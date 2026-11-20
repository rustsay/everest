"""Trajectory of the profile exam by the project's methodology (Nov 2026). Pure functions, no DB and no network.

Modules (weeks and hours of the methodology; hours are study time on the platform: walkthroughs, bank, photo checks):
  1-12 - 6 weeks / 80 h, 13 - 2 / 26, 15 - 3 / 34, 16 - 3 / 33, 17 - 4 / 37, 19 - 6 / 85, 18 - 6 / 108, 14 - 4 / 35.
Plans by the diagnostic:
  1 - the first part is weak:                 1-12, 13, 15, 16, 17      -> 90-96 points in 23 weeks
  2 - the first part is good:                 13, 15, 16, 17, 19        -> 94-98 in 23 weeks
  3 - the first part, 13, 15 and 16 are good: 17, 19, 18, 14            -> 98-100 in 25 weeks
The 5 weeks above the sum of the modules are repetition and mock exams at the end.
Before a module (requirements of the methodology):
  15, 16 - 1-12 and 13; 19, 18 - 1-12, 13, 15, 16; 17 - the same and every type of task 1; 14 - the same and every type of tasks 1 and 3.
A high goal (from HIGH_TARGET test points): the first part takes at most PART1_CAP weeks, its rest goes into warm-ups.
Fewer hours a week than the methodology needs: modules are stretched, what does not fit before the exam is cut from the end,
and the expected result goes down by the points of the cut tasks (on the 2026 scale).
"""
from __future__ import annotations

import math
from datetime import date, timedelta

from app.learning.content import EXAMS, PROF_SCALE_2026

MODULES: dict[str, dict] = {
    "P1": {"title": "Первая часть: задания 1-12", "tasks": list(range(1, 13)), "weeks": 6, "hours": 80, "req": []},
    "T13": {"title": "№ 13 Уравнение", "tasks": [13], "weeks": 2, "hours": 26, "req": []},
    "T15": {"title": "№ 15 Неравенство", "tasks": [15], "weeks": 3, "hours": 34, "req": ["P1", "T13"]},
    "T16": {"title": "№ 16 Экономическая задача", "tasks": [16], "weeks": 3, "hours": 33, "req": ["P1", "T13"]},
    "T17": {"title": "№ 17 Планиметрия", "tasks": [17], "weeks": 4, "hours": 37, "req": ["P1", "T13", "T15", "T16"], "all_types": [1]},
    "T19": {"title": "№ 19 Теория чисел", "tasks": [19], "weeks": 6, "hours": 85, "req": ["P1", "T13", "T15", "T16"]},
    "T18": {"title": "№ 18 Параметр", "tasks": [18], "weeks": 6, "hours": 108, "req": ["P1", "T13", "T15", "T16"]},
    "T14": {"title": "№ 14 Стереометрия", "tasks": [14], "weeks": 4, "hours": 35, "req": ["P1", "T13", "T15", "T16"], "all_types": [1, 3]},
}
PLANS: dict[int, list[str]] = {1: ["P1", "T13", "T15", "T16", "T17"], 2: ["T13", "T15", "T16", "T17", "T19"], 3: ["T17", "T19", "T18", "T14"]}
PLAN_NAMES = {1: "для тех, кто пока плохо решает первую часть", 2: "для тех, кто хорошо решает первую часть",
              3: "для тех, кто хорошо решает первую часть, 13, 15 и 16"}
EXPECT: dict[int, tuple[int, int]] = {1: (90, 96), 2: (94, 98), 3: (98, 100)}
EXTRA_ORDER = ["T19", "T18", "T14"]  # what comes next when there is time left after the plan
REVIEW_WEEKS = 5
HIGH_TARGET = 82
PART1_CAP = 4
GOOD_PART1 = 0.9  # «хорошо решает первую часть»: share of solved types of tasks 1-12
FIX_WEEK_HOURS = 8  # a short module «все типы № 1 (и № 3)» before 17 and 14


def _types_of(types: dict[str, float], n: int) -> dict[str, float]:
    return {t: v for t, v in types.items() if t.split(".")[0] == str(n)}


