"""Photo check by the exam of the student. First part (profile 1-12, OGE 1-19, base 1-21): the answer and a photo of the solution. With a problem of the bank the key
decides right or wrong and the model only reads the solution (a computing slip or a wrong method); with an own problem
the model solves it itself, and the student is told that this check has no key.
Second part of OGE (20-25): /check2, a score 0-2 by the photo against the answer of the collection. The profile's second part is
the multi-agent check of sessions (api/router.py)."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.config import NO_LLM, settings
from app.db.database import get_db
from app.db.models import User
from app.learning import engine, llm, problems, service

log = logging.getLogger(__name__)
router = APIRouter(tags=["check1"])
MAX_BYTES = 15 * 1024 * 1024
HISTORY = 30


# parts of each exam: (first task, last task) of the first and of the second part; base has one part
PARTS = {"prof": ((1, 12), (13, 19)), "oge": ((1, 19), (20, 25)), "base": ((1, 21), None)}


def _exam(user: User, exam: str | None) -> str:
    """A student checks tasks of his exam; a teacher picks one (the switch of the cabinet)."""
    if user.role != "student" and exam in PARTS:
        return exam
    k = service.key_for(user)
    return k if k in PARTS else "prof"


async def _photos(files: list[UploadFile]) -> list[bytes]:
    if not files or len(files) > 5:
        raise HTTPException(400, "Прикрепите от 1 до 5 фото решения")
    from app.api.batch import file_pages
    from app.ocr.pipeline import get_scan_jpegs
    pages: list[tuple[bytes, str]] = []
    for f in files:
        data = await f.read()
        if len(data) > MAX_BYTES:
            raise HTTPException(400, "Файл больше 15 МБ")
        pages += file_pages(data, f.filename or "photo.jpg", 10 - len(pages))
    return await asyncio.get_event_loop().run_in_executor(None, get_scan_jpegs, [(b, f"p{i}.jpg") for i, (b, _) in enumerate(pages)])


async def _problem(db: AsyncSession, ref: str, task: int, problem: str, key: str) -> dict | None:
    p = (await problems.resolve(db, [ref])).get(ref) if ref else None
    if ref and p is None:
        raise HTTPException(404, "Нет такой задачи в банке")
    if p is not None and p["task"] != task:
        raise HTTPException(400, f"Это задача задания № {p['task']}")
    if p is not None and p.get("exam", "prof") != key:
        raise HTTPException(400, "Это задача другого экзамена")
    if p is None and not problem.strip():
        raise HTTPException(400, "Впишите условие задачи или выберите задачу из банка")
    return p


@router.post("/check1")
async def check_first_part(task: int = Form(..., ge=1, le=25), answer: str = Form("", max_length=40), ref: str = Form("", max_length=40),
                           problem: str = Form("", max_length=3000), exam: str = Form(""), files: list[UploadFile] = File(...),
                           user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not settings.llm_ready:
        raise HTTPException(503, NO_LLM)
    key = _exam(user, exam)
    lo, hi = PARTS[key][0]
    if not lo <= task <= hi:
        raise HTTPException(400, f"Здесь проверяются задания {lo}-{hi}")
    imgs = await _photos(files)
    p = await _problem(db, ref, task, problem, key)
    try:
        if p is not None and p["a"]:
            text = p["q"]
            from app.api.diag_work import _problem_image
            if pic := _problem_image(p):
                imgs = [pic] + imgs  # the exact condition first (OGE 1-5: with the shared text): the text of bank pictures is rough
                text = "условие на первой картинке, решение ученика на следующих"
            ok = engine.same_ans(answer, p["a"])
            r = await llm.analyze_short(text, p["a"], answer, imgs)
            out = {"ok": ok, "right": p["a"], "keyed": True, **{k: r[k] for k in ("method_ok", "error", "comment")}}
        else:
            r = await llm.check_short_nokey(problem.strip(), answer, imgs)
            out = {"ok": r["ok"], "right": r["answer"] or None, "keyed": False, **{k: r[k] for k in ("method_ok", "error", "comment")}}
    except Exception as exc:  # noqa: BLE001
        log.exception("check1 failed: %s", exc)
        raise HTTPException(502, "Проверка сейчас недоступна. Попробуйте через минуту.")
    kind = "ok" if out["ok"] and out["method_ok"] else "ok_doubt" if out["ok"] else "slip" if out["method_ok"] or out["error"] == "вычислительная" else "method"
    out["kind"] = kind
    row = await service.get_state(db, user.id)
    first = False
    if p is not None and p["a"] and user.role == "student":
        tm = row.data.setdefault("tm", {})
        if p["pid"] not in tm:  # the first attempt counts for the task map and the schedule, as with a typed answer
            tm[p["pid"]] = 1 if out["ok"] else 0
            service.on_practice(user, row, task, out["ok"])
            service.gain(row, 30 if out["ok"] else 5)
            first = True
            if not out["ok"]:
                service.redo_add(row, p["ref"], task)
        elif p["a"]:
            out["redo"] = service.redo_answer(row, p["ref"], out["ok"])
    if user.role == "student":
        service.count(row, "checks1")
    hist = row.data.setdefault("check1", [])
    hist.insert(0, {"at": datetime.now().isoformat(timespec="minutes"), "task": task, "ref": ref or None, "exam": key,
                    "problem": (p["q"] if p else problem.strip())[:300], "answer": answer, **out})
    del hist[HISTORY:]
    service.touch(row)
    await db.commit()
    return {**out, "first": first, "sol": (p or {}).get("sol") or ""}


@router.get("/check1")
async def history(exam: str = "", user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Checks of the first part of this exam (old records without an exam are the profile's)."""
    key = _exam(user, exam)
    row = await service.get_state(db, user.id)
    return {"items": [h for h in row.data.get("check1", []) if h.get("exam", "prof") == key]}


