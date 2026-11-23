"""Board walkthroughs of problems from the bank and the task maps: the student opens any problem and watches it solved
step by step. Bank walkthroughs are shared; diagnostic walkthroughs are cached per learner and task with feedback.
With the model: steps from the condition, the known answer and the
solution of the bank (the answer is not changed). Without the model: the bank solution split into steps."""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.config import settings
from app.db.database import get_db
from app.db.models import Diagnostic, ProblemWalkthrough, User
from app.learning import analytics, engine, fipi, problems, service
from app.learning.taskmaps import TASK_MAPS
from app.video.geometry import is_geometry_task
from app.video.worked_geometry import worked_geometry

log = logging.getLogger(__name__)
router = APIRouter(tags=["walkthrough"])
FORMAT_VERSION = 2
DRAWING_UNAVAILABLE = "Не удалось подготовить чертёж, соответствующий условию. Попробуйте собрать разбор ещё раз."


def _proto_fig(n: int, pid: str) -> str | None:
    return next((p.get("fig") for p in (TASK_MAPS.get(n) or {}).get("protos", []) if p["id"] == pid), None)


def from_solution(sol: str, answer: str | None) -> list[dict]:
    """No model: the written solution of the bank, one or two sentences per step, the answer last."""
    parts = [x.strip() for x in re.split(r"(?<=[.;])\s+|\n+", sol or "") if x.strip()]
    steps, buf = [], []
    for x in parts:
        buf.append(x)
        if len(" ".join(buf)) > 70 or len(buf) == 2:
            steps.append(buf)
            buf = []
    if buf:
        steps.append(buf)
    out = []
    for i, sentences in enumerate(steps):
        explanation = " ".join(sentences)
        out.append({"title": f"Шаг {i + 1}", "lines": sentences if len(explanation) <= 150 else [],
                    "text": explanation if len(explanation) <= 150 else "Посмотри на запись на доске.",
                    "explanation": explanation})
    if answer:
        out.append({"title": "Ответ", "lines": [f"Ответ: {answer}"], "text": f"Ответ: {answer}.", "explanation": f"Ответ: {answer}."})
    return out


class RefIn(BaseModel):
    ref: str = Field(..., max_length=40)


async def _persist_walkthrough(db: AsyncSession, ref: str, source: str, steps: list,
                               diagram: dict | None = None) -> ProblemWalkthrough:
    """Insert once and return the winner when several requests build the same problem concurrently."""
    await db.execute(
        pg_insert(ProblemWalkthrough)
        .values(ref=ref, source=source, steps=steps, diagram=diagram)
        .on_conflict_do_nothing(index_elements=[ProblemWalkthrough.ref])
    )
    await db.commit()
    row = (await db.execute(select(ProblemWalkthrough).where(ProblemWalkthrough.ref == ref))).scalars().first()
    if row is None:  # defensive: the insert or the competing transaction must have produced a row
        raise HTTPException(503, "Не удалось сохранить разбор. Попробуйте ещё раз.")
    return row


