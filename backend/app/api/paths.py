"""Educational trajectories: a student builds one for himself; in a class the teacher accepts it.
The teacher or tutor can also build one for a student or for a whole class."""
from __future__ import annotations

import logging
from collections import Counter
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.teacher import require_teacher
from app.auth.deps import get_current_user
from app.config import settings
from app.db import crud_learning as crud
from app.db.database import get_db
from app.db.models import ClassGroup, LearningPath, User
from app.learning import engine, llm, paths, problems, service
from app.learning.content import EXAMS

log = logging.getLogger(__name__)
router = APIRouter(tags=["paths"])


# ---------- building ----------

async def _photo_errors(db: AsyncSession, ids: list[int], limit: int = 8) -> list[str]:
    out: list[str] = []
    for _, r in reversed(await crud.student_task_results(db, ids)):
        for v in r.agent_verdicts or []:
            for e in v.get("errors_found") or []:
                line = f"№ {r.task_id}: {str(e)[:160]}"
                if line not in out:
                    out.append(line)
        if len(out) >= limit:
            break
    return out[:limit]


async def _pool(db: AsyncSession, key: str) -> dict[str, list[dict]]:
    if key != "prof":
        return {}
    pool: dict[str, list[dict]] = {}
    for p in await problems.approved(db):
        pool.setdefault(f"T{p['task']}", []).append(p)
    return pool


async def _build(db: AsyncSession, kind: str, key: str, who: str, model: dict, facts: list[dict], basis: list[str],
                 extra: list[str], state: dict, done: dict | None, target: dict | None = None, p2_open: bool = False) -> dict:
    today = date.today()
    end, dw, mins = paths.plan_settings(state, key)
    end = paths.exam_end_ok(end, today)
    allowed = {t["id"]: t["name"] for t in model["tasks"]}
    part2 = {t["id"] for t in model["tasks"] if t["part"] == 2}
    extra = list(extra)
    if target and key == "prof":
        extra.append(f"Цель ученика: {target['test']} тестовых баллов = {target['primary']} первичных (шкала 2026 г.).")
    if part2:
        extra.append("Вторая часть: " + ("ученик уже решает часть заданий второй части." if p2_open else
                                          "по диагностике пока не решается - сначала первая часть."))
    data = None
    if settings.llm_ready:
        try:
            raw = await llm.build_path(paths.prompt_facts(kind, who, key, today, end, facts, basis, extra, dw, mins), kind)
            data = paths.validate(raw, allowed, today, end)
            if data and not p2_open and data["stages"]:  # the second part never goes first while it is not solved
                data["stages"][0]["tasks"] = [t for t in data["stages"][0]["tasks"] if t not in part2]
                data["stages"] = [s for s in data["stages"] if s["tasks"]]
            if data and data["stages"]:
                data["source"] = "ai"
            else:
                data = None
        except Exception:  # noqa: BLE001 - any failure of the model falls back to the rules
            log.exception("path: model failed")
        if data is None:
            data = paths.rules_path(model, key, today, end, basis, target, p2_open)
            data["fallback"] = "ИИ не дал подходящего ответа, траектория собрана по правилам"
    else:
        data = paths.rules_path(model, key, today, end, basis, target, p2_open)
    data["exam"], data["end"], data["built"] = key, end.isoformat(), today.isoformat()
    data["labels"] = {t["id"]: paths.label(t) for t in model["tasks"]}
    data["nums"] = {t["id"]: t.get("n") for t in model["tasks"]}
    paths.attach_problems(data, await _pool(db, key), done)
    return data


async def _for_student(db: AsyncSession, st: User) -> dict:
    key = service.key_for(st)
    row = await service.get_state(db, st.id)
    model = engine.build_model(row.data, key)
    diag = await crud.last_finished_diagnostic(db, st.id) is not None
    basis = paths.basis_lines(diag, row.data)
    errs = await _photo_errors(db, [st.id])
    extra = (["Ошибки из проверки по фото:"] + [f"- {e}" for e in errs]) if errs else []
    sim = {t["id"]: min(1.0, t["p"]) for t in model["tasks"]}
    return await _build(db, "student", key, st.name or "ученик", model, paths.task_facts(model, row.data), basis or ["данных пока нет"],
                        extra, row.data, row.data.get("tm"), row.data.get("target"), engine.part2_open(row.data, model["tasks"], sim))


