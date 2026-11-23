"""Geometry data for the board. All coordinates are mathematical, before projection."""
import re
from math import acos, degrees, hypot, isclose
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator


class GeometryError(ValueError):
    pass


GEOMETRY_TASKS = {"prof": {1, 3, 14, 17}, "base": {11, 12, 13}, "oge": {15, 16, 17, 18, 23, 24, 25}}
GEOMETRY_WORDS = re.compile(
    r"\b(?:треугольник|четыр[её]хугольник|трапеци|параллелограмм|прямоугольник|ромб|"
    r"многоугольник|параллелепипед|пирамид|призм|цилиндр|конус|биссектрис|медиан[ауеы]|"
    r"радиус|диаметр|гипотенуз|катет|хорд|сфер)\w*|"
    r"\b(?:в кубе|р[её]бр\w* куба|клетчатой бумаг[еи]|уг[ео]л между|в окружность вписан|"
    r"в окружности|расстояние от точки|площадь круг[аи]|сторон\w* квадрата)",
    re.IGNORECASE,
)


def is_geometry_task(exam: str, task: int | None) -> bool:
    return task in GEOMETRY_TASKS.get(exam, ())


def looks_geometric(condition: str) -> bool:
    return GEOMETRY_WORDS.search(condition) is not None


Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=12, pattern=r"^[^|]+$")]
Coordinate = Annotated[float, Field(ge=-10000, le=10000, allow_inf_nan=False)]
Vector = tuple[Coordinate, Coordinate, Coordinate]


def sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def cross(a, b):
    x, y, z = a
    p, q, r = b
    return y * r - z * q, z * p - x * r, x * q - y * p


def scale(a, factor):
    return tuple(x * factor for x in a)


def close(a, b):
    return isclose(a, b, rel_tol=0.002, abs_tol=0.002)


