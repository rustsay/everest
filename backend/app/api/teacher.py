"""Teacher and tutor side: classes, results heat map, disputed works, homework, textbooks, conspects."""
from __future__ import annotations

import io
import logging
import re
from datetime import date, datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.agents.prompts.tasks import TASK_CONFIGS
from app.config import NO_LLM, settings
from app.auth.deps import get_current_user
from app.db import crud_learning as crud
from app.db.database import get_db
from app.db.models import Assignment, ClassGroup, LearningPath, Material, TaskResult, TeacherReview, Textbook, User, Variant, VariantAttempt
from app.learning import engine, llm, service, textbook_search
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
    diag = await _diag_detail(db, s)
    checks = _checks_detail(await crud.student_task_results(db, [student_id]))
    prac = row.data.get("prac") or {}
    last_check: dict[int, dict] = {}
    for c in checks:
        last_check.setdefault(c["n"], c)
    diag_by_task = {it["task"]: it for it in (diag or {}).get("items", [])}
    tasks = []
    for t in m["tasks"]:
        pr = prac.get(t["id"])
        tasks.append({"id": t["id"], "n": t["n"], "name": t["name"], "p": t["p"], "max": t["max"], "risk": t["risk"],
                      "prac": {"ok": pr[0], "all": pr[1]} if pr else None,
                      "check": {k: last_check[t["n"]][k] for k in ("score", "max", "date")} if t["n"] in last_check else None,
                      "diag": diag_by_task[t["id"]]["status"] if t["id"] in diag_by_task else None})
    attempts = (await db.execute(select(VariantAttempt, Variant).join(Variant, Variant.id == VariantAttempt.variant_id)
                                 .where(VariantAttempt.user_id == student_id).order_by(VariantAttempt.id.desc()))).all()
    path = (await db.execute(select(LearningPath).where(LearningPath.student_id == student_id, LearningPath.status == "active")
                             .order_by(LearningPath.id.desc()))).scalars().first()
    stage = None
    if path:
        today = date.today().isoformat()
        stage = next((st["title"] for st in path.data.get("stages", []) if st.get("from", "") <= today <= st.get("to", "")), None)
    await db.commit()
    return {"id": s.id, "name": s.name or s.email, "exam": EXAMS[key]["short"], "forecast": engine.forecast_value(m, key),
            "max": EXAMS[key]["max"], "pct": EXAMS[key]["pct"],
            "root": NODE_BY_ID[m["root"]]["name"] if m["root"] else None,
            "weak": [NODE_BY_ID[w]["name"] for w in m["weak"]],
            "tasks": tasks,
            "history": [{"date": h.created_at.date().isoformat() if h.created_at else None, "value": h.value, "source": h.source} for h in hist],
            "target": row.data.get("target"), "diag": diag, "checks": checks[:20],
            "variants": [{"title": v.title, "score": a.score, "max": a.max_score, "date": a.created_at.date().isoformat() if a.created_at else None}
                         for a, v in attempts[:10]],
            "path": {"id": path.id, "stage": stage, "count": len(path.data.get("stages", []))} if path else None,
            "taskmap": {"done": len(row.data.get("tm") or {}), "ok": sum(1 for v in (row.data.get("tm") or {}).values() if v)}}


def _diag_status(it: dict, answers: dict) -> tuple[str, str]:
    """(short status, comment) of one diagnostic item for the teacher."""
    ans = answers.get(it["id"])
    w = (answers.get("_work") or {}).get(it["id"]) or {}
    res = w.get("result") if w.get("status") == "done" else None
    if w.get("mode") == "dont_know" or ans == "?":
        return "не знаю", ""
    if it["t"] == "num":
        if not ans:
            return "нет ответа", ""
        ok = engine.same_ans(ans, it["a"])
        note = ""
        if res and w.get("mode") == "photo":
            note = (res.get("comment") or "").strip()
            if not ok and res.get("method_ok"):
                return "ошибка в счёте", note
            if ok and not res.get("method_ok"):
                return "верно, решение спорное", note
        elif w.get("mode") == "oral":
            note = "решил устно"
        return ("верно" if ok else "неверно"), note
    if res and res.get("score") is not None:
        return f"{res['score']} из {it.get('max') or 1}", (res.get("comment") or "").strip()
    if w.get("status") in ("pending", "error"):
        return "фото не проверено", ""
    return "нет решения", ""


