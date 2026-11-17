"""Student side of the new design: profile, diagnostics, dashboard, schedule, stars, chat."""
from __future__ import annotations

import base64
import logging
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db import crud_learning as crud
from app.db.database import get_db
from app.db.models import Assignment, ChatMessage, Diagnostic, User
from app.learning import engine, llm, service
from app.learning.content import ACHIEVEMENTS, EGGS, EVENT_XP, EXAMS, NODE_BY_ID, NODES

log = logging.getLogger(__name__)
router = APIRouter(tags=["learning"])

GRADES = {"5", "6", "7", "8", "9", "10", "11"}
EXAM_CHOICES = {"prof", "base", "oge", "none"}
ROLES = {"student", "teacher", "tutor"}


# ---------- helpers ----------

def exam_info(key: str) -> dict:
    ex = EXAMS[key]
    return {"key": key, **{k: ex[k] for k in ("title", "short", "label", "max", "pct", "unit", "date", "date_note")}}


def me_payload(user: User, state: dict, extra: dict | None = None) -> dict:
    return {
        "id": user.id, "email": user.email, "name": user.name or "", "role": user.role, "grade": user.grade, "exam": user.exam,
        "is_demo": bool(user.is_demo), "exam_info": exam_info(service.key_for(user)),
        "needs_profile": user.role == "student" and not user.grade,
        "diag_required": user.role == "student" and engine.diag_required(user.grade),
        "settings": {k: state.get(k) for k in ("plan", "care", "sound", "voice", "onb")},
        **(extra or {}),
    }


async def _diag_status(db: AsyncSession, user: User) -> dict:
    last = await crud.last_finished_diagnostic(db, user.id)
    run = await crud.open_diagnostic(db, user.id, "first")
    return {"diag_done": last is not None, "diag_in_progress": run is not None}


# ---------- profile ----------

@router.get("/me")
async def get_me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await service.get_state(db, user.id)
    await db.commit()
    classes = await crud.student_classes(db, user.id) if user.role == "student" else []
    return me_payload(user, row.data, {**await _diag_status(db, user), "classes": [{"id": c.id, "name": c.name} for c in classes]})


class ProfileIn(BaseModel):
    name: str | None = Field(None, max_length=80)
    role: str | None = None
    grade: str | None = None
    exam: str | None = None