async def _for_class(db: AsyncSession, cg: ClassGroup, teacher: User) -> dict:
    studs = await crud.class_students(db, cg.id)
    if not studs:
        raise HTTPException(400, "В классе пока нет учеников: траекторию не из чего собрать")
    keys = Counter(service.key_for(s) for s in studs)
    key = keys.most_common(1)[0][0]
    same = [s for s in studs if service.key_for(s) == key]
    models, with_data = [], 0
    for s in same:
        row = await service.get_state(db, s.id)
        models.append(engine.build_model(row.data, key))
        if row.data.get("prac") or row.data.get("obs") or await crud.last_finished_diagnostic(db, s.id):
            with_data += 1
    model = paths.avg_model(models)
    basis = [f"{len(same)} учеников, данные есть у {with_data}"]
    if len(same) < len(studs):
        basis.append(f"ещё {len(studs) - len(same)} готовятся к другому экзамену и не учтены")
    errs = await _photo_errors(db, [s.id for s in same], 10)
    extra = (["Частые ошибки в проверке по фото:"] + [f"- {e}" for e in errs]) if errs else []
    teacher_row = await service.get_state(db, teacher.id)
    sim = {t["id"]: min(1.0, t["p"]) for t in model["tasks"]}
    return await _build(db, "class", key, f"класс {cg.name}", model, paths.task_facts(model, None), basis, extra, teacher_row.data, None,
                        None, engine.part2_open({}, model["tasks"], sim))


# ---------- view ----------

async def _out(db: AsyncSession, p: LearningPath | None) -> dict | None:
    if p is None:
        return None
    names = {}
    for uid in {p.author_id, p.approved_by, p.student_id} - {None}:
        u = await db.get(User, uid)
        names[uid] = (u.name or u.email) if u else ""
    cg = await db.get(ClassGroup, p.class_id) if p.class_id else None
    return {"id": p.id, "status": p.status, "kind": "class" if p.class_id else "student", "student_id": p.student_id,
            "student_name": names.get(p.student_id), "class_id": p.class_id, "class_name": cg.name if cg else None,
            "author": names.get(p.author_id), "approved_by": names.get(p.approved_by), "note": p.note, "data": p.data,
            "created_at": p.created_at.isoformat() if p.created_at else None, "approved_at": p.approved_at.isoformat() if p.approved_at else None}


async def _latest(db: AsyncSession, *conds) -> LearningPath | None:
    return (await db.execute(select(LearningPath).where(*conds).order_by(LearningPath.id.desc()))).scalars().first()


# ---------- student ----------

