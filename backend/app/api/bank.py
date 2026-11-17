"""Task bank: import problems from files, check them, publish them into the task maps.

Sources: a JSON or CSV file (exact, no model involved) or a document (PDF with a text layer, TXT):
a variant, a collection or an export of the FIPI open bank. A document is split into problems by the
language model, which copies conditions and takes answers only from the document itself.
Every imported problem is a draft until a teacher or methodist checks it and publishes it.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import re
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.teacher import _extract_text, require_teacher
from app.config import NO_LLM, settings
from app.db.database import get_db
from app.db.models import BankProblem, User
from app.learning import llm
from app.learning.taskmaps import PART2, TASK_MAPS, proto_ids

log = logging.getLogger(__name__)
router = APIRouter(tags=["bank"])

MAX_FILE = 30 * 1024 * 1024
CHUNK = 12000
MAX_CHUNKS = 8
FIELDS = ["task", "proto", "text", "answer", "solution", "source"]


def _norm(t: str) -> str:
    return re.sub(r"\s+", " ", (t or "").lower()).strip()


def _view(b: BankProblem, me: User) -> dict:
    return {"id": b.id, "task": b.task_n, "proto": b.proto, "text": b.text, "answer": b.answer, "solution": b.solution,
            "source": b.source, "status": b.status, "mine": b.owner_id == me.id}


def _rows_from_table(name: str, data: bytes) -> list[dict]:
    raw = data.decode("utf-8-sig", "ignore")
    if name.endswith(".json"):
        try:
            items = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise HTTPException(400, f"JSON не читается: {exc.msg}, строка {exc.lineno}")
        if isinstance(items, dict):
            items = items.get("problems") or []
        if not isinstance(items, list):
            raise HTTPException(400, "Нужен список задач: [{\"task\":1,\"proto\":\"right\",\"text\":\"...\",\"answer\":\"10\"}]")
        return [i for i in items if isinstance(i, dict)]
    sample = raw[:2000]
    delim = ";" if sample.count(";") > sample.count(",") else ","
    return list(csv.DictReader(io.StringIO(raw), delimiter=delim))


@router.get("/bank/template.csv")
async def template(teacher: User = Depends(require_teacher)):
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";", quoting=csv.QUOTE_ALL)
    w.writerow(FIELDS)
    w.writerow(["1", "right", "В треугольнике ABC угол C равен 90°, AC = 6, BC = 8. Найдите AB.", "10", "По теореме Пифагора AB = 10.", "пример"])
    w.writerow(["13", "trig", "а) Решите уравнение 2sin²x − sin x − 1 = 0. б) Укажите корни на отрезке [0; 2π].", "", "", "пример: вторая часть, ответ необязателен"])
    return Response(buf.getvalue().encode("utf-8-sig"), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=bank_template.csv"})


@router.get("/bank/protos")
async def protos(teacher: User = Depends(require_teacher)):
    return {"tasks": [{"n": n, "name": m["name"], "protos": [{"id": p["id"], "name": p["name"]} for p in m["protos"]]} for n, m in TASK_MAPS.items()]}


@router.post("/bank/import")
async def import_file(task: int = Form(...), file: UploadFile = File(...), teacher: User = Depends(require_teacher),
                      db: AsyncSession = Depends(get_db)):
    if task not in TASK_MAPS:
        raise HTTPException(404, "Нет такого задания")
    name = (file.filename or "file").lower()
    data = await file.read()
    if not data or len(data) > MAX_FILE:
        raise HTTPException(400, "Файл пустой или больше 30 МБ")
    ext = Path(name).suffix
    rows: list[dict]
    if ext in (".json", ".csv"):
        rows = []
        for r in _rows_from_table(name, data):
            t = str(r.get("task") or "").strip()
            n = int(t) if t.isdigit() else task
            if n not in TASK_MAPS:
                continue
            rows.append({"task": n, "proto": str(r.get("proto") or "").strip(), "text": str(r.get("text") or "").strip(),
                         "answer": (str(r.get("answer")).strip() or None) if r.get("answer") not in (None, "") else None,
                         "solution": str(r.get("solution") or "").strip(), "source": str(r.get("source") or file.filename or "")[:300]})
    elif ext in (".pdf", ".txt", ".md"):
        if not settings.llm_ready:
            raise HTTPException(503, NO_LLM)
        text = _extract_text(name, data)
        if len(text.strip()) < 40:
            raise HTTPException(400, "В файле нет текста. Скан без текстового слоя сначала нужно распознать.")
        chunks = [text[i:i + CHUNK] for i in range(0, len(text), CHUNK)][:MAX_CHUNKS]
        rows = []
        for ch in chunks:
            try:
                found = await llm.extract_problems(ch, task, TASK_MAPS[task]["protos"])
            except Exception as exc:
                log.exception("bank import chunk failed: %s", exc)
                raise HTTPException(502, "Разбор документа сейчас недоступен. Попробуйте через минуту.")
            rows += [{**f, "task": task, "source": (file.filename or "")[:300]} for f in found]
    else:
        raise HTTPException(400, "Можно JSON, CSV, PDF с текстом или TXT")

    existing = (await db.execute(select(BankProblem.task_n, BankProblem.text))).all()
    seen = {(t, _norm(x)) for t, x in existing}
    added = skipped = 0
    for r in rows:
        key = (r["task"], _norm(r["text"]))
        if len(r["text"]) < 10 or key in seen:
            skipped += 1
            continue
        seen.add(key)
        db.add(BankProblem(owner_id=teacher.id, task_n=r["task"], proto=r["proto"] if r["proto"] in proto_ids(r["task"]) else "",
                           text=r["text"][:4000], answer=r["answer"], solution=r["solution"][:6000], source=r["source"], status="draft"))
        added += 1
    await db.commit()
    return {"added": added, "skipped": skipped, "note": "Задачи сохранены как черновики. Проверьте условие и ответ, затем опубликуйте."}


@router.get("/bank")
async def list_bank(task: int | None = None, status: str = "draft", teacher: User = Depends(require_teacher),
                    db: AsyncSession = Depends(get_db)):
    q = select(BankProblem).order_by(BankProblem.id.desc())
    if task is not None:
        q = q.where(BankProblem.task_n == task)
    q = q.where(BankProblem.status == "approved") if status == "approved" else q.where(BankProblem.status == "draft", BankProblem.owner_id == teacher.id)
    items = list((await db.execute(q.limit(300))).scalars())
    counts = {}
    for t, st in (await db.execute(select(BankProblem.task_n, BankProblem.status))).all():
        c = counts.setdefault(t, {"approved": 0, "draft": 0})
        c[st] = c.get(st, 0) + 1
    return {"items": [_view(b, teacher) for b in items], "counts": counts}


class BankEdit(BaseModel):
    text: str | None = Field(None, max_length=4000)
    answer: str | None = Field(None, max_length=80)
    solution: str | None = Field(None, max_length=6000)
    proto: str | None = Field(None, max_length=40)
    status: str | None = Field(None, pattern="^(draft|approved)$")


@router.put("/bank/{pid}")
async def edit(pid: int, body: BankEdit, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    b = await db.get(BankProblem, pid)
    if b is None or b.owner_id != teacher.id:
        raise HTTPException(404, "Задача не найдена")
    if body.text is not None:
        b.text = body.text.strip()
    if body.answer is not None:
        b.answer = body.answer.strip() or None
    if body.solution is not None:
        b.solution = body.solution.strip()
    if body.proto is not None:
        if body.proto and body.proto not in proto_ids(b.task_n):
            raise HTTPException(400, "Нет такого прототипа у этого задания")
        b.proto = body.proto
    if body.status == "approved":
        if not b.proto:
            raise HTTPException(400, "Выберите прототип")
        if len(b.text) < 10:
            raise HTTPException(400, "Нет условия")
        if b.task_n not in PART2 and not b.answer:
            raise HTTPException(400, "Для первой части нужен ответ")
    if body.status is not None:
        b.status = body.status
    await db.commit()
    return _view(b, teacher)


@router.delete("/bank/{pid}")
async def remove(pid: int, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    b = await db.get(BankProblem, pid)
    if b is None or b.owner_id != teacher.id:
        raise HTTPException(404, "Задача не найдена")
    await db.delete(b)
    await db.commit()
    return {"ok": True}
