"""Open FIPI bank (ЕГЭ профиль): 841 problems with answers from the collection of A. D. Ostromogilsky (MathStart, 2025).
Built by tools/fipi_import.py: fipi/fipi.json + a picture of every problem (fipi/img/N.png, part-2 answers aN.png).
The picture is what the student sees; the text is only for search and for the model.
Problems are addressed as "f{N}" (N = number in the collection). The prototype of the task map is chosen by the
collection's topic and keywords of the problem; a teacher can always check the source page."""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

DIR = Path(__file__).resolve().parent / "fipi"
SOURCE = "Открытый банк ФИПИ (сборник А. Д. Остромогильского, 2025)"

# topic of the collection -> prototype of our task map; None = decide by the text
TOPIC = {
    1: {"Параллелограмм": None, "Центральный и вписанный угол": "angles", "Вписанный четырехугольник": "circum", "Касательная": "chords",
        "Треугольник": None},
    2: {"Длина вектора": "vec", "Скалярное произведение векторов": "dot"},
    3: {"Призма": None, "Пирамида": "pyramid", "Цилиндр и конус": "rot", "Шар": None},
    4: {"Классическое определение вероятности": "classic", "Вероятность противоположного события": "theorems"},
    5: {"Независимые события": "theorems", "Зависимые события": "hard"},
    6: {"Показательные уравнения": "exp", "Иррациональные уравнения": "irr", "Логарифмические уравнения": "log",
        "Степенные уравнения": "rat", "Рациональные уравнения": "rat"},
    7: {"Степени и корни": None, "Логарифмы": "log", "Тригонометрия": "trig"},
    8: {"Анализ графика функции": None, "Анализ графика производной": None},
    9: {"Дробно-линейная зависимость": "rat", "Квадратичная зависимость": "rat", "Степенная зависимость": None,
        "Тригонометрическая зависимость": "trig", "Показательная зависимость": "explog", "Логарифмическая зависимость": "explog"},
    10: {"Процентные вычисления": "percent", "Движение вдоль прямой": None, "Работа": "work", "Движение по воде": "water"},
    11: {"Прямая": "line", "Парабола": "parab", "Гипербола": "hyper", "Квадратный корень": "irr",
         "Показательная функция": "explog", "Логарифмическая функция": "explog"},
    12: {"Степенная функция": "pow", "Натуральный логарифм": "log", "Экспонента": "exp", "Тригонометрические функции": "trig"},
    13: {"Показательные уравнения": "exp", "Показательные тригонометрические уравнения": "mixed",
         "Тригонометрические уравнения с логарифмами": "trigodz"},  # the other topics are trigonometric: trig
    14: {"Тела вращения": "rot"},  # the rest: by what part б) asks
    15: {"Показательные неравенства": "exp", "Неравенства: логарифмы с переменным основанием": "logvar"},  # the rest: log
    16: {"Задачи на оптимизацию": "optim"},  # the rest: credit
    17: {"Треугольники": "tri", "Параллелограмм": "poly", "Трапеция": "poly", "Несколько окружностей": "circ"},
    18: {"Уравнения с параметром: исследование ОДЗ": "reduce", "Тригонометрические уравнения с параметром": "reduce",
         "Системы неравенств с параметром": "areas"},  # the rest (modulus, systems, circles): graph
    19: {"Последовательности": "seq"},  # the rest: num
}


def _proto(task: int, topic: str, text: str) -> str:
    t = (text or "").lower()
    hit = TOPIC.get(task, {}).get(topic or "")
    if hit:
        return hit
    if task == 1:
        if "трапеци" in t:
            return "trap"
        if topic == "Параллелограмм" or any(w in t for w in ("параллелограм", "ромб", "прямоугольник", "квадрат")):
            return "quad"
        if "вписан" in t and "окружност" in t:
            return "incircle"
        if "описан" in t:
            return "circum"
        if "90" in t or "прямоугольн" in t:
            return "right"
        if re.search(r"ac\s*=\s*bc|равнобедренн", t):
            return "iso"
        return "general"
    if task == 3:
        if topic == "Шар":
            return "combo" if ("вписан" in t or "описан" in t) else "rot"
        return "cube" if ("куб" in t or "параллелепипед" in t) else "prism"
    if task == 7:
        return "irr" if "√" in text else "pow"
    if task == 8:
        if "первообразн" in t:
            return "anti"
        if "касательн" in t:
            return "geom"
        if "материальная точка" in t or "движется" in t:
            return "phys"
        return "study"
    if task == 9:
        return "irr" if "√" in text else "rat"
    if task == 10:
        return "circle" if ("окружн" in t or "круг" in t) else "line"
    if task == 13:
        return "trig"
    if task == 14:
        if "угол между плоскост" in t:
            return "planes"
        if "угол между прям" in t and "плоскост" in t:
            return "lineplane"
        if "угол между прям" in t:
            return "lines"
        if "расстояние между прям" in t:
            return "skew"
        if "расстояние от" in t:
            return "dist"
        if "площадь сечения" in t or "сечени" in t and "площадь" in t:
            return "section"
        if "объём" in t or "объем" in t:
            return "vol"
        return "ratio"
    if task == 15:
        return "log"
    if task == 16:
        return "credit"
    if task == 17:
        return "circtri" if "треугольник" in t else "circquad"
    if task == 18:
        return "graph"
    if task == 19:
        return "num"
    return ""


@lru_cache(maxsize=1)
def _rows() -> list[dict]:
    path = DIR / "fipi.json"
    if not path.exists():
        return []
    from app.learning.taskmaps import TASK_MAPS
    names = {(n, p["id"]): p["name"] for n, m in TASK_MAPS.items() for p in m["protos"]}
    out = []
    for r in json.loads(path.read_text(encoding="utf-8")):
        n, task = r["n"], r["task"]
        proto = _proto(task, r.get("topic") or "", r.get("text") or "")
        out.append({
            "ref": f"f{n}", "pid": f"f{n}", "task": task, "proto": proto, "proto_name": names.get((task, proto), ""),
            "q": r.get("text") or "", "a": r.get("answer") if task <= 12 else None, "sol": "",
            "src": f"{SOURCE}, № {n}, стр. {r['page']}", "img": f"/api/fipi/img/{n}.png",
            "ans_img": f"/api/fipi/img/a{n}.png" if r.get("answer_img") else None, "topic": r.get("topic") or "",
        })
    return out


def problems(n: int | None = None, proto: str | None = None) -> list[dict]:
    return [p for p in _rows() if (n is None or p["task"] == n) and (not proto or p["proto"] == proto)]


@lru_cache(maxsize=1)
def by_ref() -> dict[str, dict]:
    return {p["ref"]: p for p in _rows()}


def image_path(name: str) -> Path | None:
    """Only files of the collection: N.png or aN.png."""
    if not re.fullmatch(r"a?\d{1,4}\.png", name):
        return None
    p = DIR / "img" / name
    return p if p.exists() else None
