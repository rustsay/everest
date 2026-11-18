"""Diagnostic: every task needs the photo of the solution or «не знаю» (task 8 of the profile exam may be solved orally).
Photos are checked in the background: the first part - does the solution show the right method (a computing slip
is not the same as not knowing); the second part - the multi-agent check by FIPI criteria."""
from __future__ import annotations

import asyncio
import logging
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.auth.deps import get_current_user
from app.config import settings
from app.db.database import AsyncSessionLocal, get_db
from app.db.models import Diagnostic, User
from app.learning import engine, llm

log = logging.getLogger(__name__)
router = APIRouter(tags=["diagnostics"])
MAX_BYTES = 15 * 1024 * 1024
_locks: dict[int, asyncio.Lock] = {}


def _lock(diag_id: int) -> asyncio.Lock:
    return _locks.setdefault(diag_id, asyncio.Lock())


def _items(d: Diagnostic, user: User) -> dict[str, dict]:
    return {it["id"]: it for it in engine.diag_items(d.exam_key, user.grade, d.variant, date.today())}


def _folder(diag_id: int, item_id: str) -> Path:
    return Path(settings.uploads_dir) / "diag" / str(diag_id) / item_id


async def _own(db: AsyncSession, diag_id: int, user: User) -> Diagnostic:
    d = await db.get(Diagnostic, diag_id)
    if d is None or d.user_id != user.id or d.finished:
        raise HTTPException(404, "Диагностика не найдена")
    return d


def _set_work(d: Diagnostic, item_id: str, work: dict | None, answer: str | None = None) -> None:
    ans = dict(d.answers or {})
    w = dict(ans.get("_work") or {})
    if work is None:
        w.pop(item_id, None)
    else:
        w[item_id] = work
    ans["_work"] = w
    if answer is not None:
        ans[item_id] = answer
    d.answers = ans
    flag_modified(d, "answers")


def public_work(answers: dict) -> dict:
    """What the student sees while solving: the verdict on the photo is shown only in the analytics at the end."""
    return {k: {"mode": v.get("mode"), "status": v.get("status"), "files": v.get("files", 0), "comment": v.get("error") or ""}
            for k, v in (answers.get("_work") or {}).items()}


async def _analyze(diag_id: int, item_id: str, item: dict, pages: list[tuple[bytes, str]]) -> None:
    """Background: check the photo and store the result in the diagnostic."""
    result, status, error = None, "done", ""
    try:
        if not settings.llm_ready:
            status, error = "skipped", "ИИ не подключён: засчитан только ответ"
        elif item["t"] == "num":
            from app.ocr.pipeline import get_scan_jpegs
            imgs = await asyncio.get_event_loop().run_in_executor(None, get_scan_jpegs, pages)
            async with AsyncSessionLocal() as db:
                d = await db.get(Diagnostic, diag_id)
                given = (d.answers or {}).get(item_id, "") if d else ""
            result = await llm.analyze_short(item["q"], item["a"], given, imgs)
        elif item.get("n") in range(13, 20) and str(item["task"]).startswith("T") and item["id"].startswith("s"):
            from app.agents.engine import check_task
            from app.ocr.pipeline import get_scan_jpegs, run_ocr
            loop = asyncio.get_event_loop()
            ocr, imgs = await asyncio.gather(loop.run_in_executor(None, run_ocr, pages), loop.run_in_executor(None, get_scan_jpegs, pages))
            verdicts, judge = await check_task(task_id=item["n"], ocr_text=ocr["text"], image_bytes_list=imgs)
            errs = list(dict.fromkeys(e for v in verdicts for e in (v.errors_found or [])))[:4]
            result = {"score": judge.final_score, "max": judge.max_score,
                      "comment": "; ".join(errs) if errs else (judge.reasoning or "")[:400], "errors": errs}
        else:
            from app.ocr.pipeline import get_scan_jpegs
            imgs = await asyncio.get_event_loop().run_in_executor(None, get_scan_jpegs, pages)
            result = await llm.grade_long(item["q"], int(item.get("max") or 2), imgs)
    except Exception as exc:  # noqa: BLE001 - a failed check must not block the diagnostic
        log.exception("diag %s item %s: check failed", diag_id, item_id)
        status, error = "error", f"Не удалось проверить фото: засчитан только ответ ({type(exc).__name__})"
    async with _lock(diag_id):
        async with AsyncSessionLocal() as db:
            d = await db.get(Diagnostic, diag_id)
            if d is None or d.finished:
                return
            w = dict(((d.answers or {}).get("_work") or {}).get(item_id) or {})
            if w.get("mode") != "photo":
                return  # the student changed the choice while the check was running
            w.update({"status": status, "result": result, "error": error})
            _set_work(d, item_id, w)
            await db.commit()