def part1_share(types: dict[str, float], model: dict) -> float:
    """Share of solved types of tasks 1-12 (diagnostic by types), else the mean estimate of tasks 1-12."""
    p1 = {t: v for t, v in types.items() if int(t.split(".")[0]) <= 12}
    if p1:
        return sum(1 for v in p1.values() if v >= 0.99) / len(p1)
    ts = [t for t in model["tasks"] if t["part"] == 1]
    return sum(min(1.0, t["p"]) for t in ts) / len(ts) if ts else 0.0


def task_full(types: dict[str, float], model: dict, n: int) -> bool:
    """Full score on a second-part task: the chosen type in the diagnostic, else the photo check of the task."""
    tv = _types_of(types, n)
    if tv:
        return max(tv.values()) >= 0.99
    t = next((t for t in model["tasks"] if t.get("n") == n), None)
    return bool(t and (t.get("obs") or 0) >= 0.99)


def choose_plan(types: dict[str, float], model: dict) -> tuple[int, float]:
    share = part1_share(types, model)
    if share >= GOOD_PART1:
        if all(task_full(types, model, n) for n in (13, 15, 16)):
            return 3, share
        return 2, share
    return 1, share


def missing_types(types: dict[str, float], ns: list[int]) -> list[str]:
    return [t for n in ns for t, v in sorted(_types_of(types, n).items(), key=lambda kv: [int(x) for x in kv[0].split(".")]) if v < 0.99]


def test_points(primary: float) -> int:
    p = max(0, min(32, int(round(primary))))
    return PROF_SCALE_2026[p]


def _primary_for(test: int) -> int:
    return next((p for p, t in enumerate(PROF_SCALE_2026) if t >= test), 32)


def _module_max(m: str) -> int:
    mx = {t["n"]: t["max"] for t in EXAMS["prof"]["tasks"]}
    return sum(mx[n] for n in MODULES[m]["tasks"])


