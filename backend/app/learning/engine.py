"""Pure learning logic: answers → mastery → forecast, root cause, schedule.

Everything a student sees is computed here from their own data (diagnostics, mocks, photo checks).
No DB and no LLM imports, so it is easy to test.
"""
from __future__ import annotations

import math
from copy import deepcopy
from datetime import date, timedelta

from app.learning.content import (
    BASE_ITEMS, DAILY, EXAMS, G10, G58, NODE_BY_ID, NODES, OGE_P1, OGE_P2, PROF_P1, PROF_P2, STAGES, UNKNOWN_M,
)

# ---------- profile → exam ----------

def exam_key(grade: str | None, exam: str | None) -> str:
    if grade == "11":
        return "base" if exam == "base" else "prof"
    if grade == "10":
        return "g10"
    if grade == "9":
        return "oge"
    if grade in {"5", "6", "7", "8"}:
        return "g58"
    return "prof"


def diag_required(grade: str | None) -> bool:
    """Since Nov 2026 the entrance diagnostic is optional for everyone: it is offered, not forced."""
    return False


def school_passed(frm: str | None, today: date) -> bool:
    """Has the topic that starts on `frm` (MM-DD, school year from Sep 1) already started?"""
    if not frm:
        return True
    m, d = (int(x) for x in frm.split("-"))
    start_year = today.year if today.month >= 9 else today.year - 1
    return date(start_year if m >= 9 else start_year + 1, m, d) <= today


def exam_tasks(key: str) -> list[dict]:
    return deepcopy(EXAMS[key]["tasks"])


# ---------- diagnostics ----------

def diag_items(key: str, grade: str | None, variant: int, today: date) -> list[dict]:
    out: list[dict] = []
    if key == "prof":
        for n in range(1, 13):
            vs = PROF_P1[n]
            vi = variant % len(vs)
            it = vs[vi]
            out.append({**it, "id": f"p{n}_{vi}", "task": f"T{n}", "n": n, "t": "num",
                        "src": "по образцу банка ФИПИ" if it.get("own") else "демоверсия ЕГЭ 2027"})
        for t in EXAMS["prof"]["tasks"]:
            if t["part"] == 2:
                out.append({"id": f"s{t['n']}", "t": "self", "task": t["id"], "n": t["n"], "q": PROF_P2[t["n"]],
                            "nodes": t["need"], "max": t["max"], "src": "демоверсия ЕГЭ 2027"})
    elif key == "oge":
        for n, it in OGE_P1:
            out.append({**it, "id": f"o{n}", "task": f"T{n}", "n": n, "t": "num", "src": "в формате ОГЭ"})
        for t in EXAMS["oge"]["tasks"]:
            if t["part"] == 2:
                out.append({"id": f"os{t['n']}", "t": "self", "task": t["id"], "n": t["n"], "q": OGE_P2[t["n"]],
                            "nodes": t["need"], "max": t["max"], "src": "в формате ОГЭ"})
    elif key == "g10":
        topics = {t["id"]: t for t in EXAMS["g10"]["tasks"]}
        for i, (tid, it) in enumerate(G10):
            if school_passed(topics[tid]["from"], today):
                out.append({**it, "id": f"y{i}", "task": tid, "n": None, "t": "num", "src": "по теме: " + topics[tid]["name"]})
    elif key == "g58":
        g = int(grade) if grade and grade.isdigit() else 5
        for i, (tid, it, min_g) in enumerate(G58):
            if g >= min_g:
                out.append({**it, "id": f"g{i}", "task": tid, "n": None, "t": "num", "src": "базовая проверка"})
    else:
        for i, (tid, it) in enumerate(BASE_ITEMS):
            out.append({**it, "id": f"b{i}", "task": tid, "n": None, "t": "num", "src": "по заданиям демоверсии ЕГЭ 2027"})
    return out


def public_item(it: dict) -> dict:
    """Item as the client sees it: no answer key."""
    return {k: v for k, v in it.items() if k not in {"a", "own"}}


def norm_ans(v: str | None) -> str:
    s = str(v or "").strip().lower().replace(" ", "")
    for ch in "−–—":
        s = s.replace(ch, "-")
    return s.replace(",", ".")


def same_ans(v: str | None, a: str) -> bool:
    x, y = norm_ans(v), norm_ans(a)
    if not x:
        return False
    if x == y:
        return True
    try:
        return abs(float(x) - float(y)) < 1e-9
    except ValueError:
        return False


