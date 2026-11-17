"""Teacher and tutor side: classes, results heat map, disputed works, homework, textbooks, conspects."""
from __future__ import annotations

import io
import logging
import re
from datetime import date, datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.agents.prompts.tasks import TASK_CONFIGS
from app.auth.deps import get_current_user
from app.db import crud_learning as crud
from app.db.database import get_db
from app.db.models import Assignment, ClassGroup, Material, TaskResult, TeacherReview, Textbook, User
from app.learning import engine, llm, service
from app.learning.content import EXAMS, NODE_BY_ID, NODES

log = logging.getLogger(__name__)
router = APIRouter(tags=["teacher"])

ERR_TYPES = [
    ("Отбор корней", re.compile(r"отбор|отрез", re.I)),
    ("ОДЗ и потеря корней", re.compile(r"одз|потер|посторон|област", re.I)),
    ("Недостаточное обоснование", re.compile(r"обоснов|доказ", re.I)),
    ("Вычислительная", re.compile(r"вычисл|арифмет|подсч", re.I)),
    ("Тождественные преобразования", re.compile(r"преобраз|тожд|формул", re.I)),
    ("Неверный метод", re.compile(r"метод|подход", re.I)),
]


def require_teacher(user: User = Depends(get_current_user)) -> User:
    if user.role not in ("teacher", "tutor"):
        raise HTTPException(403, "Раздел для учителя или репетитора")
    return user


async def _own_class(db: AsyncSession, teacher: User, class_id: int) -> ClassGroup:
    cg = await db.get(ClassGroup, class_id)
    if cg is None or cg.teacher_id != teacher.id:
        raise HTTPException(404, "Класс не найден")
    return cg


# ---------- overview ----------