@router.post("/check2")
async def check_second_part(task: int = Form(..., ge=20, le=25), ref: str = Form("", max_length=40), problem: str = Form("", max_length=3000),
                            exam: str = Form(""), files: list[UploadFile] = File(...),
                            user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """OGE 20-25 by the photo: 0-2 points. A bank problem is graded against the answer of the collection; an own one without a key."""
    if not settings.llm_ready:
        raise HTTPException(503, NO_LLM)
    key = _exam(user, exam)
    if key != "oge":
        raise HTTPException(400, "Вторая часть по фото здесь - для ОГЭ. Профиль проверяется в «Вторая часть» через новую проверку")
    imgs = await _photos(files)
    p = await _problem(db, ref, task, problem, key)
    from app.api.diag_work import _pic, _problem_image
    from app.learning.content import EXAMS
    mx = next((t["max"] for t in EXAMS["oge"]["tasks"] if t["n"] == task), 2)
    key_img = None
    if p is not None and p.get("ans_img") and (kp := _pic(p["ans_img"])):
        key_img = kp.read_bytes()
    try:
        r = await llm.grade_long(p["q"] if p else problem.strip(), mx, imgs, _problem_image(p) if p else None, key_img)
    except Exception as exc:  # noqa: BLE001
        log.exception("check2 failed: %s", exc)
        raise HTTPException(502, "Проверка сейчас недоступна. Попробуйте через минуту.")
    out = {"score": r["score"], "max": mx, "comment": r["comment"], "keyed": key_img is not None or bool(p and p.get("a")),
           "ans_img": (p or {}).get("ans_img"), "answer_text": (p or {}).get("answer_text") or (p or {}).get("a")}
    row = await service.get_state(db, user.id)
    hist = row.data.setdefault("check2", [])
    hist.insert(0, {"at": datetime.now().isoformat(timespec="minutes"), "task": task, "ref": ref or None, "exam": key,
                    "problem": (p["q"] if p else problem.strip())[:300], **out})
    del hist[HISTORY:]
    service.touch(row)
    await db.commit()
    # like the profile's photo check: the score feeds the forecast and the schedule
    await service.on_task_checked(db, user.id, task, r["score"], mx)
    return out


@router.get("/check2")
async def history2(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await service.get_state(db, user.id)
    return {"items": row.data.get("check2", [])}
