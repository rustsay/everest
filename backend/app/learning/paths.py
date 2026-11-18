"""Educational trajectory: stages with goals, task focus and checkpoints until the exam.

Two ways to build it, the result has one shape:
- rules_path: from the learner model, no network; always works;
- the language model writes it from the same facts (llm.build_path), then `validate` keeps only what is allowed:
  task ids of this exam, dates between today and the exam, short texts. Problems are never invented:
  `attach_problems` adds published problems from the bank to each stage.

Shape: {"source": "ai"|"rules", "summary": str, "why": [str], "stages": [{"title", "from", "to", "goal", "tasks": ["T6"], "check", "problems": [ref]}]}
"""
from __future__ import annotations

import math
import re
from datetime import date, timedelta

from app.learning.content import EXAMS, NODE_BY_ID


def label(t: dict) -> str:
    return f"№ {t['n']} {t['name']}" if t.get("n") else t["name"]


def task_facts(model: dict, state: dict | None) -> list[dict]:
    """Per exam task: estimate and where it comes from (for a class `state` is None and `obs` holds the share of students with data)."""
    out = []
    for t in model["tasks"]:
        ev = []
        if state is not None:
            pr = (state.get("prac") or {}).get(t["id"])
            if pr and pr[1]:
                ev.append(f"ответы: {pr[0]} из {pr[1]} верно")
            if t.get("obs") is not None:
                ev.append(f"проверка по фото: {round(t['obs'] * 100)}%")
        from app.learning.engine import BLOCK_NAMES, task_block
        out.append({"id": t["id"], "label": label(t), "part": t["part"], "max": t["max"], "p": round(t["p"], 2), "block": BLOCK_NAMES[task_block(t)],
                    "risk": bool(t.get("risk")), "evidence": "; ".join(ev)})
    return out


def _gain(t: dict) -> float:
    return (1 - min(1.0, t["p"])) * t["max"] * t.get("att", 1.0)


def _split(today: date, end: date, shares: list[float]) -> list[tuple[str, str]]:
    total = max(7, (end - today).days)
    out, acc = [], 0.0
    for i, f in enumerate(shares):
        a = today + timedelta(days=round(acc * total))
        acc += f
        b = end if i == len(shares) - 1 else today + timedelta(days=round(acc * total) - 1)
        out.append((a.isoformat(), max(a, b).isoformat()))
    return out


def _sessions(t: dict) -> int:
    from app.learning.engine import GOAL
    return max(2, math.ceil((GOAL - min(t["p"], GOAL)) / 0.12)) if t["p"] < GOAL else 1


def _steps(ts: list[dict], tail: str) -> list[str]:
    from app.learning.engine import _protos
    out = []
    for t in ts[:6]:
        pr = [p["name"] for p in _protos(t)][:4]
        lbl = f"№ {t['n']}" if t.get("n") else t["name"]
        out.append(f"{lbl}: " + (" → ".join(f"«{x}»" for x in pr) if pr else "от простых задач к сложным"))
    if tail:
        out.append(tail)
    return out