def score_item(it: dict, ans: str | None) -> float:
    if it["t"] == "self":
        return {"full": 1.0, "part": 0.5}.get(ans or "", 0.0)
    return 1.0 if same_ans(ans, it["a"]) else 0.0


def apply_diag(state: dict, items: list[dict], answers: dict, blend: bool) -> dict:
    """Update mastery / unknown / obs in `state` from one finished diagnostic or mock."""
    ev: dict[str, list[tuple[float, float]]] = {}
    obs: dict[str, list[float]] = {}
    for it in items:
        s = score_item(it, answers.get(it["id"]))
        w = 0.7 if it["t"] == "self" else 1.0
        for nd in it["nodes"]:
            ev.setdefault(nd, []).append((s, w))
        obs.setdefault(it["task"], []).append(s)

    mastery = state.setdefault("mastery", {})
    prev_unknown = set(state.get("unknown") or [])
    unknown: list[str] = []
    for n in NODES:
        e = ev.get(n["id"])
        if not e:
            if not blend:
                mastery[n["id"]] = UNKNOWN_M
                unknown.append(n["id"])
            elif n["id"] in prev_unknown or n["id"] not in mastery:
                mastery.setdefault(n["id"], UNKNOWN_M)
                unknown.append(n["id"])
            continue
        m = sum(s * w for s, w in e) / sum(w for _, w in e)
        val = round(0.12 + 0.8 * m, 2)
        if blend and n["id"] not in prev_unknown and n["id"] in mastery:
            mastery[n["id"]] = round(mastery[n["id"]] * 0.5 + val * 0.5, 2)
        else:
            mastery[n["id"]] = val
    state["unknown"] = unknown

    so = state.setdefault("obs", {})
    for t, arr in obs.items():
        o = sum(arr) / len(arr)
        so[t] = (so[t] + o) / 2 if blend and t in so else o

    pts = 0.0
    for it in items:
        s = score_item(it, answers.get(it["id"]))
        pts += (it["max"] if s == 1 else 1 if s > 0 else 0) if it["t"] == "self" else s
    nums = [i for i in items if i["t"] == "num"]
    right = sum(1 for i in nums if score_item(i, answers.get(i["id"])) == 1)
    return {"pts": pts, "right": right, "of": len(nums)}


def observe_task(state: dict, task_id: str, fraction: float) -> None:
    """A photo check of one task (score / max) feeds the same model."""
    so = state.setdefault("obs", {})
    so[task_id] = fraction if task_id not in so else (so[task_id] + fraction) / 2


def ensure_mastery(state: dict) -> None:
    m = state.setdefault("mastery", {})
    for n in NODES:
        m.setdefault(n["id"], UNKNOWN_M)
    if "unknown" not in state:
        state["unknown"] = [n["id"] for n in NODES]


# ---------- model ----------

def _eff(nid: str, mast: dict, memo: dict) -> float:
    if nid in memo:
        return memo[nid]
    v = mast.get(nid, UNKNOWN_M)
    for p in NODE_BY_ID[nid]["pre"]:
        v = min(v, _eff(p, mast, memo) + 0.25)
    memo[nid] = max(0.0, min(1.0, v))
    return memo[nid]


def build_model(state: dict, key: str, mastery: dict | None = None) -> dict:
    mast = mastery if mastery is not None else state.get("mastery", {})
    memo: dict = {}
    E = {n["id"]: _eff(n["id"], mast, memo) for n in NODES}
    unk = set(state.get("unknown") or [])
    weak = {n["id"] for n in NODES if E[n["id"]] < 0.5 and n["id"] not in unk}
    threat: set[str] = set()

    def down(nid):
        for c in NODES:
            if nid in c["pre"] and c["id"] not in threat:
                threat.add(c["id"])
                down(c["id"])

    for w in list(weak):
        down(w)
    obs = state.get("obs") or {}
    tasks = []
    for t in exam_tasks(key):
        pm = min(E[k] for k in t["need"])
        o = obs.get(t["id"])
        p = 0.6 * o + 0.4 * pm if o is not None else pm
        risk = any(k in weak or k in threat for k in t["need"])
        tasks.append({**t, "p": round(p, 4), "exp": round(t["max"] * p, 4), "risk": risk, "obs": o})
    primary = sum(t["exp"] for t in tasks)
    roots = [w for w in weak if all(p not in weak for p in NODE_BY_ID[w]["pre"])]
    root = sorted(roots, key=lambda r: E[r])[0] if roots else None
    root_set: set[str] = set()
    if root:
        root_set.add(root)
        stack = [root]
        while stack:
            cur = stack.pop()
            for c in NODES:
                if cur in c["pre"] and c["id"] not in root_set:
                    root_set.add(c["id"])
                    stack.append(c["id"])
    root_tasks = [t for t in tasks if any(k in root_set for k in t["need"]) and t["p"] < 0.95]
    at_risk = sum(t["max"] - t["exp"] for t in root_tasks)
    return {"E": E, "weak": sorted(weak), "threat": sorted(threat), "unknown": sorted(unk), "tasks": tasks,
            "primary": primary, "root": root, "root_tasks": [t["id"] for t in root_tasks], "at_risk": round(at_risk, 2)}


