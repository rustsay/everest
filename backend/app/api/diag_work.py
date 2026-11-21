"""Diagnostic: every task needs the photo of the solution or «не знаю» (task 8 of the profile exam may be solved orally).
Photos are checked in the background: the first part - does the solution show the right method (a computing slip
is not the same as not knowing); the second part - the multi-agent check by FIPI criteria."""
from __future__ import annotations

import asyncio
import logging
import uuid
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
    return {it["id"]: it for it in engine.items_of(d.exam_key, user.grade, d.variant, date.today(), d.answers)}


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


def _pic(url: str):
    """Path of a bank picture by its URL: /api/fipi/img/N.png or /api/bank/<key>/img/<name>."""
    if url.startswith("/api/fipi/img/"):
        from app.learning import fipi
        return fipi.image_path(url.rsplit("/", 1)[-1])
    m = url.split("/")
    if len(m) == 6 and m[1] == "api" and m[2] == "bank" and m[4] == "img":
        from app.learning import exambank
        return exambank.image_path(m[3], m[5])
    return None


def _problem_image(item: dict | None) -> bytes | None:
    """The picture of an open-bank problem to show the model the exact condition (OGE 1-5: with the shared text above)."""
    paths = [p for p in (_pic((item or {}).get("ctx_img") or ""), _pic((item or {}).get("img") or "")) if p]
    if not paths:
        return None
    if len(paths) == 1:
        return paths[0].read_bytes()
    import io
    from PIL import Image
    ims = [Image.open(p).convert("L") for p in paths]
    out = Image.new("L", (max(i.width for i in ims), sum(i.height for i in ims) + 10), 255)
    y = 0
    for i in ims:
        out.paste(i, (0, y))
        y += i.height + 10
    buf = io.BytesIO()
    out.save(buf, "PNG")
    return buf.getvalue()


def public_work(answers: dict) -> dict:
    """What the student sees while solving: the verdict on the photo is shown only in the analytics at the end."""
    return {k: {"mode": v.get("mode"), "status": v.get("status"), "files": v.get("files", 0), "comment": v.get("error") or ""}
            for k, v in (answers.get("_work") or {}).items()}