def rules_path(model: dict, key: str, today: date, end: date, basis: list[str], target: dict | None = None, p2_open: bool = False) -> dict:
    """A trajectory by blocks (geometry, algebra, probability, functions) from easy to hard, the same logic as the
    daily schedule: the goal decides which tasks are needed, the second part waits until the student can solve it."""
    from app.learning.engine import BLOCK_NAMES, GOAL, _rank, needed_tasks, task_block
    tasks = model["tasks"]
    need = sorted(needed_tasks(tasks, (target or {}).get("primary") if key == "prof" else None), key=lambda t: (t["part"], _rank(t)))
    p1 = [t for t in need if t["part"] == 1]
    p2 = [t for t in need if t["part"] == 2]
    todo1 = [t for t in p1 if t["p"] < GOAL]
    ex = EXAMS[key]
    final = "Контрольные замеры" if ex["pct"] else "Пробники"
    blocks = list(dict.fromkeys(task_block(t) for t in todo1))
    first: list[dict] = []
    for b in blocks:  # the first, easiest task of every block
        first += [t for t in todo1 if task_block(t) == b][:1]
    first = [t for t in todo1 if t in first]
    rest = [t for t in todo1 if t not in first]
    lbl = lambda ts: ", ".join(f"№ {t['n']}" if t.get("n") else t["name"] for t in ts)  # noqa: E731
    stages: list[dict] = []
    if first:
        stages.append({"title": "Фундамент по блокам", "tasks": [t["id"] for t in first][:8],
                       "goal": f"Решать {lbl(first[:8])} без ошибок: 3 задачи подряд по каждому прототипу",
                       "check": "мини-вариант из этих заданий в конце этапа",
                       "steps": _steps(first, "Блоки чередуются по дням: " + ", ".join(BLOCK_NAMES[b].lower() for b in blocks))})
    if rest:
        stages.append({"title": "Первая часть целиком" if p2 or ex["pct"] is False else "Вся программа", "tasks": [t["id"] for t in rest][:8],
                       "goal": "Каждое задание первой части: не меньше 7 из 10 верных первых попыток",
                       "check": "вариант первой части", "steps": _steps(rest, "Разминка каждый день - по уже освоенным заданиям блока")})
    if p2:
        cond = "" if p2_open else " Начинаем, когда первая часть в среднем на 70%."
        stages.append({"title": "Вторая часть", "tasks": [t["id"] for t in p2][:8],
                       "goal": f"Получать баллы за {lbl(p2)}: полное решение и проверка по фото.{cond}",
                       "check": "3 работы на проверку по фото", "steps": _steps(p2, "Решение каждой задачи - на проверку по фото, разбор замечаний в чате")})
    goal_txt = (f"Выйти на {target['primary']} первичных баллов ({target['test']} тестовых)" if target and key == "prof"
                else "Полный вариант раз в неделю, разбор каждой ошибки")
    weakest = sorted(p1 + p2, key=lambda t: t["p"])[:6] or tasks[:6]
    stages.append({"title": final, "tasks": [t["id"] for t in need if t in weakest] or [t["id"] for t in weakest],
                   "goal": goal_txt, "check": "пробник раз в неделю" if not ex["pct"] else "замер раз в две недели",
                   "steps": ["Пробник в конце каждой недели", "Разбор ошибок пробника в тот же день", "Повтор заданий, где потеряны баллы"]})
    # stage length follows how many sessions its tasks still need; the last stage takes at least two weeks
    total = max(14, (end - today).days)
    last = max(14, round(total * 0.12))
    w = [sum(_sessions(t) for t in tasks if t["id"] in s["tasks"]) for s in stages[:-1]]
    spans, acc = [], today
    budget = total - last
    for i, s in enumerate(stages[:-1]):
        n = max(7, round(budget * w[i] / max(1, sum(w))))
        b = min(end - timedelta(days=last), acc + timedelta(days=n - 1))
        spans.append((acc.isoformat(), max(acc, b).isoformat()))
        acc = max(acc, b) + timedelta(days=1)
    spans.append((min(acc, end).isoformat(), end.isoformat()))
    for s, (a, b) in zip(stages, spans):
        s["from"], s["to"] = a, b
    why = list(basis)
    if target and key == "prof":
        why.append(f"Цель: {target['test']} тестовых баллов, это {target['primary']} первичных по шкале 2026 года")
    if p2 and not p2_open:
        why.append("Вторая часть по диагностике пока не решается: сначала первая часть")
    if not p2 and key == "prof" and target:
        why.append("Для этой цели хватает первой части, вторая не нужна")
    if model.get("root"):
        why.append(("Начинаем с основ: " if model.get("basics") else "Первопричина ошибок: тема ") + f"«{NODE_BY_ID[model['root']]['name']}»")
    return {"source": "rules", "summary": "Собрано по правилам: задания по блокам от лёгких к сложным, "
            + ("потом вторая часть, " if p2 else "") + "в конце пробники.", "why": why[:6], "stages": stages}


def _task_id(v, allowed: dict[str, str]) -> str | None:
    s = str(v).strip()
    if s in allowed:
        return s
    m = re.search(r"\d+", s)
    if m and f"T{m.group(0)}" in allowed:
        return f"T{m.group(0)}"
    for tid, name in allowed.items():  # topics without a number (school program) come by name
        if s.lower() == name.lower():
            return tid
    return None