@router.post("/diagnostics/{diag_id}/items/{item_id}/work")
async def upload_work(diag_id: int, item_id: str, files: list[UploadFile] = File(...),
                      user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.api.batch import file_pages
    d = await _own(db, diag_id, user)
    from app.api.learning import exam_guard
    exam_guard(d)
    item = _items(d, user).get(item_id)
    if item is None:
        raise HTTPException(404, "Нет такого задания")
    if not files or len(files) > 5:
        raise HTTPException(400, "Прикрепите от 1 до 5 файлов")
    pages: list[tuple[bytes, str]] = []
    for f in files:
        data = await f.read()
        if len(data) > MAX_BYTES:
            raise HTTPException(400, "Файл больше 15 МБ")
        pages += file_pages(data, f.filename or "photo.jpg", 10 - len(pages))
    pages = [(b, f"p{i}.jpg") for i, (b, _) in enumerate(pages)]
    folder = _folder(diag_id, item_id)
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob("*.jpg"):
        old.unlink()
    for b, name in pages:
        (folder / name).write_bytes(b)
    async with _lock(diag_id):
        await db.refresh(d)
        _set_work(d, item_id, {"mode": "photo", "status": "pending", "files": len(pages)})
        await db.commit()
    asyncio.create_task(_analyze(diag_id, item_id, item, pages))
    return {"work": public_work(d.answers)}


class ModeIn(BaseModel):
    mode: str  # dont_know | oral | clear


@router.put("/diagnostics/{diag_id}/items/{item_id}/mode")
async def set_mode(diag_id: int, item_id: str, body: ModeIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    d = await _own(db, diag_id, user)
    from app.api.learning import exam_guard
    exam_guard(d)
    item = _items(d, user).get(item_id)
    if item is None:
        raise HTTPException(404, "Нет такого задания")
    if body.mode == "oral" and not item.get("oral"):
        raise HTTPException(400, "«Решил устно» можно только в задании 8")
    async with _lock(diag_id):
        await db.refresh(d)
        if body.mode == "dont_know":
            _set_work(d, item_id, {"mode": "dont_know", "status": "done"}, answer="?")
        elif body.mode == "oral":
            _set_work(d, item_id, {"mode": "oral", "status": "done"})
        elif body.mode == "clear":
            _set_work(d, item_id, None)
        else:
            raise HTTPException(422, "mode: dont_know, oral или clear")
        await db.commit()
    return {"work": public_work(d.answers)}


@router.get("/diagnostics/{diag_id}/work")
async def get_work(diag_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    d = await _own(db, diag_id, user)
    return {"work": public_work(d.answers or {})}


def missing(d: Diagnostic, user: User) -> tuple[list[int], int]:
    """Numbers (positions) of tasks without an answer + photo / «не знаю», and how many checks are still running."""
    ans = d.answers or {}
    work = ans.get("_work") or {}
    gaps, pending = [], 0
    for i, it in enumerate(engine.diag_items(d.exam_key, user.grade, d.variant, date.today()), 1):
        w = work.get(it["id"]) or {}
        mode = w.get("mode")
        if w.get("status") == "pending":
            pending += 1
        if mode == "dont_know":
            continue
        has_answer = it["t"] != "num" or bool(ans.get(it["id"]) and ans.get(it["id"]) != "?")
        if not has_answer or mode not in ("photo", "oral"):
            gaps.append(i)
    return gaps, pending