@router.get("/path")
async def my_path(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != "student":
        raise HTTPException(403, "Траектория ученика")
    classes = await crud.student_classes(db, user.id)
    row = await service.get_state(db, user.id)
    active = await _latest(db, LearningPath.student_id == user.id, LearningPath.status == "active")
    pending = await _latest(db, LearningPath.student_id == user.id, LearningPath.status == "pending")
    rejected = await _latest(db, LearningPath.student_id == user.id, LearningPath.status == "rejected")
    if rejected and ((active and active.id > rejected.id) or (pending and pending.id > rejected.id)):
        rejected = None
    class_path = None
    if classes and not active:
        class_path = await _latest(db, LearningPath.class_id.in_([c.id for c in classes]), LearningPath.status == "active")
    teachers = []
    for c in classes:
        t = await db.get(User, c.teacher_id)
        if t and (t.name or t.email) not in teachers:
            teachers.append(t.name or t.email)
    return {"mode": "class" if classes else "solo", "teachers": teachers, "follow": bool(row.data.get("path_follow", True)),
            "building": bool(row.data.get("path_building")), "target": row.data.get("target"),
            "llm_ready": settings.llm_ready, "active": await _out(db, active), "pending": await _out(db, pending),
            "rejected": await _out(db, rejected), "class_path": await _out(db, class_path)}


async def _save_student_path(db: AsyncSession, user: User, data: dict) -> LearningPath:
    """Solo student: the path is active at once. In a class: it waits for the teacher."""
    classes = await crud.student_classes(db, user.id)
    if classes:
        for old in (await db.execute(select(LearningPath).where(LearningPath.student_id == user.id, LearningPath.status == "pending"))).scalars():
            old.status = "archived"
        p = LearningPath(student_id=user.id, author_id=user.id, status="pending", data=data)
        db.add(p)
        for t_id in {c.teacher_id for c in classes}:
            await service.notify(db, t_id, f"{user.name or 'Ученик'} собрал образовательную траекторию: проверьте и утвердите", "paths")
    else:
        for old in (await db.execute(select(LearningPath).where(LearningPath.student_id == user.id, LearningPath.status == "active"))).scalars():
            old.status = "archived"
        p = LearningPath(student_id=user.id, author_id=user.id, status="active", data=data, approved_at=datetime.utcnow())
        db.add(p)
        row = await service.get_state(db, user.id)
        row.data["path_follow"] = True
        service.touch(row)
    return p


@router.post("/path/generate")
async def generate_mine(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != "student":
        raise HTTPException(403, "Траектория ученика")
    p = await _save_student_path(db, user, await _for_student(db, user))
    await db.commit()
    await db.refresh(p)
    return await _out(db, p)


async def auto_build(user_id: int) -> None:
    """In the background after the diagnostic or a new goal: the trajectory is built without a button."""
    from app.db.database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        user = await db.get(User, user_id)
        if user is None or user.role != "student":
            return
        row = await service.get_state(db, user_id)
        row.data["path_building"] = True
        service.touch(row)
        await db.commit()
        try:
            data = await _for_student(db, user)
            await _save_student_path(db, user, data)
            await service.notify(db, user_id, "Траектория собрана по диагностике и цели" if not await crud.student_classes(db, user_id)
                                 else "Траектория собрана и отправлена учителю на утверждение", "path")
        except Exception:  # noqa: BLE001
            log.exception("auto path for user %s failed", user_id)
        finally:
            row = await service.get_state(db, user_id)
            row.data["path_building"] = False
            service.touch(row)
            await db.commit()


class FollowIn(BaseModel):
    follow: bool


@router.post("/path/follow")
async def follow_mine(body: FollowIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if await crud.student_classes(db, user.id):
        raise HTTPException(400, "В классе траекторию утверждает учитель")
    row = await service.get_state(db, user.id)
    row.data["path_follow"] = body.follow
    service.touch(row)
    await db.commit()
    return {"follow": body.follow}


# ---------- teacher / tutor ----------

async def _scope(db: AsyncSession, teacher: User) -> tuple[list[ClassGroup], dict[int, list[int]], dict[int, User]]:
    classes = await crud.teacher_classes(db, teacher.id)
    members: dict[int, list[int]] = {}
    users: dict[int, User] = {}
    for c in classes:
        studs = await crud.class_students(db, c.id)
        members[c.id] = [s.id for s in studs]
        users.update({s.id: s for s in studs})
    return classes, members, users


async def _own_path(db: AsyncSession, teacher: User, pid: int) -> LearningPath:
    p = await db.get(LearningPath, pid)
    classes, _, users = await _scope(db, teacher)
    if p is None or not ((p.class_id and p.class_id in {c.id for c in classes}) or (p.student_id and p.student_id in users)):
        raise HTTPException(404, "Траектория не найдена")
    return p


@router.get("/teacher/paths")
async def teacher_paths(teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    classes, members, users = await _scope(db, teacher)
    sids, cids = list(users), [c.id for c in classes]
    rows = list((await db.execute(select(LearningPath).where(or_(LearningPath.student_id.in_(sids or [-1]), LearningPath.class_id.in_(cids or [-1])),
                                                       LearningPath.status.in_(["draft", "pending", "active"])).order_by(LearningPath.id.desc()))).scalars())

    def state_of(cond) -> dict:
        mine = [p for p in rows if cond(p)]
        return {"active": next((p.id for p in mine if p.status == "active"), None), "pending": next((p.id for p in mine if p.status == "pending"), None),
                "draft": next((p.id for p in mine if p.status == "draft"), None)}

    return {
        "pending": [await _out(db, p) for p in rows if p.status == "pending"],
        "classes": [{"id": c.id, "name": c.name, "students": len(members[c.id]), **state_of(lambda p, c=c: p.class_id == c.id)} for c in classes],
        "students": [{"id": u.id, "name": u.name or u.email, "exam": EXAMS[service.key_for(u)]["short"],
                      "classes": [c.name for c in classes if u.id in members[c.id]], **state_of(lambda p, u=u: p.student_id == u.id)}
                     for u in sorted(users.values(), key=lambda x: x.name or x.email)],
        "llm_ready": settings.llm_ready,
    }


@router.get("/teacher/paths/{pid}")
async def teacher_path(pid: int, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    return await _out(db, await _own_path(db, teacher, pid))


class GenIn(BaseModel):
    student_id: int | None = None
    class_id: int | None = None


@router.post("/teacher/paths/generate")
async def teacher_generate(body: GenIn, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    classes, _, users = await _scope(db, teacher)
    if body.class_id is not None:
        cg = next((c for c in classes if c.id == body.class_id), None)
        if cg is None:
            raise HTTPException(404, "Класс не найден")
        data = await _for_class(db, cg, teacher)
        target = {"class_id": cg.id}
        cond = LearningPath.class_id == cg.id
    elif body.student_id is not None and body.student_id in users:
        data = await _for_student(db, users[body.student_id])
        target = {"student_id": body.student_id}
        cond = LearningPath.student_id == body.student_id
    else:
        raise HTTPException(404, "Ученик не найден в ваших классах")
    for old in (await db.execute(select(LearningPath).where(cond, LearningPath.status == "draft"))).scalars():
        old.status = "archived"
    p = LearningPath(author_id=teacher.id, status="draft", data=data, **target)
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return await _out(db, p)


class StageIn(BaseModel):
    title: str = Field(..., max_length=80)
    goal: str = Field("", max_length=300)
    check: str = Field("", max_length=200)
    from_: str = Field(..., alias="from")
    to: str
    tasks: list[str] = Field(default_factory=list, max_length=8)
    steps: list[str] = Field(default_factory=list, max_length=10)


class EditIn(BaseModel):
    stages: list[StageIn] | None = Field(None, max_length=8)
    summary: str | None = Field(None, max_length=600)
    note: str | None = Field(None, max_length=1000)


@router.put("/teacher/paths/{pid}")
async def teacher_edit(pid: int, body: EditIn, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    p = await _own_path(db, teacher, pid)
    if p.status not in ("draft", "pending", "active"):
        raise HTTPException(400, "Эту траекторию уже нельзя менять")
    data = dict(p.data)
    if body.stages is not None:
        today = date.today()
        allowed = {k: v for k, v in (data.get("labels") or {}).items()}
        end = date.fromisoformat(data.get("end") or EXAMS[data.get("exam", "prof")]["date"])
        raw = {"summary": data.get("summary", ""), "why": data.get("why", []),
               "stages": [{"title": s.title, "goal": s.goal, "check": s.check, "from": s.from_, "to": s.to, "tasks": s.tasks, "steps": s.steps}
                          for s in body.stages]}
        checked = paths.validate(raw, allowed, min(today, date.fromisoformat(data.get("built") or today.isoformat())), end)
        if not checked:
            raise HTTPException(400, "Нужен хотя бы один этап с заданиями и датами до экзамена")
        old = {s["title"]: s.get("problems", []) for s in data.get("stages", [])}
        for s in checked["stages"]:
            s["problems"] = old.get(s["title"], [])
        data["stages"] = checked["stages"]
        data["edited"] = True
    if body.summary is not None:
        data["summary"] = body.summary.strip()
    p.data = data
    if body.note is not None:
        p.note = body.note.strip()
    await db.commit()
    return await _out(db, p)


async def _notify_target(db: AsyncSession, p: LearningPath, text: str) -> None:
    ids = [p.student_id] if p.student_id else [s.id for s in await crud.class_students(db, p.class_id)]
    for sid in ids:
        await service.notify(db, sid, text, "path")


@router.post("/teacher/paths/{pid}/approve")
async def teacher_approve(pid: int, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    p = await _own_path(db, teacher, pid)
    if p.status not in ("draft", "pending"):
        raise HTTPException(400, "Траектория уже утверждена или закрыта")
    cond = LearningPath.class_id == p.class_id if p.class_id else LearningPath.student_id == p.student_id
    for old in (await db.execute(select(LearningPath).where(cond, LearningPath.status.in_(["active", "pending"]), LearningPath.id != p.id))).scalars():
        old.status = "archived"
    p.status, p.approved_by, p.approved_at = "active", teacher.id, datetime.utcnow()
    await _notify_target(db, p, f"{teacher.name or 'Учитель'} утвердил образовательную траекторию" + (f": {p.note[:120]}" if p.note else ""))
    await db.commit()
    return await _out(db, p)


class RejectIn(BaseModel):
    note: str = Field("", max_length=1000)


@router.post("/teacher/paths/{pid}/reject")
async def teacher_reject(pid: int, body: RejectIn, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    p = await _own_path(db, teacher, pid)
    if p.status == "draft":
        await db.delete(p)
    elif p.status in ("pending", "active"):
        was = p.status
        p.status, p.note = ("rejected" if was == "pending" else "archived"), body.note.strip() or p.note
        await _notify_target(db, p, ("Учитель вернул траекторию на доработку" if was == "pending" else "Учитель отменил траекторию")
                             + (f": {body.note.strip()[:120]}" if body.note.strip() else ""))
    await db.commit()
    return {"ok": True}