def validate(raw: dict, allowed: dict[str, str], today: date, end: date) -> dict | None:
    """Keep only what fits: known tasks, dates inside [today, end], no overlaps, short texts. None if nothing useful is left."""
    if not isinstance(raw, dict):
        return None
    stages = []
    for s in (raw.get("stages") or [])[:8]:
        if not isinstance(s, dict):
            continue
        try:
            a = max(today, date.fromisoformat(str(s.get("from"))[:10]))
            b = min(end, date.fromisoformat(str(s.get("to"))[:10]))
        except ValueError:
            continue
        tasks = list(dict.fromkeys(t for t in (_task_id(x, allowed) for x in (s.get("tasks") or [])) if t))[:8]
        title = str(s.get("title") or "").strip()[:80]
        if not tasks or not title or a > b:
            continue
        steps = [str(x).strip()[:160] for x in (s.get("steps") or []) if str(x).strip()][:10]
        stages.append({"title": title, "from": a.isoformat(), "to": b.isoformat(), "tasks": tasks, "steps": steps,
                       "goal": str(s.get("goal") or "").strip()[:300], "check": str(s.get("check") or "").strip()[:200]})
    stages.sort(key=lambda s: s["from"])
    for prev, cur in zip(stages, stages[1:]):  # no overlaps: a stage starts after the previous one
        if cur["from"] <= prev["to"]:
            cur["from"] = (date.fromisoformat(prev["to"]) + timedelta(days=1)).isoformat()
    stages = [s for s in stages if s["from"] <= s["to"]]
    if not stages:
        return None
    why = [str(w).strip()[:200] for w in (raw.get("why") or []) if str(w).strip()][:6]
    return {"summary": str(raw.get("summary") or "").strip()[:600], "why": why, "stages": stages}


def prompt_facts(kind: str, who: str, key: str, today: date, end: date, facts: list[dict], basis: list[str], extra: list[str],
                 days_week: int, minutes: int) -> str:
    ex = EXAMS[key]
    rows = "\n".join(
        f"- {f['id']}: {f['label']} (часть {f['part']}, блок «{f['block']}», макс. {f['max']} б.) оценка {round(f['p'] * 100)}%"
        + (" · под риском" if f["risk"] else "") + (f" · {f['evidence']}" if f["evidence"] else "") for f in facts)
    return f"""Экзамен: {ex['title']}. Сегодня {today.isoformat()}, {'конец учебного года' if ex['pct'] else 'экзамен'} {end.isoformat()} ({(end - today).days} дн.).
Время: {days_week} дн. в неделю по {minutes} мин.
Для кого: {who} ({'весь класс, оценки средние по ученикам' if kind == 'class' else 'один ученик'}).
Откуда данные: {'; '.join(basis) or 'данных пока нет, все оценки стартовые'}.
Задания (id: название, оценка - доля успеха по модели):
{rows}
{chr(10).join(extra)}"""


def attach_problems(data: dict, pool: dict[str, list[dict]], done: dict | None) -> None:
    """Up to 4 published problems per stage, unsolved first; only problems that exist in the bank or task maps."""
    for s in data["stages"]:
        refs: list[str] = []
        for tid in s["tasks"]:
            items = pool.get(tid, [])
            items = sorted(items, key=lambda p: 1 if (done or {}).get(p["pid"]) is not None else 0)
            refs += [p["ref"] for p in items if p["a"]][:2]
        s["problems"] = refs[:4]


def basis_lines(diag: bool, state: dict) -> list[str]:
    out = []
    if diag:
        out.append("входная диагностика")
    n = sum(c[1] for c in (state.get("prac") or {}).values())
    if n:
        out.append(f"ответы в банке задач, картах заданий и вариантах: {n}")
    if state.get("obs"):
        out.append(f"проверка по фото: заданий {len(state['obs'])}")
    return out


def plan_settings(state: dict, key: str) -> tuple[date, int, int]:
    ps = state.get("plan") or {}
    end = date.fromisoformat(ps.get("date") or EXAMS[key]["date"])
    return end, int(ps.get("days") or 5), int(ps.get("min") or 45)


def avg_model(models: list[dict]) -> dict:
    """A class: task estimates averaged over students, risk if a third or more of the class is at risk."""
    base = models[0]
    tasks = []
    for i, t in enumerate(base["tasks"]):
        ps = [m["tasks"][i]["p"] for m in models]
        risk = sum(1 for m in models if m["tasks"][i]["risk"])
        tasks.append({**t, "p": sum(ps) / len(ps), "risk": risk * 3 >= len(models), "obs": None})
    roots = [m["root"] for m in models if m.get("root")]
    root = max(set(roots), key=roots.count) if roots else None
    return {**base, "tasks": tasks, "root": root}


def exam_end_ok(end: date, today: date) -> date:
    return end if end > today + timedelta(days=6) else today + timedelta(days=7)


__all__ = ["rules_path", "validate", "prompt_facts", "attach_problems", "task_facts", "basis_lines", "plan_settings", "avg_model",
           "exam_end_ok"]
