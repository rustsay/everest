"""Weekly report: what was done in the last 7 days, how the forecast moved, what is left to the goal, what is next.
Pure function over the learner document and the forecast history (no DB, no network)."""
from __future__ import annotations

from datetime import date, timedelta

from app.learning import engine
from app.learning.content import EXAMS

KEYS = ("solved", "ok", "checks", "checks1", "fixed")


def week(state: dict, model: dict, key: str, hist: list[tuple[date, int]], today: date) -> dict:
    """hist: (date, forecast value) of the measurements, oldest first."""
    start = today - timedelta(days=6)
    days = state.get("days") or {}
    tot = {k: 0 for k in KEYS}
    for d, c in days.items():
        if start.isoformat() <= d <= today.isoformat():
            for k in KEYS:
                tot[k] += int(c.get(k, 0))
    active = sorted(d for d in state.get("active_days", []) if start.isoformat() <= d <= today.isoformat())
    now = engine.forecast_value(model, key)
    before = [v for d, v in hist if d < start]
    in_week = [v for d, v in hist if start <= d <= today]
    delta = (now - before[-1]) if before and in_week else None
    ex = EXAMS[key]
    target = state.get("target")
    gap = max(0, target["primary"] - round(model["primary"])) if target and key == "prof" else None
    need = engine.needed_tasks(model["tasks"], target["primary"] if target else None) if key == "prof" else model["tasks"]
    focus = [t for t in sorted(need, key=lambda t: t["p"]) if t["p"] < 0.8][:3]
    redo = state.get("redo") or {}
    out = {
        "from": start.isoformat(), "to": today.isoformat(), "active": len(active), "active_days": active, **tot,
        "acc": round(100 * tot["ok"] / tot["solved"]) if tot["solved"] else None,
        "forecast": now, "delta": delta, "pct": ex["pct"], "max": ex["max"],
        "target": target, "gap": gap,
        "redo_due": sum(1 for r in redo.values() if r["due"] <= today.isoformat()), "redo_total": len(redo),
        "focus": [{"task": engine.task_label(t), "name": t["name"], "p": round(t["p"] * 100)} for t in focus],
    }
    out["lines"] = lines(out)
    return out


def plural(n: int, one: str, few: str, many: str) -> str:
    n = abs(n) % 100
    if 11 <= n <= 14:
        return many
    return one if n % 10 == 1 else few if 2 <= n % 10 <= 4 else many


def ru(d: str) -> str:
    return f"{d[8:10]}.{d[5:7]}"


def lines(w: dict) -> list[str]:
    """The report in plain sentences (screen, notification, email)."""
    out = [f"Дней с занятиями: {w['active']} из 7."]
    if w["solved"]:
        out.append(f"Решено задач с первой попытки: {w['solved']}, верно {w['ok']} ({w['acc']}%).")
    else:
        out.append("Задач из банка и карт заданий за неделю не решено.")
    if w["checks"] or w["checks1"]:
        out.append(f"Проверок по фото: {w['checks'] + w['checks1']}.")
    if w["fixed"]:
        out.append(f"Исправлено ошибок: {w['fixed']}.")
    unit = "%" if w["pct"] else f" из {w['max']}"
    if w["delta"] is not None:
        sign = "+" if w["delta"] > 0 else ""
        out.append(f"Прогноз: {w['forecast']}{unit} ({sign}{w['delta']} за неделю).")
    else:
        out.append(f"Прогноз: {w['forecast']}{unit}.")
    if w["gap"] is not None:
        out.append(f"До цели {w['target']['test']} баллов не хватает {w['gap']} первичных." if w["gap"] else f"Цель {w['target']['test']} баллов по прогнозу достигнута.")
    if w["redo_due"]:
        out.append(f"Ждут исправления: {w['redo_due']} {plural(w['redo_due'], 'задача', 'задачи', 'задач')}.")
    if w["focus"]:
        out.append("На следующей неделе главное: " + ", ".join(f"{f['task']} ({f['name'].lower()})" for f in w["focus"]) + ".")
    return out
