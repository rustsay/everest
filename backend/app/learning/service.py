"""DB side of the learning model: state per student, history, notifications, hooks."""
from __future__ import annotations

import logging
from datetime import date, timedelta, datetime

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
    from app.api.push import queue_push  # the same text goes to the phone after the commit
    queue_push(db, user_id, text[:300], go)


def count(row: LearnerState, k: str, n: int = 1) -> None:
    """Daily counters for the weekly report: solved, ok, checks, checks1, fixed, diag (kept 70 days)."""
    days = row.data.setdefault("days", {})
    today = date.today().isoformat()
    d = days.setdefault(today, {})
    d[k] = int(d.get(k, 0)) + n
    if len(days) > 70:
        for old in sorted(days)[:-70]:
            days.pop(old)


def on_practice(user: User, row: LearnerState, task_n: int, ok: bool) -> None:
    """First attempt at a short-answer problem: feeds the forecast and the schedule of this exam (task maps are ЕГЭ профиль)."""
    if user.role == "student":
        count(row, "solved")
        if ok:
            count(row, "ok")
    tid = f"T{task_n}"
    if user.role == "student" and any(t["id"] == tid for t in EXAMS[key_for(user)]["tasks"]):
        engine.observe_practice(row.data, tid, ok)


# ---------- «Работа над ошибками»: a wrong problem comes back in 3 days, then in 7, until it is solved twice ----------

REDO_STEPS = (3, 7)


def redo_ref(task_n: int, pid: str) -> str:
    """The address of a problem from its id on the task map."""
    from app.learning.exambank import is_ref
    if is_ref(pid):  # OGE / base bank: g7.14.3, e12.3
        return pid
    return pid if (pid[:1] in ("f", "b") and pid[1:].isdigit()) else f"s{task_n}:{pid}"


def redo_add(row: LearnerState, ref: str, task_n: int) -> None:
    redo = row.data.setdefault("redo", {})
    redo[ref] = {"task": task_n, "step": 0, "due": (date.today() + timedelta(days=REDO_STEPS[0])).isoformat(),
                 "added": date.today().isoformat(), "tries": 0}


def redo_answer(row: LearnerState, ref: str, ok: bool) -> str | None:
    """A later answer to a problem from the list: right -> the next interval or done; wrong -> again in 3 days.
    Returns "next", "done", "again" or None (not in the list)."""
    redo = row.data.get("redo") or {}
    r = redo.get(ref)
    if r is None:
        return None
    r["tries"] = int(r.get("tries", 0)) + 1
    if not ok:
        r.update(step=0, due=(date.today() + timedelta(days=REDO_STEPS[0])).isoformat())
        return "again"
    if r["step"] + 1 >= len(REDO_STEPS):
        redo.pop(ref)
        row.data["redo_done"] = int(row.data.get("redo_done", 0)) + 1
        count(row, "fixed")
        gain(row, 40)
        return "done"
    r.update(step=r["step"] + 1, due=(date.today() + timedelta(days=REDO_STEPS[r["step"] + 1])).isoformat())
    return "next"


def redo_due(row: LearnerState, today: date | None = None) -> list[str]:
    t = (today or date.today()).isoformat()
    return sorted((ref for ref, r in (row.data.get("redo") or {}).items() if r["due"] <= t), key=lambda ref: row.data["redo"][ref]["due"])


async def active_path(db: AsyncSession, user: User, row: LearnerState):
    """The trajectory the schedule follows: the student's own approved one, else the class one;
    a student on his own can switch his off."""
    from app.db.crud_learning import student_classes
    from app.db.models import LearningPath
    classes = await student_classes(db, user.id)
    if not classes and not row.data.get("path_follow", True):
        return None
    res = await db.execute(select(LearningPath).where(LearningPath.student_id == user.id, LearningPath.status == "active").order_by(LearningPath.id.desc()))
    p = res.scalars().first()
    if p is None and classes:
        res = await db.execute(select(LearningPath).where(LearningPath.class_id.in_([c.id for c in classes]), LearningPath.status == "active")
                               .order_by(LearningPath.id.desc()))
        p = res.scalars().first()
    if p is not None and p.data.get("exam") != key_for(user):
        return None  # a class path for another exam does not fit
    return p


async def route_basis(db: AsyncSession, user_id: int, row: LearnerState, path=None) -> str:
    """What today's route rests on: 'path' - a trajectory, 'diag' - a diagnostic, 'practice' - answers and photo checks, 'start' - nothing yet."""
    from app.db.crud_learning import last_finished_diagnostic
    if path is not None:
        return "path"
    if await last_finished_diagnostic(db, user_id) is not None:
        return "diag"
    return "practice" if row.data.get("prac") or row.data.get("obs") else "start"


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
        if await last_finished_diagnostic(db, user_id) is not None:
            await add_measurement(db, user, row, f"проверка задания {task_id}")
    unlock(row, "first_check")
    count(row, "checks")
    gain(row, 80)
    touch(row)
    await notify(db, user_id, f"Проверка задания {task_id}: {score} из {max_score}. Прогноз и расписание обновлены", "home")
    await db.commit()
    log.info("learning: user=%s task=%s %s/%s applied", user_id, task_id, score, max_score)
