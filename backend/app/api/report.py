"""Weekly reports for students and teachers, with in-app notifications."""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.teacher import require_teacher
from app.auth.deps import get_current_user
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
    return await _week(db, user, row, date.today())


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


def iso_week(d: date) -> str:
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


async def weekly_tick() -> int:
    """Once a week (from Monday 9:00), notify active students. Return the number of notifications created."""
    now = datetime.now()
    if now.weekday() != 0 or now.hour < 9:
        return 0
    wk, notified = iso_week(now.date()), 0
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
                notified += 1
            await db.commit()
    return notified


async def weekly_loop() -> None:
    while True:
        try:
            n = await weekly_tick()
            if n:
                log.info("weekly reports: %s notifications created", n)
        except Exception:  # noqa: BLE001 - the loop must survive a bad hour
            log.exception("weekly reports failed")
        await asyncio.sleep(3600)
