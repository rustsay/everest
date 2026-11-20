"""One-off converter: the open FIPI bank (ЕГЭ профиль) from a PDF collection with answers
-> backend/app/learning/fipi/fipi.json + one PNG per problem (and per part-2 answer).

Problems are kept as pictures cut from the PDF: formulas and drawings stay exactly as in the book; the text next to
the picture is only for search and for the model. Run: python tools/fipi_import.py book.pdf
Needs poppler (pdftotext, pdftoppm), Pillow, numpy."""
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

OUT = Path(__file__).resolve().parent.parent / "app" / "learning" / "fipi"
DPI = 150
K = DPI / 72
TOP, FOOT = 70.0, 778.0          # running head ends / navigation bar starts (pt)
LINE = re.compile(r'<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</line>', re.S)
WORD = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>')


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
                       "t": " ".join(w["t"] for w in words), "words": words})
        pages.append(ls)
    return pages


def trim(img: Image.Image, pad: int = 8) -> Image.Image | None:
    a = np.asarray(img.convert("L"))
    ys, xs = np.where(a < 200)
    if not len(ys):
        return None
    return img.crop((max(0, xs.min() - pad), max(0, ys.min() - pad), min(a.shape[1], xs.max() + pad + 1), min(a.shape[0], ys.max() + pad + 1)))


def stack(parts: list[Image.Image]) -> Image.Image:
    w = max(p.width for p in parts)
    out = Image.new("L", (w, sum(p.height for p in parts) + 10 * (len(parts) - 1)), 255)
    y = 0
    for p in parts:
        out.paste(p, (0, y))
        y += p.height + 10
    return out


def save(img: Image.Image, path: Path) -> None:
    img = img.convert("L").point(lambda v: 255 if v > 235 else v)  # clean paper, fewer grey levels -> smaller file
    img.quantize(16).save(path, optimize=True)


