"""Converter of an open FIPI bank collection (OGE, EGE base: «Задача N.P.» prototypes and «Аналог N.P.A.» analogs, answers
at the end) -> backend/app/learning/banks/<key>/bank.json + one PNG per problem (and per shared text, per long answer).

Run: python tools/bank_import.py <oge|base> book.pdf     Needs poppler (pdftotext, pdftoppm), Pillow, numpy.
Problems stay pictures cut from the PDF (formulas and drawings exactly as in the source); the text is only for search and
for the model. The answer row of the book («Ответ:» and its cells) is cleaned out of the picture.
Rows: {"id": "7.14" | "7.14.3", "task": 7, "proto": 14, "an": 0|A, "type": heading of the prototype group, "tags": [...],
       "text": ..., "answer": short answer text, "answer_img": bool, "ctx": "1.3" (OGE 1-5: id of the shared text)}"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
import unicodedata
from html import unescape
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent / "app" / "learning" / "banks"
DPI = 150
K = DPI / 72
TOP, FOOT = 72.0, 772.0
X0, X1 = 67.0, 528.0
LINE = re.compile(r'<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</line>', re.S)
WORD = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>')
HDR = re.compile(r"(Задача|Аналог) (\d+)\.(\d+)(?:\.(\d+))?\.\s*(.*)")
CTX = re.compile(r"Текст к задачам (\d+)\.(\d+)(?:\.(\d+))?\s*–")
TAGS = ("DEMO", "NEW", "OLD", "SIM")


def plain(s: str) -> str:
    s = unicodedata.normalize("NFKC", unescape(s))
    return re.sub(r"\s+", " ", s).strip()


def lines_of(html: str) -> list[list[dict]]:
    pages = []
    for pg in html.split("<page ")[1:]:
        ls = []
        for x0, y0, x1, y1, inner in LINE.findall(pg):
            words = [{"x0": float(a), "y0": float(b), "x1": float(c), "y1": float(d), "t": unescape(t)} for a, b, c, d, t in WORD.findall(inner)]
            ls.append({"x0": float(x0), "y0": float(y0), "x1": float(x1), "y1": float(y1), "h": float(y1) - float(y0),
                       "t": plain(" ".join(w["t"] for w in words)), "words": words})
        pages.append(ls)
    return pages


def trim(img: Image.Image, pad: int = 8) -> Image.Image | None:
    a = np.asarray(img.convert("L"))
    ys, xs = np.where(a < 190)
    if not len(ys):
        return None
    return img.crop((max(0, xs.min() - pad), max(0, ys.min() - pad), min(a.shape[1], xs.max() + pad + 1), min(a.shape[0], ys.max() + pad + 1)))


def save(img: Image.Image, path: Path) -> None:
    img = img.convert("L").point(lambda v: 255 if v > 225 else v)  # clean (tinted) paper, fewer grey levels -> smaller file
    img.quantize(16).save(path, optimize=True)


def fname(i: str) -> str:
    return i.replace(".", "_")


def main(key: str, pdf: str, answers_only: bool = False) -> None:
    out = ROOT / key
    (out / "img").mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp())
    subprocess.run(["pdftotext", "-bbox-layout", pdf, str(tmp / "b.html")], check=True)
    pages = lines_of((tmp / "b.html").read_text(encoding="utf-8"))
    if not answers_only:
        subprocess.run(["pdftoppm", "-r", str(DPI), "-gray", "-png", pdf, str(tmp / "p")], check=True)
    width = len(str(len(pages)))
    cache: dict[int, np.ndarray] = {}

    def page(i: int) -> np.ndarray:
        if i not in cache:
            if len(cache) > 6:
                cache.clear()
            cache[i] = np.asarray(Image.open(tmp / f"p-{str(i + 1).zfill(width)}.png").convert("L")).copy()
        return cache[i]

    def cut(i: int, y0: float, y1: float, blank: list[tuple[float, float, float, float]] = (), x0: float = X0, x1: float = X1,
            vlines: bool = False) -> Image.Image | None:
        a = page(i)[int(y0 * K):int(y1 * K), int(x0 * K):int(x1 * K)].copy()
        for bx0, by0, bx1, by1 in blank:  # the answer row of the book
            a[max(0, int((by0 - y0) * K)):max(0, int((by1 - y0) * K)), max(0, int((bx0 - x0) * K)):max(0, int((bx1 - x0) * K))] = 255
        if not a.size:
            return None
        a[(a < 235).mean(axis=1) > 0.9] = 255  # borders of the box: lines across the whole width
        if vlines:  # answers: the frame of the «№N.P» label and its shadow
            a[:, (a < 235).mean(axis=0) > 0.5] = 255
        return trim(Image.fromarray(a))

    ans_start = next(i for i, ls in enumerate(pages) if any(l["t"] == "ОТВЕТЫ" for l in ls))

    # ---- marks in reading order: headers of problems and shared texts, headings of sections and groups
    marks = []
    for i, ls in enumerate(pages[:ans_start]):
        for l in ls:
            if l["y0"] < TOP or l["y0"] > FOOT:
                continue
            t = l["t"]
            m = HDR.match(t)
            if m and l["x0"] < 80:
                tags = [x for x in TAGS if re.search(rf"\b{x}\b", m.group(5) or "")]
                marks.append((i, l["y0"], "prob", {"task": int(m.group(2)), "proto": int(m.group(3)), "an": int(m.group(4) or 0),
                                                   "tags": tags, "y1": l["y1"]}))
                continue
            m = CTX.match(t)
            if m and l["x0"] < 80:
                marks.append((i, l["y0"], "ctx", {"proto": int(m.group(2)), "an": int(m.group(3) or 0), "y1": l["y1"]}))
                continue
            if l["x0"] < 66 and 17 < l["h"] < 24 and t.endswith("."):
                if re.match(r"(№|No)\d", t):  # NFKC turns «№» into «No»
                    mm = re.match(r"(?:№|No)(\d+)(?:–(?:№|No)(\d+))?\.\s*(.*)\.$", t)
                    if mm:
                        marks.append((i, l["y0"], "section", {"from": int(mm.group(1)), "to": int(mm.group(2) or mm.group(1)),
                                                              "name": mm.group(3).strip()}))
                else:
                    marks.append((i, l["y0"], "group", {"name": t.rstrip(".").strip()}))
    marks.sort(key=lambda m: (m[0], m[1]))
    # a group heading may be an invisible anchor printed just under a problem header (inside its box): it belongs before it
    fixed = []
    for m in marks:
        if m[2] == "group" and fixed and fixed[-1][2] == "prob" and fixed[-1][0] == m[0] and m[1] - fixed[-1][1] < 30:
            fixed.insert(len(fixed) - 1, (m[0], fixed[-1][1] - 0.1, "group", m[3]))
        else:
            fixed.append(m)
    marks = fixed

    rows, ctx_rows = [], []
    if answers_only:  # keep the pictures and rows, read the answers again (the long answers keep their pictures)
        old_data = json.loads((out / "bank.json").read_text(encoding="utf-8"))
        rows, ctx_rows = old_data["rows"], old_data["ctx"]
        marks = []
    section, group = None, None
    proto_type: dict[tuple[int, int], str] = {}
    for k, (pi, y, kind, d) in enumerate(marks):
        if kind == "section":
            section, group = d, None
            continue
        if kind == "group":
            group = d["name"]
            continue
        nxt = next(((p2, y2) for p2, y2, _, _ in marks[k + 1:] if p2 == pi), None)
        end = nxt[1] - 4 if nxt else FOOT
        start = d["y1"] + 5
        blank = [(352.0, l["y0"] - 4, X1, l["y1"] + 10) for l in pages[pi] if start <= l["y0"] < end and l["t"].startswith("Ответ:")]
        img = cut(pi, start, end, blank)
        text = plain(" ".join(l["t"] for l in pages[pi] if start <= l["y0"] < end and not l["t"].startswith("Ответ:")))
        if kind == "ctx":
            cid = f"{d['proto']}" + (f".{d['an']}" if d["an"] else "")
            if img is not None:
                save(img, out / "img" / f"c{fname(cid)}.png")
                ctx_rows.append({"id": cid, "text": text, "page": pi + 1})
            continue
        pid = f"{d['task']}.{d['proto']}" + (f".{d['an']}" if d["an"] else "")
        if not d["an"]:
            typ = group or (section["name"] if section else "")
            proto_type[(d["task"], d["proto"])] = typ
        else:
            typ = proto_type.get((d["task"], d["proto"]), "")
        if img is None:
            print("no picture for", pid)
            continue
        save(img, out / "img" / f"{fname(pid)}.png")
        row = {"id": pid, "task": d["task"], "proto": d["proto"], "an": d["an"], "type": typ, "tags": d["tags"], "text": text, "page": pi + 1}
        if key == "oge" and d["task"] <= 5:
            row["ctx"] = f"{d['proto']}" + (f".{d['an']}" if d["an"] else "")
        rows.append(row)

    # ---- answers: two columns of «№N.P(.A)» labels, the answer follows the label
    labels = []
    for i in range(ans_start, len(pages)):
        for l in pages[i]:
            for w in l["words"]:
                if re.fullmatch(r"№\d+\.\d+(\.\d+)?", w["t"]):
                    labels.append({"p": i, **w, "id": w["t"][1:]})
    answers = {}
    for i in range(ans_start, len(pages)):
        here = [a for a in labels if a["p"] == i]
        mid = lambda b: round((b["x0"] + b["x1"]) / 2 / 40) * 40  # noqa: E731 - labels are centred in their frames
        cols = sorted({mid(a) for a in here})  # 2 columns (OGE) or 3 (base)
        lefts = {c: min(b["x0"] for b in here if mid(b) == c) for c in cols}
        for a in here:
            cx = mid(a)
            right = [lefts[c] for c in cols if c > cx]
            col = [b for b in here if mid(b) == cx]
            below = [b["y0"] for b in col if b["y0"] > a["y0"] + 3]
            y_end = min(below) - 2 if below else FOOT
            cx0, cx1 = a["x1"] + 8, (right[0] - 6 if right else 535.0)
            words = [w for l in pages[i] for w in l["words"]
                     if cx0 <= w["x0"] < cx1 and a["y0"] - 6 <= w["y0"] < y_end and not re.fullmatch(r"№\d+\.\d+(\.\d+)?", w["t"])]
            txt = plain(" ".join(w["t"] for w in sorted(words, key=lambda w: (round(w["y0"] / 4), w["x0"]))))
            txt = re.sub(r"^[.\s]+", "", re.sub(r"\s*\.$", "", txt)).strip()
            answers[a["id"]] = {"text": txt, "p": i, "box": (cx0, a["y0"] - 6, cx1, y_end)}
    long_from = 20 if key == "oge" else 99  # OGE 20-25: the answer is kept as a picture too (formulas, intervals)
    for r in rows:
        a = answers.get(r["id"])
        if not a:
            continue
        r["answer"] = a["text"].replace("−", "-") if a["text"] else None
        if r["task"] >= long_from and not answers_only:
            x0, y0, x1, y1 = a["box"]
            img = cut(a["p"], y0, y1, (), x0, x1, vlines=True)
            if img is not None:
                save(img, out / "img" / f"a{fname(r['id'])}.png")
                r["answer_img"] = True
    (out / "bank.json").write_text(json.dumps({"rows": rows, "ctx": ctx_rows}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(key, len(rows), "problems,", sum(1 for r in rows if r.get("answer")), "with answers,", len(ctx_rows), "shared texts")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], "--answers-only" in sys.argv)
