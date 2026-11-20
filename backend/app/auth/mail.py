"""Email codes: 6 digits, 15 minutes, 5 tries, a new code not more often than once a minute.
Sent through SMTP (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM). Without SMTP_HOST the code goes to the log."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import secrets
import smtplib
import ssl
from datetime import datetime, timedelta
from email.message import EmailMessage

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import EmailCode

log = logging.getLogger(__name__)
TTL = timedelta(minutes=15)
RESEND = timedelta(seconds=60)
TRIES = 5
SUBJECT = {"register": "Код для регистрации в «Эвересте»", "reset": "Код для смены пароля в «Эвересте»"}
WHAT = {"register": "подтверждения почты", "reset": "смены пароля"}


def _hash(email: str, code: str) -> str:
    return hashlib.sha256(f"{settings.secret_key}:{email}:{code}".encode()).hexdigest()


def _send_smtp(to: str, subject: str, text: str) -> None:
    msg = EmailMessage()
    msg["From"] = settings.smtp_from or settings.smtp_user
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    ctx = ssl.create_default_context()
    if settings.smtp_port == 465:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, context=ctx, timeout=20) as s:
            if settings.smtp_user:
                s.login(settings.smtp_user, settings.smtp_password)
            s.send_message(msg)
    else:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as s:
            s.starttls(context=ctx)
            if settings.smtp_user:
                s.login(settings.smtp_user, settings.smtp_password)
            s.send_message(msg)


async def send_code(db: AsyncSession, email: str, purpose: str) -> None:
    now = datetime.utcnow()
    last = (await db.execute(select(EmailCode).where(EmailCode.email == email, EmailCode.purpose == purpose)
                             .order_by(EmailCode.id.desc()))).scalars().first()
    if last and now - last.created_at < RESEND:
        left = int((RESEND - (now - last.created_at)).total_seconds()) + 1
        raise HTTPException(429, f"Код уже отправлен. Новый можно запросить через {left} с")
    code = f"{secrets.randbelow(1_000_000):06d}"
    await db.execute(delete(EmailCode).where(EmailCode.email == email, EmailCode.purpose == purpose))
    db.add(EmailCode(email=email, purpose=purpose, code_hash=_hash(email, code), attempts=0, expires_at=now + TTL, created_at=now))
    await db.commit()
    text = (f"Здравствуйте!\n\nВаш код для {WHAT[purpose]}: {code}\nКод действует 15 минут.\n\n"
            "Если вы не запрашивали код, просто удалите это письмо.\n«Эверест»")
    if not settings.smtp_ready:
        log.warning("SMTP не настроен. Код %s для %s: %s", WHAT[purpose], email, code)
        return
    try:
        await asyncio.to_thread(_send_smtp, email, SUBJECT[purpose], text)
    except Exception as exc:  # noqa: BLE001
        log.exception("smtp failed: %s", exc)
        raise HTTPException(502, "Не получилось отправить письмо. Проверьте адрес или попробуйте позже")


async def check_code(db: AsyncSession, email: str, purpose: str, code: str) -> None:
    """Raises 400 if the code is wrong or old; a right code is used up."""
    row = (await db.execute(select(EmailCode).where(EmailCode.email == email, EmailCode.purpose == purpose)
                            .order_by(EmailCode.id.desc()))).scalars().first()
    if row is None or row.expires_at < datetime.utcnow():
        raise HTTPException(400, "Код устарел или не запрашивался. Запросите новый")
    if row.attempts >= TRIES:
        raise HTTPException(400, "Слишком много попыток. Запросите новый код")
    if not secrets.compare_digest(row.code_hash, _hash(email, (code or "").strip())):
        row.attempts += 1
        await db.commit()
        raise HTTPException(400, f"Неверный код. Осталось попыток: {TRIES - row.attempts}")
    await db.delete(row)
