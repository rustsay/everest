"""Educational trajectory: stages with goals, task focus and checkpoints until the exam.

Two ways to build it, the result has one shape:
- rules_path: from the learner model, no network; always works;
- the language model writes it from the same facts (llm.build_path), then `validate` keeps only what is allowed:
  task ids of this exam, dates between today and the exam, short texts. Problems are never invented:
  `attach_problems` adds published problems from the bank to each stage.

Shape: {"source": "ai"|"rules", "summary": str, "why": [str], "stages": [{"title", "from", "to", "goal", "tasks": ["T6"], "check", "problems": [ref]}]}
"""
from __future__ import annotations

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
        out.append({"id": t["id"], "label": label(t), "part": t["part"], "max": t["max"], "p": round(t["p"], 2),
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


def rules_path(model: dict, key: str, today: date, end: date, basis: list[str]) -> dict:
    """A trajectory from the estimates alone: weak first part tasks, then the whole first part, then the second, then mocks."""
    tasks = model["tasks"]
    p1 = sorted([t for t in tasks if t["part"] == 1], key=_gain, reverse=True)
    p2 = sorted([t for t in tasks if t["part"] == 2], key=_gain, reverse=True)
    labels = lambda ts: ", ".join(f"№ {t['n']}" if t.get("n") else t["name"] for t in ts)  # noqa: E731
    days = (end - today).days
    ex = EXAMS[key]
    final = "Контрольные замеры" if ex["pct"] else "Пробники"
    stages: list[dict] = []
    if days < 28 or not p1:
        weak = sorted(tasks, key=_gain, reverse=True)[:5]
        spans = _split(today, end, [0.6, 0.4])
        stages = [
            {"title": "Слабые места", "tasks": [t["id"] for t in weak], "goal": f"Подтянуть {labels(weak)}: решать без ошибок 3 задачи подряд",
             "check": "мини-вариант из этих заданий в конце этапа"},
            {"title": final, "tasks": [t["id"] for t in sorted(tasks, key=_gain, reverse=True)[:6]],
             "goal": "Решать полный вариант и разбирать каждую ошибку", "check": "пробник раз в неделю"},
        ]
    else:
        first = p1[:4]
        rest = [t for t in p1 if t not in first][:8] or first
        whole = "Вся первая часть" if p2 else "Вся программа"
        stages = [
            {"title": "Фундамент", "tasks": [t["id"] for t in first], "goal": f"Довести {labels(first)} до уверенного решения: 3 задачи подряд без ошибок",
             "check": "вариант из этих заданий в конце этапа"},
            {"title": whole, "tasks": [t["id"] for t in rest],
             "goal": ("Каждое задание первой части" if p2 else "Каждая тема") + ": не меньше 7 из 10 верных первых попыток",
             "check": "вариант первой части" if p2 else "контрольная по этим темам"},
        ]
        if p2:
            top2 = p2[:3]
            stages.append({"title": "Вторая часть", "tasks": [t["id"] for t in top2],
                           "goal": f"Получать баллы за {labels(top2)}: полное решение и проверка по фото", "check": "3 работы на проверку по фото"})
        stages.append({"title": final, "tasks": [t["id"] for t in sorted(tasks, key=_gain, reverse=True)[:6]],
                       "goal": "Полный вариант раз в неделю, разбор каждой ошибки" if not ex["pct"] else "Контрольный замер по всем темам, разбор ошибок",
                       "check": "пробник раз в неделю" if not ex["pct"] else "замер раз в две недели"})
        spans = _split(today, end, [0.3, 0.35, 0.25, 0.1] if p2 else [0.35, 0.45, 0.2])
    for s, (a, b) in zip(stages, spans):
        s["from"], s["to"] = a, b
    why = list(basis)
    if model.get("root"):
        why.append(f"Первопричина ошибок по оценке модели: тема «{NODE_BY_ID[model['root']]['name']}»")
    risky = [t for t in tasks if t.get("risk")][:4]
    if risky:
        why.append("Под риском: " + labels(risky))
    return {"source": "rules", "summary": "Собрано по правилам: сначала задания, где больше всего теряется баллов, потом вся первая часть, "
            + ("вторая часть " if p2 else "") + "и пробники в конце.", "why": why[:6], "stages": stages}


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
    for s in (raw.get("stages") or [])[:6]:
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
        stages.append({"title": title, "from": a.isoformat(), "to": b.isoformat(), "tasks": tasks,
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
        f"- {f['id']}: {f['label']} (часть {f['part']}, макс. {f['max']} б.) оценка {round(f['p'] * 100)}%"
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