@router.post("/walkthrough")
async def walkthrough(body: RefIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    found = await problems.resolve(db, [body.ref])
    p = found.get(body.ref)
    if p is None:
        raise HTTPException(404, "Нет такой задачи")
    geometry = is_geometry_task(p.get("exam", "prof"), p["task"])
    meta = {"ref": body.ref, "task": p["task"], "q": p["q"], "proto_name": p["proto_name"],
            "fig": None if geometry or p.get("img") else _proto_fig(p["task"], p["proto"]), "img": p.get("img"), "ctx_img": p.get("ctx_img"),
            "title": p["proto_name"] or f"Задание № {p['task']}"}
    if user.role == "student" and p["a"] and p.get("exam", service.key_for(user)) == service.key_for(user):
        # watched before solving: the task map counts this problem as not solved by the student
        st = await service.get_state(db, user.id)
        tm = st.data.setdefault("tm", {})
        if p["pid"] not in tm:
            tm[p["pid"]] = 0
            service.redo_add(st, body.ref, p["task"])  # watched first: it comes back to be solved alone
            service.touch(st)
            await db.commit()
    if prepared := worked_geometry(body.ref):
        return {**meta, "source": "solution", **prepared}
    identity = json.dumps(p, sort_keys=True, ensure_ascii=False)
    ref = f"v{FORMAT_VERSION}:" + hashlib.sha256(identity.encode()).hexdigest()[:35]
    row = (await db.execute(select(ProblemWalkthrough).where(ProblemWalkthrough.ref == ref))).scalars().first()
    if row is None:
        steps, diagram = None, None
        if settings.llm_ready:
            from app.video.steps import generate_steps
            from app.learning.exambank import path_of
            ans = p["a"] or p.get("answer_text")
            hint = f"\nВерный ответ: {ans}" if ans else ""
            imgs = []
            if p.get("ctx_img") and (cp := path_of(p["ctx_img"])):  # OGE 1-5: the shared text (plan, table) comes first
                imgs.append(base64.b64encode(cp.read_bytes()).decode())
                hint += "\nОбщее условие (текст, план или таблица) - на первой картинке."
            if p.get("img") and (path := path_of(p["img"])):  # formulas and the drawing exactly as in the source; the text is only a hint
                imgs.append(base64.b64encode(path.read_bytes()).decode())
                hint += "\nТочное условие с формулами и рисунком на картинке, текст выше распознан с ошибками."
            ap = path_of(p.get("ans_img")) if p.get("ans_img") else (fipi.image_path(f"a{p['pid'][1:]}.png") if p["pid"][:1] == "f" else None)
            if ap:
                imgs.append(base64.b64encode(ap.read_bytes()).decode())
                hint += " Верный ответ - на последней картинке."
            if p["sol"]:
                hint += f"\nРешение из банка (опирайся на него, ответ не меняй): {p['sol']}"
            try:
                data = await generate_steps(p["q"] + hint, imgs, require_geometry=geometry)
                steps, diagram = data["steps"], data.get("diagram")
            except Exception:  # noqa: BLE001 - fall back to the written solution
                log.exception("walkthrough %s: model failed", body.ref)
        if geometry and not diagram:
            raise HTTPException(503, DRAWING_UNAVAILABLE)
        if steps is None and p["sol"]:
            return {**meta, "source": "solution", "steps": from_solution(p["sol"], p["a"]), "diagram": None}
        if steps is None:
            raise HTTPException(503, "Для этой задачи пока нет решения в банке, а ИИ не подключён: разбор не из чего собрать")
        row = await _persist_walkthrough(db, ref, "ai", steps, diagram)
    return {**meta, "source": row.source, "steps": row.steps, "diagram": row.diagram}


def _diagnostic_feedback(item: dict, answers: dict) -> dict:
    kind, note, _, _ = analytics.item_kind(item, answers)
    work = (answers.get("_work") or {}).get(item["id"]) or {}
    result = work.get("result") if work.get("status") == "done" else None
    answer = answers.get(item["id"])
    return {
        "kind": kind, "label": analytics.KIND[kind],
        "answer": str(answer) if item["t"] == "num" and answer not in (None, "", "?") else None,
        "right": str(item["a"]) if item["t"] == "num" else None,
        "note": note, "errors": [str(e) for e in ((result or {}).get("errors") or [])][:4],
    }


def _diagnostic_input(problem: dict) -> tuple[str, list[str]]:
    """Use the original condition and its pictures; never substitute a typical problem."""
    from app.learning.exambank import path_of
    prompt = problem.get("q") or "Условие задачи на картинке."
    # Exact coordinates of the fixed diagrams drawn by DiagnosticFigure in the client.
    diagrams = {
        "tangent": "Касательная проходит через отмеченные точки (−1; 3) и (4; 2), x₀ = 1.",
        "hyper": "На графике y = k/x отмечены точки (1; 5) и (5; 1).",
        "trig": "На графике y = a·cos x + b отмечены точки (0; 3) и (π; −1). Шаг сетки по Ox равен π/2.",
        "expo": "На графике показательной функции отмечены точки (−1; 4) и (0; 1).",
    }
    if problem.get("fig") in diagrams:
        prompt += "\nДанные исходного рисунка: " + diagrams[problem["fig"]]
    images = []
    for field, description in (
        ("ctx_img", "Общее условие (текст, план или таблица)"),
        ("img", "Точное условие с формулами и рисунком"),
        ("ans_img", "Верный ответ из сборника"),
    ):
        if problem.get(field):
            path = path_of(problem[field])
            if path is None or not path.is_file():
                raise HTTPException(503, "Не удалось загрузить исходную картинку задачи. Попробуйте позже")
            images.append(base64.b64encode(path.read_bytes()).decode())
            prompt += f"\n{description} — на картинке № {len(images)}."
    if problem.get("a"):
        prompt += f"\nВерный ответ: {problem['a']}"
    if problem.get("sol"):
        prompt += f"\nРешение из банка (опирайся на него, ответ не меняй): {problem['sol']}"
    return prompt, images


@router.post("/diagnostics/{diag_id}/items/{item_id}/walkthrough")
async def diagnostic_walkthrough(diag_id: int, item_id: str, user: User = Depends(get_current_user),
                                 db: AsyncSession = Depends(get_db)):
    d = await db.get(Diagnostic, diag_id)
    if d is None or d.user_id != user.id or not d.finished:
        raise HTTPException(404, "Завершённая диагностика не найдена")
    items = engine.items_of(d.exam_key, user.grade, d.variant, (d.created_at or datetime.now()).date(), d.answers)
    item = next((it for it in items if it["id"] == item_id), None)
    if item is None:
        raise HTTPException(404, "Нет такого задания в диагностике")
    problem = item
    if item.get("choices"):
        from app.learning.diag_types import chosen
        problem = chosen(item, d.answers or {})
        if problem is None:
            raise HTTPException(400, "В этом задании тип не был выбран: конкретной задачи для разбора нет")
    problem = dict(problem)
    # A reference can supply a written solution, but the diagnostic's condition remains authoritative.
    prepared = None
    if problem.get("ref"):
        found = await problems.resolve(db, [problem["ref"]])
        bank = found.get(problem["ref"])
        if bank and bank.get("q") == problem.get("q") and bank.get("img") == problem.get("img"):
            problem["sol"] = problem.get("sol") or bank.get("sol")
            problem["ans_img"] = problem.get("ans_img") or bank.get("ans_img")
            prepared = worked_geometry(problem["ref"])
    feedback = _diagnostic_feedback(item, d.answers or {})
    geometry = is_geometry_task(d.exam_key, item.get("n"))
    identity = json.dumps({"version": FORMAT_VERSION, "user": user.id, "diagnostic": d.id, "item": item_id,
                           "exam": d.exam_key, "problem": problem, "feedback": feedback}, sort_keys=True, ensure_ascii=False)
    ref = "diag:" + hashlib.sha256(identity.encode()).hexdigest()[:35]
    meta = {"ref": ref, "task": item.get("n"), "q": problem.get("q") or "Условие на изображении",
            "title": problem.get("name") or item.get("type_name") or (f"Задание № {item['n']}" if item.get("n") else "Разбор задачи"),
            "proto_name": problem.get("name") or item.get("type_name") or "", "fig": None,
            "condition_fig": problem.get("fig"), "img": problem.get("img"), "ctx_img": problem.get("ctx_img"),
            "feedback": feedback, "diagnostic_id": d.id, "item_id": item_id}
    row = (await db.execute(select(ProblemWalkthrough).where(ProblemWalkthrough.ref == ref))).scalars().first()
    if row is None:
        steps, diagram = None, None
        if settings.llm_ready:
            from app.video.steps import generate_steps
            prompt, images = _diagnostic_input(problem)
            try:
                data = await generate_steps(prompt, images, feedback=feedback, require_geometry=geometry)
                steps, diagram = data["steps"], data.get("diagram")
            except Exception:  # noqa: BLE001 - a written solution is a safe fallback
                log.exception("diagnostic walkthrough %s/%s: model failed", diag_id, item_id)
        if geometry and not diagram:
            if prepared:
                return {**meta, "source": "solution", **prepared}
            raise HTTPException(503, DRAWING_UNAVAILABLE)
        if steps is None and problem.get("sol"):
            steps = from_solution(problem["sol"], problem.get("a"))
            notes = feedback["errors"] or ([feedback["note"]] if feedback["note"] else [])
            if notes:
                steps.insert(0, {"title": "На что обратить внимание", "lines": ["Замечания проверки"],
                                 "text": "Посмотри на замечания проверки перед решением.", "explanation": "\n".join(notes)})
            if steps:
                return {**meta, "source": "solution", "steps": steps, "diagram": None}
        if not steps:
            raise HTTPException(503, "Для разбора этой задачи нужен ИИ: готового решения в банке нет. Попробуйте позже")
        # Private to this diagnostic and this learner; never reuse another student's explanation.
        row = await _persist_walkthrough(db, ref, "ai", steps, diagram)
    return {**meta, "source": row.source, "steps": row.steps, "diagram": row.diagram}


@router.get("/fipi/img/{name}")
async def fipi_image(name: str):
    """Pictures of the open FIPI bank problems (public, as on the FIPI site)."""
    path = fipi.image_path(name)
    if path is None:
        raise HTTPException(404, "Нет такой картинки")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "public, max-age=604800"})
