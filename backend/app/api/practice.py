"""Task bank for students (practice) and variants composed by teachers and tutors from the bank."""
from __future__ import annotations

import random
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.teacher import require_teacher
from app.auth.deps import get_current_user
from app.db import crud_learning as crud
from app.db.database import get_db
from app.db.models import ClassGroup, User, Variant, VariantAttempt
from app.learning import engine, problems, service
from app.learning.taskmaps import TASK_MAPS

router = APIRouter(tags=["practice"])
MAX_ITEMS = 40


def _public(p: dict, done: dict | None = None) -> dict:
    """A problem as a student sees it: no answer; solution only after the first attempt."""
    d = (done or {}).get(p["pid"])
    fig = next((x.get("fig") for x in (TASK_MAPS.get(p["task"]) or {}).get("protos", []) if x["id"] == p["proto"]), None)
    return {"ref": p["ref"], "pid": p["pid"], "task": p["task"], "proto": p["proto"], "proto_name": p["proto_name"], "q": p["q"], "fig": fig,
            "src": p["src"], "check": "answer" if p["a"] else "photo", "done": d, "sol": p["sol"] if d is not None else None,
            "img": p.get("img"), "ans_img": p.get("ans_img")}


# ---------- student: the bank ----------

@router.get("/practice")
async def practice(task: int | None = None, proto: str | None = None, user: User = Depends(get_current_user),
                   db: AsyncSession = Depends(get_db)):
    row = await service.get_state(db, user.id)
    done = row.data.get("tm", {})
    items = await problems.approved(db, task, proto)
    counts: dict[int, int] = {}
    for p in await problems.approved(db):
        counts[p["task"]] = counts.get(p["task"], 0) + 1
    return {"items": [_public(p, done) for p in items[:300]], "counts": counts,
            "tasks": [{"n": n, "name": m["name"], "protos": [{"id": p["id"], "name": p["name"]} for p in m["protos"]]} for n, m in TASK_MAPS.items()]}


# ---------- «Работа над ошибками» ----------

