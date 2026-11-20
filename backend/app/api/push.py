"""Push notifications to the phone and the computer (Web Push).

- Every in-app notification (service.notify) is also sent as a push, right after the transaction is committed.
- A daily reminder to a student on his study days: at his time of lessons (or PUSH_REMIND_TIME), not after 22:00,
  only if he has not studied yet today. Turned off in the profile.
- Works only on an https site (or localhost): otherwise the browser does not give a subscription."""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import date, datetime, time, timedelta
from functools import lru_cache
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, event, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session as OrmSession
from sqlalchemy.orm.attributes import flag_modified

from app import webpush
from app.auth.deps import get_current_user
from app.config import settings
from app.db.database import AsyncSessionLocal, get_db
from app.db.models import LearnerState, PushSubscription, User
from app.learning import engine, service
from app.learning.content import EXAMS

log = logging.getLogger(__name__)
router = APIRouter(tags=["push"])

MAX_DEVICES = 10


@lru_cache(maxsize=1)
def vapid_key():
    return webpush.load_or_create_vapid(settings.vapid_private_key, Path(settings.uploads_dir) / "vapid_private.pem")


def public_key() -> str:
    try:
        return webpush.b64u(webpush.raw_public(vapid_key()))
    except Exception as exc:  # noqa: BLE001 - a broken key must not break the site
        log.warning("VAPID key is not available: %s", exc)
        return ""


def subject() -> str:
    s = settings.vapid_subject.strip()
    if s:
        return s
    if "@" in settings.smtp_from:
        return "mailto:" + settings.smtp_from.split("<")[-1].strip(" >")
    return "https://github.com/rustsay/everest"


# ---------- sending ----------

async def _send_one(client: httpx.AsyncClient, sub: PushSubscription, data: bytes, ttl: int) -> str:
    """'ok', 'gone' (the browser dropped the subscription) or 'fail'."""
    try:
        body = webpush.encrypt(data, sub.p256dh, sub.auth)
        r = await client.post(sub.endpoint, content=body, headers={
            "Authorization": webpush.vapid_header(vapid_key(), sub.endpoint, subject()),
            "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
            "TTL": str(ttl), "Urgency": "normal",
        })
    except Exception as exc:  # noqa: BLE001
        log.warning("push to %s failed: %s", sub.id, exc)
        return "fail"
    if r.status_code in (404, 410):
        return "gone"
    if r.status_code >= 400:
        log.warning("push to %s: HTTP %s %s", sub.id, r.status_code, r.text[:200])
        return "fail"
    return "ok"


async def send_push(user_ids: list[int], title: str, body: str, go: str | None = None, tag: str | None = None, ttl: int = 86400) -> int:
    """Sends one message to every device of the users. Returns how many devices accepted it."""
    if not user_ids:
        return 0
    data = json.dumps({"title": title, "body": body[:300], "go": go or "home", "tag": tag}, ensure_ascii=False).encode()
    sent = 0
    async with AsyncSessionLocal() as db:
        subs = (await db.execute(select(PushSubscription).where(PushSubscription.user_id.in_(user_ids)))).scalars().all()
        if not subs:
            return 0
        async with httpx.AsyncClient(timeout=10) as client:
            results = await asyncio.gather(*(_send_one(client, s, data, ttl) for s in subs))
        for s, res in zip(subs, results):
            if res == "ok":
                s.last_ok, s.fails = datetime.utcnow(), 0
                sent += 1
            elif res == "gone" or (s.fails or 0) >= 20:
                await db.delete(s)
            else:
                s.fails = (s.fails or 0) + 1
        await db.commit()
    return sent


# Every in-app notification also goes out as a push, but only after the transaction is committed:
# a rolled back notification is never sent.
_tasks: set[asyncio.Task] = set()


def queue_push(db: AsyncSession, user_id: int, text: str, go: str | None) -> None:
    db.sync_session.info.setdefault("push", []).append((user_id, text, go))


@event.listens_for(OrmSession, "after_commit")
def _after_commit(sess: OrmSession) -> None:
    items = sess.info.pop("push", None)
    if not items:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    for uid, text, go in items:
        t = loop.create_task(send_push([uid], "Эверест", text, go))
        _tasks.add(t)
        t.add_done_callback(_tasks.discard)


