import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from typing import List
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

from app.agents.engine import check_task
from app.agents.prompts.tasks import MAX_TOTAL, TASK_CONFIGS
from app.auth.deps import get_current_user
from app.db.crud import (
    create_session,
    get_session,
    get_task_result,
    get_trajectory,
    get_user_sessions,
    save_trajectory,
    upsert_task_result,
)
from app.db.database import AsyncSessionLocal, get_db
from app.db.models import User
from app.models.schemas import AgentVerdict, JudgeDecision, SessionResult, TaskResult, TaskStatus
from app.ocr.pipeline import get_scan_jpegs, run_ocr
from app.storage import save_scan

router = APIRouter()

VALID_TASK_IDS = set(TASK_CONFIGS.keys())
VALID_EXTENSIONS = {".jpg", ".jpeg", ".png", ".pdf"}
MAX_FILE_SIZE = 15 * 1024 * 1024


# ---------- WebSocket manager ----------

class _WsManager:
    def __init__(self):
        self._conns: dict[str, list[WebSocket]] = {}

    async def connect(self, session_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self._conns.setdefault(session_id, []).append(ws)

    def disconnect(self, session_id: str, ws: WebSocket) -> None:
        conns = self._conns.get(session_id, [])
        if ws in conns:
            conns.remove(ws)

    async def broadcast(self, session_id: str, data: dict) -> None:
        for ws in list(self._conns.get(session_id, [])):
            try:
                await ws.send_json(data)
            except Exception:
                self.disconnect(session_id, ws)


_ws = _WsManager()


# ---------- Helpers ----------

def _task_result_from_row(row) -> TaskResult:
    """Convert ORM TaskResult → Pydantic TaskResult."""
    verdicts = None
    if row.agent_verdicts:
        verdicts = [AgentVerdict(**v) for v in row.agent_verdicts]
    judge = JudgeDecision(**row.judge_decision) if row.judge_decision else None
    return TaskResult(
        task_id=row.task_id,
        status=TaskStatus(row.status),
        ocr_text=row.ocr_text,
        ocr_confidence=row.ocr_confidence,
        agent_verdicts=verdicts,
        judge_decision=judge,
        error=row.error,
    )


def _session_summary(session) -> dict:
    tasks = {r.task_id: r for r in session.task_results}
    total = sum(
        r.judge_decision.get("final_score", 0)
        for r in tasks.values()
        if r.status == "done" and r.judge_decision
    )
    return {
        "session_id": str(session.id),
        "created_at": session.created_at.isoformat(),
        "total_score": total,
        "max_total": MAX_TOTAL,
        "completed_tasks": sum(1 for r in tasks.values() if r.status == "done"),
        "task_scores": {
            r.task_id: r.judge_decision.get("final_score")
            for r in tasks.values()
            if r.status == "done" and r.judge_decision
        },
    }


# ---------- Routes ----------

@router.post("/sessions")
async def create_new_session(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await create_session(db, current_user.id)
    return {"session_id": str(session.id)}


@router.get("/sessions")
async def list_sessions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    sessions = await get_user_sessions(db, current_user.id)
    return {"sessions": [_session_summary(s) for s in sessions]}


MAX_FILES_PER_TASK = 5


@router.post("/sessions/{session_id}/tasks/{task_id}/upload")
async def upload_task(
    session_id: str,
    task_id: int,
    files: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if task_id not in VALID_TASK_IDS:
        raise HTTPException(400, f"Допустимые задания: {sorted(VALID_TASK_IDS)}")
    if not files:
        raise HTTPException(400, "Нет файлов")
    if len(files) > MAX_FILES_PER_TASK:
        raise HTTPException(400, f"Максимум {MAX_FILES_PER_TASK} файлов на задание")

    for f in files:
        ext = Path(f.filename or "").suffix.lower()
        if ext not in VALID_EXTENSIONS:
            raise HTTPException(400, f"Недопустимый формат {f.filename}: только jpg, png, pdf")

    session = await get_session(db, session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(403, "Сессия не найдена")

    file_inputs: list[tuple[bytes, str]] = []
    for idx, f in enumerate(files):
        data = await f.read()
        if len(data) > MAX_FILE_SIZE:
            raise HTTPException(400, f"Файл {f.filename} превышает 15 МБ")
        ext = Path(f.filename or "").suffix.lower().lstrip(".")
        fname = f.filename or f"scan_{idx}.{ext}"
        await save_scan(session_id, task_id, idx, ext, data)
        file_inputs.append((data, fname))

    log.info(
        "upload session=%s task=%d files=%d names=%s",
        session_id[:8], task_id, len(file_inputs), [fi[1] for fi in file_inputs],
    )

    initial = TaskResult(task_id=task_id, status=TaskStatus.ocr)
    await upsert_task_result(db, session_id, initial)

    asyncio.create_task(_process_task(session_id, task_id, file_inputs))
    return {"task_id": task_id, "status": "processing"}


@router.get("/sessions/{session_id}/tasks/{task_id}/status")
async def get_task_status(
    session_id: str,
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await get_task_result(db, session_id, task_id)
    if not row:
        return {"task_id": task_id, "status": "pending"}
    return {"task_id": task_id, "status": row.status}


@router.get("/sessions/{session_id}/results", response_model=SessionResult)
async def get_results(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await get_session(db, session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(403, "Сессия не найдена")

    tasks: dict[int, TaskResult] = {
        r.task_id: _task_result_from_row(r) for r in session.task_results
    }
    total = sum(
        t.judge_decision.final_score
        for t in tasks.values()
        if t.status == TaskStatus.done and t.judge_decision
    )
    return SessionResult(
        session_id=session_id,
        tasks=tasks,
        total_score=total if tasks else None,
        max_total=MAX_TOTAL,
    )


@router.get("/sessions/{session_id}/trajectory")
async def get_trajectory_endpoint(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await get_session(db, session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(403, "Сессия не найдена")
    traj = await get_trajectory(db, session_id)
    if not traj:
        raise HTTPException(404, "Траектория ещё не сгенерирована")
    return traj.data


@router.post("/sessions/{session_id}/trajectory")
async def start_trajectory(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await get_session(db, session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(403, "Сессия не найдена")
    done_tasks = [r for r in session.task_results if r.status == "done"]
    if not done_tasks:
        raise HTTPException(400, "Нет проверенных заданий")
    asyncio.create_task(_generate_trajectory(session_id, list(session.task_results)))
    return {"status": "generating"}


async def _generate_trajectory(session_id: str, task_rows: list) -> None:
    from app.agents.trajectory import generate_trajectory
    try:
        log.info("trajectory generation started session=%s", session_id[:8])
        data = await generate_trajectory(task_rows)
        async with AsyncSessionLocal() as db:
            await save_trajectory(db, session_id, data)
        await _ws.broadcast(session_id, {"event": "trajectory_done"})
        log.info("trajectory generation done session=%s", session_id[:8])
    except Exception as exc:
        log.exception("trajectory generation failed session=%s: %s", session_id[:8], exc)
        await _ws.broadcast(session_id, {"event": "trajectory_error", "error": str(exc)})


@router.get("/sessions/{session_id}/report.pdf")
async def get_report_pdf(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await get_session(db, session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(403, "Сессия не найдена")
    from app.report import build_pdf
    total = sum(
        r.judge_decision.get("final_score", 0)
        for r in session.task_results
        if r.status == "done" and r.judge_decision
    )
    done_count = sum(1 for r in session.task_results if r.status == "done")
    loop = asyncio.get_event_loop()
    pdf_bytes = await loop.run_in_executor(
        None, build_pdf, str(session.id), session.task_results, session.created_at, total, done_count
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="ege-report-{str(session.id)[:8]}.pdf"'},
    )


@router.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await _ws.connect(session_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        _ws.disconnect(session_id, websocket)


# ---------- Background processing ----------

async def _process_task(session_id: str, task_id: int, file_inputs: list[tuple[bytes, str]]):
    tag = f"session={session_id[:8]} task={task_id}"

    async def emit(event: dict) -> None:
        await _ws.broadcast(session_id, event)

    async with AsyncSessionLocal() as db:
        try:
            log.info("[%s] OCR start files=%d", tag, len(file_inputs))
            await emit({"event": "ocr_started", "task_id": task_id})

            loop = asyncio.get_event_loop()
            ocr_data, scan_jpegs = await asyncio.gather(
                loop.run_in_executor(None, run_ocr, file_inputs),
                loop.run_in_executor(None, get_scan_jpegs, file_inputs),
            )

            log.info(
                "[%s] OCR done conf=%.3f low_conf=%s text_len=%d images=%d",
                tag, ocr_data["confidence"], ocr_data["low_confidence"],
                len(ocr_data["text"]), len(scan_jpegs),
            )

            ocr_result = TaskResult(
                task_id=task_id,
                status=TaskStatus.checking,
                ocr_text=ocr_data["text"],
                ocr_confidence=ocr_data["confidence"],
            )
            await upsert_task_result(db, session_id, ocr_result)
            await emit({
                "event": "ocr_done",
                "task_id": task_id,
                "confidence": ocr_data["confidence"],
                "low_confidence": ocr_data["low_confidence"],
            })

            log.info("[%s] agents start", tag)
            verdicts, judge = await check_task(
                task_id=task_id,
                ocr_text=ocr_data["text"],
                image_bytes_list=scan_jpegs,
                emit=emit,
            )
            log.info(
                "[%s] judge done score=%d/%d consensus=%s",
                tag, judge.final_score, judge.max_score, judge.consensus_level,
            )

            final = TaskResult(
                task_id=task_id,
                status=TaskStatus.done,
                ocr_text=ocr_data["text"],
                ocr_confidence=ocr_data["confidence"],
                agent_verdicts=verdicts,
                judge_decision=judge,
            )
            await upsert_task_result(db, session_id, final)
            await emit({
                "event": "task_complete",
                "task_id": task_id,
                "final_score": judge.final_score,
                "max_score": judge.max_score,
            })
            log.info("[%s] complete score=%d/%d", tag, judge.final_score, judge.max_score)

        except Exception as exc:
            log.exception("[%s] failed: %s", tag, exc)
            err = TaskResult(task_id=task_id, status=TaskStatus.error, error=str(exc))
            await upsert_task_result(db, session_id, err)
            await emit({"event": "task_error", "task_id": task_id, "error": str(exc)})
