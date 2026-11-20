"""Analytics of a finished diagnostic or mock: what went wrong where, of which kind, and what brings points fastest.
Pure functions over the diagnostic items and the answers (no DB, no network); the model only writes the short
conclusion from these facts (learning/llm.diag_summary)."""
from __future__ import annotations

from app.learning import engine
from app.learning.content import EXAMS, NODE_BY_ID

KIND = {  # kind -> what the student sees
    "ok": "верно",
    "ok_doubt": "ответ верный, решение спорное",
    "slip": "ошибка в счёте",
    "method": "не тот способ",
    "wrong": "неверно",
    "dont_know": "не знаю",
    "none": "нет ответа",
    "full": "полный балл",
    "part": "часть баллов",
    "zero": "0 баллов",
    "unchecked": "фото не проверено",
}
ADVICE = {
    "slip": "Способ знаешь, теряешь баллы на счёте: пиши промежуточные шаги и проверяй ответ подстановкой.",
    "method": "Способ решения пока не тот: начни с разбора прототипа на карте задания.",
    "wrong": "Ответ неверный, решения на фото нет: реши ещё раз по шагам и приложи фото, чтобы найти ошибку.",
    "dont_know": "Тема пока не знакома: разбор на доске, потом 3-5 задач того же прототипа.",
    "part": "Часть баллов уже есть: сравни решение с критериями и допиши недостающий шаг.",
    "zero": "Решение не принесло баллов: разбери критерии этого задания и типовой разбор.",
}


def item_kind(it: dict, answers: dict) -> tuple[str, str, float, float]:
    """(kind, comment, points, max) of one item."""
    ans = answers.get(it["id"])
    w = (answers.get("_work") or {}).get(it["id"]) or {}
    res = w.get("result") if w.get("status") == "done" else None
    note = str((res or {}).get("comment") or "").strip()
    mx = float(it.get("max") or 1) if it["t"] != "num" else 1.0
    if w.get("mode") == "dont_know" or ans == "?":
        return "dont_know", "", 0.0, mx
    if it["t"] == "num":
        if not ans:
            return "none", "", 0.0, mx
        ok = engine.same_ans(ans, it["a"])
        if res and w.get("mode") == "photo":
            method = bool(res.get("method_ok"))
            if ok:
                return ("ok" if method else "ok_doubt"), note, 1.0, mx
            if method or res.get("error") == "вычислительная":
                return "slip", note, 0.0, mx
            return "method", note, 0.0, mx
        return ("ok" if ok else "wrong"), ("решил устно" if w.get("mode") == "oral" else note), (1.0 if ok else 0.0), mx
    if res and res.get("score") is not None:
        sc = max(0.0, min(float(res["score"]), mx))
        return ("full" if sc >= mx else "part" if sc > 0 else "zero"), note, sc, mx
    if ans in ("full", "part", "none"):  # old self-assessment
        sc = mx if ans == "full" else 1.0 if ans == "part" else 0.0
        return ("full" if ans == "full" else "part" if ans == "part" else "zero"), "самооценка", sc, mx
    if w.get("mode") != "photo":
        return "none", "", 0.0, mx  # left blank (a mock in exam conditions)
    return "unchecked", str(w.get("error") or ""), 0.0, mx


def build(items: list[dict], answers: dict, model: dict, key: str, target: dict | None = None) -> dict:
    tasks = {t["id"]: t for t in EXAMS[key]["tasks"]}
    rows = []
    for it in items:
        kind, note, pts, mx = item_kind(it, answers)
        t = tasks.get(it["task"]) or {}
        w = (answers.get("_work") or {}).get(it["id"]) or {}
        errors = [str(e) for e in ((w.get("result") or {}).get("errors") or [])][:4]
        if it.get("choices"):  # part 2 of the diagnostic by types: the chosen type
            from app.learning.diag_types import chosen
            ch = chosen(it, answers)
            if ch:
                note = (f"тип {ch['type']} «{ch['name']}». " + note).strip()
        share = 1 / it["of_types"] if it.get("of_types") else 1.0  # a type of a first-part task is a share of its point
        rows.append({
            "id": it["id"], "n": it.get("n"), "task": it["task"], "name": it.get("type_name") or t.get("name") or it.get("src", ""),
            "type": it.get("type"), "share": share,
            "part": t.get("part", 1), "block": engine.task_block(t) if t.get("need") else "alg",
            "kind": kind, "label": KIND[kind], "note": note[:300], "errors": errors, "pts": pts, "max": mx,
            "answer": None if it["t"] != "num" or answers.get(it["id"]) in (None, "?") else str(answers.get(it["id"])),
            "right": str(it["a"]).replace(".", ",") if it["t"] == "num" else None, "photo": w.get("mode") == "photo",
            "topics": [NODE_BY_ID[nd]["name"] for nd in it.get("nodes", []) if nd in NODE_BY_ID][:3],
        })
    counts: dict[str, int] = {}
    for r in rows:
        counts[r["kind"]] = counts.get(r["kind"], 0) + 1
    blocks: dict[str, dict] = {}
    for r in rows:
        if key not in ("prof", "oge", "base"):
            b = blocks.setdefault(r["name"] or "Темы", {"pts": 0.0, "max": 0.0, "count": 0})
        else:
            b = blocks.setdefault(engine.BLOCK_NAMES[r["block"]], {"pts": 0.0, "max": 0.0, "count": 0})
        b["pts"] += r["pts"]
        b["max"] += r["max"]
        b["count"] += 1
    p1 = [r for r in rows if r["part"] == 1]
    p2 = [r for r in rows if r["part"] == 2]
    p1pts = lambda rs: sum(r["pts"] * r["share"] for r in rs)  # noqa: E731 - by types: the share of solved types per task
    p1max = lambda rs: sum(r["max"] * r["share"] for r in rs)  # noqa: E731
    out = {
        "rows": rows, "counts": counts,
        "blocks": [{"name": k, "pts": round(v["pts"], 1), "max": round(v["max"], 1), "pct": round(100 * v["pts"] / v["max"]) if v["max"] else 0}
                   for k, v in sorted(blocks.items(), key=lambda kv: kv[1]["pts"] / (kv[1]["max"] or 1))],
        "part1": {"pts": round(p1pts(p1), 1), "max": round(p1max(p1), 1)},
        "typed": any(r["type"] for r in rows),
        "part2": {"pts": sum(r["pts"] for r in p2), "max": sum(r["max"] for r in p2)} if p2 else None,
        "gains": gains(rows, target, key),
        "advice": [{"kind": k, "text": ADVICE[k], "tasks": [_lbl(r) for r in rows if r["kind"] == k]} for k in ADVICE if counts.get(k)],
    }
    out["facts"] = facts(out, model, key, target)
    return out