class DiagramPart(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Edge(DiagramPart):
    points: tuple[Label, Label]
    style: Literal["solid", "hidden", "auxiliary"] = "solid"


class Circle(DiagramPart):
    center: Label
    through: Label


RelationKind = Literal[
    "length", "equal", "parallel", "perpendicular", "angle", "midpoint",
    "on_segment", "collinear", "on_circle", "tangent", "coplanar", "perpendicular_plane",
]


class Relation(DiagramPart):
    kind: RelationKind
    points: list[Label] = Field(min_length=2, max_length=5)
    value: Coordinate | None = None
    # An inferred relation becomes visible when its solution step is reached.
    step: int = Field(default=0, ge=0, le=20)

    @model_validator(mode="after")
    def expand_intersecting_lines(self):
        if self.kind == "perpendicular" and len(self.points) == 3:
            a, vertex, b = self.points
            self.points = [a, vertex, vertex, b]
        return self


class Diagram(DiagramPart):
    dimension: Literal[2, 3]
    grid: Annotated[float, Field(gt=0, le=10000, allow_inf_nan=False)] | None = None
    points: dict[Label, Vector] = Field(min_length=3, max_length=30)
    edges: list[Edge] = Field(default_factory=list, max_length=60)
    circles: list[Circle] = Field(default_factory=list, max_length=8)
    faces: list[list[Label]] = Field(default_factory=list, max_length=10)
    relations: list[Relation] = Field(min_length=1, max_length=65)

    def direction(self, a, b):
        v = sub(b, a)
        if hypot(*v) <= 1e-7:
            raise GeometryError("В построении совпали концы отрезка")
        return scale(v, 1 / hypot(*v))

    def verifies(self, relation: Relation) -> bool:
        kind = relation.kind
        count = {"length": 2, "angle": 3, "midpoint": 3, "collinear": 3, "on_segment": 3,
                 "on_circle": 3, "equal": 4, "parallel": 4, "perpendicular": 4, "tangent": 4,
                 "coplanar": 4, "perpendicular_plane": 5}
        if len(relation.points) != count[kind] or (relation.value is None) != (kind not in {"length", "angle"}):
            return False
        p = [self.points[name] for name in relation.points]
        if kind == "length":
            return relation.value > 0 and close(hypot(*sub(p[0], p[1])), relation.value)
        if kind == "angle":
            a, b = self.direction(p[1], p[0]), self.direction(p[1], p[2])
            return 0 < relation.value < 180 and close(degrees(acos(max(-1., min(1., dot(a, b))))), relation.value)
        if kind in {"equal", "parallel", "perpendicular"}:
            a, b = self.direction(*p[:2]), self.direction(*p[2:])
            if kind == "equal":
                return close(hypot(*sub(p[0], p[1])), hypot(*sub(p[2], p[3])))
            if kind == "parallel":
                return close(hypot(*cross(a, b)), 0)
            return close(dot(a, b), 0)
        if kind == "midpoint":
            length = hypot(*sub(p[1], p[2]))
            return length > 1e-7 and hypot(*sub(sub(p[0], p[1]), scale(sub(p[2], p[1]), 0.5))) <= length * 0.002
        if kind in {"collinear", "on_segment"}:
            axis = self.direction(p[1], p[2])
            delta, length = sub(p[0], p[1]), hypot(*sub(p[2], p[1]))
            t = dot(delta, axis) / length
            return hypot(*cross(delta, axis)) <= length * 0.002 and (kind == "collinear" or -0.002 <= t <= 1.002)
        if kind in {"on_circle", "tangent"}:
            radius = hypot(*sub(p[1], p[0]))
            if radius <= 1e-7:
                return False
            if kind == "on_circle":
                return close(hypot(*sub(p[2], p[0])), radius)
            axis = self.direction(p[2], p[3])
            return close(hypot(*cross(sub(p[0], p[2]), axis)), radius)
        plane = p[:3] if kind == "coplanar" else p[2:]
        normal = cross(self.direction(plane[0], plane[1]), self.direction(plane[0], plane[2]))
        if hypot(*normal) <= 1e-7:
            return False
        normal = scale(normal, 1 / hypot(*normal))
        if kind == "coplanar":
            delta = sub(p[3], p[0])
            return hypot(*delta) <= 1e-7 or close(dot(scale(delta, 1 / hypot(*delta)), normal), 0)
        return close(hypot(*cross(self.direction(p[0], p[1]), normal)), 0)

    @model_validator(mode="after")
    def validate_construction(self):
        if self.dimension == 2 and any(z != 0 for _, _, z in self.points.values()):
            raise GeometryError("У плоского чертежа координата z должна быть нулевой")
        if self.dimension == 3 and self.circles:
            raise GeometryError("Окружность на пространственном чертеже нужно вынести на плоское сечение")
        if self.dimension == 3 and self.grid:
            raise GeometryError("Сетка поддерживается только на плоском чертеже")
        if not (self.edges or self.circles or self.faces):
            raise GeometryError("В чертеже нет фигур")
        try:
            for edge in self.edges:
                self.direction(*(self.points[name] for name in edge.points))
            for circle in self.circles:
                self.direction(self.points[circle.center], self.points[circle.through])
            for face in self.faces:
                if not 3 <= len(face) <= 12 or len(set(face)) != len(face):
                    raise GeometryError("У грани должны быть разные вершины в порядке обхода")
                a, b, c, *_ = [self.points[name] for name in face]
                if hypot(*cross(self.direction(a, b), self.direction(a, c))) <= 1e-7:
                    raise GeometryError("Вырожденная грань")
                for name in face[3:]:
                    if not self.verifies(Relation(kind="coplanar", points=[*face[:3], name])):
                        raise GeometryError(f"Грань {', '.join(face)}: точка {name} не лежит в плоскости {', '.join(face[:3])}")
            for relation in self.relations:
                if not self.verifies(relation):
                    raise GeometryError(f"Не выполнено: {relation.kind} {', '.join(relation.points)}")
        except KeyError as exc:
            raise GeometryError(f"Не задана точка {exc.args[0]}") from exc
        return self