def forecast_value(model: dict, key: str) -> int:
    ex = EXAMS[key]
    return round(model["primary"] / ex["max"] * 100) if ex["pct"] else round(model["primary"])


def what_if(state: dict, key: str) -> float:
    """Expected gain if the weak topics and everything above them were closed."""
    m = build_model(state, key)
    mast = dict(state.get("mastery", {}))
    for nid in set(m["weak"]) | set(m["threat"]):
        mast[nid] = max(mast.get(nid, UNKNOWN_M), 0.85 if nid in m["weak"] else 0.78)
    return round(build_model(state, key, mast)["primary"] - m["primary"], 2)


def strong_weak(model: dict) -> tuple[list[str], list[str]]:
    unk = set(model["unknown"])
    E = model["E"]
    strong = sorted([n for n in E if n not in unk and E[n] >= 0.75], key=lambda n: -E[n])[:3]
    weak = sorted([n for n in E if n not in unk and E[n] < 0.5], key=lambda n: E[n])[:3]
    return strong, weak


# ---------- schedule ----------

DAYSETS = {3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5]}  # Monday = 0, Sunday always free


class _Swrr:
    """Smooth weighted round robin: every task gets a share, weak ones more often."""

    def __init__(self, items: list[dict], weights: list[float]):
        self.items, self.w = items, weights
        self.cur = [0.0] * len(items)
        self.tot = sum(weights)

    def __call__(self) -> dict:
        bi = 0
        for i, w in enumerate(self.w):
            self.cur[i] += w
            if self.cur[i] > self.cur[bi]:
                bi = i
        self.cur[bi] -= self.tot
        return self.items[bi]


def task_label(t: dict) -> str:
    return f"№ {t['n']}" if t.get("n") else t["name"]