@router.get("/redo")
async def redo_list(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Problems due again today (without answers), and how many wait for later."""
    row = await service.get_state(db, user.id)
    redo = row.data.get("redo") or {}
    due = service.redo_due(row)
    found = await problems.resolve(db, due)
    items = []
    for ref in due:
        p = found.get(ref)
        if p is None:
            continue
        r = redo[ref]
        items.append({**_public(p), "done": None, "sol": None, "step": r["step"], "added": r["added"], "tries": r.get("tries", 0)})
    later = sorted((r["due"] for ref, r in redo.items() if ref not in due))
    return {"items": items, "later": len(later), "next": later[0] if later else None, "done": int(row.data.get("redo_done", 0))}


# ---------- teacher: variants ----------

class VariantIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    items: list[str] = Field(default_factory=list, max_length=MAX_ITEMS)
    auto_tasks: list[int] = Field(default_factory=list, max_length=19)  # pick one random published problem per task
    class_id: int | None = None
    due: date | None = None


async def _check_class(db: AsyncSession, teacher: User, class_id: int | None) -> None:
    if class_id is None:
        return
    cg = await db.get(ClassGroup, class_id)
    if cg is None or cg.teacher_id != teacher.id:
        raise HTTPException(404, "Класс не найден")


async def _auto(db: AsyncSession, tasks: list[int]) -> list[str]:
    out = []
    for n in sorted(set(t for t in tasks if t in TASK_MAPS)):
        pool = await problems.approved(db, n)
        if pool:
            out.append(random.choice(pool)["ref"])
    return out


@router.get("/variants/candidates")
async def candidates(task: int, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    return {"items": [{**_public(p), "answer": p["a"]} for p in await problems.approved(db, task)]}


@router.post("/variants")
async def create_variant(body: VariantIn, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    await _check_class(db, teacher, body.class_id)
    refs = list(dict.fromkeys(body.items)) or await _auto(db, body.auto_tasks)
    found = await problems.resolve(db, refs)
    refs = [r for r in refs if r in found]
    if not refs:
        raise HTTPException(400, "В банке пока нет опубликованных задач для этих заданий")
    v = Variant(owner_id=teacher.id, title=body.title.strip(), items=refs, class_id=body.class_id, due=body.due)
    db.add(v)
    await db.commit()
    await db.refresh(v)
    return {"id": v.id, "items": len(refs), "missing": [n for n in body.auto_tasks if n in TASK_MAPS and not any(found[r]["task"] == n for r in refs)]}


class VariantEdit(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    items: list[str] | None = Field(None, max_length=MAX_ITEMS)
    class_id: int | None = None
    due: date | None = None
    unassign: bool = False


@router.put("/variants/{vid}")
async def edit_variant(vid: int, body: VariantEdit, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    v = await db.get(Variant, vid)
    if v is None or v.owner_id != teacher.id:
        raise HTTPException(404, "Вариант не найден")
    if body.title is not None:
        v.title = body.title.strip()
    if body.items is not None:
        found = await problems.resolve(db, body.items)
        v.items = [r for r in dict.fromkeys(body.items) if r in found]
    if body.unassign:
        v.class_id, v.due = None, None
    elif body.class_id is not None:
        await _check_class(db, teacher, body.class_id)
        v.class_id, v.due = body.class_id, body.due
    await db.commit()
    return {"ok": True}


@router.delete("/variants/{vid}")
async def delete_variant(vid: int, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    v = await db.get(Variant, vid)
    if v is None or v.owner_id != teacher.id:
        raise HTTPException(404, "Вариант не найден")
    for a in (await db.execute(select(VariantAttempt).where(VariantAttempt.variant_id == vid))).scalars():
        await db.delete(a)
    await db.delete(v)
    await db.commit()
    return {"ok": True}


# ---------- both sides ----------

async def _visible(db: AsyncSession, user: User, v: Variant | None) -> Variant:
    if v is None:
        raise HTTPException(404, "Вариант не найден")
    if v.owner_id == user.id:
        return v
    if v.class_id is not None and v.class_id in {c.id for c in await crud.student_classes(db, user.id)}:
        return v
    raise HTTPException(404, "Вариант не найден")


@router.get("/variants")
async def list_variants(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role in ("teacher", "tutor"):
        vs = list((await db.execute(select(Variant).where(Variant.owner_id == user.id).order_by(Variant.id.desc()))).scalars())
    else:
        cls = [c.id for c in await crud.student_classes(db, user.id)]
        vs = list((await db.execute(select(Variant).where(Variant.class_id.in_(cls)).order_by(Variant.id.desc()))).scalars()) if cls else []
    names = {c.id: c.name for c in (await db.execute(select(ClassGroup).where(ClassGroup.id.in_([v.class_id for v in vs if v.class_id])))).scalars()} if vs else {}
    mine = {a.variant_id: a for a in (await db.execute(select(VariantAttempt).where(VariantAttempt.user_id == user.id))).scalars()}
    return {"variants": [{"id": v.id, "title": v.title, "count": len(v.items or []), "class_id": v.class_id, "class_name": names.get(v.class_id),
                          "due": v.due.isoformat() if v.due else None,
                          "attempt": {"score": mine[v.id].score, "max": mine[v.id].max_score} if v.id in mine else None} for v in vs]}


@router.get("/variants/{vid}")
async def get_variant(vid: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    v = await _visible(db, user, await db.get(Variant, vid))
    found = await problems.resolve(db, v.items or [])
    items = [found[r] for r in v.items or [] if r in found]
    owner = v.owner_id == user.id
    attempt = (await db.execute(select(VariantAttempt).where(VariantAttempt.variant_id == v.id, VariantAttempt.user_id == user.id))).scalars().first()
    out = {"id": v.id, "title": v.title, "class_id": v.class_id, "due": v.due.isoformat() if v.due else None, "owner": owner,
           "items": [{**_public(p), "answer": p["a"] if owner or attempt else None,
                      "sol": p["sol"] if owner or attempt else None} for p in items]}
    if attempt:
        out["attempt"] = {"answers": attempt.answers, "results": attempt.results, "score": attempt.score, "max": attempt.max_score}
    if owner:
        rows = list((await db.execute(select(VariantAttempt, User).join(User, User.id == VariantAttempt.user_id)
                                      .where(VariantAttempt.variant_id == v.id).order_by(VariantAttempt.score.desc()))).all())
        out["results"] = [{"name": u.name or u.email, "score": a.score, "max": a.max_score, "results": a.results} for a, u in rows]
    return out


class SubmitIn(BaseModel):
    answers: dict[str, str] = Field(default_factory=dict)


@router.post("/variants/{vid}/submit")
async def submit_variant(vid: int, body: SubmitIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    v = await _visible(db, user, await db.get(Variant, vid))
    if (await db.execute(select(VariantAttempt).where(VariantAttempt.variant_id == v.id, VariantAttempt.user_id == user.id))).scalars().first():
        raise HTTPException(400, "Вариант уже сдан")
    found = await problems.resolve(db, v.items or [])
    results, score, mx = {}, 0, 0
    row = await service.get_state(db, user.id)
    tm = row.data.setdefault("tm", {})
    for r in v.items or []:
        p = found.get(r)
        if not p or not p["a"]:
            continue  # second-part problems without a short answer go to the photo check
        mx += 1
        ok = engine.same_ans(body.answers.get(r, ""), p["a"])
        results[r] = 1 if ok else 0
        score += results[r]
        if p["pid"] not in tm:  # the first attempt counts: for the task maps and for the schedule
            tm[p["pid"]] = results[r]
            service.on_practice(user, row, p["task"], ok)
            if not ok:
                service.redo_add(row, p["ref"], p["task"])
        else:
            service.redo_answer(row, p["ref"], ok)
    answers = {k: str(val)[:40] for k, val in body.answers.items() if k in (v.items or [])}
    db.add(VariantAttempt(variant_id=v.id, user_id=user.id, answers=answers, results=results, score=score, max_score=mx))
    service.gain(row, 20 * score)
    service.touch(row)
    await db.commit()
    return {"score": score, "max": mx}