def main(pdf: str) -> None:
    tmp = Path(tempfile.mkdtemp())
    subprocess.run(["pdftotext", "-bbox-layout", pdf, str(tmp / "b.html")], check=True)
    pages = lines_of((tmp / "b.html").read_text(encoding="utf-8"))
    subprocess.run(["pdftoppm", "-r", str(DPI), "-gray", "-png", pdf, str(tmp / "p")], check=True)
    width = len(str(len(pages)))
    boxes: dict[int, list[tuple[float, float, float, float]]] = {}  # framed link boxes with a shadow: header, answer labels
    cache: dict[int, Image.Image] = {}

    def page_img(i: int) -> Image.Image:
        if i not in cache:
            arr = np.asarray(Image.open(tmp / f"p-{str(i + 1).zfill(width)}.png").convert("L")).copy()
            for x0, y0, x1, y1 in boxes.get(i, []):
                arr[max(0, int((y0 - 9) * K)):int((y1 + 7) * K), max(0, int((x0 - 9) * K)):int((x1 + 12) * K)] = 255
            cache[i] = Image.fromarray(arr)
        return cache[i]

    ans_start = next(i for i, ls in enumerate(pages) if any(l["t"].strip() == "Ответы." for l in ls))
    # ---- problems: headers, topics, sections in reading order
    marks = []  # (page, y, kind, data)
    for i, ls in enumerate(pages[:ans_start]):
        for l in ls:
            t = l["t"].strip()
            m = re.fullmatch(r"Задача (\d+)\.", t)
            if m and l["x0"] < 60:
                proto = next((re.search(r"[\d.]+", o["t"]).group(0) for o in ls
                              if o["t"].startswith("Прототип") and abs(o["y0"] - l["y0"]) < 3), "")
                hdr = [o for o in ls if abs(o["y0"] - l["y0"]) < 3 and o["x0"] < 320]
                boxes.setdefault(i, []).append((l["x0"], min(o["y0"] for o in hdr), max(o["x1"] for o in hdr), max(o["y1"] for o in hdr)))
                marks.append((i, l["y0"], "task", {"n": int(m.group(1)), "aproto": proto, "y1": max(o["y1"] for o in hdr)}))
            elif l["h"] > 16 and re.match(r"№\d+\.", t):
                marks.append((i, l["y0"], "section", {"sec": int(t[1:t.index(".")])}))
            elif 13.9 < l["h"] < 14.6 and l["x0"] < 57.5 and i >= 4:
                marks.append((i, l["y0"], "topic", {"topic": plain(t).rstrip(".")}))
    marks.sort(key=lambda m: (m[0], m[1]))
    # section titles come in two pieces on one line: «№1.» and «Планиметрия 1.» - ignore the second
    probs, sec, topic = [], None, None
    for k, (pi, y, kind, d) in enumerate(marks):
        if kind == "section":
            sec = d["sec"]
            continue
        if kind == "topic":
            topic = d["topic"]
            continue
        nxt = next(((p2, y2) for p2, y2, k2, _ in marks[k + 1:]), (pi, FOOT))
        parts, texts = [], []
        p, start = pi, d["y1"] + 6
        while True:
            end = nxt[1] - 5 if p == nxt[0] else FOOT
            if end - start > 6:
                img = page_img(p).crop((int(48 * K), int(start * K), int(548 * K), int(end * K)))
                t = trim(img)
                if t is not None:
                    parts.append(t)
                texts += [l["t"] for l in pages[p] if start <= l["y0"] < end
                          and not re.fullmatch(r"Задача \d+\.|Прототип [\d.]+|Ответ", l["t"].strip())]
            if p >= nxt[0]:
                break
            p, start = p + 1, TOP
        probs.append({"n": d["n"], "sec": sec, "topic": topic, "aproto": d["aproto"], "page": pi + 1,
                      "text": plain(" ".join(texts)), "img": parts})

    # ---- answers: two columns of «№N» labels
    labels = []
    for i in range(ans_start, len(pages)):
        for l in pages[i]:
            for w in l["words"]:
                if re.fullmatch(r"№\d+", w["t"]):
                    labels.append({"p": i, **w, "n": int(w["t"][1:])})
    for a in labels:
        boxes.setdefault(a["p"], []).append((a["x0"], a["y0"], a["x1"], a["y1"]))
    answers = {}
    for i in range(ans_start, len(pages)):
        here = [a for a in labels if a["p"] == i]
        split = 300.0  # labels of the right column start at x = 307 pt
        for a in here:
            col = [b for b in here if (b["x0"] < split) == (a["x0"] < split)]
            below = [b["y0"] for b in col if b["y0"] > a["y0"] + 1]
            y_end = min(below) - 2 if below else FOOT
            x0, x1 = (48, split + 2) if a["x0"] < split else (split - 2, 548)
            words = [w for l in pages[i] for w in l["words"]
                     if x0 <= w["x0"] < x1 and a["y0"] - 8 <= w["y0"] < y_end and not re.fullmatch(r"№\d+", w["t"])]
            text = plain(" ".join(w["t"] for w in sorted(words, key=lambda w: (round(w["y0"] / 4), w["x0"]))))
            crop = page_img(i).crop((int(x0 * K), int((a["y0"] - 8) * K), int(x1 * K), int((y_end - 3) * K)))
            answers[a["n"]] = {"text": text, "img": trim(crop)}

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "img").mkdir(exist_ok=True)
    rows = []
    for pr in probs:
        n = pr["n"]
        if not pr["img"]:
            print("no picture for", n)
            continue
        save(stack(pr["img"]), OUT / "img" / f"{n}.png")
        a = answers.get(n) or {}
        short = re.sub(r"\.$", "", a.get("text", "")).strip()
        row = {"n": n, "task": pr["sec"], "topic": pr["topic"], "aproto": pr["aproto"], "page": pr["page"], "text": pr["text"]}
        if pr["sec"] <= 12:
            row["answer"] = short.replace("−", "-") if short else None
        else:
            row["answer_text"] = short
            if a.get("img") is not None:
                save(a["img"], OUT / "img" / f"a{n}.png")
                row["answer_img"] = True
        rows.append(row)
    (OUT / "fipi.json").write_text(json.dumps(rows, ensure_ascii=False, indent=0), encoding="utf-8")
    print(len(rows), "problems,", sum(1 for r in rows if r.get("answer") or r.get("answer_img")), "with answers")


if __name__ == "__main__":
    main(sys.argv[1])
