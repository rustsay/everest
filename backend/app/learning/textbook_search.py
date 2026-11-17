"""Find the pages of a textbook that talk about a skill (plain keyword scoring, no LLM).

Text of a PDF textbook is stored with page markers [[стр. N]] (see api/teacher._extract_text).
Older uploads and .txt files have no markers: they are cut into numbered fragments instead.
"""
from __future__ import annotations

import re

MARK = re.compile(r"\[\[стр\. (\d+)\]\]")
FRAG = 2500


def pages(text: str) -> list[tuple[str, str]]:
    """[(label, page text)]; label is «стр. N» or «фрагмент N»."""
    text = text or ""
    parts = MARK.split(text)
    if len(parts) > 1:
        out = []
        for i in range(1, len(parts) - 1, 2):
            body = parts[i + 1].strip()
            if body:
                out.append((f"стр. {parts[i]}", body))
        return out
    return [(f"фрагмент {k + 1}", text[i:i + FRAG]) for k, i in enumerate(range(0, len(text), FRAG)) if text[i:i + FRAG].strip()]


def score(body: str, keys: list[str]) -> float:
    low = body.lower()
    hits = [low.count(k.lower()) for k in keys]
    found = sum(1 for h in hits if h)
    return sum(min(h, 6) for h in hits) + 3 * max(0, found - 1)  # several different keys on a page weigh more


def best_pages(text: str, keys: list[str], top: int = 3, limit: int = 9000) -> tuple[float, list[tuple[str, str]]]:
    """Total score of the chosen pages and the pages themselves in book order."""
    ps = pages(text)
    ranked = sorted(((score(b, keys), i) for i, (_, b) in enumerate(ps)), reverse=True)
    chosen = [i for s, i in ranked[:top] if s > 0]
    total = sum(s for s, i in ranked[:top] if s > 0)
    out, size = [], 0
    for i in sorted(chosen):
        label, body = ps[i]
        body = body[: max(0, limit - size)]
        if not body:
            break
        out.append((label, body))
        size += len(body)
    return total, out