@router.get("/teacher/overview")
async def overview(teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    classes = await crud.teacher_classes(db, teacher.id)
    out_classes, all_students = [], {}
    for cg in classes:
        studs = await crud.class_students(db, cg.id)
        out_classes.append({"id": cg.id, "name": cg.name, "code": cg.code, "student_ids": [s.id for s in studs]})
        for s in studs:
            all_students[s.id] = s
    results = await crud.student_task_results(db, list(all_students))
    latest: dict[int, dict[int, TaskResult]] = {}
    for uid, r in results:
        if r.status == "done" and r.judge_decision:
            latest.setdefault(uid, {})[r.task_id] = r  # sessions come in time order: the last wins
    since = datetime.utcnow() - timedelta(days=14)
    err_students: dict[str, set[int]] = {name: set() for name, _ in ERR_TYPES}
    for uid, r in results:
        if r.status != "done" or not r.agent_verdicts or (r.updated_at and r.updated_at < since):
            continue
        for v in r.agent_verdicts:
            for e in v.get("errors_found", []):
                for name, rx in ERR_TYPES:
                    if rx.search(e):
                        err_students[name].add(uid)
                        break
    disputed = [(uid, r) for uid, r in results if r.status == "done" and r.judge_decision
                and r.judge_decision.get("consensus_level") == "judge_decision"]
    reviewed = await crud.reviewed_ids(db, [r.id for _, r in disputed])
    students = []
    for s in all_students.values():
        row = await service.get_state(db, s.id)
        key = service.key_for(s)
        m = engine.build_model(row.data, key)
        sc = {tid: r.judge_decision.get("final_score") for tid, r in latest.get(s.id, {}).items()}
        students.append({"id": s.id, "name": s.name or s.email, "grade": s.grade, "exam": EXAMS[key]["short"], "pct": EXAMS[key]["pct"],
                         "forecast": engine.forecast_value(m, key), "max": EXAMS[key]["max"],
                         "root": NODE_BY_ID[m["root"]]["name"] if m["root"] else None, "scores": sc})
    assignments = await crud.assignments_for_teacher(db, teacher.id)
    await db.commit()
    return {
        "classes": out_classes, "students": students,
        "tasks": [{"n": n, "max": c["max_score"], "topic": c["topic"]} for n, c in sorted(TASK_CONFIGS.items())],
        "errors": [{"name": name, "count": len(err_students[name])} for name, _ in ERR_TYPES],
        "reviews": [{"id": r.id, "student": (all_students[uid].name or all_students[uid].email), "task": r.task_id,
                     "max": TASK_CONFIGS[r.task_id]["max_score"], "agents": r.judge_decision.get("agent_scores", []),
                     "judge": r.judge_decision.get("final_score")} for uid, r in disputed if r.id not in reviewed][:20],
        "assignments": [{"id": a.id, "class_id": a.class_id, "topic": a.topic, "count": a.count, "task_id": a.task_id,
                         "due": a.due.isoformat(), "done": len(a.done_by or [])} for a in assignments],
    }


@router.get("/teacher/students/{student_id}")
async def student_detail(student_id: int, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    my = set()
    for cg in await crud.teacher_classes(db, teacher.id):
        my |= {s.id for s in await crud.class_students(db, cg.id)}
    if student_id not in my:
        raise HTTPException(404, "Ученик не найден в ваших классах")
    s = await db.get(User, student_id)
    row = await service.get_state(db, student_id)
    key = service.key_for(s)
    m = engine.build_model(row.data, key)
    hist = await service.history(db, student_id)
    await db.commit()
    return {"id": s.id, "name": s.name or s.email, "exam": EXAMS[key]["short"], "forecast": engine.forecast_value(m, key),
            "max": EXAMS[key]["max"], "pct": EXAMS[key]["pct"],
            "root": NODE_BY_ID[m["root"]]["name"] if m["root"] else None,
            "weak": [NODE_BY_ID[w]["name"] for w in m["weak"]],
            "tasks": [{"id": t["id"], "n": t["n"], "name": t["name"], "p": t["p"], "max": t["max"], "risk": t["risk"]} for t in m["tasks"]],
            "history": [{"date": h.created_at.date().isoformat() if h.created_at else None, "value": h.value, "source": h.source} for h in hist]}


class ClassIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)


@router.post("/teacher/classes")
async def create_class(body: ClassIn, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    cg = await crud.create_class(db, teacher.id, body.name.strip())
    return {"id": cg.id, "name": cg.name, "code": cg.code}


class ReviewIn(BaseModel):
    score: int = Field(..., ge=0, le=4)


@router.post("/teacher/reviews/{task_result_id}")
async def review(task_result_id: int, body: ReviewIn, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    r = await db.get(TaskResult, task_result_id)
    if r is None or not r.judge_decision:
        raise HTTPException(404, "Работа не найдена")
    if body.score > TASK_CONFIGS[r.task_id]["max_score"]:
        raise HTTPException(422, "Балл больше максимума за задание")
    db.add(TeacherReview(task_result_id=r.id, teacher_id=teacher.id, score=body.score))
    jd = dict(r.judge_decision)
    jd["final_score"], jd["consensus_level"] = body.score, "teacher"
    r.judge_decision = jd
    flag_modified(r, "judge_decision")
    await db.commit()
    return {"ok": True}


class AssignIn(BaseModel):
    class_id: int
    topic: str = Field(..., min_length=1, max_length=200)
    count: int = Field(5, ge=1, le=30)
    due: date
    task_id: int | None = None


@router.post("/teacher/assignments")
async def create_assignment(body: AssignIn, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    cg = await _own_class(db, teacher, body.class_id)
    if body.task_id is not None and body.task_id not in TASK_CONFIGS:
        raise HTTPException(422, "Задание для проверки по фото: 13-19")
    a = Assignment(teacher_id=teacher.id, class_id=cg.id, topic=body.topic, count=body.count, task_id=body.task_id,
                   due=datetime.combine(body.due, datetime.min.time()).replace(hour=20), done_by=[])
    db.add(a)
    for s in await crud.class_students(db, cg.id):
        await service.notify(db, s.id, f"Учитель выдал работу: {body.topic}, {body.count} задач, до {body.due.strftime('%d.%m')}", "home")
    await db.commit()
    return {"id": a.id}


@router.delete("/teacher/assignments/{assignment_id}")
async def delete_assignment(assignment_id: int, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    a = await db.get(Assignment, assignment_id)
    if a is None or a.teacher_id != teacher.id:
        raise HTTPException(404, "Работа не найдена")
    await db.delete(a)
    await db.commit()
    return {"ok": True}


# ---------- textbooks ----------

MAX_BOOK = 40 * 1024 * 1024


def _extract_text(name: str, data: bytes) -> str:
    ext = Path(name).suffix.lower()
    if ext in (".txt", ".md"):
        for enc in ("utf-8", "cp1251"):
            try:
                return data.decode(enc)
            except UnicodeDecodeError:
                continue
        return data.decode("utf-8", "ignore")
    if ext == ".pdf":
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(data))
            return "\n".join((p.extract_text() or "") for p in reader.pages)
        except Exception as exc:  # scanned PDF without a text layer, broken file
            log.warning("pdf text extraction failed: %s", exc)
            return ""
    raise HTTPException(400, "Учебник: .txt, .md или .pdf")


def _book_view(b: Textbook) -> dict:
    return {"id": b.id, "title": b.title, "authors": b.authors, "grade": b.grade, "filename": b.filename,
            "chars": len(b.text or "")}


@router.get("/textbooks")
async def list_textbooks(teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    return {"textbooks": [_book_view(b) for b in await crud.textbooks(db, teacher.id)]}


@router.post("/textbooks")
async def add_textbook(title: str = Form(..., max_length=200), authors: str = Form("", max_length=200), grade: str = Form("", max_length=10),
                       file: UploadFile | None = File(None), teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    text, fname = "", None
    if file is not None and file.filename:
        data = await file.read()
        if len(data) > MAX_BOOK:
            raise HTTPException(400, "Файл больше 40 МБ")
        fname = file.filename
        text = _extract_text(fname, data)
    b = Textbook(owner_id=teacher.id, title=title.strip(), authors=authors.strip(), grade=grade.strip(), filename=fname, text=text[:2_000_000])
    db.add(b)
    await db.commit()
    await db.refresh(b)
    return _book_view(b)


@router.delete("/textbooks/{book_id}")
async def delete_textbook(book_id: int, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    b = await db.get(Textbook, book_id)
    if b is None or b.owner_id != teacher.id:
        raise HTTPException(404, "Учебник не найден")
    await db.delete(b)
    await db.commit()
    return {"ok": True}


# ---------- conspects and presentations ----------

class MaterialIn(BaseModel):
    kind: str = Field("conspect", pattern="^(conspect|slides)$")
    topic: str = Field(..., min_length=1, max_length=200)
    textbook_id: int
    section: str = Field("", max_length=80)
    paragraph: str = Field("", max_length=60000)
    who: str = Field("Класс", max_length=80)
    minutes: str = Field("45", max_length=4)


def _exam_link(topic: str) -> str:
    tl = topic.lower()
    hit = next((n for n in NODES if n["name"].lower()[:7] in tl), None)
    if not hit:
        return "номер задания по кодификатору ФИПИ"
    parts = []
    for key in ("prof", "oge"):
        ts = [engine.task_label(t) for t in EXAMS[key]["tasks"] if hit["id"] in t["need"]]
        if ts:
            parts.append(f"{EXAMS[key]['short']}: {', '.join(ts)}")
    return "; ".join(parts) or "номер задания по кодификатору ФИПИ"


@router.post("/materials/generate")
async def generate_material(body: MaterialIn, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    b = await db.get(Textbook, body.textbook_id)
    if b is None or b.owner_id != teacher.id:
        raise HTTPException(404, "Учебник не найден")
    text = body.paragraph.strip() or (b.text or "")
    if not text.strip():
        raise HTTPException(400, "Нужен текст учебника: вставьте параграф или загрузите учебник с текстом")
    book = {"title": b.title, "authors": b.authors}
    link = _exam_link(body.topic)
    try:
        if body.kind == "conspect":
            content = {"text": await llm.conspect(body.topic, book, body.section, body.who, body.minutes, text, link)}
        else:
            slides = await llm.slides(body.topic, book, body.section, body.who, body.minutes, text, link)
            if not slides:
                raise HTTPException(502, "Не получилось собрать слайды. Попробуйте ещё раз.")
            content = {"slides": slides}
    except HTTPException:
        raise
    except Exception as exc:
        log.exception("material generation failed: %s", exc)
        raise HTTPException(502, "Генерация сейчас недоступна. Попробуйте через минуту.")
    m = Material(owner_id=teacher.id, kind=body.kind, topic=body.topic, textbook_id=b.id, section=body.section, content=content)
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return {"id": m.id, "kind": m.kind, "topic": m.topic, **content}


@router.get("/materials")
async def list_materials(teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    return {"materials": [{"id": m.id, "kind": m.kind, "topic": m.topic, "section": m.section, "textbook_id": m.textbook_id,
                           "created_at": m.created_at.isoformat() if m.created_at else None, **(m.content or {})}
                          for m in await crud.materials(db, teacher.id)]}
