"""DB side of the learning model: state per student, history, notifications, hooks."""
from __future__ import annotations

import logging
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.db.models import LearnerState, Measurement, Notification, User
from app.learning import engine
from app.learning.content import ACHIEVEMENTS, EXAMS

log = logging.getLogger(__name__)

DEFAULT_STATE: dict = {
    "xp": 0, "ach": {}, "eggs": {}, "vdone": {}, "plan": {}, "plan_done": {}, "mocks": 0,
    "daily": {}, "care": {"breaks": True, "sleep": True, "every": 45}, "sound": True, "voice": False,
    "active_days": [], "chest": False, "hunt": False, "onb": "new",
}


def key_for(user: User) -> str:
    return engine.exam_key(user.grade, user.exam)


async def get_state(db: AsyncSession, user_id: int) -> LearnerState:
    row = await db.get(LearnerState, user_id)
    if row is None:
        data = {**DEFAULT_STATE}
        engine.ensure_mastery(data)
        row = LearnerState(user_id=user_id, data=data)
        db.add(row)
        await db.flush()
    else:
        for k, v in DEFAULT_STATE.items():
            row.data.setdefault(k, v)
        engine.ensure_mastery(row.data)
    return row


def touch(row: LearnerState) -> None:
    """JSONB is mutated in place: tell SQLAlchemy and mark today as an active day."""
    today = date.today().isoformat()
    days = row.data.setdefault("active_days", [])
    if today not in days:
        days.append(today)
        row.data["active_days"] = days[-60:]
    flag_modified(row, "data")


def gain(row: LearnerState, metres: int) -> None:
    row.data["xp"] = int(row.data.get("xp", 0)) + int(metres)
    if row.data["xp"] >= 8848:
        unlock(row, "summit")


def unlock(row: LearnerState, ach_id: str) -> bool:
    if ach_id not in {a["id"] for a in ACHIEVEMENTS}:
        return False
    ach = row.data.setdefault("ach", {})
    if ach_id in ach:
        return False
    ach[ach_id] = datetime.utcnow().isoformat()
    return True


async def add_measurement(db: AsyncSession, user: User, row: LearnerState, source: str) -> int:
    key = key_for(user)
    model = engine.build_model(row.data, key)
    value = engine.forecast_value(model, key)
    db.add(Measurement(user_id=user.id, value=value, source=source[:80],
                       mastery=dict(row.data.get("mastery", {})), unknown=list(row.data.get("unknown", []))))
    return value


async def history(db: AsyncSession, user_id: int, limit: int = 30) -> list[Measurement]:
    res = await db.execute(
        select(Measurement).where(Measurement.user_id == user_id).order_by(Measurement.created_at.desc(), Measurement.id.desc()).limit(limit)
    )
    return list(reversed(res.scalars().all()))


async def notify(db: AsyncSession, user_id: int, text: str, go: str | None = None) -> None:
    db.add(Notification(user_id=user_id, text=text[:300], go=go))


async def on_task_checked(db: AsyncSession, user_id: int, task_id: int, score: int, max_score: int) -> None:
    """Hook after the multi-agent photo check: the result feeds the forecast and the schedule."""
    user = await db.get(User, user_id)
    if user is None or user.role != "student":
        return
    row = await get_state(db, user_id)
    key = key_for(user)
    tid = f"T{task_id}"
    if any(t["id"] == tid for t in EXAMS[key]["tasks"]) and max_score:
        engine.observe_task(row.data, tid, score / max_score)
        # before the first diagnostic the forecast rests on default values, so no point on the chart yet
        from app.db.crud_learning import last_finished_diagnostic
        if row.data.get("onb") == "skipped" or await last_finished_diagnostic(db, user_id) is not None:
            await add_measurement(db, user, row, f"проверка задания {task_id}")
    unlock(row, "first_check")
    gain(row, 80)
    touch(row)
    await notify(db, user_id, f"Проверка задания {task_id}: {score} из {max_score}. Прогноз и расписание обновлены", "home")
    await db.commit()
    log.info("learning: user=%s task=%s %s/%s applied", user_id, task_id, score, max_score)
