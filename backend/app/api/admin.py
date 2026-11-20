"""Admin panel: how the platform is used. Access: emails from ADMIN_EMAILS in .env.
Demo users are not counted. Days are counted in the zone STATS_UTC_OFFSET (Moscow by default)."""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import activity
from app.auth.deps import require_admin
from app.config import settings
from app.db.database import get_db
from app.db.models import (Assignment, BankProblem, ChatMessage, ClassGroup, ClassMember, Diagnostic, GeneratedVideo, LearnerState,
                           LearningPath, Material, PushSubscription, Textbook, User, UserActivity, Variant, VariantAttempt)

router = APIRouter(prefix="/admin", tags=["admin"])

COUNTERS = ("solved", "ok", "checks", "checks1", "fixed")


def _local(dt: datetime | None) -> date | None:
    return (dt + timedelta(hours=settings.stats_utc_offset)).date() if dt else None


def _utc_start(d: date) -> datetime:
    """Start of a local day in UTC (created_at columns are UTC)."""
    return datetime.combine(d, datetime.min.time()) - timedelta(hours=settings.stats_utc_offset)


async def _count(db: AsyncSession, model, *where) -> int:
    return int((await db.execute(select(func.count()).select_from(model).where(*where))).scalar() or 0)


@router.get("/stats")
async def stats(days: int = 30, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    await activity.flush()  # the last minute of requests too
    days = max(7, min(days, 180))
    today = activity.today()
    start = today - timedelta(days=days - 1)
    week = today - timedelta(days=6)

    users = (await db.execute(select(User))).scalars().all()
    real = {u.id: u for u in users if not u.is_demo}
    roles = Counter(u.role for u in real.values())

    acts = (await db.execute(select(UserActivity).where(UserActivity.day >= start))).scalars().all()
    acts = [a for a in acts if a.user_id in real]
    by_day: dict[date, set[int]] = defaultdict(set)
    for a in acts:
        by_day[a.day].add(a.user_id)

    def uniq(since: date) -> int:
        return len({a.user_id for a in acts if a.day >= since})

    def sections(since: date) -> dict[str, dict]:
        out: dict[str, dict] = defaultdict(lambda: {"users": set(), "hits": 0})
        for a in acts:
            if a.day < since:
                continue
            for k, n in (a.sections or {}).items():
                out[k]["users"].add(a.user_id)
                out[k]["hits"] += int(n)
        return {k: {"users": len(v["users"]), "hits": v["hits"]} for k, v in out.items()}

    reg_by_day = Counter(_local(u.created_at) for u in real.values())
    series = []
    for i in range(days):
        d = start + timedelta(days=i)
        ids = by_day.get(d, set())
        series.append({"date": d.isoformat(), "active": len(ids),
                       "students": sum(1 for x in ids if real[x].role == "student"), "new": reg_by_day.get(d, 0)})

    s7, s30 = sections(week), sections(start)
    sec_rows = sorted(({"name": k, "users7": s7.get(k, {}).get("users", 0), "users": v["users"], "hits": v["hits"]} for k, v in s30.items()),
                      key=lambda r: -r["users"])

    # student counters from the learner states (first attempts, photo checks, fixed mistakes), kept 70 days
    states = (await db.execute(select(LearnerState))).scalars().all()
    since_s = start.isoformat()
    sums = Counter()
    funnel = Counter()
    for st in states:
        u = real.get(st.user_id)
        if u is None or u.role != "student":
            continue
        dd = st.data.get("days") or {}
        for d, c in dd.items():
            if d >= since_s:
                for k in COUNTERS:
                    sums[k] += int(c.get(k, 0))
        if any(int(c.get("solved", 0)) + int(c.get("checks", 0)) + int(c.get("checks1", 0)) for c in dd.values()) or st.data.get("prac") or st.data.get("obs"):
            funnel["worked"] += 1
        if len(st.data.get("active_days") or []) >= 3:
            funnel["days3"] += 1

    t0 = _utc_start(start)
    students = [u for u in real.values() if u.role == "student"]
    diag_done = {r for (r,) in (await db.execute(select(Diagnostic.user_id).where(Diagnostic.mode == "first", Diagnostic.finished.is_(True)))).all()}
    recent = {a.user_id for a in acts if a.day >= week}
    push_users = {r for (r,) in (await db.execute(select(PushSubscription.user_id))).all()}
    in_class = {r for (r,) in (await db.execute(select(ClassMember.student_id))).all()}

    actions = [
        ("Диагностик начато", await _count(db, Diagnostic, Diagnostic.mode == "first", Diagnostic.created_at >= t0)),
        ("Диагностик завершено", await _count(db, Diagnostic, Diagnostic.mode == "first", Diagnostic.finished.is_(True), Diagnostic.created_at >= t0)),
        ("Пробников начато", await _count(db, Diagnostic, Diagnostic.mode == "mock", Diagnostic.created_at >= t0)),
        ("Задач решено (первая попытка)", sums["solved"]),
        ("Из них верно", sums["ok"]),
        ("Проверок 2 части по фото", sums["checks"]),
        ("Проверок 1 части по фото", sums["checks1"]),
        ("Ошибок исправлено", sums["fixed"]),
        ("Вопросов помощнику от учеников", await _count(db, ChatMessage, ChatMessage.role == "user", ChatMessage.kind == "student", ChatMessage.created_at >= t0)),
        ("Вопросов помощнику от учителей", await _count(db, ChatMessage, ChatMessage.role == "user", ChatMessage.kind == "teacher", ChatMessage.created_at >= t0)),
        ("Своих задач разобрано на доске", await _count(db, GeneratedVideo, GeneratedVideo.created_at >= t0)),
        ("Траекторий собрано", await _count(db, LearningPath, LearningPath.created_at >= t0)),
        ("Конспектов и презентаций", await _count(db, Material, Material.created_at >= t0)),
        ("Учебников загружено", await _count(db, Textbook, Textbook.created_at >= t0)),
        ("Задач добавлено в банк", await _count(db, BankProblem, BankProblem.created_at >= t0)),
        ("Вариантов составлено", await _count(db, Variant, Variant.created_at >= t0)),
        ("Вариантов сдано учениками", await _count(db, VariantAttempt, VariantAttempt.created_at >= t0)),
        ("Домашних заданий выдано", await _count(db, Assignment, Assignment.created_at >= t0)),
        ("Классов создано", await _count(db, ClassGroup, ClassGroup.created_at >= t0)),
    ]

    return {
        "today": today.isoformat(), "days": days, "from": start.isoformat(),
        "admins": len(settings.admins),
        "users": {"total": len(real), "students": roles.get("student", 0), "teachers": roles.get("teacher", 0), "tutors": roles.get("tutor", 0),
                  "demo": len(users) - len(real), "new7": sum(1 for u in real.values() if (_local(u.created_at) or today) >= week),
                  "new": sum(1 for u in real.values() if (_local(u.created_at) or today) >= start),
                  "push": len(push_users & set(real)), "in_class": len(in_class & set(real))},
        "active": {"today": len(by_day.get(today, set())), "week": uniq(week), "period": uniq(start)},
        "series": series,
        "sections": sec_rows,
        "actions": [{"name": n, "value": v} for n, v in actions],
        "funnel": [
            {"name": "Зарегистрировались", "value": len(students)},
            {"name": "Заполнили профиль", "value": sum(1 for u in students if u.grade)},
            {"name": "Прошли диагностику", "value": len(diag_done & {u.id for u in students})},
            {"name": "Решали задачи или проверяли фото", "value": funnel["worked"]},
            {"name": "Занимались 3 дня и больше", "value": funnel["days3"]},
            {"name": "Заходили за последние 7 дней", "value": len(recent & {u.id for u in students})},
        ],
    }


@router.get("/users")
async def user_list(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    await activity.flush()
    today = activity.today()
    month = today - timedelta(days=29)
    users = (await db.execute(select(User).where(User.is_demo.is_(False)).order_by(User.id.desc()))).scalars().all()
    last = dict((await db.execute(select(UserActivity.user_id, func.max(UserActivity.day)).group_by(UserActivity.user_id))).all())
    acts = (await db.execute(select(UserActivity).where(UserActivity.day >= month))).scalars().all()
    d30, secs = Counter(), defaultdict(Counter)
    for a in acts:
        d30[a.user_id] += 1
        secs[a.user_id].update({k: int(v) for k, v in (a.sections or {}).items()})
    diag = Counter(r for (r,) in (await db.execute(select(Diagnostic.user_id).where(Diagnostic.finished.is_(True)))).all())
    push = Counter(r for (r,) in (await db.execute(select(PushSubscription.user_id))).all())
    classes = Counter(r for (r,) in (await db.execute(select(ClassGroup.teacher_id))).all())
    states = {s.user_id: s.data for s in (await db.execute(select(LearnerState))).scalars().all()}
    out = []
    for u in users:
        dd = (states.get(u.id) or {}).get("days") or {}
        tot = Counter()
        for c in dd.values():
            tot.update({k: int(c.get(k, 0)) for k in COUNTERS})
        out.append({
            "id": u.id, "name": u.name or "", "email": u.email, "role": u.role, "grade": u.grade, "exam": u.exam,
            "created": _local(u.created_at).isoformat() if u.created_at else None,
            "last": last[u.id].isoformat() if u.id in last else None, "days30": d30[u.id],
            "sections": [k for k, _ in secs[u.id].most_common(3)],
            "solved": tot["solved"], "ok": tot["ok"], "checks": tot["checks"] + tot["checks1"], "diags": diag[u.id],
            "push": push[u.id] > 0, "classes": classes[u.id],
        })
    return {"users": out, "today": today.isoformat()}