async def _analyze(diag_id: int, item_id: str, item: dict, pages: list[tuple[bytes, str]], picked: dict | None = None,
                   upload_id: str | None = None) -> None:
    """Background: check the photo and store the result in the diagnostic.
    picked: the type the student chose in a part-2 item of the diagnostic by types (its problem is checked)."""
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
            result = await llm.analyze_short(item["q"], item["a"], given, imgs, _problem_image(item))
        elif item.get("n") in range(13, 20) and str(item["task"]).startswith("T") and item["id"].startswith("s"):
            from app.agents.engine import check_task
            from app.ocr.pipeline import get_scan_jpegs, run_ocr
            loop = asyncio.get_event_loop()
            ocr, imgs = await asyncio.gather(loop.run_in_executor(None, run_ocr, pages), loop.run_in_executor(None, get_scan_jpegs, pages))
            verdicts, judge = await check_task(task_id=item["n"], ocr_text=ocr["text"], image_bytes_list=imgs,
                                               problem=(picked or {}).get("q") or item.get("q") or "", problem_image=_problem_image(picked))
            errs = list(dict.fromkeys(e for v in verdicts for e in (v.errors_found or [])))[:4]
            result = {"score": judge.final_score, "max": judge.max_score,
                      "comment": "; ".join(errs) if errs else (judge.reasoning or "")[:400], "errors": errs}
        else:
            from app.ocr.pipeline import get_scan_jpegs
            imgs = await asyncio.get_event_loop().run_in_executor(None, get_scan_jpegs, pages)
            result = await llm.grade_long((picked or {}).get("q") or item["q"], int(item.get("max") or 2), imgs,
                                          _problem_image(picked or item))
    except Exception as exc:  # noqa: BLE001 - a failed check must not block the diagnostic
        log.exception("diag %s item %s: check failed", diag_id, item_id)
        status, error = "error", f"Не удалось проверить фото: засчитан только ответ ({type(exc).__name__})"
    async with _lock(diag_id):
        async with AsyncSessionLocal() as db:
            d = await db.get(Diagnostic, diag_id)
            if d is None or d.finished:
                return
            w = dict(((d.answers or {}).get("_work") or {}).get(item_id) or {})
            if w.get("mode") != "photo" or (upload_id is not None and w.get("upload_id") != upload_id):
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
    picked = None
    if item.get("choices"):
        from app.learning.diag_types import chosen
        picked = chosen(item, d.answers or {})
        if picked is None:
            raise HTTPException(400, "Сначала выберите тип задания")
    if not files or len(files) > 5:
        raise HTTPException(400, "Прикрепите от 1 до 5 файлов")
    pages: list[tuple[bytes, str]] = []
    for f in files:
        data = await f.read()
        if len(data) > MAX_BYTES:
            raise HTTPException(400, "Файл больше 15 МБ")
        pages += file_pages(data, f.filename or "photo.jpg", 10 - len(pages))
    pages = [(b, f"p{i}.jpg") for i, (b, _) in enumerate(pages)]
    upload_id = uuid.uuid4().hex
    async with _lock(diag_id):
        await db.refresh(d)
        if item.get("choices") and chosen(item, d.answers or {}) != picked:
            raise HTTPException(409, "Тип задания изменился. Прикрепите решение ещё раз")
        folder = _folder(diag_id, item_id)
        folder.mkdir(parents=True, exist_ok=True)
        for old in folder.glob("*.jpg"):
            old.unlink()
        for b, name in pages:
            (folder / name).write_bytes(b)
        _set_work(d, item_id, {"mode": "photo", "status": "pending", "files": len(pages), "upload_id": upload_id},
                  answer="" if (d.answers or {}).get(item_id) == "?" else None)
        await db.commit()
    asyncio.create_task(_analyze(diag_id, item_id, item, pages, picked, upload_id))
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
        raise HTTPException(400, "«Решил устно» в этом задании нельзя")
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
    for i, it in enumerate(engine.items_of(d.exam_key, user.grade, d.variant, date.today(), d.answers), 1):
        w = work.get(it["id"]) or {}
        mode = w.get("mode")
        if w.get("status") == "pending":
            pending += 1
        if mode == "dont_know":
            continue
        has_answer = it["t"] != "num" or bool(ans.get(it["id"]) and ans.get(it["id"]) != "?")
        if it.get("choices") and not (ans.get("_choice") or {}).get(it["id"]):
            has_answer = False
        if not has_answer or (mode not in ("photo", "oral") and it.get("photo") != "optional"):
            gaps.append(i)
    return gaps, pending


class ChoiceIn(BaseModel):
    type: str


@router.put("/diagnostics/{diag_id}/items/{item_id}/choice")
async def set_choice(diag_id: int, item_id: str, body: ChoiceIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Part 2 of the diagnostic by types: which type the student solves. A photo of another type is dropped."""
    d = await _own(db, diag_id, user)
    from app.api.learning import exam_guard
    exam_guard(d)
    item = _items(d, user).get(item_id)
    if item is None or not item.get("choices"):
        raise HTTPException(404, "Нет такого задания")
    if body.type not in {c["type"] for c in item["choices"]}:
        raise HTTPException(422, "Нет такого типа")
    async with _lock(diag_id):
        await db.refresh(d)
        ans = dict(d.answers or {})
        ch = dict(ans.get("_choice") or {})
        if ch.get(item_id) != body.type:
            ch[item_id] = body.type
            ans["_choice"] = ch
            ans.pop(item_id, None)
            d.answers = ans
            if ((ans.get("_work") or {}).get(item_id) or {}).get("mode") in ("photo", "dont_know"):
                _set_work(d, item_id, None)
            flag_modified(d, "answers")
        await db.commit()
    return {"work": public_work(d.answers), "choice": (d.answers.get("_choice") or {})}


@router.post("/diagnostics/{diag_id}/tasks/{n}/skip")
async def skip_task(diag_id: int, n: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """«Не знаю» twice in a row inside one task: the rest of its types without an answer become «не знаю» too."""
    d = await _own(db, diag_id, user)
    items = [it for it in _items(d, user).values() if it.get("n") == n and it.get("type")]
    if not items:
        raise HTTPException(404, "Нет такого задания")
    async with _lock(diag_id):
        await db.refresh(d)
        work = (d.answers or {}).get("_work") or {}
        for it in items:
            if not work.get(it["id"]) and not (d.answers or {}).get(it["id"]):
                _set_work(d, it["id"], {"mode": "dont_know", "status": "done"}, answer="?")
        await db.commit()
    return {"work": public_work(d.answers)}