def build_plan(state: dict, key: str, today: date) -> dict:
    ex = EXAMS[key]
    ps = state.get("plan") or {}
    model = build_model(state, key)
    end = date.fromisoformat(ps.get("date") or ex["date"])
    total_days = max(7, (end - today).days)
    mins = int(ps.get("min") or 45)
    study = DAYSETS.get(int(ps.get("days") or 5), DAYSETS[5])
    tasks = model["tasks"]
    passed = [t for t in tasks if school_passed(t.get("from"), today)]
    future = [t for t in tasks if not school_passed(t.get("from"), today)]
    p1 = [t for t in passed if t["part"] == 1]
    p2 = [t for t in passed if t["part"] == 2]

    def w(t):
        return 0.25 + (1 - min(1.0, t["p"])) * t["att"] * min(t["max"], 3)

    pick1 = _Swrr(p1, [w(t) for t in p1]) if p1 else None
    pick2 = _Swrr(p2, [w(t) for t in p2]) if p2 else None

    needed: set[str] = set()

    def up(nid):
        for p in NODE_BY_ID[nid]["pre"]:
            needed.add(p)
            up(p)

    for t in tasks:
        for k in t["need"]:
            needed.add(k)
            up(k)
    E = model["E"]
    order = [n for n in NODES if n["id"] in needed and E[n["id"]] < 0.8]
    order.sort(key=lambda n: (0 if n["id"] == model["root"] else 1, n["col"], E[n["id"]]))
    queue: list[str] = []
    for n in order:
        k = max(1, min(4, math.ceil((0.8 - E[n["id"]]) / 0.12)))
        queue += [n["id"]] * k
    q_len = len(queue)

    wm, mm = round(mins * 0.2), round(mins * 0.55)
    tm = mins - wm - mm
    brief = lambda t: {"id": t["id"], "n": t["n"], "name": t["name"]}  # noqa: E731
    days, mock, studied = [], 0, 0
    for i in range(total_days):
        d = today + timedelta(days=i)
        wd, week, left = d.weekday(), i // 7, total_days - i
        if wd not in study:
            days.append({"date": d.isoformat(), "rest": True, "blocks": []})
            continue
        last_study = study[-1] == wd
        if last_study and ((week + 1) % 4 == 0 or left <= 14):
            mock += 1
            title = f"Контрольный замер № {mock}" if ex["pct"] else f"Пробник № {mock}"
            sub = "все темы, по которым есть задания" if ex["pct"] else "полный вариант, ответы и самооценка второй части"
            days.append({"date": d.isoformat(), "mock": mock,
                         "blocks": [{"k": "mock", "min": mins if ex["pct"] else max(mins, 90), "title": title, "sub": sub}]})
            continue
        studied += 1
        blocks: list[dict] = []
        if pick1:
            a = pick1()
            b = pick1()
            if b is a and len(p1) > 1:
                b = pick1()
            blocks.append({"k": "warm", "min": wm, "title": "Разминка",
                           "sub": f"{task_label(a)}{' и ' + task_label(b) if b is not a else ''}: по 2 задачи",
                           "tasks": [brief(a)] + ([brief(b)] if b is not a else [])})
        if queue and left > 14:
            nd = queue.pop(0)
            blocks.append({"k": "topic", "min": mm, "title": NODE_BY_ID[nd]["name"], "sub": "конспект по учебнику, разбор, 6-8 задач", "node": nd})
        elif pick2:
            t = pick2()
            blocks.append({"k": "deep", "min": mm, "title": f"{task_label(t)}: {t['name']}", "sub": "полное решение и проверка по фото", "tasks": [brief(t)]})
        elif p1:
            t = pick1()
            title = t["name"] if not t.get("n") else f"{task_label(t)}: {t['name']}"
            blocks.append({"k": "deep", "min": mm, "title": title, "sub": "задачи посложнее по теме", "tasks": [brief(t)]})
        if pick2 and len(blocks) > 1 and blocks[1]["k"] != "deep":
            t = pick2()
            blocks.append({"k": "p2", "min": tm, "title": f"{task_label(t)}: {t['name']}", "sub": "один шаг решения второй части", "tasks": [brief(t)]})
        elif future and key == "g10":
            cur = passed[-1] if passed else None
            blocks.append({"k": "school", "min": tm, "title": cur["name"] if cur else "Тема школы", "sub": "тема, которую сейчас проходят в школе"})
        elif p1:
            t = pick1()
            blocks.append({"k": "rep", "min": tm, "title": f"Повторение: {task_label(t)}", "sub": "2-3 задачи, чтобы не забылось", "tasks": [brief(t)]})
        days.append({"date": d.isoformat(), "blocks": blocks})

    freq: dict[str, int] = {}
    for dd in days:
        for b in dd["blocks"]:
            for t in b.get("tasks") or []:
                freq[t["id"]] = freq.get(t["id"], 0) + 1
    phases_def = [("Фундамент", 0.3), ("Все задания по чуть-чуть", 0.35),
                  ("Вторая часть" if any(t["part"] == 2 for t in tasks) else "Сложные темы", 0.25), ("Пробники", 0.1)]
    acc, phases = 0.0, []
    for name, f in phases_def:
        phases.append({"name": name, "share": f, "from": (today + timedelta(days=round(acc * total_days))).isoformat()})
        acc += f
    return {"days": days, "total_days": total_days, "studied": studied, "mocks": mock, "queue": q_len,
            "end": end.isoformat(), "freq": freq, "minutes": mins, "days_per_week": len(study), "phases": phases}


def plan_window(plan: dict, today: date) -> list[dict]:
    """Monday..Sunday of the current week; days before today are marked past."""
    monday = today - timedelta(days=today.weekday())
    by_date = {d["date"]: d for d in plan["days"]}
    out = []
    for i in range(7):
        dd = (monday + timedelta(days=i)).isoformat()
        out.append(by_date.get(dd) or {"date": dd, "past": True, "blocks": []})
    return out


# ---------- small helpers ----------

def daily_pick(model: dict, today: date) -> dict:
    E = model["E"]
    ranked = sorted(DAILY, key=lambda d: E.get(d["node"], 1))
    return ranked[min(today.day % 3, len(ranked) - 1)]


def stage(xp: int) -> tuple[str, str, int]:
    cur, nxt = STAGES[0], STAGES[-1]
    for s in STAGES:
        if xp >= s[0]:
            cur = s
    for s in STAGES:
        if s[0] > xp:
            nxt = s
            break
    return cur[1], nxt[1], max(0, nxt[0] - xp)


def streak(active_days: list[str], today: date) -> int:
    days = set(active_days or [])
    n, d = 0, today
    if d.isoformat() not in days:
        d -= timedelta(days=1)
    while d.isoformat() in days:
        n += 1
        d -= timedelta(days=1)
    return n
