"""Weekly reports: the student's own, the teacher's over his classes, and an email to a parent once a week
(only when SMTP is set up; the address is given by the student in the settings)."""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.teacher import require_teacher
from app.auth.deps import get_current_user
from app.config import settings
from app.db import crud_learning as crud
from app.db.database import AsyncSessionLocal, get_db
from app.db.models import LearnerState, User
from app.learning import engine, report, service

log = logging.getLogger(__name__)
router = APIRouter(tags=["report"])


async def _week(db: AsyncSession, u: User, row: LearnerState, today: date) -> dict:
    key = service.key_for(u)
    model = engine.build_model(row.data, key)
    hist = [(h.created_at.date(), h.value) for h in await service.history(db, u.id, 60) if h.created_at]
    return report.week(row.data, model, key, hist, today)


@router.get("/report/week")
async def my_week(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await service.get_state(db, user.id)
    w = await _week(db, user, row, date.today())
    return {**w, "parent_email": row.data.get("parent_email"), "smtp": settings.smtp_ready}


@router.get("/teacher/report/week")
async def class_week(teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    today = date.today()
    out = []
    for cg in await crud.teacher_classes(db, teacher.id):
        rows = []
        for s in await crud.class_students(db, cg.id):
            row = await service.get_state(db, s.id)
            w = await _week(db, s, row, today)
            flag = "нет занятий" if w["active"] == 0 else "прогноз упал" if (w["delta"] or 0) < 0 else \
                "много ошибок" if w["acc"] is not None and w["acc"] < 50 and w["solved"] >= 4 else None
            rows.append({"id": s.id, "name": s.name or s.email, **{k: w[k] for k in ("active", "solved", "ok", "acc", "checks", "checks1",
                         "fixed", "forecast", "delta", "pct", "max", "gap", "redo_due")}, "flag": flag})
        out.append({"id": cg.id, "name": cg.name, "students": sorted(rows, key=lambda r: (r["flag"] is None, r["name"]))})
    await db.commit()
    from datetime import timedelta
    return {"from": (today - timedelta(days=6)).isoformat(), "to": today.isoformat(), "classes": out}


class ParentIn(BaseModel):
    email: EmailStr | None = None


@router.put("/me/parent")
async def set_parent(body: ParentIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != "student":
        raise HTTPException(400, "Отчёт родителю есть только у ученика")
    row = await service.get_state(db, user.id)
    if body.email:
        row.data["parent_email"] = str(body.email).lower()
    else:
        row.data.pop("parent_email", None)
    service.touch(row)
    await db.commit()
    return {"parent_email": row.data.get("parent_email"), "smtp": settings.smtp_ready}


def iso_week(d: date) -> str:
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


async def weekly_tick() -> int:
    """Once a week (from Monday 9:00): a notification to every student who did something, and an email to a parent if
    the address is set and SMTP works. Returns how many emails were sent."""
    from app.auth.mail import _send_smtp
    now = datetime.now()
    if now.weekday() != 0 or now.hour < 9:
        return 0
    wk, sent = iso_week(now.date()), 0
    async with AsyncSessionLocal() as db:
        states = (await db.execute(select(LearnerState))).scalars().all()
        for row in states:
            if row.data.get("report_week") == wk:
                continue
            u = await db.get(User, row.user_id)
            if u is None or u.role != "student" or u.is_demo:
                continue
            w = await _week(db, u, row, now.date())
            row.data["report_week"] = wk
            service.touch(row)
            if w["active"]:
                await service.notify(db, u.id, "Итоги недели готовы: что сделано и что дальше", "report")
            mail = row.data.get("parent_email")
            if mail and settings.smtp_ready:
                text = (f"Здравствуйте!\n\nИтоги недели в «Эвересте» ({report.ru(w['from'])} - {report.ru(w['to'])}). Ученик: {u.name or u.email}.\n\n"
                        + "\n".join("- " + x for x in w["lines"]) + "\n\nПисьмо приходит раз в неделю. Отключить можно в настройках ученика.\n«Эверест»")
                try:
                    await asyncio.to_thread(_send_smtp, mail, "Итоги недели в «Эвересте»", text)
                    sent += 1
                except Exception as exc:  # noqa: BLE001
                    log.warning("weekly email to parent of %s failed: %s", u.id, exc)
            await db.commit()
    return sent


async def weekly_loop() -> None:
    while True:
        try:
            n = await weekly_tick()
            if n:
                log.info("weekly reports: %s emails sent", n)
        except Exception:  # noqa: BLE001 - the loop must survive a bad hour
            log.exception("weekly reports failed")
        await asyncio.sleep(3600)
