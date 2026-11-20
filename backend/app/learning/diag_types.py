"""Entrance diagnostic by task types (Nov 2026): every type of a task map, one problem each, in the order of the map.

Part 1 (tasks 1-12): all types one after another (1.1, 1.2, ...). Part 2 (13-19): one item per task; the student
chooses which type to solve. The types he did not choose count as «probably weak» for the trajectory.

Where a problem comes from, in this order:
- the official FIPI demo of EGE 2027 (PROF_P1, index of its variant);
- the open FIPI bank (f{N}: the picture is shown, the answer is the bank's);
- own problem in the exam format where the open bank has no problem of this type ("own": True).
Every answer of part 1 was solved again by hand when the list was made (Nov 2026); own answers were also checked
by a brute-force script. Part 2 is graded by the photo check, its answers here are only for reference.
"""
from __future__ import annotations

from functools import lru_cache

UNCHOSEN = 0.25  # a part-2 type the student did not choose: probably weak, but he did not show it
SKIP_AFTER = 2   # «не знаю» twice in a row inside one task: offer to skip the rest of its types

# type -> ("demo", variant index) | ("fipi", N) | ("own", text, answer[, fig])
PROF: dict[str, tuple] = {
    # 1. Планиметрия
    "1.1": ("fipi", 1), "1.2": ("own", "В треугольнике ABC стороны AC и BC равны, AB = 12, cos A = 0,6. Найдите высоту CH.", "8"),
    "1.3": ("demo", 2), "1.4": ("fipi", 16), "1.5": ("fipi", 14), "1.6": ("fipi", 19), "1.7": ("fipi", 39),
    "1.8": ("demo", 0), "1.9": ("fipi", 12),
    # 2. Векторы
    "2.1": ("fipi", 44), "2.2": ("demo", 0), "2.3": ("demo", 1),
    # 3. Стереометрия
    "3.1": ("fipi", 59),
    "3.2": ("own", "В кубе ABCDA₁B₁C₁D₁ найдите угол между прямыми AB₁ и B₁C. Ответ дайте в градусах.", "60"),
    "3.3": ("demo", 1), "3.4": ("demo", 0), "3.5": ("fipi", 70), "3.6": ("fipi", 82), "3.7": ("demo", 2),
    # 4-5. Вероятность
    "4.1": ("demo", 0), "4.2": ("demo", 1), "5.1": ("demo", 0), "5.2": ("demo", 1),
    # 6. Простейшие уравнения
    "6.1": ("fipi", 212), "6.2": ("demo", 1), "6.3": ("demo", 0), "6.4": ("demo", 2),
    "6.5": ("own", "Решите уравнение cos(π(x − 7)/3) = 1/2. В ответе напишите наименьший положительный корень.", "2"),
    # 7. Вычисления
    "7.1": ("own", "Найдите значение выражения (a² − 25)/(a + 5) − a при a = 7,3.", "-5"),
    "7.2": ("fipi", 225), "7.3": ("demo", 2), "7.4": ("demo", 1), "7.5": ("demo", 0),
    # 8. Производная и первообразная
    "8.1": ("demo", 1), "8.2": ("demo", 0), "8.3": ("fipi", 259),
    "8.4": ("own", "Функция F(x) = x³ − 6x² + 2 является одной из первообразных функции f(x). Найдите f(5).", "15"),
    # 9. Прикладная задача
    "9.1": ("demo", 0), "9.2": ("demo", 2), "9.3": ("demo", 1), "9.4": ("fipi", 333),
    "9.5": ("own", "Сила тока I (в амперах) в электросети вычисляется по закону Ома: I = U/R, где U = 220 В - напряжение, "
                   "R - сопротивление прибора (в омах). Электросеть выдерживает силу тока не более 4 А. Определите, "
                   "какое наименьшее сопротивление должно быть у прибора, подключаемого к этой сети. Ответ дайте в омах.", "55"),
    # 10. Текстовая задача
    "10.1": ("demo", 0),
    "10.2": ("own", "Из одной точки круговой трассы, длина которой равна 14 км, одновременно в одном направлении стартовали "
                    "два автомобиля. Скорость первого автомобиля равна 80 км/ч, и через 40 минут после старта он опережал "
                    "второй автомобиль на один круг. Найдите скорость второго автомобиля. Ответ дайте в км/ч.", "59"),
    "10.3": ("fipi", 372), "10.4": ("demo", 2), "10.5": ("demo", 1),
    "10.6": ("own", "Рабочий в первый день изготовил 20 деталей, а в каждый следующий день изготавливал на 3 детали больше, "
                    "чем в предыдущий. Сколько деталей изготовил рабочий за первые 10 дней?", "335"),
    # 11. Графики функций
    "11.1": ("fipi", 389), "11.2": ("fipi", 395), "11.3": ("demo", 0), "11.4": ("demo", 1), "11.5": ("fipi", 413),
    "11.6": ("own", "На рисунке изображён график функции вида f(x) = a·cos x + b. Найдите значение f(π/3).", "2", "trig"),
    # 12. Наибольшее и наименьшее значение
    "12.1": ("demo", 2), "12.2": ("demo", 0), "12.3": ("demo", 1), "12.4": ("fipi", 477),
    "12.5": ("own", "Найдите наименьшее значение функции y = √(x² − 6x + 13).", "2"),
    # ---------- part 2: the student chooses one type per task ----------
    "13.1": ("own", "а) Решите уравнение (x² − 2x)² − 2(x² − 2x) − 3 = 0.\nб) Укажите корни этого уравнения, принадлежащие отрезку [−1; 2].",
             "а) −1; 1; 3. б) −1; 1"),
    "13.2": ("own", "а) Решите уравнение |x² − 4x| = 3x − 6.\nб) Укажите корни этого уравнения, принадлежащие отрезку [0; 5].", "а) 3; 6. б) 3"),
    "13.3": ("own", "а) Решите уравнение (2x² − 5x − 3)·√(x − 2) = 0.\nб) Укажите корни этого уравнения, принадлежащие отрезку [2,5; 4].",
             "а) 2; 3. б) 3"),
    "13.4": ("fipi", 485), "13.5": ("fipi", 518),
    "13.6": ("own", "а) Решите уравнение log₃²(9x) − 5·log₃x − 10 = 0.\nб) Укажите корни этого уравнения, принадлежащие отрезку [0,1; 1].",
             "а) 1/9; 27. б) 1/9"),
    "13.7": ("fipi", 533), "13.8": ("fipi", 522),
    "14.1": ("fipi", 557), "14.2": ("fipi", 543),
    "14.3": ("own", "В правильной треугольной призме ABCA₁B₁C₁ все рёбра равны 1.\nа) Докажите, что прямые AB₁ и A₁B перпендикулярны.\n"
                    "б) Найдите косинус угла между прямыми AB₁ и BC₁.", "б) 0,25"),
    "14.4": ("fipi", 537),
    "14.5": ("own", "Дан куб ABCDA₁B₁C₁D₁ с ребром 6.\nа) Докажите, что прямая BD₁ перпендикулярна плоскости AB₁C.\n"
                    "б) Найдите расстояние между прямыми AB₁ и BC₁.", "б) 2√3"),
    "14.6": ("fipi", 539), "14.7": ("fipi", 545), "14.8": ("fipi", 578), "14.9": ("fipi", 548),
    "15.1": ("own", "Решите неравенство 1/(x − 2) + 4/(x + 1) ≥ 1.", "(−1; 1] ∪ (2; 5]"),
    "15.2": ("own", "Решите неравенство |x² − 3x| ≤ 2x − 4.", "[(1 + √17)/2; 4]"),
    "15.3": ("fipi", 586), "15.4": ("fipi", 599), "15.5": ("fipi", 629),
    "16.1": ("fipi", 640), "16.2": ("fipi", 685),
    "17.1": ("fipi", 690), "17.2": ("fipi", 696),
    "17.3": ("own", "В треугольнике ABC точка M - середина стороны AB, точка K лежит на стороне BC, причём BK : KC = 1 : 2. "
                    "Отрезки AK и CM пересекаются в точке O.\nа) Докажите, что AO : OK = 3 : 2.\n"
                    "б) Найдите отношение площади треугольника AOC к площади треугольника ABC.", "б) 2 : 5"),
    "17.4": ("fipi", 742), "17.5": ("fipi", 710), "17.6": ("fipi", 713),
    "18.1": ("own", "Найдите все значения a, при каждом из которых система уравнений\nax + 4y = a + 2,\nx + ay = a\nне имеет решений.", "a = −2"),
    "18.2": ("own", "Найдите все значения a, при каждом из которых уравнение x² − (2a + 1)x + a² + a − 2 = 0 имеет два корня, "
                    "сумма квадратов которых равна 13.", "a = (−1 ± √17)/2"),
    "18.3": ("own", "Найдите все значения a, при каждом из которых оба корня уравнения x² − 2ax + a² − 1 = 0 принадлежат отрезку [−2; 4].",
             "[−1; 3]"),
    "18.4": ("own", "Найдите все значения a, при каждом из которых неравенство x² + 2(a − 1)x + a + 5 > 0 выполняется при всех x.", "(−1; 4)"),
    "18.5": ("fipi", 745),
    "18.6": ("own", "Найдите все значения a, при каждом из которых уравнение (x² + a)³ + x² + a = 8x³ + 2x имеет ровно два различных корня.",
             "a < 1"),
    "18.7": ("own", "Найдите все значения a, при каждом из которых уравнение x² + a·|x| + a² − 4 = 0 имеет единственное решение.", "a = 2"),
    "18.8": ("fipi", 789), "18.9": ("fipi", 793),
    "19.1": ("fipi", 797),
    "19.2": ("own", "На доске написано несколько (больше одного) различных натуральных чисел, среднее арифметическое которых равно 15.\n"
                    "а) Могут ли на доске быть ровно 5 чисел, наибольшее из которых равно 50?\n"
                    "б) Может ли сумма чисел на доске быть равна 100?\n"
                    "в) Какое наибольшее количество чисел может быть на доске, если каждое из них меньше 20?", "а) да; б) нет; в) 9"),
    "19.3": ("own", "Дана конечная возрастающая арифметическая прогрессия из натуральных чисел, в которой не меньше трёх членов, "
                    "а сумма всех членов равна 120.\nа) Может ли в ней быть ровно 5 членов?\nб) Может ли в ней быть ровно 7 членов?\n"
                    "в) Какое наибольшее число членов может быть в этой прогрессии?", "а) да; б) нет; в) 15"),
    "19.4": ("own", "Группа школьников побывала в кино и в театре; каждый был хотя бы в одном из этих мест, некоторые - в обоих. "
                    "В кино мальчики составили не более 2/5 от всех школьников группы, побывавших в кино, а в театре - "
                    "не более 1/4 от всех побывавших в театре.\nа) Могло ли в группе из 12 школьников быть 5 мальчиков?\n"
                    "б) Какое наибольшее число мальчиков могло быть в группе из 12 школьников?\n"
                    "в) Какую наименьшую долю могли составлять девочки от всех школьников группы?", "а) да; б) 6; в) 1/2"),
}


