"""Open FIPI banks of OGE and EGE base (Nov 2026): every problem of the collections with answers, as pictures.
Built by tools/bank_import.py: banks/<key>/bank.json + banks/<key>/img/*.png.

Refs: "g7.14" / "g7.14.3" - OGE (prototype 7.14 and its analog 3), "e12.3" / "e12.3.5" - EGE base.
Types of a task = groups of prototypes in the collection («Сравнение квадратных корней», ...), numbered in book order:
task 7, type 3 = "7.3"; the map of the task lists them as prototypes with id "3".
OGE tasks 1-5 share a text (a plan, a table): the problem keeps `ctx` - the picture of the text is shown above it.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

DIR = Path(__file__).resolve().parent / "banks"
PREFIX = {"oge": "g", "base": "e"}
KEYS = {v: k for k, v in PREFIX.items()}
SOURCE = "Открытый банк ФИПИ"


def img_url(key: str, name: str) -> str:
    return f"/api/bank/{key}/img/{name}"


def _f(i: str) -> str:
    return i.replace(".", "_")


@lru_cache(maxsize=4)
def _data(key: str) -> dict:
    path = DIR / key / "bank.json"
    if key not in PREFIX or not path.exists():
        return {"rows": [], "ctx": []}
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=4)
def types(key: str) -> dict[int, list[dict]]:
    """task -> [{"id": "3", "type": "7.3", "name": ..., "protos": [14, 15, ...]}] in book order."""
    out: dict[int, list[dict]] = {}
    for r in _data(key)["rows"]:
        if r["an"]:
            continue
        lst = out.setdefault(r["task"], [])
        t = next((x for x in lst if x["raw"] == r["type"]), None)
        if t is None:
            k = len(lst) + 1
            name = (r["type"] or f"Тип {k}").replace("м е ньшую", "меньшую").replace("б о льшую", "большую")  # accents split the word
            t = {"id": str(k), "type": f"{r['task']}.{k}", "name": name, "raw": r["type"], "protos": []}
            lst.append(t)
        t["protos"].append(r["proto"])
    return out


@lru_cache(maxsize=4)
def _type_of(key: str) -> dict[tuple[int, int], str]:
    return {(n, p): t["id"] for n, ts in types(key).items() for t in ts for p in t["protos"]}


@lru_cache(maxsize=4)
def _ans(a):
    """«; ; . 390 570 750» (several right answers, layout of the book) → «390 ; 570 ; 750»."""
    if not a or not re.match(r"^[;\s]*\.\s", a):
        return a
    return " ; ".join(re.sub(r"^[;\s]*\.\s*", "", a).split())


def _rows(key: str) -> list[dict]:
    pre = PREFIX.get(key)
    if not pre:
        return []
    tof = _type_of(key)
    names = {(n, t["id"]): t["name"] for n, ts in types(key).items() for t in ts}
    out = []
    for r in _data(key)["rows"]:
        tid = tof.get((r["task"], r["proto"]), "")
        out.append({
            "ref": pre + r["id"], "pid": pre + r["id"], "task": r["task"], "proto": tid, "proto_name": names.get((r["task"], tid), ""),
            "type": f"{r['task']}.{tid}" if tid else "", "q": r.get("text") or "",
            "a": _ans(r.get("answer")) if not r.get("answer_img") else None, "answer_text": _ans(r.get("answer")),
            "sol": "", "src": f"{SOURCE}, № {r['id']}", "img": img_url(key, _f(r["id"]) + ".png"),
            "ans_img": img_url(key, "a" + _f(r["id"]) + ".png") if r.get("answer_img") else None,
            "ctx_img": img_url(key, "c" + _f(r["ctx"]) + ".png") if r.get("ctx") else None,
            "tags": r.get("tags") or [], "analog": bool(r["an"]), "exam": key,
        })
    return out


def problems(key: str, n: int | None = None, proto: str | None = None, analogs: bool = True) -> list[dict]:
    return [p for p in _rows(key) if (n is None or p["task"] == n) and (not proto or p["proto"] == proto) and (analogs or not p["analog"])]


@lru_cache(maxsize=4)
def by_ref(key: str) -> dict[str, dict]:
    return {p["ref"]: p for p in _rows(key)}


def find(ref: str) -> dict | None:
    """Any problem of the OGE or base bank by its ref."""
    key = KEYS.get(ref[:1])
    return by_ref(key).get(ref) if key else None


def is_ref(ref: str) -> bool:
    return bool(re.fullmatch(r"[ge]\d+\.\d+(\.\d+)?", ref or ""))


def image_path(key: str, name: str) -> Path | None:
    """Only files of the bank: 7_14.png, 7_14_3.png, a20_1.png (answer), c1_2.png (shared text)."""
    if key not in PREFIX or not re.fullmatch(r"[ac]?\d+(_\d+){0,2}\.png", name):
        return None
    p = DIR / key / "img" / name
    return p if p.exists() else None


def task_maps(key: str, names: dict[int, str]) -> dict[int, dict]:
    """Maps of the tasks in the shape of learning.taskmaps.TASK_MAPS: a type of the collection is a prototype of the map."""
    out = {}
    for n, ts in sorted(types(key).items()):
        out[n] = {"n": n, "name": names.get(n) or f"Задание {n}", "diag": {},
                  "protos": [{"id": t["id"], "name": t["name"], "fig": None, "skills": [], "know": [], "links": [], "problems": []} for t in ts]}
    return out


def path_of(url: str | None) -> Path | None:
    """File of a bank picture by its URL: /api/fipi/img/N.png (profile) or /api/bank/<key>/img/<name> (OGE, base)."""
    url = url or ""
    if url.startswith("/api/fipi/img/"):
        from app.learning import fipi
        return fipi.image_path(url.rsplit("/", 1)[-1])
    m = url.split("/")
    if len(m) == 6 and m[1] == "api" and m[2] == "bank" and m[4] == "img":
        return image_path(m[3], m[5])
    return None
