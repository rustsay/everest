"""Knowledge map of one exam task: prototypes, what to know, practice problems, files (new design)."""
from __future__ import annotations

import logging
import uuid
from pathlib import Path

import aiofiles
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.config import settings
from app.db import crud_learning as crud
from app.db.database import get_db
from app.db.models import Diagnostic, TaskFile, User
from app.learning import engine, service
from app.learning.content import PROF_P1
from app.learning.taskmaps import AVAILABLE, SKILLS, TASK_MAPS, problem_index

log = logging.getLogger(__name__)
router = APIRouter(tags=["taskmaps"])

FILE_EXT = {".pdf", ".png", ".jpg", ".jpeg", ".docx", ".pptx"}
MAX_FILE = 20 * 1024 * 1024


def _map(n: int) -> dict:
    if n not in TASK_MAPS:
        raise HTTPException(404, "Карта этого задания ещё не готова")
    return TASK_MAPS[n]


async def _diag_entries(db: AsyncSession, user: User, n: int) -> list[tuple[str, list[str], int]]:
    """(prototype, skills, 0/1) for this task's items in every finished diagnostic and mock."""
    tm = TASK_MAPS[n]
    if service.key_for(user) != "prof" or n not in PROF_P1:
        return []
    res = await db.execute(select(Diagnostic).where(Diagnostic.user_id == user.id, Diagnostic.finished.is_(True),
                                                    Diagnostic.exam_key == "prof"))
    out = []
    for d in res.scalars():
        vi = d.variant % len(PROF_P1[n])
        tag = tm["diag"].get(vi)
        if tag is None:
            continue
        ok = engine.same_ans((d.answers or {}).get(f"p{n}_{vi}"), PROF_P1[n][vi]["a"])
        out.append((tag[0], tag[1], 1 if ok else 0))
    return out


def _stat(vals: list[int]) -> dict:
    return {"pct": round(100 * sum(vals) / len(vals)) if vals else None, "ok": sum(vals), "count": len(vals)}


async def _files_visible(db: AsyncSession, user: User, n: int) -> list[TaskFile]:
    owners = {user.id}
    if user.role == "student":
        owners |= {c.teacher_id for c in await crud.student_classes(db, user.id)}
    res = await db.execute(select(TaskFile).where(TaskFile.task_n == n, TaskFile.owner_id.in_(owners)).order_by(TaskFile.id))
    return list(res.scalars())


@router.get("/taskmaps")
async def list_maps(user: User = Depends(get_current_user)):
    return {"maps": [{"n": n, "name": TASK_MAPS[n]["name"]} for n in AVAILABLE]}


@router.get("/taskmaps/{n}")
async def get_map(n: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    tm = _map(n)
    row = await service.get_state(db, user.id)
    done: dict = row.data.get("tm", {})
    diag = await _diag_entries(db, user, n)
    files = await _files_visible(db, user, n)
    skill_vals: dict[str, list[int]] = {k: [] for k in SKILLS}
    all_vals: list[int] = []
    protos = []
    for pr in tm["protos"]:
        vals = [done[p["id"]] for p in pr["problems"] if p["id"] in done]
        for p in pr["problems"]:
            if p["id"] in done:
                for s in p["skills"]:
                    skill_vals[s].append(done[p["id"]])
        for proto, skills, v in diag:
            if proto == pr["id"]:
                vals.append(v)
                for s in skills:
                    skill_vals[s].append(v)
        all_vals += vals
        protos.append({
            "id": pr["id"], "name": pr["name"], "fig": pr["fig"], "skills": pr["skills"], "know": pr["know"],
            "added": pr.get("added"), "links": pr["links"], **_stat(vals),
            "from_diag": sum(1 for proto, _, _ in diag if proto == pr["id"]),
            "problems": [{"id": p["id"], "q": p["q"], "done": done.get(p["id"]),
                          "sol": p["sol"] if p["id"] in done else None} for p in pr["problems"]],
            "files": [{"id": f.id, "name": f.name, "size": f.size, "mine": f.owner_id == user.id} for f in files if f.proto == pr["id"]],
        })
    used = {s for pr in tm["protos"] for s in pr["skills"]}
    return {
        "n": n, "name": tm["name"], "codifier": tm["codifier"],
        "skills": [{"id": k, "name": SKILLS[k]["name"], "know": SKILLS[k]["know"], **_stat(skill_vals[k])} for k in SKILLS if k in used],
        "protos": protos,
        "total": {**_stat(all_vals), "covered": sum(1 for p in protos if p["count"]), "of": len(protos)},
        "can_upload": user.role in ("teacher", "tutor"),
    }


class AnswerIn(BaseModel):
    problem_id: str = Field(..., max_length=20)
    answer: str = Field("", max_length=40)


@router.post("/taskmaps/{n}/answer")
async def answer(n: int, body: AnswerIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _map(n)
    idx = problem_index(n)
    if body.problem_id not in idx:
        raise HTTPException(404, "Нет такой задачи")
    _, p = idx[body.problem_id]
    ok = engine.same_ans(body.answer, p["a"])
    row = await service.get_state(db, user.id)
    done = row.data.setdefault("tm", {})
    first = body.problem_id not in done
    if first:  # the percentage counts the first attempt only: after it the solution is shown
        done[body.problem_id] = 1 if ok else 0
        service.gain(row, 30 if ok else 5)
    service.touch(row)
    await db.commit()
    return {"ok": ok, "first": first, "answer": p["a"], "sol": p["sol"]}


@router.post("/taskmaps/{n}/files")
async def upload_file(n: int, proto: str = Form(...), file: UploadFile = File(...),
                      user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    tm = _map(n)
    if user.role not in ("teacher", "tutor"):
        raise HTTPException(403, "Файлы добавляет учитель или репетитор")
    if proto not in {p["id"] for p in tm["protos"]}:
        raise HTTPException(404, "Нет такого прототипа")
    name = Path(file.filename or "file").name[:200]
    ext = Path(name).suffix.lower()
    if ext not in FILE_EXT:
        raise HTTPException(400, "Можно PDF, картинки, DOCX и PPTX")
    data = await file.read()
    if not data or len(data) > MAX_FILE:
        raise HTTPException(400, "Файл пустой или больше 20 МБ")
    dest = Path(settings.uploads_dir) / "taskfiles" / f"{uuid.uuid4().hex}{ext}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    async with aiofiles.open(dest, "wb") as f:
        await f.write(data)
    tf = TaskFile(owner_id=user.id, task_n=n, proto=proto, name=name, path=str(dest), size=len(data))
    db.add(tf)
    await db.commit()
    return {"id": tf.id, "name": tf.name, "size": tf.size}


async def _visible_file(db: AsyncSession, user: User, file_id: int) -> TaskFile:
    tf = await db.get(TaskFile, file_id)
    if tf is None or tf.id not in {f.id for f in await _files_visible(db, user, tf.task_n)}:
        raise HTTPException(404, "Файл не найден")
    return tf


@router.get("/taskfiles/{file_id}")
async def download_file(file_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    tf = await _visible_file(db, user, file_id)
    if not Path(tf.path).exists():
        raise HTTPException(404, "Файл не найден на диске")
    return FileResponse(tf.path, filename=tf.name)


@router.delete("/taskfiles/{file_id}")
async def delete_file(file_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    tf = await db.get(TaskFile, file_id)
    if tf is None or tf.owner_id != user.id:
        raise HTTPException(404, "Файл не найден")
    Path(tf.path).unlink(missing_ok=True)
    await db.delete(tf)
    await db.commit()
    return {"ok": True}
