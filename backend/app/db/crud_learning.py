"""CRUD for the new-design tables (classes, diagnostics, chat, notifications, textbooks...)."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import (
    Assignment, ChatMessage, ClassGroup, ClassMember, Diagnostic, Material, Notification, Session, TaskResult,
    TeacherReview, Textbook, User,
)


# ---------- diagnostics ----------

async def open_diagnostic(db: AsyncSession, user_id: int, mode: str) -> Diagnostic | None:
    res = await db.execute(select(Diagnostic).where(
        Diagnostic.user_id == user_id, Diagnostic.mode == mode, Diagnostic.finished.is_(False)
    ).order_by(Diagnostic.id.desc()))
    return res.scalars().first()


async def last_finished_diagnostic(db: AsyncSession, user_id: int) -> Diagnostic | None:
    res = await db.execute(select(Diagnostic).where(Diagnostic.user_id == user_id, Diagnostic.finished.is_(True)).order_by(Diagnostic.id.desc()))
    return res.scalars().first()


# ---------- notifications ----------

async def list_notifications(db: AsyncSession, user_id: int, limit: int = 20) -> list[Notification]:
    res = await db.execute(select(Notification).where(Notification.user_id == user_id).order_by(Notification.id.desc()).limit(limit))
    return list(res.scalars().all())


async def unread_count(db: AsyncSession, user_id: int) -> int:
    res = await db.execute(select(Notification.id).where(Notification.user_id == user_id, Notification.read.is_(False)))
    return len(res.all())


async def mark_read(db: AsyncSession, user_id: int, note_id: int | None, note_ids: list[int] | None = None) -> None:
    q = update(Notification).where(Notification.user_id == user_id)
    if note_id is not None:
        q = q.where(Notification.id == note_id)
    if note_ids is not None:
        q = q.where(Notification.id.in_(note_ids))
    await db.execute(q.values(read=True))
    await db.commit()


# ---------- chat ----------

async def chat_history(db: AsyncSession, user_id: int, kind: str, limit: int = 40) -> list[ChatMessage]:
    res = await db.execute(select(ChatMessage).where(ChatMessage.user_id == user_id, ChatMessage.kind == kind).order_by(ChatMessage.id.desc()).limit(limit))
    return list(reversed(res.scalars().all()))


async def clear_chat(db: AsyncSession, user_id: int, kind: str) -> None:
    await db.execute(delete(ChatMessage).where(ChatMessage.user_id == user_id, ChatMessage.kind == kind))
    await db.commit()


# ---------- classes ----------

async def create_class(db: AsyncSession, teacher_id: int, name: str) -> ClassGroup:
    while True:
        code = secrets.token_hex(3).upper()
        if not (await db.execute(select(ClassGroup.id).where(ClassGroup.code == code))).first():
            break
    cg = ClassGroup(teacher_id=teacher_id, name=name, code=code)
    db.add(cg)
    await db.commit()
    await db.refresh(cg)
    return cg


async def teacher_classes(db: AsyncSession, teacher_id: int) -> list[ClassGroup]:
    res = await db.execute(select(ClassGroup).where(ClassGroup.teacher_id == teacher_id).order_by(ClassGroup.id))
    return list(res.scalars().all())


async def class_students(db: AsyncSession, class_id: int) -> list[User]:
    res = await db.execute(select(User).join(ClassMember, ClassMember.student_id == User.id).where(ClassMember.class_id == class_id).order_by(User.name))
    return list(res.scalars().all())


async def join_class(db: AsyncSession, student_id: int, code: str) -> ClassGroup | None:
    res = await db.execute(select(ClassGroup).where(ClassGroup.code == code.strip().upper()))
    cg = res.scalar_one_or_none()
    if cg is None:
        return None
    exists = await db.execute(select(ClassMember.id).where(ClassMember.class_id == cg.id, ClassMember.student_id == student_id))
    if not exists.first():
        db.add(ClassMember(class_id=cg.id, student_id=student_id))
        await db.commit()
    return cg


async def student_classes(db: AsyncSession, student_id: int) -> list[ClassGroup]:
    res = await db.execute(select(ClassGroup).join(ClassMember, ClassMember.class_id == ClassGroup.id).where(ClassMember.student_id == student_id))
    return list(res.scalars().all())


# ---------- photo-check results of students ----------

async def student_task_results(db: AsyncSession, student_ids: list[int]) -> list[tuple[int, TaskResult]]:
    if not student_ids:
        return []
    res = await db.execute(
        select(Session).where(Session.user_id.in_(student_ids)).options(selectinload(Session.task_results)).order_by(Session.created_at)
    )
    out: list[tuple[int, TaskResult]] = []
    for s in res.scalars().all():
        for r in s.task_results:
            out.append((s.user_id, r))
    return out


async def reviewed_ids(db: AsyncSession, task_result_ids: list[int]) -> set[int]:
    if not task_result_ids:
        return set()
    res = await db.execute(select(TeacherReview.task_result_id).where(TeacherReview.task_result_id.in_(task_result_ids)))
    return {r[0] for r in res.all()}


# ---------- assignments ----------

async def assignments_for_teacher(db: AsyncSession, teacher_id: int) -> list[Assignment]:
    res = await db.execute(select(Assignment).where(Assignment.teacher_id == teacher_id).order_by(Assignment.due))
    return list(res.scalars().all())


async def assignments_for_student(db: AsyncSession, student_id: int) -> list[Assignment]:
    class_ids = [c.id for c in await student_classes(db, student_id)]
    if not class_ids:
        return []
    since = datetime.utcnow() - timedelta(days=2)
    res = await db.execute(select(Assignment).where(Assignment.class_id.in_(class_ids), Assignment.due >= since).order_by(Assignment.due))
    return [a for a in res.scalars().all() if student_id not in (a.done_by or [])]


# ---------- textbooks and materials ----------

async def textbooks(db: AsyncSession, owner_id: int) -> list[Textbook]:
    res = await db.execute(select(Textbook).where(Textbook.owner_id == owner_id).order_by(Textbook.id))
    return list(res.scalars().all())


async def materials(db: AsyncSession, owner_id: int, limit: int = 20) -> list[Material]:
    res = await db.execute(select(Material).where(Material.owner_id == owner_id).order_by(Material.id.desc()).limit(limit))
    return list(res.scalars().all())
