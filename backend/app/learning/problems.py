"""One way to address any practice problem: "b12" = task bank row 12, "s1:r2" = built-in problem r2 of task 1."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import BankProblem
from app.learning.taskmaps import PART2, TASK_MAPS


def _proto_name(n: int, pid: str) -> str:
    return next((p["name"] for p in TASK_MAPS.get(n, {}).get("protos", []) if p["id"] == pid), "")


def builtin(n: int | None = None) -> list[dict]:
    out = []
    for tn, m in TASK_MAPS.items():
        if n is not None and tn != n:
            continue
        for pr in m["protos"]:
            for p in pr["problems"]:
                out.append({"ref": f"s{tn}:{p['id']}", "pid": p["id"], "task": tn, "proto": pr["id"], "proto_name": pr["name"],
                            "q": p["q"], "a": p["a"], "sol": p["sol"], "src": "Эверест"})
    return out


def _bank_view(b: BankProblem) -> dict:
    return {"ref": f"b{b.id}", "pid": f"b{b.id}", "task": b.task_n, "proto": b.proto, "proto_name": _proto_name(b.task_n, b.proto),
            "q": b.text, "a": b.answer, "sol": b.solution or "", "src": b.source}


async def approved(db: AsyncSession, n: int | None = None, proto: str | None = None) -> list[dict]:
    """Built-in problems + published bank problems, in task order."""
    q = select(BankProblem).where(BankProblem.status == "approved")
    if n is not None:
        q = q.where(BankProblem.task_n == n)
    if proto:
        q = q.where(BankProblem.proto == proto)
    bank = [_bank_view(b) for b in (await db.execute(q.order_by(BankProblem.task_n, BankProblem.id))).scalars()]
    items = [p for p in builtin(n) if not proto or p["proto"] == proto] + bank
    return sorted(items, key=lambda p: p["task"])


async def resolve(db: AsyncSession, refs: list[str]) -> dict[str, dict]:
    """ref -> problem (only existing, published or built-in problems)."""
    out: dict[str, dict] = {}
    ids = [int(r[1:]) for r in refs if r.startswith("b") and r[1:].isdigit()]
    if ids:
        for b in (await db.execute(select(BankProblem).where(BankProblem.id.in_(ids), BankProblem.status == "approved"))).scalars():
            out[f"b{b.id}"] = _bank_view(b)
    static = {p["ref"]: p for p in builtin()}
    for r in refs:
        if r in static:
            out[r] = static[r]
    return out


def is_part2(p: dict) -> bool:
    return p["task"] in PART2