def _src(kind: str) -> str:
    return {"demo": "демоверсия ЕГЭ 2027", "fipi": "открытый банк ФИПИ", "own": "по образцу банка ФИПИ"}[kind]


def _problem(t: str, n: int) -> dict:
    """The problem of one type: q (text), a (answer), img / fig, src."""
    from app.learning import fipi
    from app.learning.content import PROF_P1
    spec = PROF[t]
    if spec[0] == "demo":
        it = PROF_P1[n][spec[1]]
        return {"q": it["q"], "a": it["a"], "fig": it.get("fig"), "nodes": it["nodes"], "src": _src("demo")}
    if spec[0] == "fipi":
        p = fipi.by_ref()[f"f{spec[1]}"]
        return {"q": p["q"], "a": p["a"], "img": p["img"], "ans_img": p.get("ans_img"), "ref": p["ref"], "src": _src("fipi")}
    return {"q": spec[1], "a": spec[2], "fig": spec[3] if len(spec) > 3 else None, "own": True, "src": _src("own")}


@lru_cache(maxsize=1)
def prof_items() -> tuple[dict, ...]:
    """All items of the typed profile diagnostic (cached: the list is static)."""
    from app.learning.content import EXAMS
    from app.learning.taskmaps import TASK_MAPS
    need = {t["n"]: t for t in EXAMS["prof"]["tasks"]}
    out: list[dict] = []
    for n in range(1, 20):
        protos = TASK_MAPS[n]["protos"]
        types = [(f"{n}.{k}", p) for k, p in enumerate(protos, 1)]
        if n <= 12:
            for t, p in types:
                pr = _problem(t, n)
                out.append({**pr, "id": f"t{t.replace('.', '_')}", "type": t, "proto": p["id"], "type_name": p["name"],
                            "task": f"T{n}", "n": n, "t": "num", "oral": n == 8, "nodes": pr.get("nodes") or need[n]["need"],
                            "of_types": len(types)})
        else:
            choices = []
            for t, p in types:
                pr = _problem(t, n)
                choices.append({"type": t, "proto": p["id"], "name": p["name"], "q": pr["q"], "img": pr.get("img"),
                                "a": pr["a"], "own": bool(pr.get("own")), "src": pr["src"]})
            out.append({"id": f"s{n}", "t": "work", "task": f"T{n}", "n": n, "q": "", "nodes": need[n]["need"],
                        "max": need[n]["max"], "choices": choices, "src": "выбери тип задания"})
    return tuple(out)


def chosen(item: dict, answers: dict) -> dict | None:
    """The type the student chose in a part-2 item (or None)."""
    t = (answers.get("_choice") or {}).get(item["id"])
    return next((c for c in item.get("choices") or [] if c["type"] == t), None)


def type_scores(items: list[dict], answers: dict, evals: dict[str, dict | None]) -> dict[str, float]:
    """type -> how well it is solved (0..1) after a typed diagnostic. evals: item id -> engine.eval_item result.
    Part 2: the chosen type gets its score, the other types UNCHOSEN; «не знаю» = all types 0."""
    out: dict[str, float] = {}
    work = answers.get("_work") or {}
    for it in items:
        e = evals.get(it["id"])
        if it.get("type"):
            if e is not None:
                out[it["type"]] = round(e["o"], 2)
            continue
        if not it.get("choices"):
            continue
        dont = (work.get(it["id"]) or {}).get("mode") == "dont_know" or answers.get(it["id"]) == "?"
        ch = chosen(it, answers)
        for c in it["choices"]:
            if dont:
                out[c["type"]] = 0.0
            elif ch and c["type"] == ch["type"]:
                if e is not None:
                    out[c["type"]] = round(e["o"], 2)
            else:
                out[c["type"]] = UNCHOSEN
    return out
