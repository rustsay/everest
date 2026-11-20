"""Photo check of first-part tasks (1-12): the answer and a photo of the solution. With a problem of the bank the key
decides right or wrong and the model only reads the solution (a computing slip or a wrong method); with an own problem
the model solves it itself, and the student is told that this check has no key."""
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
from app.learning import engine, fipi, llm, problems, service

log = logging.getLogger(__name__)
router = APIRouter(tags=["check1"])
MAX_BYTES = 15 * 1024 * 1024
HISTORY = 30


@router.post("/check1")
async def check_first_part(task: int = Form(..., ge=1, le=12), answer: str = Form("", max_length=40), ref: str = Form("", max_length=40),
                           problem: str = Form("", max_length=3000), files: list[UploadFile] = File(...),
                           user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not settings.llm_ready:
        raise HTTPException(503, NO_LLM)
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
    imgs = await asyncio.get_event_loop().run_in_executor(None, get_scan_jpegs, [(b, f"p{i}.jpg") for i, (b, _) in enumerate(pages)])

    p = (await problems.resolve(db, [ref])).get(ref) if ref else None
    if ref and p is None:
        raise HTTPException(404, "Нет такой задачи в банке")
    if p is not None and p["task"] != task:
        raise HTTPException(400, f"Это задача задания № {p['task']}")
    if p is None and not problem.strip():
        raise HTTPException(400, "Впишите условие задачи или выберите задачу из банка")
    try:
        if p is not None and p["a"]:
            text = p["q"]
            if p.get("img") and (path := fipi.image_path(p["img"].rsplit("/", 1)[-1])):
                imgs = [path.read_bytes()] + imgs  # the exact condition first: the text of FIPI pictures is rough
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
    hist.insert(0, {"at": datetime.now().isoformat(timespec="minutes"), "task": task, "ref": ref or None,
                    "problem": (p["q"] if p else problem.strip())[:300], "answer": answer, **out})
    del hist[HISTORY:]
    service.touch(row)
    await db.commit()
    return {**out, "first": first, "sol": (p or {}).get("sol") or ""}


@router.get("/check1")
async def history(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await service.get_state(db, user.id)
    return {"items": row.data.get("check1", [])}
