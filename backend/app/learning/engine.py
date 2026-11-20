"""Pure learning logic: answers → mastery → forecast, root cause, schedule.

Everything a student sees is computed here from their own data (diagnostics, mocks, photo checks).
No DB and no LLM imports, so it is easy to test.
"""
from __future__ import annotations

import re

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
            out.append({**it, "id": f"p{n}_{vi}", "task": f"T{n}", "n": n, "t": "num", "oral": n == 8,
                        "src": "по образцу банка ФИПИ" if it.get("own") else "демоверсия ЕГЭ 2027"})
        for t in EXAMS["prof"]["tasks"]:
            if t["part"] == 2:
                out.append({"id": f"s{t['n']}", "t": "work", "task": t["id"], "n": t["n"], "q": PROF_P2[t["n"]],
                            "nodes": t["need"], "max": t["max"], "src": "демоверсия ЕГЭ 2027"})
    elif key == "oge":
        for n, it in OGE_P1:
            out.append({**it, "id": f"o{n}", "task": f"T{n}", "n": n, "t": "num", "src": "в формате ОГЭ"})
        for t in EXAMS["oge"]["tasks"]:
            if t["part"] == 2:
                out.append({"id": f"os{t['n']}", "t": "work", "task": t["id"], "n": t["n"], "q": OGE_P2[t["n"]],
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


TYPED_KEYS = {"prof", "oge", "base"}  # exams whose entrance diagnostic goes by task types (learning/diag_types.py)


def items_of(key: str, grade: str | None, variant: int, today: date, answers: dict | None = None) -> list[dict]:
    """Items of a stored diagnostic: by task types if it was started so (answers["_fmt"] == "types"), else the
    usual one item per task (mocks and diagnostics started before Nov 2026)."""
    if (answers or {}).get("_fmt") == "types" and key == "prof":
        from app.learning.diag_types import prof_items
        return [dict(it) for it in prof_items()]
    if (answers or {}).get("_fmt") == "types" and key in ("oge", "base"):
        from app.learning.diag_types import bank_items
        return [dict(it) for it in bank_items(key)]
    if (answers or {}).get("_fmt") == "bank" and key in ("oge", "base"):  # mocks of OGE / base: one problem per task from the bank
        from app.learning.diag_types import bank_mock
        return bank_mock(key, variant)
    return diag_items(key, grade, variant, today)


_HIDDEN = {"a", "own", "ans_img", "ref", "answer_text"}


def public_item(it: dict) -> dict:
    """Item as the client sees it: no answer key (also inside the part-2 choices)."""
    out = {k: v for k, v in it.items() if k not in _HIDDEN}
    if it.get("choices"):
        out["choices"] = [{k: v for k, v in c.items() if k not in _HIDDEN} for c in it["choices"]]
    return out


def norm_ans(v: str | None) -> str:
    s = str(v or "").strip().lower().replace(" ", "")
    for ch in "−–—":
        s = s.replace(ch, "-")
    return s.replace(",", ".")


def _alternatives(a: str) -> list[str] | None:
    """Answers of the open banks with several right answers: «13 или 256», a list «816 ; 824 ; 864» (any of them)."""
    s = str(a or "")
    if "или" in s or ";" in s:
        return re.findall(r"-?\d+(?:[.,]\d+)?", s) or None
    return None


def same_ans(v: str | None, a: str) -> bool:
    alts = _alternatives(a)
    if alts:
        return any(same_ans(v, x) for x in alts)
    sa = str(a or "").strip()
    if sa.startswith("<") and sa.endswith(">"):  # OGE 19: the numbers of the statements in any order
        need, got = re.sub(r"\D", "", sa), re.sub(r"\D", "", str(v or ""))
        return bool(got) and sorted(got) == sorted(need)
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
    if it["t"] in ("self", "work"):  # old self-assessment answers of unfinished diagnostics
        return {"full": 1.0, "part": 0.5}.get(ans or "", 0.0)
    return 1.0 if same_ans(ans, it["a"]) else 0.0


def eval_item(it: dict, answers: dict) -> dict | None:
    """One diagnostic item -> knowledge of its topics (k), chance to solve the task now (o) and exam points.
    The photo of the solution separates a computing slip from not knowing the method. None = no evidence."""
    ans = answers.get(it["id"])
    w = (answers.get("_work") or {}).get(it["id"]) or {}
    mode = w.get("mode")
    if mode == "dont_know" or ans == "?":
        # in the second part «не знаю» says nothing about the basic topics, only about the task itself
        return {"k": 0.0 if it["t"] == "num" else None, "o": 0.0, "pts": 0.0}
    res = w.get("result") if w.get("status") == "done" else None
    if it["t"] == "num":
        ok = same_ans(ans, it["a"])
        if res and mode == "photo":
            method = bool(res.get("method_ok"))
            k, o = (1.0, 1.0) if ok and method else (0.4, 0.6) if ok else (0.7, 0.35) if method else (0.0, 0.0)
        else:  # oral answer (task 8) or the photo could not be analysed: the answer alone
            k = o = 1.0 if ok else 0.0
        return {"k": k, "o": o, "pts": 1.0 if ok else 0.0}
    mx = it.get("max") or 1
    if res and res.get("score") is not None:
        sc = max(0.0, min(float(res["score"]), mx))
        return {"k": sc / mx, "o": sc / mx, "pts": sc}
    if ans in ("full", "part", "none"):  # legacy self-assessment
        s = score_item(it, ans)
        return {"k": s, "o": s, "pts": (mx if s == 1 else 1 if s > 0 else 0)}
    return None  # a photo that was not checked: no evidence either way


def apply_diag(state: dict, items: list[dict], answers: dict, blend: bool) -> dict:
    """Update mastery / unknown / obs in `state` from one finished diagnostic or mock.
    A diagnostic by types: a first-part task gives the share of its solved types (its points are the mean),
    and every type gets its own score in state["types"] for the trajectory."""
    ev: dict[str, list[tuple[float, float]]] = {}
    obs: dict[str, list[float]] = {}
    pts = 0.0
    typed = any(it.get("type") or it.get("choices") for it in items)
    task_pts: dict[str, list[float]] = {}
    evals: dict[str, dict | None] = {}
    for it in items:
        e = eval_item(it, answers)
        evals[it["id"]] = e
        if e is None:
            continue
        if typed:
            task_pts.setdefault(it["task"], []).append(e["pts"])
        else:
            pts += e["pts"]
        if e["k"] is not None:
            for nd in it["nodes"]:
                ev.setdefault(nd, []).append((e["k"], 1.0 if it["t"] == "num" else 0.7))
        obs.setdefault(it["task"], []).append(e["o"])

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
        val = round(0.9 * m, 2)  # nothing solved -> 0, not a hidden floor
        if blend and n["id"] not in prev_unknown and n["id"] in mastery:
            mastery[n["id"]] = round(mastery[n["id"]] * 0.5 + val * 0.5, 2)
        else:
            mastery[n["id"]] = val
    state["unknown"] = unknown

    so = state.setdefault("obs", {})
    for t, arr in obs.items():
        o = sum(arr) / len(arr)
        so[t] = (so[t] + o) / 2 if blend and t in so else o

    if typed:
        pts = sum(sum(v) / len(v) for v in task_pts.values())
        from app.learning.diag_types import type_scores
        state["types"] = type_scores(items, answers, evals)
    nums = [i for i in items if i["t"] == "num"]
    right = sum(1 for i in nums if same_ans(answers.get(i["id"]), i["a"]))
    return {"pts": round(pts, 1), "right": right, "of": len(nums), "typed": typed}


def observe_task(state: dict, task_id: str, fraction: float) -> None:
    """A photo check of one task (score / max) feeds the same model."""
    so = state.setdefault("obs", {})
    so[task_id] = fraction if task_id not in so else (so[task_id] + fraction) / 2


def observe_practice(state: dict, task_id: str, ok: bool) -> None:
    """A first attempt at a problem in the bank, a task map or a teacher's variant: count right / total per task."""
    c = state.setdefault("prac", {}).setdefault(task_id, [0, 0])
    c[0] += 1 if ok else 0
    c[1] += 1


def practice_share(state: dict, task_id: str) -> tuple[float, int] | None:
    c = (state.get("prac") or {}).get(task_id)
    return (c[0] / c[1], c[1]) if c and c[1] else None


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
        pr = practice_share(state, t["id"])
        if o is None and t["part"] == 2:
            pm *= 0.3  # knowing the topics is far from solving a second-part task with full reasoning
        if o is not None and t["part"] == 2:  # a checked solution or an honest «не знаю»: the task itself decides
            p = (o + pr[0]) / 2 if pr else o
        elif o is not None:  # the task was measured (diagnostic, photo check): weight 0.75; practice answers are mixed in
            p = 0.75 * ((o + pr[0]) / 2 if pr else o) + 0.25 * pm
        elif pr:  # only short answers: the more of them, the more they weigh (1 answer 0.2, 4 answers 0.4, max 0.6)
            w = 0.6 * pr[1] / (pr[1] + 2)
            p = w * pr[0] + (1 - w) * pm
        else:
            p = pm
        risk = any(k in weak or k in threat for k in t["need"])
        tasks.append({**t, "p": round(p, 4), "exp": round(t["max"] * p, 4), "risk": risk, "obs": o,
                      "prac": (state.get("prac") or {}).get(t["id"])})
    primary = sum(t["exp"] for t in tasks)
    order = {n["id"]: i for i, n in enumerate(NODES)}
    tested = [n["id"] for n in NODES if n["id"] not in unk]
    basics = bool(tested) and len(weak) >= 0.75 * len(tested)
    if basics:  # almost everything failed: start from the first basic topic, not from a random weak one
        root = next((n["id"] for n in NODES if not n["pre"] and (n["id"] in weak or n["id"] in unk)), None)
    else:  # a weak topic whose foundations are fine; the most basic one first
        roots = [w for w in weak if all(p not in weak and p not in unk for p in NODE_BY_ID[w]["pre"])]
        key = lambda r: (NODE_BY_ID[r]["col"], E[r], order[r])  # noqa: E731
        root = sorted(roots, key=key)[0] if roots else (sorted(weak, key=key)[0] if weak else None)
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
            "primary": primary, "root": root, "basics": basics, "root_tasks": [t["id"] for t in root_tasks], "at_risk": round(at_risk, 2)}


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


def path_stage(stages: list[dict] | None, d: date) -> int | None:
    """Index of the trajectory stage that covers the date."""
    ds = d.isoformat()
    return next((i for i, s in enumerate(stages or []) if s.get("from", "") <= ds <= s.get("to", "")), None)


# ---------- schedule by blocks: geometry, algebra, probability, functions; from easy to hard ----------

GOAL = 0.8  # a task counts as mastered from this estimate on
_GEO, _PROB, _FUNC = {"PLANE", "STEREO", "TTRI"}, {"PROB"}, {"FUNC", "DER", "DERAPP"}
BLOCK_NAMES = {"geo": "Геометрия", "alg": "Алгебра", "prob": "Вероятность", "func": "Функции и производная"}


def task_block(t: dict) -> str:
    need = set(t["need"])
    return "geo" if need & _GEO else "prob" if need & _PROB else "func" if need & _FUNC else "alg"


_EASIER = {"T11": 7.5}  # graphs of functions come before the derivative in the functions block


def _rank(t: dict) -> float:
    return _EASIER.get(t["id"], t["n"] if isinstance(t.get("n"), (int, float)) else 0)


def base_topic(nid: str, E: dict, unknown: set | None = None) -> str:
    """Go down to the most basic weak foundation: no point in logarithmic equations before powers.
    unknown: untested topics that also count as weak (when almost nothing was solved)."""
    while True:
        weak_pre = [p for p in NODE_BY_ID[nid]["pre"] if E[p] < 0.4 or p in (unknown or set())]
        if not weak_pre:
            return nid
        nid = min(weak_pre, key=lambda p: E[p])


def needed_tasks(tasks: list[dict], target: int | None) -> list[dict]:
    """Tasks the goal needs, easiest first: the whole first part, then the second part from the most attainable.
    Each task is counted at 85% of its maximum, so the goal is reached with a margin."""
    if not target:
        return tasks
    order = [t for t in tasks if t["part"] == 1] + sorted([t for t in tasks if t["part"] == 2], key=lambda t: (-t["att"], tasks.index(t)))
    out, acc = [], 0.0
    for t in order:
        if acc >= target:
            break
        out.append(t)
        acc += 0.85 * t["max"]
    return [t for t in tasks if t in out]


def part2_open(state: dict, tasks: list[dict], sim: dict[str, float]) -> bool:
    """The second part enters the schedule only when the student shows he can solve it (a checked solution scored
    above zero) or when the first part is mostly mastered (70% on average)."""
    obs = state.get("obs") or {}
    if any((obs.get(t["id"]) or 0) > 0 for t in tasks if t["part"] == 2):
        return True
    p1 = [sim[t["id"]] for t in tasks if t["part"] == 1]
    return bool(p1) and sum(p1) / len(p1) >= 0.7


def _protos_by_types(t: dict, types: dict[str, float]) -> list[dict]:
    """Prototypes of a task, the weakest type first (diagnostic by types: unsolved, then the ones not chosen in part 2).
    Without data by types the order of the task map stays."""
    ps = _protos(t)
    if not types or not ps:
        return ps
    score = {p["id"]: types.get(f"{t['n']}.{k}", 0.5) for k, p in enumerate(ps, 1)}
    return sorted(ps, key=lambda p: score[p["id"]] >= 0.99)  # solved types go to the end, the rest keep the map order


def _protos(t: dict) -> list[dict]:
    if not isinstance(t.get("n"), int):
        return []
    from app.learning.taskmaps import TASK_MAPS
    return (TASK_MAPS.get(t["n"]) or {}).get("protos") or []


def day_events(state: dict, d: date) -> list[dict]:
    """The student's own events on a day: other subjects and personal plans (weekly or once)."""
    out = []
    ds = d.isoformat()
    for e in state.get("events") or []:
        if e.get("repeat") == "once":
            hit = e.get("date") == ds
        else:
            hit = d.weekday() in (e.get("weekdays") or []) and (not e.get("until") or ds <= e["until"])
        if hit:
            out.append({k: e.get(k) for k in ("id", "title", "kind", "start", "min", "busy")})
    return sorted(out, key=lambda e: e.get("start") or "99:99")


HEAVY_MIN = 300  # more than 5 hours of study in a day: the schedule warns


def study_days(ps: dict) -> list[int]:
    """Weekdays for mathematics: chosen by the student (any of Mon..Sun) or by the count of days a week."""
    wd = ps.get("wd")
    if isinstance(wd, list) and wd and all(isinstance(x, int) and 0 <= x <= 6 for x in wd):
        return sorted(set(wd))
    return DAYSETS.get(int(ps.get("days") or 5), DAYSETS[5])


def build_plan(state: dict, key: str, today: date, stages: list[dict] | None = None) -> dict:
    """Daily schedule. Each study day belongs to one block (geometry, algebra, probability, functions); inside the block
    the first task that is not mastered yet is studied, prototype after prototype, then the next, harder task.
    The second part waits until the student can solve it. The goal (test points) decides which tasks are needed.
    stages: the active educational trajectory; during a stage only its tasks are studied."""
    ex = EXAMS[key]
    ps = state.get("plan") or {}
    model = build_model(state, key)
    end = date.fromisoformat(ps.get("date") or ex["date"])
    total_days = max(7, (end - today).days)
    mins = int(ps.get("min") or 45)
    study = study_days(ps)
    target = (state.get("target") or {}).get("primary") if key == "prof" else None
    all_tasks = [t for t in model["tasks"] if school_passed(t.get("from"), today)] or model["tasks"]
    need = sorted(needed_tasks(all_tasks, target), key=lambda t: (t["part"], _rank(t)))
    E = model["E"]
    sim = {t["id"]: min(1.0, t["p"]) for t in model["tasks"]}
    sessions: dict[str, int] = {}
    stages = sorted([s for s in (stages or []) if s.get("tasks")], key=lambda s: s.get("from", ""))
    block_order = list(dict.fromkeys(task_block(t) for t in need))
    rr: dict[str, float] = {b: 0.0 for b in block_order}
    wm, mm = round(mins * 0.2), round(mins * 0.5)
    tm = mins - wm - mm
    brief = lambda t: {"id": t["id"], "n": t["n"], "name": t["name"]}  # noqa: E731
    label = lambda t: f"{task_label(t)}: {t['name']}" if t.get("n") else t["name"]  # noqa: E731
    queue = sum(1 for t in need if sim[t["id"]] < GOAL)
    days, mock, studied = [], 0, 0
    p2_first = None
    for i in range(total_days):
        d = today + timedelta(days=i)
        wd, week, left = d.weekday(), i // 7, total_days - i
        ev = day_events(state, d)
        if wd not in study:
            days.append({"date": d.isoformat(), "rest": True, "blocks": [], "events": ev})
            continue
        if any(e.get("busy") for e in ev):  # the student marked the day as taken: mathematics moves on to the next day
            days.append({"date": d.isoformat(), "busy": True, "blocks": [], "events": ev})
            continue
        ps_i = path_stage(stages, d)
        if ps_i is not None and stages[ps_i].get("module") == "PAUSE":  # a pause in the trajectory (holidays): no mathematics
            days.append({"date": d.isoformat(), "rest": True, "pause": True, "blocks": [], "events": ev})
            continue
        heavy = sum(int(e.get("min") or 0) for e in ev) + mins > HEAVY_MIN
        open2 = part2_open(state, need, sim)
        if open2 and p2_first is None and any(t["part"] == 2 for t in need):
            p2_first = d.isoformat()
        last_study = study[-1] == wd
        if last_study and ((week + 1) % 4 == 0 or left <= 14):
            mock += 1
            title = f"Контрольный замер № {mock}" if ex["pct"] else f"Пробник № {mock}"
            sub = ("все темы, по которым есть задания" if ex["pct"] else
                   "полный вариант, вторая часть - с проверкой по фото" if open2 else "первая часть варианта целиком")
            days.append({"date": d.isoformat(), "mock": mock, "events": ev, "heavy": heavy,
                         "blocks": [{"k": "mock", "min": mins if ex["pct"] else max(mins, 90), "title": title, "sub": sub}]})
            continue
        studied += 1
        avail = [t for t in need if t["part"] == 1 or open2]
        si = path_stage(stages, d)
        if si is not None:  # the trajectory stage narrows the choice; its tasks are studied even if the second part is not open yet
            focus = [t for t in all_tasks if t["id"] in set(stages[si]["tasks"])]
            avail = focus or avail
        pending = [t for t in avail if sim[t["id"]] < GOAL] or sorted(avail, key=lambda t: sim[t["id"]])[:4]
        blocks_today = [b for b in block_order if any(task_block(t) == b for t in pending)]
        if not blocks_today:
            days.append({"date": d.isoformat(), "blocks": [], "events": ev})
            continue
        weight = {b: sum(GOAL + 0.2 - sim[t["id"]] for t in pending if task_block(t) == b) for b in blocks_today}
        tot = sum(weight.values())
        for b in blocks_today:
            rr[b] += weight[b]
        blk = max(blocks_today, key=lambda b: rr[b])
        rr[blk] -= tot
        in_blk = [t for t in avail if task_block(t) == blk]
        cur = next(t for t in pending if task_block(t) == blk)
        k = sessions.get(cur["id"], 0)
        protos = _protos_by_types(cur, state.get("types") or {})
        pr = protos[min(k, len(protos) - 1)] if protos else None
        weak_node = base_topic(min(cur["need"], key=lambda n: E[n]), E, set(model["unknown"]) if model["basics"] else None)
        main_sub = (f"прототип «{pr['name']}»: разбор и 6-8 задач" if pr else "разбор и 6-8 задач, от простых к сложным")
        if k == 0 and (E[weak_node] < 0.4 or (model["basics"] and weak_node in model["unknown"])):
            main_sub = f"сначала тема «{NODE_BY_ID[weak_node]['name']}» по учебнику, потом {main_sub}"
        idx = in_blk.index(cur)
        before = [t for t in in_blk[:idx] if t["part"] == 1 or open2]
        warm_t = before[-1] if before else cur
        after = [t for t in in_blk[idx + 1:] if sim[t["id"]] < GOAL]
        blocks: list[dict] = [
            {"k": "warm", "min": wm, "title": "Разминка", "block": BLOCK_NAMES[blk],
             "sub": f"{task_label(warm_t)}: 2-3 {'знакомые' if warm_t is not cur else 'простые'} задачи", "tasks": [brief(warm_t)]},
            {"k": "deep", "min": mm, "title": label(cur), "sub": main_sub, "tasks": [brief(cur)], "block": BLOCK_NAMES[blk],
             **({"proto": pr["id"]} if pr else {}), **({"node": weak_node} if "сначала тема" in main_sub else {})},
        ]
        if after and k >= 1:
            nxt = after[0]
            blocks.append({"k": "step", "min": tm, "title": f"Шаг сложнее: {label(nxt)}", "block": BLOCK_NAMES[blk],
                           "sub": "первые 2-3 задачи следующего задания" if nxt["part"] == 1 else "один пункт решения, проверка по фото",
                           "tasks": [brief(nxt)]})
            sim[nxt["id"]] = min(1.0, sim[nxt["id"]] + 0.04)
        else:
            nxt_pr = protos[min(k + 1, len(protos) - 1)] if protos else None
            blocks.append({"k": "step", "min": tm, "title": f"Закрепление: {label(cur)}", "block": BLOCK_NAMES[blk],
                           "sub": f"задачи посложнее, прототип «{nxt_pr['name']}»" if nxt_pr and nxt_pr is not pr else "задачи посложнее без подсказок",
                           "tasks": [brief(cur)]})
        sessions[cur["id"]] = k + 1
        sim[cur["id"]] = min(1.0, sim[cur["id"]] + 0.12)
        if warm_t is not cur:
            sim[warm_t["id"]] = min(1.0, sim[warm_t["id"]] + 0.02)
        days.append({"date": d.isoformat(), "blocks": blocks, "events": ev, "heavy": heavy})

    freq: dict[str, int] = {}
    for dd in days:
        for b in dd["blocks"]:
            for t in b.get("tasks") or []:
                freq[t["id"]] = freq.get(t["id"], 0) + 1
    has2 = any(t["part"] == 2 for t in need)
    phases_def = [("Фундамент по блокам", 0.3), ("Вся первая часть", 0.35),
                  ("Вторая часть" if has2 else "Закрепление и скорость", 0.25), ("Пробники", 0.1)]
    acc, phases = 0.0, []
    for name, f in phases_def:
        phases.append({"name": name, "share": f, "from": (today + timedelta(days=round(acc * total_days))).isoformat()})
        acc += f
    return {"days": days, "total_days": total_days, "studied": studied, "mocks": mock, "queue": queue,
            "end": end.isoformat(), "freq": freq, "minutes": mins, "days_per_week": len(study), "phases": phases,
            "needed": [t["id"] for t in need], "part2": {"needed": has2, "open_from": p2_first}, "target": state.get("target")}


def plan_window(plan: dict, today: date, week: int = 0) -> list[dict]:
    """Monday..Sunday of the current week (or `week` weeks later); days before today are marked past."""
    monday = today - timedelta(days=today.weekday()) + timedelta(days=7 * week)
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