@router.put("/me/profile")
async def put_profile(body: ProfileIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if body.role is not None:
        if body.role not in ROLES:
            raise HTTPException(422, "Роль: student, teacher или tutor")
        user.role = body.role
    if body.grade is not None:
        if body.grade not in GRADES:
            raise HTTPException(422, "Класс от 5 до 11")
        user.grade = body.grade
    if body.exam is not None:
        if body.exam not in EXAM_CHOICES:
            raise HTTPException(422, "Экзамен: prof, base, oge или none")
        user.exam = body.exam
    if body.name is not None:
        user.name = body.name.strip()[:80]
    row = await service.get_state(db, user.id)
    service.touch(row)
    await db.commit()
    return me_payload(user, row.data, await _diag_status(db, user))


class SettingsIn(BaseModel):
    plan: dict | None = None
    care: dict | None = None
    sound: bool | None = None
    voice: bool | None = None
    onb: str | None = None


@router.put("/me/settings")
async def put_settings(body: SettingsIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await service.get_state(db, user.id)
    if body.plan is not None:
        p = row.data.setdefault("plan", {})
        if "date" in body.plan:
            try:
                p["date"] = date.fromisoformat(str(body.plan["date"])).isoformat()
            except ValueError:
                raise HTTPException(422, "Дата в формате ГГГГ-ММ-ДД")
        try:
            days = int(body.plan["days"]) if "days" in body.plan else None
            mins = int(body.plan["min"]) if "min" in body.plan else None
        except (TypeError, ValueError):
            raise HTTPException(422, "days и min должны быть числами")
        if days in engine.DAYSETS:
            p["days"] = days
        if mins in (30, 45, 60, 90):
            p["min"] = mins
    if body.care is not None:
        c = row.data.setdefault("care", {})
        for k in ("breaks", "sleep"):
            if k in body.care:
                c[k] = bool(body.care[k])
    for k in ("sound", "voice", "onb"):
        v = getattr(body, k)
        if v is not None:
            row.data[k] = v
    service.touch(row)
    await db.commit()
    return {"settings": {k: row.data.get(k) for k in ("plan", "care", "sound", "voice", "onb")}}


# ---------- diagnostics ----------

def _diag_view(d: Diagnostic, items: list[dict]) -> dict:
    return {"id": d.id, "mode": d.mode, "variant": d.variant, "position": d.position, "answers": d.answers,
            "items": [engine.public_item(i) for i in items], "exam": exam_info(d.exam_key)}


class DiagStart(BaseModel):
    mode: str = "first"


@router.post("/diagnostics")
async def start_diagnostic(body: DiagStart, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if body.mode not in ("first", "mock"):
        raise HTTPException(422, "mode: first или mock")
    if user.role != "student" or not user.grade:
        raise HTTPException(400, "Сначала выберите класс и экзамен")
    d = await crud.open_diagnostic(db, user.id, body.mode)
    if d is None:
        row = await service.get_state(db, user.id)
        variant = int(row.data.get("mocks", 0)) + 1 if body.mode == "mock" else 0
        d = Diagnostic(user_id=user.id, mode=body.mode, exam_key=service.key_for(user), variant=variant, answers={})
        db.add(d)
        await db.commit()
        await db.refresh(d)
    items = engine.diag_items(d.exam_key, user.grade, d.variant, date.today())
    return _diag_view(d, items)


class AnswerIn(BaseModel):
    item_id: str
    answer: str = Field("", max_length=60)
    position: int = 0


@router.put("/diagnostics/{diag_id}/answer")
async def save_answer(diag_id: int, body: AnswerIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    d = await db.get(Diagnostic, diag_id)
    if d is None or d.user_id != user.id or d.finished:
        raise HTTPException(404, "Диагностика не найдена")
    d.answers = {**(d.answers or {}), body.item_id: body.answer}
    d.position = max(0, body.position)
    await db.commit()
    return {"ok": True}


@router.post("/diagnostics/{diag_id}/finish")
async def finish_diagnostic(diag_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    d = await db.get(Diagnostic, diag_id)
    if d is None or d.user_id != user.id:
        raise HTTPException(404, "Диагностика не найдена")
    if d.finished and d.result:
        return d.result
    key = d.exam_key
    items = engine.diag_items(key, user.grade, d.variant, date.today())
    row = await service.get_state(db, user.id)
    blend = d.mode == "mock"
    prev = await service.history(db, user.id, 1)
    r = engine.apply_diag(row.data, items, d.answers or {}, blend)
    if blend:
        row.data["mocks"] = int(row.data.get("mocks", 0)) + 1
    model = engine.build_model(row.data, key)
    value = await service.add_measurement(db, user, row, f"пробник № {row.data['mocks']}" if blend else "диагностика")
    strong, weak = engine.strong_weak(model)
    plan = engine.build_plan(row.data, key, date.today())
    result = {
        **r, "mode": d.mode, "value": value, "prev": prev[-1].value if prev else None, "exam": exam_info(key),
        "strong": [NODE_BY_ID[n]["name"] for n in strong], "weak": [NODE_BY_ID[n]["name"] for n in weak],
        "root": model["root"], "root_name": NODE_BY_ID[model["root"]]["name"] if model["root"] else None,
        "plan": {"studied": plan["studied"], "days": plan["days_per_week"], "min": plan["minutes"]}, "mocks": row.data.get("mocks", 0),
    }
    d.finished, d.result = True, result
    service.gain(row, 150 if not blend else 120)
    service.touch(row)
    await service.notify(db, user.id, "Расписание собрано по диагностике" if not blend else f"Пробник № {row.data['mocks']}: {value}", "plan")
    await db.commit()
    return result


@router.post("/diagnostics/skip")
async def skip_diagnostic(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if engine.diag_required(user.grade):
        raise HTTPException(400, "Для 9-11 классов диагностика обязательна")
    row = await service.get_state(db, user.id)
    row.data["onb"] = "skipped"
    service.touch(row)
    await db.commit()
    return {"ok": True}


# ---------- dashboard ----------

async def _homework(db: AsyncSession, user: User) -> Assignment | None:
    hw = await crud.assignments_for_student(db, user.id)
    return hw[0] if hw else None


@router.get("/dashboard")
async def dashboard(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    today = date.today()
    key = service.key_for(user)
    row = await service.get_state(db, user.id)
    st = row.data
    if st.get("daily", {}).get("date") != today.isoformat():
        st["daily"] = {"date": today.isoformat(), "done": False, "tries": 0, "hint": 0}
        service.touch(row)
    model = engine.build_model(st, key)
    plan = engine.build_plan(st, key, today)
    hist = await service.history(db, user.id)
    deltas = []
    if len(hist) >= 2:
        a, b = hist[-2], hist[-1]
        skip = set(a.unknown or []) | set(b.unknown or [])
        for n in NODES:
            if n["id"] in skip:
                continue
            dv = round(((b.mastery or {}).get(n["id"], 0) - (a.mastery or {}).get(n["id"], 0)) * 100)
            if dv:
                deltas.append({"node": n["id"], "name": n["name"], "delta": dv})
        deltas.sort(key=lambda x: -abs(x["delta"]))
    td = next((d for d in plan["days"] if d["date"] == today.isoformat()), {"date": today.isoformat(), "rest": True, "blocks": []})
    done = st.get("plan_done", {})
    today_blocks = [{**b, "key": f"{td['date']}:{i}", "done": bool(done.get(f"{td['date']}:{i}"))} for i, b in enumerate(td.get("blocks", []))]
    dq = engine.daily_pick(model, today)
    daily = st["daily"]
    hw = await _homework(db, user)
    nm = next((d for d in plan["days"] if d.get("mock")), None)
    exam_days = max(0, (date.fromisoformat(plan["end"]) - today).days)
    if hw:
        deadline = {"kind": "hw", "id": hw.id, "title": hw.topic, "due": hw.due.isoformat(), "task_id": hw.task_id, "count": hw.count}
    else:
        deadline = {"kind": "milestone", "title": nm["blocks"][0]["title"] if nm else "Экзамен", "date": nm["date"] if nm else plan["end"],
                    "days_left": (date.fromisoformat(nm["date"]) - today).days if nm else exam_days, "exam_days": exam_days}
    cur, nxt, left = engine.stage(int(st.get("xp", 0)))
    await db.commit()
    return {
        "exam": exam_info(key), "forecast": engine.forecast_value(model, key), "gain": engine.what_if(st, key),
        "model": {
            "nodes": [{**n, "m": round(model["E"][n["id"]], 3), "unknown": n["id"] in model["unknown"]} for n in NODES],
            "tasks": model["tasks"], "root": model["root"], "root_tasks": model["root_tasks"], "at_risk": model["at_risk"],
            "weak": model["weak"], "threat": model["threat"],
        },
        "history": [{"date": h.created_at.date().isoformat() if h.created_at else today.isoformat(), "value": h.value, "source": h.source} for h in hist],
        "deltas": deltas[:5],
        "today": {"date": td["date"], "rest": bool(td.get("rest")), "blocks": today_blocks},
        "daily": {"q": dq["q"], "node": dq["node"], "hints": dq["h"][: daily.get("hint", 0)], "hint_count": len(dq["h"]),
                  "done": daily.get("done", False), "sol": dq["sol"] if daily.get("done") else None},
        "deadline": deadline,
        "stars": {"total": len(st.get("ach", {})) + len(st.get("eggs", {})), "ach": st.get("ach", {}), "eggs": st.get("eggs", {}),
                  "achievements": ACHIEVEMENTS, "egg_meta": {k: {"name": v[0], "hint": v[1]} for k, v in EGGS.items()}},
        "xp": int(st.get("xp", 0)), "stage": {"current": cur, "next": nxt, "left": left},
        "streak": engine.streak(st.get("active_days", []), today), "chest": bool(st.get("chest")), "hunt": bool(st.get("hunt")),
        "vdone": st.get("vdone", {}), "mocks": st.get("mocks", 0), "unread": await crud.unread_count(db, user.id),
    }


# ---------- schedule ----------

@router.get("/plan")
async def get_plan(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    today = date.today()
    key = service.key_for(user)
    row = await service.get_state(db, user.id)
    plan = engine.build_plan(row.data, key, today)
    model = engine.build_model(row.data, key)
    done = row.data.get("plan_done", {})
    week = []
    for d in engine.plan_window(plan, today):
        week.append({**d, "blocks": [{**b, "key": f"{d['date']}:{i}", "done": bool(done.get(f"{d['date']}:{i}"))} for i, b in enumerate(d.get("blocks", []))]})
    await db.commit()
    return {
        "exam": exam_info(key), "settings": {"date": row.data.get("plan", {}).get("date") or EXAMS[key]["date"],
                                             "days": plan["days_per_week"], "min": plan["minutes"]},
        "week": week, "phases": plan["phases"], "freq": plan["freq"], "studied": plan["studied"], "mocks": plan["mocks"],
        "queue": plan["queue"], "end": plan["end"], "total_days": plan["total_days"],
        "tasks": [{"id": t["id"], "n": t["n"], "name": t["name"], "risk": t["risk"], "from": t.get("from")} for t in model["tasks"]],
        "root": model["root"], "root_name": NODE_BY_ID[model["root"]]["name"] if model["root"] else None,
    }


class KeyIn(BaseModel):
    key: str = Field(..., max_length=20)


@router.post("/plan/done")
async def toggle_plan_block(body: KeyIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await service.get_state(db, user.id)
    done = row.data.setdefault("plan_done", {})
    now_done = not done.get(body.key)
    if now_done:
        done[body.key] = True
        service.gain(row, EVENT_XP["route_block"])
        day = body.key.split(":")[0]
        if day == date.today().isoformat() and sum(1 for k, v in done.items() if v and k.startswith(day)) >= 3:
            service.unlock(row, "route")
    else:
        done.pop(body.key, None)
    service.touch(row)
    await db.commit()
    return {"done": now_done, "xp": row.data["xp"]}


# ---------- daily task ----------

@router.post("/daily/hint")
async def daily_hint(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await service.get_state(db, user.id)
    d = row.data.setdefault("daily", {"date": date.today().isoformat(), "done": False, "tries": 0, "hint": 0})
    d["hint"] = min(3, int(d.get("hint", 0)) + 1)
    service.touch(row)
    await db.commit()
    model = engine.build_model(row.data, service.key_for(user))
    return {"hints": engine.daily_pick(model, date.today())["h"][: d["hint"]]}


class DailyIn(BaseModel):
    answer: str = Field(..., max_length=40)


@router.post("/daily/answer")
async def daily_answer(body: DailyIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await service.get_state(db, user.id)
    model = engine.build_model(row.data, service.key_for(user))
    dq = engine.daily_pick(model, date.today())
    d = row.data.setdefault("daily", {"date": date.today().isoformat(), "done": False, "tries": 0, "hint": 0})
    d["tries"] = int(d.get("tries", 0)) + 1
    ok = any(engine.same_ans(body.answer, a) for a in dq["a"])
    msg = ""
    if ok and not d.get("done"):
        d["done"] = True
        service.unlock(row, "daily")
        service.gain(row, 150)
    elif not ok:
        near = dq.get("near")
        msg = near[1] if near and engine.same_ans(body.answer, near[0]) else "Пока нет. Возьмите подсказку."
    service.touch(row)
    await db.commit()
    return {"ok": ok, "message": msg, "sol": dq["sol"] if ok else None, "xp": row.data["xp"]}


# ---------- events: achievements, secret stars, videos, breaks ----------

class EventIn(BaseModel):
    event: str
    id: str | None = None


@router.post("/events")
async def event(body: EventIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await service.get_state(db, user.id)
    st = row.data
    new_ach, fresh_egg = False, False
    if body.event == "ach" and body.id in {"root", "ask", "hunter"}:
        new_ach = service.unlock(row, body.id)
    elif body.event == "egg" and body.id in EGGS:
        eggs = st.setdefault("eggs", {})
        fresh_egg = body.id not in eggs
        if fresh_egg:
            eggs[body.id] = datetime.utcnow().isoformat()
            await service.notify(db, user.id, f"Секретная звезда: {EGGS[body.id][0]}", "awards")
    elif body.event == "hunt" and not st.get("hunt"):
        st["hunt"] = True
        new_ach = service.unlock(row, "hunter")
        service.gain(row, EVENT_XP["hunt"])
    elif body.event == "chest" and not st.get("chest"):
        today = date.today().isoformat()
        ready = st.get("daily", {}).get("done") or sum(1 for k, v in st.get("plan_done", {}).items() if v and k.startswith(today)) >= 2
        if not ready:
            raise HTTPException(400, "Закройте 2 пункта маршрута или решите задачу дня")
        st["chest"] = True
        new_ach = service.unlock(row, "chest")
        service.gain(row, EVENT_XP["chest"])
    elif body.event == "video" and body.id and body.id.isdigit() and 1 <= int(body.id) <= 19:
        vd = st.setdefault("vdone", {})
        if body.id not in vd:
            vd[body.id] = True
            service.gain(row, EVENT_XP["video_task"])
    elif body.event == "break":
        service.gain(row, EVENT_XP["break"])
    else:
        raise HTTPException(422, "Неизвестное событие")
    service.touch(row)
    await db.commit()
    return {"xp": st.get("xp", 0), "new_ach": new_ach, "fresh_egg": fresh_egg,
            "stars": len(st.get("ach", {})) + len(st.get("eggs", {}))}


class QuizIn(BaseModel):
    ok: int = Field(..., ge=0, le=10)
    total: int = Field(..., ge=1, le=10)


@router.post("/nodes/{node_id}/quiz")
async def node_quiz(node_id: str, body: QuizIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if node_id not in NODE_BY_ID:
        raise HTTPException(404, "Нет такой темы")
    row = await service.get_state(db, user.id)
    mast = row.data.setdefault("mastery", {})
    before = mast.get(node_id, 0.6)
    share = min(1.0, body.ok / body.total)
    unknown = row.data.get("unknown", [])
    mast[node_id] = round(share * 0.8 + 0.12, 2) if node_id in unknown else round(before * 0.4 + share * 0.6, 2)
    row.data["unknown"] = [u for u in unknown if u != node_id]
    service.unlock(row, "diag")
    service.gain(row, 120 if share == 1 else 40)
    service.touch(row)
    await db.commit()
    return {"before": before, "after": mast[node_id]}


# ---------- notifications ----------

@router.get("/notifications")
async def notifications(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    notes = await crud.list_notifications(db, user.id)
    return {"notifications": [{"id": n.id, "text": n.text, "go": n.go, "read": n.read,
                               "created_at": n.created_at.isoformat() if n.created_at else None} for n in notes]}


class ReadIn(BaseModel):
    id: int | None = None


@router.post("/notifications/read")
async def read_notifications(body: ReadIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await crud.mark_read(db, user.id, body.id)
    return {"ok": True}


# ---------- assistant chat ----------

async def _student_context(db: AsyncSession, user: User) -> str:
    row = await service.get_state(db, user.id)
    key = service.key_for(user)
    model = engine.build_model(row.data, key)
    weak = ", ".join(NODE_BY_ID[w]["name"] for w in model["weak"]) or "нет"
    root = NODE_BY_ID[model["root"]]["name"] if model["root"] else "нет"
    return f"Ученик {user.grade or '?'} класса, готовится: {EXAMS[key]['title']}. Слабые темы: {weak}; первопричина: {root}."


async def _teacher_context(db: AsyncSession, user: User) -> str:
    lines = []
    for cg in await crud.teacher_classes(db, user.id):
        for s in await crud.class_students(db, cg.id):
            row = await service.get_state(db, s.id)
            key = service.key_for(s)
            m = engine.build_model(row.data, key)
            lines.append(f"{cg.name}: {s.name or s.email}, {EXAMS[key]['short']}, прогноз {engine.forecast_value(m, key)}, "
                         f"первопричина {NODE_BY_ID[m['root']]['name'] if m['root'] else 'нет'}")
    return "Данные учеников:\n" + ("\n".join(lines[:60]) if lines else "учеников в классах пока нет")


@router.get("/chat/{kind}")
async def get_chat(kind: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    msgs = await crud.chat_history(db, user.id, kind)
    return {"messages": [{"role": m.role, "content": m.content} for m in msgs]}


class ChatIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    image: str | None = None  # base64 JPEG/PNG without data: prefix


@router.post("/chat/{kind}")
async def post_chat(kind: str, body: ChatIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if kind not in ("student", "teacher"):
        raise HTTPException(404, "Нет такого чата")
    if body.image:
        try:
            if len(base64.b64decode(body.image, validate=True)) > 8 * 1024 * 1024:
                raise HTTPException(400, "Фото больше 8 МБ")
        except (ValueError, base64.binascii.Error):
            raise HTTPException(400, "Фото не читается")
    db.add(ChatMessage(user_id=user.id, kind=kind, role="user", content=body.text + (" [приложено фото решения]" if body.image else "")))
    await db.commit()
    hist = [{"role": m.role, "content": m.content} for m in await crud.chat_history(db, user.id, kind)]
    ctx = await (_teacher_context(db, user) if kind == "teacher" else _student_context(db, user))
    try:
        reply = await llm.chat(kind, ctx, hist, body.image)
    except Exception as exc:  # LLM down: keep the question, tell the user
        log.exception("chat failed: %s", exc)
        raise HTTPException(502, "Помощник сейчас недоступен. Попробуйте через минуту.")
    db.add(ChatMessage(user_id=user.id, kind=kind, role="assistant", content=reply or "…"))
    if kind == "student":
        row = await service.get_state(db, user.id)
        service.unlock(row, "ask")
        service.touch(row)
    await db.commit()
    return {"reply": reply}


@router.delete("/chat/{kind}")
async def delete_chat(kind: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await crud.clear_chat(db, user.id, kind)
    return {"ok": True}


@router.post("/map/analysis")
async def map_analysis(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await service.get_state(db, user.id)
    key = service.key_for(user)
    m = engine.build_model(row.data, key)
    nodes = "\n".join(f"{n['name']}: {'нет данных' if n['id'] in m['unknown'] else str(round(m['E'][n['id']] * 100)) + '%'}"
                      f"{' [не освоено]' if n['id'] in m['weak'] else ' [под угрозой]' if n['id'] in m['threat'] else ''}" for n in NODES)
    tasks = "\n".join(f"{engine.task_label(t)} {t['name']}, макс {t['max']}, ожидаемо {round(t['exp'], 1)}{' [под угрозой]' if t['risk'] else ''}" for t in m["tasks"])
    try:
        text = await llm.gap_analysis(nodes, tasks, NODE_BY_ID[m["root"]]["name"] if m["root"] else None)
    except Exception as exc:
        log.exception("gap analysis failed: %s", exc)
        raise HTTPException(502, "Разбор сейчас недоступен. Попробуйте через минуту.")
    service.unlock(row, "root")
    service.touch(row)
    await db.commit()
    return {"text": text}


# ---------- classes and homework (student side) ----------

class CodeIn(BaseModel):
    code: str = Field(..., min_length=4, max_length=12)


@router.post("/classes/join")
async def join_class(body: CodeIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != "student":
        raise HTTPException(400, "Вступить в класс может ученик")
    cg = await crud.join_class(db, user.id, body.code)
    if cg is None:
        raise HTTPException(404, "Класс с таким кодом не найден")
    await service.notify(db, cg.teacher_id, f"{user.name or user.email} вступил(а) в «{cg.name}»", "teacher")
    await db.commit()
    return {"id": cg.id, "name": cg.name}


@router.post("/assignments/{assignment_id}/done")
async def assignment_done(assignment_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    a = await db.get(Assignment, assignment_id)
    classes = {c.id for c in await crud.student_classes(db, user.id)}
    if a is None or a.class_id not in classes:
        raise HTTPException(404, "Задание не найдено")
    if user.id not in (a.done_by or []):
        a.done_by = [*(a.done_by or []), user.id]
    await service.notify(db, a.teacher_id, f"{user.name or user.email} сдал(а): {a.topic}", "teacher")
    await db.commit()
    return {"ok": True}
