"""Knowledge map of one exam task: prototypes, skills, practice problems, files, skill explanations from the textbook."""
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
from app.config import NO_LLM, settings
from app.db import crud_learning as crud
from app.db.database import get_db
from app.db.models import BankProblem, Diagnostic, SkillExplanation, TaskFile, Textbook, User
from app.learning import engine, llm, service, textbook_search
from app.learning.content import PROF_P1
from app.learning import fipi
from app.learning.taskmaps import AVAILABLE, PART2, SKILLS, TASK_MAPS, problem_index

log = logging.getLogger(__name__)
router = APIRouter(tags=["taskmaps"])

FILE_EXT = {".pdf", ".png", ".jpg", ".jpeg", ".docx", ".pptx"}
MAX_FILE = 20 * 1024 * 1024


def _map(n: int) -> dict:
    if n not in TASK_MAPS:
        raise HTTPException(404, "Карта этого задания ещё не готова")
    return TASK_MAPS[n]


async def _diag_entries(db: AsyncSession, user: User, n: int) -> list[tuple[str, int]]:
    """(prototype, 0/1) for this task's item in every finished diagnostic and mock."""
    tm = TASK_MAPS[n]
    if service.key_for(user) != "prof" or n not in PROF_P1 or not tm["diag"]:
        return []
    res = await db.execute(select(Diagnostic).where(Diagnostic.user_id == user.id, Diagnostic.finished.is_(True),
                                                    Diagnostic.exam_key == "prof"))
    out = []
    for d in res.scalars():
        if (d.answers or {}).get("_fmt") == "types":  # the diagnostic by types: every prototype of the task was asked
            from app.learning.diag_types import prof_items
            for it in prof_items():
                if it.get("n") == n and it.get("type"):
                    ans = (d.answers or {}).get(it["id"])
                    if ans and ans != "?":
                        out.append((it["proto"], 1 if engine.same_ans(ans, it["a"]) else 0))
                    elif ans == "?":
                        out.append((it["proto"], 0))
            continue
        vi = d.variant % len(PROF_P1[n])
        proto = tm["diag"].get(vi)
        if proto is None:
            continue
        ok = engine.same_ans((d.answers or {}).get(f"p{n}_{vi}"), PROF_P1[n][vi]["a"])
        out.append((proto, 1 if ok else 0))
    return out


def _stat(vals: list[int]) -> dict:
    return {"pct": round(100 * sum(vals) / len(vals)) if vals else None, "ok": sum(vals), "count": len(vals)}


async def _files_visible(db: AsyncSession, user: User, n: int) -> list[TaskFile]:
    owners = {user.id}
    if user.role == "student":
        owners |= {c.teacher_id for c in await crud.student_classes(db, user.id)}
    res = await db.execute(select(TaskFile).where(TaskFile.task_n == n, TaskFile.owner_id.in_(owners)).order_by(TaskFile.id))
    return list(res.scalars())


async def _bank(db: AsyncSession, n: int) -> list[BankProblem]:
    res = await db.execute(select(BankProblem).where(BankProblem.task_n == n, BankProblem.status == "approved").order_by(BankProblem.id))
    return list(res.scalars())