@event.listens_for(OrmSession, "after_rollback")
def _after_rollback(sess: OrmSession) -> None:
    sess.info.pop("push", None)


# ---------- daily reminder ----------

def _plural(n: int, one: str, few: str, many: str) -> str:
    n10, n100 = n % 10, n % 100
    return one if n10 == 1 and n100 != 11 else few if 2 <= n10 <= 4 and not 12 <= n100 <= 14 else many


def local_now(sub: PushSubscription, utc: datetime) -> datetime:
    if sub.tz:
        try:
            from zoneinfo import ZoneInfo
            return utc.replace(tzinfo=ZoneInfo("UTC")).astimezone(ZoneInfo(sub.tz)).replace(tzinfo=None)
        except Exception:  # noqa: BLE001 - no tzdata or an unknown zone: the offset is enough
            pass
    return utc - timedelta(minutes=sub.tzo if sub.tzo is not None else -180)


def reminder_text(data: dict, key: str, now: datetime) -> str | None:
    """The reminder for this moment or None. Pure function: data is the learner state, now is the student's local time."""
    p = data.get("push") or {}
    d = now.date()
    if p.get("remind") is False or p.get("last") == d.isoformat():
        return None
    ps = data.get("plan") or {}
    try:
        if d > date.fromisoformat(ps.get("date") or EXAMS[key]["date"]):
            return None
    except ValueError:
        pass
    if d.weekday() not in engine.study_days(ps):
        return None
    if any(e.get("busy") for e in engine.day_events(data, d)):
        return None
    try:
        hh, mm = (int(x) for x in (ps.get("time") or settings.push_remind_time).split(":"))
    except ValueError:
        hh, mm = 17, 0
    if now.time() < time(hh, mm) or now.hour >= 22:
        return None
    if d.isoformat() in (data.get("active_days") or []):
        return None
    mins = int(ps.get("min") or 45)
    redo = sum(1 for r in (data.get("redo") or {}).values() if r.get("due", "9999") <= d.isoformat())
    text = f"Сегодня по расписанию математика, {mins} минут."
    if redo:
        text += f" И {redo} {_plural(redo, 'задача ждёт', 'задачи ждут', 'задач ждут')} в работе над ошибками."
    return text


async def remind_tick(utc: datetime | None = None) -> int:
    utc = utc or datetime.utcnow()
    out: list[tuple[int, str]] = []
    async with AsyncSessionLocal() as db:
        subs = (await db.execute(select(PushSubscription).order_by(PushSubscription.id.desc()))).scalars().all()
        newest: dict[int, PushSubscription] = {}
        for s in subs:
            newest.setdefault(s.user_id, s)
        for uid, s in newest.items():
            u = await db.get(User, uid)
            if u is None or u.role != "student" or u.is_demo or not u.grade:
                continue
            row = await db.get(LearnerState, uid)
            if row is None:
                continue
            now = local_now(s, utc)
            text = reminder_text(row.data, service.key_for(u), now)
            if text is None:
                continue
            p = dict(row.data.get("push") or {})
            p["last"] = now.date().isoformat()
            row.data["push"] = p
            flag_modified(row, "data")  # not service.touch: a reminder is not a day of lessons
            out.append((uid, text))
        await db.commit()
    n = 0
    for uid, text in out:
        n += await send_push([uid], "Пора заниматься", text, "plan", tag="remind", ttl=4 * 3600)
    return n


async def remind_loop() -> None:
    while True:
        await asyncio.sleep(300)
        try:
            n = await remind_tick()
            if n:
                log.info("push reminders: %s sent", n)
        except Exception:  # noqa: BLE001
            log.exception("push reminders failed")


# ---------- API ----------

class Keys(BaseModel):
    p256dh: str = Field(..., max_length=120)
    auth: str = Field(..., max_length=40)


class SubIn(BaseModel):
    endpoint: str = Field(..., max_length=1000)
    keys: Keys


class SubscribeIn(BaseModel):
    subscription: SubIn
    tz: str = Field("", max_length=60)
    tzo: int = Field(-180, ge=-900, le=900)
    agent: str = Field("", max_length=120)