def build(types: dict[str, float], model: dict, target: dict | None, today: date, end: date, days_week: int, minutes: int,
          type_names: dict[str, str] | None = None) -> dict:
    """The trajectory: stages (modules) with dates, goals, steps by types, links to the walkthroughs, and the method block
    (plan, hours, what was cut, expected result). The shape is the one of learning/paths.py."""
    names = type_names or {}
    plan, share = choose_plan(types, model)
    hours_week = max(0.5, days_week * minutes / 60)
    total_weeks = max(1, (end - today).days // 7)
    review = REVIEW_WEEKS if total_weeks >= 2 * REVIEW_WEEKS else max(1, total_weeks // 5)
    avail = max(1, total_weeks - review)
    high = bool(target and int(target.get("test") or 0) >= HIGH_TARGET)

    order = list(PLANS[plan])
    done = set() if plan == 1 else ({"P1"} if plan == 2 else {"P1", "T13", "T15", "T16"})
    # a short module before 17 / 14 when some types of task 1 (and 3) are not solved yet (plans 2 and 3: 1-12 is not studied again)
    seq: list[str] = []
    fixed: set[int] = set()
    for m in order:
        need = [n for n in MODULES[m].get("all_types", []) if n not in fixed]
        if "P1" not in order and need:
            miss = missing_types(types, need)
            if miss:
                seq.append("FIX:" + ",".join(miss))
            fixed.update(need)
        seq.append(m)

    def weeks_of(m: str) -> tuple[int, float]:
        if m.startswith("FIX:"):
            return 1, float(FIX_WEEK_HOURS)
        w, h = MODULES[m]["weeks"], float(MODULES[m]["hours"])
        w = max(w, math.ceil(h / hours_week))  # fewer hours a week than the methodology: the module is stretched
        if m == "P1" and high and w > PART1_CAP:  # a high goal: the first part takes a month at most, whatever the hours
            w, h = PART1_CAP, min(h, PART1_CAP * hours_week)
        return w, h

    plan_hours = sum(weeks_of(m)[1] for m in seq)
    method_weeks = sum(min(MODULES[m]["weeks"], PART1_CAP if (m == "P1" and high) else 99) if not m.startswith("FIX:") else 1 for m in seq)
    hours_need = round(plan_hours / max(1, min(avail, method_weeks)), 1)

    # a «все типы» module goes together with the module it prepares: both fit or both are cut
    units: list[list[str]] = []
    for m in seq:
        if units and units[-1][-1].startswith("FIX:"):
            units[-1].append(m)
        else:
            units.append([m])
    kept, cut, used = [], [], 0
    for unit in units:
        ws = [weeks_of(m) for m in unit]
        need_w = sum(w for w, _ in ws)
        if used + need_w <= avail or not kept:
            for m, (w, h) in zip(unit, ws):
                if used + w > avail:  # the very first module longer than all the time: as much as there is
                    w = max(1, avail - used)
                kept.append((m, w, h))
                used += w
        else:
            cut += [m for m in unit if not m.startswith("FIX:")]
    # time left after the plan: the next modules of the methodology
    for m in EXTRA_ORDER:
        if m in seq:
            continue
        w, h = weeks_of(m)
        if used + w <= avail and all(r in done or r in {k for k, _, _ in kept} for r in MODULES[m]["req"]):
            miss = missing_types(types, MODULES[m].get("all_types", [])) if "P1" not in {k for k, _, _ in kept} else []
            if miss and used + w + 1 <= avail:
                kept.append(("FIX:" + ",".join(miss), 1, float(FIX_WEEK_HOURS)))
                used += 1
            elif miss:
                continue
            kept.append((m, w, h))
            used += w

    # dates: modules one after another, then repetition and mocks until the exam
    stages, acc = [], today
    for m, w, h in kept:
        b = min(end, acc + timedelta(days=7 * w - 1))
        stages.append(_stage(m, acc, b, h, w, types, names, high))
        acc = b + timedelta(days=1)
    weak = sorted({t for s in stages for t in s["tasks"]}, key=lambda t: int(t[1:]))
    if acc <= end:
        stages.append({"title": "Повторение и пробники", "from": acc.isoformat(), "to": end.isoformat(), "tasks": weak[:12] or ["T1"],
                       "module": "REV", "goal": "Пробник раз в неделю, разбор каждой ошибки в тот же день",
                       "check": "пробник раз в неделю", "steps": ["Пробник в конце недели", "Разбор ошибок пробника",
                                                                  "Повтор типов, где потеряны баллы"], "links": []})

    # expected result: the methodology range, minus the points of the plan modules that do not fit before the exam
    lo, hi = EXPECT[plan]
    cut_plan = [m for m in cut if not m.startswith("FIX:") and m in PLANS[plan]]
    cut_primary = sum(_module_max(m) for m in cut_plan)
    exp = (test_points(_primary_for(lo) - cut_primary), test_points(_primary_for(hi) - cut_primary)) if cut_primary else (lo, hi)

    why = [f"План № {plan} по методике - {PLAN_NAMES[plan]}: решено {round(share * 100)}% типов первой части"]
    if plan >= 2:
        why.append("Первую часть заново не проходим: она уже решается" + (", 13, 15 и 16 тоже" if plan == 3 else ""))
    if high and "P1" in seq:
        why.append(f"Цель {target['test']} баллов: на первую часть не больше {PART1_CAP} недель, остальное - в разминках")
    if hours_week + 0.05 < hours_need:
        why.append(f"По методике нужно около {hours_need:g} ч в неделю, сейчас в расписании {hours_week:g} ч: сроки модулей растянуты")
    if cut:
        why.append("До экзамена не успеваем: " + ", ".join(_title(m) for m in cut) + ". Можно добавить часы в расписании")
    why.append(f"В конце {review} {'неделя' if review == 1 else 'недели' if review < 5 else 'недель'} на повторение и пробники")
    exp_txt = f"{exp[0]}-{exp[1]}" if exp[0] != exp[1] else str(exp[0])
    summary = (f"План № {plan} по методике: " + ", ".join(_title(m) for m, _, _ in kept) + ", потом повторение и пробники. "
               f"Ожидаемый результат по методике с учётом твоего темпа: {exp_txt} баллов.")
    return {"source": "method", "summary": summary, "why": why[:6], "stages": stages[:8],
            "method": {"plan": plan, "plan_name": PLAN_NAMES[plan], "part1_share": round(share, 2), "expect_base": list(EXPECT[plan]),
                       "expect": list(exp), "hours_week": round(hours_week, 1), "hours_need": hours_need, "cut": [_title(m) for m in cut],
                       "high": high, "review_weeks": review}}


def _title(m: str) -> str:
    if m.startswith("FIX:"):
        ns = sorted({t.split(".")[0] for t in m[4:].split(",")}, key=int)
        return "Все типы № " + " и № ".join(ns)
    return MODULES[m]["title"]


def _stage(m: str, a: date, b: date, hours: float, weeks: int, types: dict[str, float], names: dict[str, str], high: bool) -> dict:
    def tl(t: str) -> str:
        return f"{t} {names.get(t, '')}".strip()
    if m.startswith("FIX:"):
        miss = m[4:].split(",")
        ns = sorted({int(t.split(".")[0]) for t in miss})
        return {"title": _title(m), "from": a.isoformat(), "to": b.isoformat(), "tasks": [f"T{n}" for n in ns], "module": "FIX",
                "goal": "Решать все типы, которые нужны перед следующим модулем", "check": "по 3 задачи каждого типа без ошибок",
                "steps": [tl(t) for t in miss][:10], "links": [{"label": f"Разборы № {n}", "go": f"video/t{n}"} for n in ns], "hours": round(hours)}
    mod = MODULES[m]
    ns = mod["tasks"]
    weak = missing_types(types, ns) if types else []
    if m == "P1":
        goal = "Все типы заданий 1-12 без ошибок" + (f": за {weeks} нед., остальное - в разминках следующих этапов" if high else "")
        steps = ([f"Сначала нерешённые типы: {', '.join(weak[:8])}" + (" и ещё " + str(len(weak) - 8) if len(weak) > 8 else "")] if weak else []) + \
                ["По блокам: геометрия, алгебра, вероятность, функции", "Каждый тип: разбор на доске, потом 5-8 задач из банка",
                 "В конце модуля вариант первой части"]
        check = "вариант первой части: не меньше 11 из 12"
    else:
        n = ns[0]
        mx = next(t["max"] for t in EXAMS["prof"]["tasks"] if t.get("n") == n)
        order = sorted(_types_of(types, n).items(), key=lambda kv: (kv[1], [int(x) for x in kv[0].split(".")])) if types else []
        steps = [f"{tl(t)}" + (" - уже решается" if v >= 0.99 else "") for t, v in order][:9] or [f"Все типы № {n} по порядку"]
        steps.append(f"Каждое решение - на проверку по фото, разбор замечаний")
        goal = f"Получать за № {n} полный балл ({mx}): решение каждого типа с обоснованием"
        check = f"2-3 задачи № {n} разных типов на проверку по фото"
    return {"title": mod["title"], "from": a.isoformat(), "to": b.isoformat(), "tasks": [f"T{n}" for n in ns], "module": m,
            "goal": goal, "check": check, "steps": steps[:10], "hours": round(hours), "weeks": weeks,
            "links": [{"label": f"Разборы № {n}", "go": f"video/t{n}"} for n in ns[:12]]}


def check_order(stages: list[dict]) -> list[str]:
    """Edits of the schedule: a module may not stand before the modules it needs (if they are in the trajectory)."""
    pos = {s.get("module"): i for i, s in enumerate(stages) if s.get("module") in MODULES}
    errs = []
    for m, i in pos.items():
        for r in MODULES[m]["req"]:
            if r in pos and pos[r] > i:
                errs.append(f"«{MODULES[m]['title']}» нельзя ставить раньше «{MODULES[r]['title']}»: по методике сначала {MODULES[r]['title']}")
    return errs


# ---------- OGE and EGE base: modules of the draft approved by the project (Nov 2026) ----------
# weeks / hours of a module, plans by the goal mark; the 2026 marks: OGE «3» 8, «4» 15, «5» 22 (and at least 2 points
# for geometry in every case), base «3» 7, «4» 12, «5» 17.
EXAM_MODULES: dict[str, dict[str, dict]] = {
    "base": {
        "B1": {"title": "Практические задачи: 1-8", "tasks": list(range(1, 9)), "weeks": 3, "hours": 20},
        "B2": {"title": "Арифметика и алгебра: 14-18", "tasks": list(range(14, 19)), "weeks": 3, "hours": 20},
        "B3": {"title": "Геометрия: 9-13", "tasks": list(range(9, 14)), "weeks": 3, "hours": 20},
        "B4": {"title": "Повышенной трудности: 19-21", "tasks": [19, 20, 21], "weeks": 3, "hours": 20},
    },
    "oge": {
        "O1": {"title": "Практические задачи: 1-5", "tasks": [1, 2, 3, 4, 5], "weeks": 3, "hours": 20},
        "O2": {"title": "Алгебра: 6-14", "tasks": list(range(6, 15)), "weeks": 4, "hours": 30},
        "O3": {"title": "Геометрия: 15-19", "tasks": list(range(15, 20)), "weeks": 3, "hours": 25, "must": True},
        "O4": {"title": "Уравнения и текстовые задачи: 20-21", "tasks": [20, 21], "weeks": 3, "hours": 20},
        "O5": {"title": "График функции: 22", "tasks": [22], "weeks": 2, "hours": 12},
        "O6": {"title": "Геометрия, часть 2: 23-24", "tasks": [23, 24], "weeks": 3, "hours": 20},
        "O7": {"title": "Сложная геометрия: 25", "tasks": [25], "weeks": 2, "hours": 15},
    },
}
EXAM_PLANS: dict[str, dict[int, list[str]]] = {
    "base": {3: ["B1", "B2"], 4: ["B1", "B2", "B3"], 5: ["B1", "B2", "B3", "B4"]},
    "oge": {3: ["O1", "O2", "O3"], 4: ["O1", "O2", "O3", "O4"], 5: ["O1", "O2", "O3", "O4", "O5", "O6", "O7"]},
}
EXAM_REVIEW = 3
DEFAULT_GRADE = 4


def build_exam(key: str, types: dict[str, float], model: dict, target: dict | None, today: date, end: date, days_week: int,
               minutes: int, type_names: dict[str, str] | None = None) -> dict:
    """OGE / base: the plan by the goal mark, modules stretched by the hours a week, the mandatory geometry of OGE is never cut;
    a module whose tasks are already solved (all types right in the diagnostic) is skipped."""
    names = type_names or {}
    mods = EXAM_MODULES[key]
    grade = int((target or {}).get("grade") or DEFAULT_GRADE)
    grades = EXAMS[key]["grades"]
    hours_week = max(0.5, days_week * minutes / 60)
    total_weeks = max(1, (end - today).days // 7)
    review = EXAM_REVIEW if total_weeks >= 3 * EXAM_REVIEW else max(1, total_weeks // 5)
    avail = max(1, total_weeks - review)

    def solved(m: str) -> bool:
        ts = [v for t, v in types.items() if int(t.split(".")[0]) in mods[m]["tasks"]]
        return bool(ts) and all(v >= 0.99 for v in ts)

    plan = [m for m in EXAM_PLANS[key][grade] if not solved(m)] or [EXAM_PLANS[key][grade][-1]]
    skipped = [m for m in EXAM_PLANS[key][grade] if m not in plan]

    def weeks_of(m: str) -> tuple[int, float]:
        w, h = mods[m]["weeks"], float(mods[m]["hours"])
        return max(w, math.ceil(h / hours_week)), h

    order = sorted(plan, key=lambda m: (not mods[m].get("must"), plan.index(m)))  # what must stay is placed first
    keep, used = set(), 0
    for m in order:
        w, _ = weeks_of(m)
        if used + w <= avail or mods[m].get("must") or not keep:
            keep.add(m)
            used += w
    cut = [m for m in plan if m not in keep]
    if used < avail:  # time left: the next modules of the higher marks
        for m in EXAM_PLANS[key][5]:
            w, _ = weeks_of(m)
            if m not in plan and m not in skipped and used + w <= avail and not solved(m):
                plan.append(m)
                keep.add(m)
                used += w
    stages, acc = [], today
    for m in [m for m in plan if m in keep]:
        w, h = weeks_of(m)
        b = min(end, acc + timedelta(days=7 * w - 1))
        ns = mods[m]["tasks"]
        weak = [t for n in ns for t, v in sorted(_types_of(types, n).items(), key=lambda kv: [int(x) for x in kv[0].split(".")]) if v < 0.99]
        weak_txt = ", ".join((t + " " + names.get(t, "")).strip() for t in weak[:6])
        steps = ([f"Сначала нерешённые типы: {weak_txt}" + (f" и ещё {len(weak) - 6}" if len(weak) > 6 else "")] if weak else []) + \
                ["Каждый тип: разбор на доске, потом задачи из банка", "В конце этапа - задания этапа из варианта"]
        if mods[m].get("must"):
            steps.insert(0, "Обязательно: без 2 баллов за геометрию ставится «2» при любой сумме")
        stages.append({"title": mods[m]["title"], "from": acc.isoformat(), "to": b.isoformat(), "tasks": [f"T{n}" for n in ns][:12],
                       "module": m, "goal": "Все типы заданий этапа без ошибок", "check": "задания этапа из варианта ФИПИ",
                       "steps": steps[:10], "hours": round(h), "weeks": w,
                       "links": [{"label": f"Разборы № {n}", "go": f"video/t{n}"} for n in ns[:12]]})
        acc = b + timedelta(days=1)
    if acc <= end:
        allt = sorted({t for s in stages for t in s["tasks"]}, key=lambda t: int(t[1:]))
        stages.append({"title": "Повторение и пробники", "from": acc.isoformat(), "to": end.isoformat(), "tasks": allt[:12] or ["T1"],
                       "module": "REV", "goal": "Пробник раз в неделю, разбор каждой ошибки в тот же день", "check": "пробник раз в неделю",
                       "steps": ["Пробник в конце недели", "Разбор ошибок пробника", "Повтор типов, где потеряны баллы"], "links": []})
    # expected result: the mark of the plan, lower if modules are cut (their tasks give no points then)
    mx = {t["n"]: t["max"] for t in EXAMS[key]["tasks"]}
    reach = sum(mx[n] for m in keep for n in mods[m]["tasks"]) + sum(mx[n] for m in skipped for n in mods[m]["tasks"])
    exp_grade = min(grade, max([g for g, p in grades.items() if p <= reach] or [2]))  # never above the goal: points are not certain
    hours_need = round(sum(mods[m]["hours"] for m in plan) / max(1, min(avail, sum(mods[m]["weeks"] for m in plan))), 1)
    why = [f"Цель - «{grade}»: от {grades[grade]} баллов" + (", из них не меньше 2 за геометрию" if key == "oge" else "")]
    if skipped:
        why.append("Уже решается, отдельным этапом не ставим: " + ", ".join(mods[m]["title"] for m in skipped))
    if hours_week + 0.05 < hours_need:
        why.append(f"По плану нужно около {hours_need:g} ч в неделю, сейчас в расписании {hours_week:g} ч: сроки этапов растянуты")
    if cut:
        why.append("До экзамена не успеваем: " + ", ".join(mods[m]["title"] for m in cut) + ". Можно добавить часы в расписании")
    extra = [m for m in plan if m not in EXAM_PLANS[key][grade]]
    if extra:
        why.append("Время остаётся, поэтому добавлено: " + ", ".join(mods[m]["title"] for m in extra) + ". Это запас на более высокую отметку")
    why.append(f"В конце {review} {'неделя' if review == 1 else 'недели' if review < 5 else 'недель'} на повторение и пробники")
    summary = (f"План на «{grade}»: " + ", ".join(mods[m]["title"] for m in plan if m in keep) + ", потом повторение и пробники. "
               f"Ожидаемый результат с учётом твоего темпа: «{exp_grade}».")
    lo = grades.get(exp_grade, 0)
    hi = min(EXAMS[key]["max"], grades.get(exp_grade + 1, EXAMS[key]["max"] + 1) - 1) if exp_grade < 5 else EXAMS[key]["max"]
    return {"source": "method", "summary": summary, "why": why[:6], "stages": stages[:8],
            "method": {"plan": grade, "plan_name": f"на «{grade}»", "grade": grade, "part1_share": 0, "expect_base": [grades[grade], grades[grade]],
                       "expect": [lo, hi], "expect_grade": exp_grade, "hours_week": round(hours_week, 1), "hours_need": hours_need,
                       "cut": [mods[m]["title"] for m in cut], "high": False, "review_weeks": review, "exam": key}}


def check_order_exam(key: str, stages: list[dict]) -> list[str]:
    return []  # the draft of OGE / base has no requirements between modules yet
