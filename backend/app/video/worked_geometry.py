"""Reviewed walkthroughs for bank tasks that can also be opened without a model."""
from math import cos, radians, sin

from app.video.geometry import Diagram


def edge(*points, style="solid"):
    return {"points": points, "style": style}


def relation(kind, *points, value=None, step=0):
    return {"kind": kind, "points": points, "value": value, "step": step}


def solution(diagram, rows):
    return {"diagram": Diagram.model_validate(diagram).model_dump(mode="json"), "steps": [
        {"title": title, "lines": lines, "text": narration, "explanation": explanation}
        for title, lines, narration, explanation in rows
    ]}


def circle_angles():
    def on_circle(degrees):
        return cos(radians(degrees)), sin(radians(degrees)), 0

    return solution({
        "dimension": 2,
        "points": {"O": (0, 0, 0), "A": on_circle(248), "B": on_circle(112),
                   "C": on_circle(68), "D": on_circle(292)},
        "edges": [edge("A", "O"), edge("O", "C"), edge("B", "O"), edge("O", "D"), edge("B", "C")],
        "circles": [{"center": "O", "through": "A"}],
        "relations": [relation("on_circle", "O", "A", name) for name in ("B", "C", "D")] + [
            relation("midpoint", "O", "A", "C"), relation("midpoint", "O", "B", "D"),
            relation("angle", "A", "O", "D", value=44), relation("angle", "A", "O", "B", value=136, step=2),
            relation("angle", "A", "C", "B", value=68, step=3),
        ],
    }, [
        ("Отмечаем диаметры", ["AC и BD — диаметры", "∠AOD = 44°"], "Диаметры пересекаются в центре O.",
         "На чертеже A и C лежат на одном диаметре, B и D — на другом. Лучи OB и OD направлены в противоположные стороны. Для угла ACB нужна дуга AB, которая не содержит вершину C."),
        ("Находим центральный угол", ["∠AOB + ∠AOD = 180°", "∠AOB = 180° − 44° = 136°"],
         "Лучи OB и OD образуют развёрнутый угол. Вычтем из ста восьмидесяти сорок четыре.",
         "У углов AOB и AOD общий луч OA, а два других луча лежат на одной прямой. Значит, углы смежные. Центральный угол AOB равен 136°, поэтому дуга AB без точки C тоже имеет величину 136°."),
        ("Находим вписанный угол", ["∠ACB = ½ ∠AOB", "∠ACB = 68°"],
         "Вписанный угол равен половине центрального, который опирается на ту же дугу.",
         "Стороны угла ACB пересекают окружность в A и B, так что этот вписанный угол опирается на дугу AB без точки C. По теореме о вписанном угле его величина равна 136° / 2 = 68°. Ответ: 68°."),
    ])


def cube_section():
    points = {"A": (0, 0, 0), "B": (4, 0, 0), "C": (4, 4, 0), "D": (0, 4, 0),
              "A₁": (0, 0, 4), "B₁": (4, 0, 4), "C₁": (4, 4, 4), "D₁": (0, 4, 4),
              "M": (2, 0, 0), "N": (0, 2, 0), "P": (1, 4, 0), "Q": (4, 4, 12 / 5), "R": (0, 0, 4 / 5),
              "H": (44 / 15, 68 / 15, 4 / 3)}
    return solution({
        "dimension": 3, "points": points,
        "edges": [edge("A", "B"), edge("B", "C"), edge("C", "D", style="hidden"),
                  edge("D", "A", style="hidden"), edge("A", "A₁"), edge("B", "B₁"),
                  edge("C", "C₁"), edge("D", "D₁", style="hidden"), edge("A₁", "B₁"),
                  edge("B₁", "C₁"), edge("C₁", "D₁"), edge("D₁", "A₁"),
                  edge("N", "B₁", style="auxiliary"), edge("C", "M", style="auxiliary"),
                  edge("N", "P", style="auxiliary"), edge("C", "H", style="auxiliary")],
        "faces": [["N", "P", "Q", "B₁", "R"]],
        "relations": [
            relation("midpoint", "M", "A", "B"), relation("midpoint", "N", "A", "D"),
            relation("length", "B₁", "N", value=6),
            relation("perpendicular", "N", "B₁", "M", "C", step=2),
            relation("parallel", "N", "P", "M", "C", step=3),
            relation("on_segment", "P", "D", "C"), relation("on_segment", "Q", "C", "C₁"),
            relation("on_segment", "R", "A", "A₁"),
            relation("coplanar", "N", "P", "B₁", "H", step=4),
            relation("perpendicular_plane", "C", "H", "N", "P", "B₁", step=4),
        ],
    }, [
        ("а) Выбираем координаты", ["A = (0; 0; 0), B = (a; 0; 0)", "C = (a; a; 0), D = (0; a; 0)", "B₁ = (a; 0; a)", "M = (a/2; 0; 0), N = (0; a/2; 0)"],
         "Направим три координатные оси вдоль рёбер куба, выходящих из A.",
         "Пусть a — ребро куба. Оси Ox, Oy и Oz направим вдоль AB, AD и AA₁. Соседние рёбра куба перпендикулярны, поэтому это прямоугольная система координат. Координаты M и N получаем как средние арифметические координат концов соответствующих рёбер."),
        ("а) Проверяем скалярное произведение", ["NB₁ = (a; −a/2; a)", "MC = (a/2; a; 0)", "NB₁ · MC = a²/2 − a²/2 = 0"],
         "Скалярное произведение направляющих векторов равно нулю.",
         "Вектор из N в B₁ получаем вычитанием координат N из координат B₁. Аналогично находим вектор из M в C. Оба вектора ненулевые. Нулевое скалярное произведение означает, что направления прямых перпендикулярны. Это доказывает пункт а)."),
        ("б) Находим ребро и уравнение плоскости", ["|NB₁| = 3a/2 = 6, a = 4", "n = (4; −2; −5)", "α: 4x − 2y − 5z + 4 = 0"],
         "Найдём размер куба, затем построим нормаль к плоскости.",
         "Квадрат длины NB₁ равен a² + a²/4 + a² = 9a²/4, поэтому длина 3a/2 и ребро a = 4. Плоскость содержит NB₁ и направление MC. Нормаль n = (4; −2; −5) перпендикулярна обоим: её скалярные произведения с (4; −2; 4) и (2; 4; 0) дают ноль. Подставляем N = (0; 2; 0) в уравнение плоскости, чтобы найти свободный член 4. На чертеже NP параллельна MC, а N, P, Q, B₁ и R образуют сечение."),
        ("б) Находим расстояние", ["C = (4; 4; 0)", "CH = |16 − 8 + 4| / √(16 + 4 + 25)", "CH = 12 / √45 = 4√5 / 5"],
         "Подставим C в уравнение плоскости и разделим на длину нормали.",
         "Расстояние от C до плоскости равно длине перпендикуляра CH. Значение 4x − 2y − 5z + 4 в точке C равно 12. Делим модуль 12 на длину нормали √45, потому что коэффициенты уравнения задают направление единичной нормали только после нормировки. Основание перпендикуляра H лежит в плоскости α, в этой конфигурации за пределами её сечения с кубом. Ответ: 4√5 / 5."),
    ])


WORKED = {"g16.1": circle_angles, "f536": cube_section}


def worked_geometry(ref: str | None) -> dict | None:
    factory = WORKED.get(ref)
    return factory() if factory else None