def _check(sub: SubIn) -> None:
    if not webpush.endpoint_allowed(sub.endpoint):
        raise HTTPException(422, "Неизвестный сервис уведомлений")
    try:
        if len(webpush.unb64u(sub.keys.p256dh)) != 65 or len(webpush.unb64u(sub.keys.auth)) != 16:
            raise ValueError
    except ValueError:
        raise HTTPException(422, "Неверные ключи подписки")


async def _settings(db: AsyncSession, user: User) -> dict:
    devices = (await db.execute(select(PushSubscription).where(PushSubscription.user_id == user.id))).scalars().all()
    row = await db.get(LearnerState, user.id)
    data = row.data if row else {}
    return {"key": public_key(), "devices": len(devices), "remind": (data.get("push") or {}).get("remind") is not False,
            "time": (data.get("plan") or {}).get("time") or settings.push_remind_time, "student": user.role == "student"}


@router.get("/push/key")
async def push_key():
    return {"key": public_key()}


@router.get("/push/settings")
async def push_settings(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await _settings(db, user)


@router.post("/push/subscribe")
async def subscribe(body: SubscribeIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.is_demo:
        raise HTTPException(400, "В демо уведомления не включаются")
    _check(body.subscription)
    sub = (await db.execute(select(PushSubscription).where(PushSubscription.endpoint == body.subscription.endpoint))).scalars().first()
    if sub is None:
        sub = PushSubscription(endpoint=body.subscription.endpoint)
        db.add(sub)
    # the same browser may now belong to another account: notifications follow the one who is signed in
    sub.user_id, sub.p256dh, sub.auth = user.id, body.subscription.keys.p256dh, body.subscription.keys.auth
    sub.tz, sub.tzo, sub.agent, sub.fails = body.tz, body.tzo, body.agent, 0
    await db.flush()
    mine = (await db.execute(select(PushSubscription).where(PushSubscription.user_id == user.id)
                             .order_by(PushSubscription.id.desc()))).scalars().all()
    for old in mine[MAX_DEVICES:]:
        await db.delete(old)
    await db.commit()
    return await _settings(db, user)


class EndpointIn(BaseModel):
    endpoint: str = Field(..., max_length=1000)


@router.post("/push/unsubscribe")
async def unsubscribe(body: EndpointIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(PushSubscription).where(PushSubscription.user_id == user.id, PushSubscription.endpoint == body.endpoint))
    await db.commit()
    return await _settings(db, user)


class RenewIn(BaseModel):
    old_endpoint: str = Field(..., max_length=1000)
    subscription: SubIn


@router.post("/push/renew")
async def renew(body: RenewIn, db: AsyncSession = Depends(get_db)):
    """The browser replaced the subscription (pushsubscriptionchange in sw.js). No token there: the old address is the proof."""
    _check(body.subscription)
    sub = (await db.execute(select(PushSubscription).where(PushSubscription.endpoint == body.old_endpoint))).scalars().first()
    if sub is None:
        raise HTTPException(404, "Подписка не найдена")
    taken = (await db.execute(select(PushSubscription).where(PushSubscription.endpoint == body.subscription.endpoint))).scalars().first()
    if taken is not None and taken.id != sub.id:
        await db.delete(taken)
        await db.flush()
    sub.endpoint, sub.p256dh, sub.auth, sub.fails = body.subscription.endpoint, body.subscription.keys.p256dh, body.subscription.keys.auth, 0
    await db.commit()
    return {"ok": True}


class RemindIn(BaseModel):
    remind: bool


@router.put("/push/settings")
async def put_push_settings(body: RemindIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await service.get_state(db, user.id)
    p = dict(row.data.get("push") or {})
    p["remind"] = body.remind
    row.data["push"] = p
    flag_modified(row, "data")
    await db.commit()
    return await _settings(db, user)


@router.post("/push/test")
async def push_test(user: User = Depends(get_current_user)):
    n = await send_push([user.id], "Эверест", "Уведомления работают. Так будут приходить напоминания и новости.", "home", tag="test")
    if not n:
        raise HTTPException(400, "Не удалось отправить: включите уведомления на этом устройстве ещё раз")
    return {"sent": n}