def _lbl(r: dict) -> str:
    if r.get("type"):
        return f"{r['type']} {r['name']}"
    return f"№ {r['n']}" if r.get("n") else r["name"]


def gains(rows: list[dict], target: dict | None, key: str) -> list[dict]:
    """Where points come fastest: slips first (the method is known), then first-part tasks without the method,
    then partial second-part solutions. Only tasks that are not solved yet."""
    order = {"slip": 0, "ok_doubt": 1, "wrong": 2, "method": 3, "part": 4, "dont_know": 5, "none": 5, "zero": 6, "unchecked": 7}
    why = {"slip": "способ знаешь, ошибка в счёте", "ok_doubt": "ответ верный, но решение стоит проверить",
           "wrong": "ответ неверный", "method": "нужен другой способ", "part": "часть баллов уже есть",
           "dont_know": "тема новая", "none": "не решено", "zero": "решение не набрало баллов", "unchecked": "фото не проверено"}
    out = []
    for r in sorted(rows, key=lambda r: (order.get(r["kind"], 9), r["part"], r["n"] or 0)):
        if r["kind"] in ("ok", "full") or r["kind"] not in order:
            continue
        add = (r["max"] - r["pts"]) * r.get("share", 1.0)
        if r["kind"] == "ok_doubt":
            add = 0.0
        out.append({"task": _lbl(r), "name": r["name"], "why": why[r["kind"]], "pts": round(add, 1), "kind": r["kind"], "part": r["part"]})
    if target and key == "prof" and target.get("primary", 0) <= 12:
        out = [g for g in out if g["part"] == 1]  # the goal is reachable with the first part alone
    return out[:8 if any(r.get("type") for r in rows) else 6]


def facts(a: dict, model: dict, key: str, target: dict | None) -> list[str]:
    """Plain facts for the screen and for the model's conclusion (it may use only these)."""
    c = a["counts"]
    f = [f"Первая часть: {a['part1']['pts']:g} из {a['part1']['max']:g}" + (" (доля решённых типов по каждому заданию)." if a.get("typed") else ".")]
    if a.get("typed"):
        p1 = [r for r in a["rows"] if r["part"] == 1]
        f.append(f"Решено типов первой части: {sum(1 for r in p1 if r['kind'] in ('ok', 'ok_doubt'))} из {len(p1)}.")
    if a["part2"]:
        f.append(f"Вторая часть: {a['part2']['pts']:g} из {a['part2']['max']:g} первичных баллов.")
    kinds = [(c.get("slip", 0), "с ошибкой в счёте при верном способе"), (c.get("method", 0), "с неверным способом"),
             (c.get("wrong", 0), "с неверным ответом без фото решения"), (c.get("dont_know", 0) + c.get("none", 0), "без решения («не знаю»)")]
    for k, txt in kinds:
        if k:
            f.append(f"Заданий {txt}: {k}.")
    if a["blocks"]:
        weak, strong = a["blocks"][0], a["blocks"][-1]
        if weak["name"] != strong["name"]:
            f.append(f"Слабее всего блок «{weak['name']}» ({weak['pct']}%), сильнее всего «{strong['name']}» ({strong['pct']}%).")
    if model.get("root"):
        f.append(f"Первопричина ошибок по графу тем: «{NODE_BY_ID[model['root']]['name']}».")
    if target and key == "prof":
        f.append(f"Цель: {target['test']} тестовых баллов = {target['primary']} первичных.")
    return f
