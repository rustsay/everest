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


STOP = {"когда", "какие", "какой", "какая", "каких", "почему", "можно", "нужно", "чтобы", "этого", "этот", "этой", "если", "тогда",
        "учеников", "ученика", "ученик", "класса", "класс", "урок", "уроке", "объясни", "объясните", "расскажи", "расскажите",
        "пожалуйста", "помоги", "помогите", "задание", "задания", "задачи", "задача", "теория", "теорию", "который", "которые",
        "вопрос", "сделать", "лучше", "сейчас", "много", "очень", "будет", "есть", "надо", "давай", "как", "что", "для"}


def query_keys(text: str, limit: int = 8) -> list[str]:
    """Search keys from a free question: words of 4+ letters without common words, crude stem (no LLM)."""
    out: list[str] = []
    for w in re.findall(r"[а-яёa-z0-9]{4,}", (text or "").lower()):
        if w in STOP:
            continue
        k = w[:-2] if len(w) > 6 else w
        if k not in out:
            out.append(k)
    return out[:limit]


def search_books(books: list[tuple[str, str]], question: str, top: int = 3, limit: int = 9000) -> list[tuple[str, str, str]]:
    """[(book title, page label, text)] - the best pages over several books for a question."""
    keys = query_keys(question)
    if not keys:
        return []
    scored = []
    for title, text in books:
        for label, body in pages(text):
            sc = score(body, keys)
            if sc >= 4:  # at least one key twice or two different keys
                scored.append((sc, title, label, body))
    scored.sort(key=lambda x: -x[0])
    out, size = [], 0
    for _, title, label, body in scored[:top]:
        body = body[: max(0, limit - size)]
        if not body:
            break
        out.append((title, label, body))
        size += len(body)
    return out
