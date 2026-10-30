import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import Session, TaskResult, Trajectory, User
from app.models.schemas import TaskResult as TaskResultSchema
from app.models.schemas import TaskStatus


# ---------- Users ----------

async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def create_user(db: AsyncSession, email: str, password_hash: str) -> User:
    user = User(email=email, password_hash=password_hash)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


# ---------- Sessions ----------

async def create_session(db: AsyncSession, user_id: int) -> Session:
    session = Session(id=uuid.uuid4(), user_id=user_id)
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


async def get_session(db: AsyncSession, session_id: str) -> Session | None:
    result = await db.execute(
        select(Session)
        .where(Session.id == uuid.UUID(session_id))
        .options(selectinload(Session.task_results))
    )
    return result.scalar_one_or_none()


async def get_user_sessions(db: AsyncSession, user_id: int) -> list[Session]:
    result = await db.execute(
        select(Session)
        .where(Session.user_id == user_id)
        .options(selectinload(Session.task_results))
        .order_by(Session.created_at.desc())
    )
    return list(result.scalars().all())


# ---------- Task results ----------

async def upsert_task_result(
    db: AsyncSession, session_id: str, schema: TaskResultSchema
) -> None:
    result = await db.execute(
        select(TaskResult).where(
            TaskResult.session_id == uuid.UUID(session_id),
            TaskResult.task_id == schema.task_id,
        )
    )
    row = result.scalar_one_or_none()

    verdicts_json: Any = (
        [v.model_dump() for v in schema.agent_verdicts] if schema.agent_verdicts else None
    )
    judge_json: Any = schema.judge_decision.model_dump() if schema.judge_decision else None

    if row is None:
        db.add(
            TaskResult(
                session_id=uuid.UUID(session_id),
                task_id=schema.task_id,
                status=schema.status,
                ocr_text=schema.ocr_text,
                ocr_confidence=schema.ocr_confidence,
                agent_verdicts=verdicts_json,
                judge_decision=judge_json,
                error=schema.error,
            )
        )
    else:
        row.status = schema.status
        row.ocr_text = schema.ocr_text
        row.ocr_confidence = schema.ocr_confidence
        row.agent_verdicts = verdicts_json
        row.judge_decision = judge_json
        row.error = schema.error

    await db.commit()


# ---------- Trajectory ----------

async def get_trajectory(db: AsyncSession, session_id: str) -> Trajectory | None:
    result = await db.execute(
        select(Trajectory).where(Trajectory.session_id == uuid.UUID(session_id))
    )
    return result.scalar_one_or_none()


async def save_trajectory(db: AsyncSession, session_id: str, data: dict) -> Trajectory:
    existing = await get_trajectory(db, session_id)
    if existing:
        existing.data = data
        await db.commit()
        return existing
    traj = Trajectory(session_id=uuid.UUID(session_id), data=data)
    db.add(traj)
    await db.commit()
    await db.refresh(traj)
    return traj


# ---------- Task results ----------

async def get_task_result(
    db: AsyncSession, session_id: str, task_id: int
) -> TaskResult | None:
    result = await db.execute(
        select(TaskResult).where(
            TaskResult.session_id == uuid.UUID(session_id),
            TaskResult.task_id == task_id,
        )
    )
    return result.scalar_one_or_none()