def _problems(n: int, pr: dict, bank: list[BankProblem]) -> list[dict]:
    """Static problems of the prototype + approved bank problems, one shape: id, q, a, sol, skills."""
    out = [{"id": p["id"], "q": p["q"], "a": p["a"], "sol": p["sol"], "skills": p["skills"], "src": ""} for p in pr["problems"]]
    for p in fipi.problems(n, pr["id"]):
        out.append({"id": p["pid"], "q": p["q"], "a": p["a"], "sol": p["sol"], "skills": pr["skills"], "src": p["src"],
                    "img": p["img"], "ans_img": p["ans_img"]})
    for b in bank:
        if b.proto == pr["id"]:
            out.append({"id": f"b{b.id}", "q": b.text, "a": b.answer, "sol": b.solution or "", "skills": pr["skills"], "src": b.source})
    return out


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
    bank = await _bank(db, n)
    used = [s for pr in tm["protos"] for s in pr["skills"]]
    skill_vals: dict[str, list[int]] = {k: [] for k in dict.fromkeys(used)}
    all_vals: list[int] = []
    protos = []
    for pr in tm["protos"]:
        probs = _problems(n, pr, bank)
        vals = []
        for p in probs:
            if p["id"] in done:
                vals.append(done[p["id"]])
                for s in p["skills"]:
                    skill_vals.setdefault(s, []).append(done[p["id"]])
        for proto, v in diag:
            if proto == pr["id"]:
                vals.append(v)
                for s in pr["skills"]:
                    skill_vals[s].append(v)
        all_vals += vals
        protos.append({
            "id": pr["id"], "name": pr["name"], "fig": pr.get("fig"), "skills": pr["skills"], "know": pr.get("know", []),
            "added": pr.get("added"), "links": pr.get("links", []), **_stat(vals),
            "from_diag": sum(1 for proto, _ in diag if proto == pr["id"]),
            "problems": [{"id": p["id"], "q": p["q"], "done": done.get(p["id"]), "src": p["src"],
                          "check": "answer" if p["a"] else "photo",
                          "sol": p["sol"] if p["id"] in done else None, "img": p.get("img"), "ans_img": p.get("ans_img")} for p in probs],
            "files": [{"id": f.id, "name": f.name, "size": f.size, "mine": f.owner_id == user.id} for f in files if f.proto == pr["id"]],
        })
    return {
        "n": n, "name": tm["name"], "part": 2 if n in PART2 else 1,
        "skills": [{"id": k, "name": SKILLS[k]["name"], "short": SKILLS[k]["short"], "know": SKILLS[k]["know"], "fig": SKILLS[k]["fig"],
                    **_stat(skill_vals[k])} for k in skill_vals],
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
    pid = body.problem_id
    if pid.startswith("f") and pid[1:].isdigit():
        fp = fipi.by_ref().get(pid)
        if fp is None or fp["task"] != n:
            raise HTTPException(404, "Нет такой задачи")
        right, sol = fp["a"], fp["sol"]
    elif pid.startswith("b") and pid[1:].isdigit():
        b = await db.get(BankProblem, int(pid[1:]))
        if b is None or b.status != "approved" or b.task_n != n:
            raise HTTPException(404, "Нет такой задачи")
        right, sol = b.answer, b.solution or ""
    else:
        idx = problem_index(n)
        if pid not in idx:
            raise HTTPException(404, "Нет такой задачи")
        right, sol = idx[pid][1]["a"], idx[pid][1]["sol"]
    if not right:
        raise HTTPException(400, "У этой задачи нет короткого ответа: решите её и отправьте на проверку по фото")
    ok = engine.same_ans(body.answer, right)
    row = await service.get_state(db, user.id)
    done = row.data.setdefault("tm", {})
    first = pid not in done
    redo = None
    if first:  # the percentage counts the first attempt only: after it the solution is shown
        done[pid] = 1 if ok else 0
        service.on_practice(user, row, n, ok)
        service.gain(row, 30 if ok else 5)
        if not ok and user.role == "student":
            service.redo_add(row, service.redo_ref(n, pid), n)
            redo = "added"
    else:
        redo = service.redo_answer(row, service.redo_ref(n, pid), ok)
    service.touch(row)
    await db.commit()
    return {"ok": ok, "first": first, "answer": right, "sol": sol or "Решение к этой задаче не добавлено.", "redo": redo}


# ---------- explanation of a skill from the textbook ----------

async def _books_for(db: AsyncSession, user: User) -> list[Textbook]:
    owners = {user.id}
    if user.role == "student":
        owners |= {c.teacher_id for c in await crud.student_classes(db, user.id)}
    res = await db.execute(select(Textbook).where(Textbook.owner_id.in_(owners)).order_by(Textbook.id))
    return [b for b in res.scalars() if (b.text or "").strip()]


class ExplainIn(BaseModel):
    textbook_id: int | None = None


@router.post("/skills/{skill_id}/explain")
async def explain(skill_id: str, body: ExplainIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    sk = SKILLS.get(skill_id)
    if sk is None:
        raise HTTPException(404, "Нет такого умения")
    books = await _books_for(db, user)
    if body.textbook_id is not None:
        books = [b for b in books if b.id == body.textbook_id]
    if not books:
        raise HTTPException(404, "Учебника с текстом пока нет: его загружает учитель в разделе «Конспекты и презентации»"
                            if user.role == "student" else "Загрузите учебник с текстом в разделе «Конспекты и презентации»")
    scored = sorted(((textbook_search.best_pages(b.text, sk["keys"]), b) for b in books), key=lambda x: -x[0][0])
    (total, frags), book = scored[0]
    if total <= 0:
        return {"text": None, "book": {"id": book.id, "title": book.title, "authors": book.authors}, "pages": [],
                "message": "В загруженных учебниках не нашлось страниц про это умение. Можно спросить помощника."}
    cached = (await db.execute(select(SkillExplanation).where(SkillExplanation.skill == skill_id, SkillExplanation.textbook_id == book.id))).scalars().first()
    out_book = {"id": book.id, "title": book.title, "authors": book.authors}
    if cached:
        return {"text": cached.text, "book": out_book, "pages": cached.pages, "cached": True}
    if not settings.llm_ready:
        raise HTTPException(503, NO_LLM)
    fragments = "\n\n".join(f"[[{label}]]\n{body_}" for label, body_ in frags)
    try:
        text = await llm.explain_skill(sk["name"], out_book, fragments)
    except Exception as exc:
        log.exception("skill explanation failed: %s", exc)
        raise HTTPException(502, "Объяснение сейчас недоступно. Попробуйте через минуту.")
    labels = [label for label, _ in frags]
    db.add(SkillExplanation(skill=skill_id, textbook_id=book.id, text=text, pages=labels))
    await db.commit()
    return {"text": text, "book": out_book, "pages": labels, "cached": False}


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