async def _diag_detail(db: AsyncSession, s: User) -> dict | None:
    d = await crud.last_finished_diagnostic(db, s.id)
    if d is None:
        return None
    items = engine.diag_items(d.exam_key, s.grade, d.variant, (d.created_at or datetime.now()).date())
    out = []
    for it in items:
        st, note = _diag_status(it, d.answers or {})
        w = ((d.answers or {}).get("_work") or {}).get(it["id"]) or {}
        out.append({"id": it["id"], "task": it["task"], "n": it.get("n"), "q": str(it.get("q", ""))[:300], "status": st, "note": note[:300],
                    "answer": None if it["t"] != "num" else (d.answers or {}).get(it["id"]), "right": it.get("a"),
                    "photo": w.get("mode") == "photo"})
    good = {"верно", "верно, решение спорное"}
    return {"date": d.created_at.date().isoformat() if d.created_at else None, "mode": d.mode, "items": out,
            "right": sum(1 for x in out if x["status"] in good), "count": len(out)}


def _checks_detail(results: list) -> list[dict]:
    out = []
    for _, r in reversed(results):
        jd = r.judge_decision or {}
        if r.status != "done" or "final_score" not in jd:
            continue
        errs: list[str] = []
        for v in r.agent_verdicts or []:
            for e in v.get("errors_found") or []:
                e = str(e).strip()[:200]
                if e and e not in errs:
                    errs.append(e)
        out.append({"id": r.id, "n": r.task_id, "score": jd["final_score"], "max": TASK_CONFIGS[r.task_id]["max_score"],
                    "date": r.updated_at.date().isoformat() if r.updated_at else None, "errors": errs[:5],
                    "teacher": jd.get("consensus_level") == "teacher"})
    return out


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
            # page markers let explanations cite pages: [[стр. 12]]
            return "\n".join(f"\n[[стр. {i}]]\n" + (p.extract_text() or "") for i, p in enumerate(reader.pages, 1))
        except Exception as exc:  # scanned PDF without a text layer, broken file
            log.warning("pdf text extraction failed: %s", exc)
            return ""
    if ext == ".docx":
        return docx_text(data)
    raise HTTPException(400, "Учебник: .pdf, .docx, .txt или .md")


def docx_text(data: bytes) -> str:
    """Text of a Word file in reading order, tables included. Formulas typed in Word (OMML) are kept as text;
    formulas pasted as pictures are lost."""
    import zipfile
    from xml.etree import ElementTree as ET
    w = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    m = "{http://schemas.openxmlformats.org/officeDocument/2006/math}"
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            root = ET.fromstring(z.read("word/document.xml"))
    except Exception as exc:  # noqa: BLE001 - not a docx, broken file
        log.warning("docx text extraction failed: %s", exc)
        raise HTTPException(400, "Не получилось прочитать файл Word. Сохраните его как .docx")
    lines = []
    for p in root.iter(f"{w}p"):
        parts = []
        for el in p.iter():
            if el.tag in (f"{w}t", f"{m}t") and el.text:
                parts.append(el.text)
            elif el.tag == f"{w}tab":
                parts.append(" ")
            elif el.tag in (f"{w}br", f"{w}cr"):
                parts.append("\n")
        line = "".join(parts).strip()
        if line:
            lines.append(line)
    return "\n".join(lines)


