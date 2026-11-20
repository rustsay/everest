"""Board walkthroughs of problems from the bank and the task maps: the student opens any problem and watches it solved
step by step. Built once per problem and shared. With the model: steps from the condition, the known answer and the
solution of the bank (the answer is not changed). Without the model: the bank solution split into steps."""
from __future__ import annotations

import base64
import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.config import settings
from app.db.database import get_db
from app.db.models import ProblemWalkthrough, User
from app.learning import fipi, problems, service
from app.learning.taskmaps import TASK_MAPS

log = logging.getLogger(__name__)
router = APIRouter(tags=["walkthrough"])


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
    out = [{"title": f"Шаг {i + 1}", "lines": [y[:90] for y in b][:4], "text": " ".join(b)} for i, b in enumerate(steps[:8])]
    if answer:
        out.append({"title": "Ответ", "lines": [f"Ответ: {answer}"], "text": f"Ответ: {answer}."})
    return out


class RefIn(BaseModel):
    ref: str = Field(..., max_length=40)


@router.post("/walkthrough")
async def walkthrough(body: RefIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    found = await problems.resolve(db, [body.ref])
    p = found.get(body.ref)
    if p is None:
        raise HTTPException(404, "Нет такой задачи")
    meta = {"ref": body.ref, "task": p["task"], "q": p["q"], "proto_name": p["proto_name"],
            "fig": None if p.get("img") else _proto_fig(p["task"], p["proto"]), "img": p.get("img"), "ctx_img": p.get("ctx_img"),
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
    row = (await db.execute(select(ProblemWalkthrough).where(ProblemWalkthrough.ref == body.ref))).scalars().first()
    if row is None:
        steps, source = None, None
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
                data = await generate_steps(p["q"] + hint, imgs)
                steps, source = data["steps"], "ai"
            except Exception:  # noqa: BLE001 - fall back to the written solution
                log.exception("walkthrough %s: model failed", body.ref)
        if steps is None and p["sol"]:
            steps, source = from_solution(p["sol"], p["a"]), "solution"
        if steps is None:
            raise HTTPException(503, "Для этой задачи пока нет решения в банке, а ИИ не подключён: разбор не из чего собрать")
        row = ProblemWalkthrough(ref=body.ref, source=source, steps=steps)
        db.add(row)
        await db.commit()
    return {**meta, "source": row.source, "steps": row.steps}


@router.get("/fipi/img/{name}")
async def fipi_image(name: str):
    """Pictures of the open FIPI bank problems (public, as on the FIPI site)."""
    path = fipi.image_path(name)
    if path is None:
        raise HTTPException(404, "Нет такой картинки")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "public, max-age=604800"})