def _book_view(b: Textbook) -> dict:
    return {"id": b.id, "title": b.title, "authors": b.authors, "grade": b.grade, "filename": b.filename,
            "chars": len(b.text or ""), "pages": len(textbook_search.MARK.findall(b.text or ""))}


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
    from sqlalchemy import delete as sql_delete
    from app.db.models import SkillExplanation
    await db.execute(sql_delete(SkillExplanation).where(SkillExplanation.textbook_id == b.id))
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
    pages: str = Field("", max_length=80)  # pages of the PDF file: "112-118, 120"
    extra: bool = True  # the model may add what the textbook lacks, marked «Дополнение»
    who: str = Field("Класс", max_length=80)
    minutes: str = Field("45", max_length=4)


MAX_PAGES = 30


def parse_pages(spec: str) -> list[int]:
    """'112-118, 120' -> [112..118, 120]; raises 400 on bad input or too many pages."""
    out: list[int] = []
    for part in re.split(r"[,;\s]+", re.sub(r"\s*[-–]\s*", "-", spec.strip())):
        if not part:
            continue
        m = re.fullmatch(r"(\d{1,4})(?:[-–](\d{1,4}))?", part)
        if not m:
            raise HTTPException(400, f"Не понял страницы «{part}». Пишите так: 112-118, 120")
        a, b = int(m.group(1)), int(m.group(2) or m.group(1))
        if b < a:
            a, b = b, a
        out += [x for x in range(a, b + 1) if x not in out]
        if len(out) > MAX_PAGES:
            raise HTTPException(400, f"Не больше {MAX_PAGES} страниц за раз")
    return out


def material_text(book_text: str, body: MaterialIn) -> tuple[str, list[str]]:
    """Text the material is built on and the labels of the pages used.
    Pasted text > pages chosen by the teacher > pages found by the topic."""
    if body.paragraph.strip():
        return body.paragraph.strip(), []
    ps = textbook_search.pages(book_text or "")
    if not ps:
        raise HTTPException(400, "В учебнике нет текста: укажите другой учебник или вставьте параграф вручную")
    if body.pages.strip():
        want = parse_pages(body.pages)
        if not ps[0][0].startswith("стр."):
            raise HTTPException(400, "В этом файле нет номеров страниц (это не PDF). Вставьте параграф вручную")
        have = {int(lbl.split()[1]): (lbl, txt) for lbl, txt in ps}
        got = [have[n] for n in want if n in have]
        if not got:
            raise HTTPException(400, f"В файле нет таких страниц или на них нет текста. Страниц в файле: {max(have)}")
    else:
        keys = [w for w in re.findall(r"[а-яёa-z]{4,}", body.topic.lower())]
        keys = [k[:-2] if len(k) > 6 else k for k in keys]  # crude stem: «логарифмические» finds «логарифм»
        _, got = textbook_search.best_pages(book_text, keys, top=6, limit=40000)
        if not got:
            raise HTTPException(400, "Не нашёл в учебнике страниц по этой теме. Укажите страницы вручную")
    text = "\n".join(f"[[{lbl}]]\n{txt}" for lbl, txt in got)[:60000]
    return text, [lbl for lbl, _ in got]


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
    if not settings.llm_ready:
        raise HTTPException(503, NO_LLM)
    b = await db.get(Textbook, body.textbook_id)
    if b is None or b.owner_id != teacher.id:
        raise HTTPException(404, "Учебник не найден")
    text, used = material_text(b.text or "", body)
    book = {"title": b.title, "authors": b.authors}
    link = _exam_link(body.topic)
    section = body.section or (f"{used[0]}-{used[-1].split()[1]}" if len(used) > 1 else used[0] if used else "")
    try:
        if body.kind == "conspect":
            content = {"text": await llm.conspect(body.topic, book, section, body.who, body.minutes, text, link, body.extra)}
        else:
            slides = await llm.slides(body.topic, book, section, body.who, body.minutes, text, link, body.extra)
            if not slides:
                raise HTTPException(502, "Не получилось собрать слайды. Попробуйте ещё раз.")
            content = {"slides": slides}
        content["pages"] = used
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
