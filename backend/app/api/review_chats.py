"""Persistent conversations about a specific completed check, with a frozen context."""
import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.prompts.tasks import TASK_CONFIGS
from app.auth.deps import get_current_user
from app.config import NO_LLM, settings
from app.db.crud import get_session
from app.db.database import get_db
from app.db.models import ReviewChat, User
from app.learning import llm

router = APIRouter(tags=['review chats'])


def summary(chat: ReviewChat) -> dict:
    return {'id': str(chat.id), 'session_id': str(chat.session_id), 'task_id': chat.task_id, 'checked_at': chat.revision + 'Z',
            'title': chat.title, 'created_at': chat.created_at.isoformat(),
            'updated_at': chat.updated_at.isoformat(), 'message_count': len(chat.messages),
            'last_message': chat.messages[-1]['content'][:160] if chat.messages else ''}


def detail(chat: ReviewChat) -> dict:
    return {**summary(chat), 'messages': chat.messages,
            'score': chat.context['judge_decision']['final_score'],
            'max_score': chat.context['judge_decision']['max_score']}


async def owned_chat(db: AsyncSession, chat_id: uuid.UUID, user: User, lock=False) -> ReviewChat:
    query = select(ReviewChat).where(ReviewChat.id == chat_id, ReviewChat.user_id == user.id)
    if lock:
        query = query.with_for_update()
    chat = (await db.execute(query)).scalar_one_or_none()
    if chat is None:
        raise HTTPException(404, 'Диалог не найден')
    return chat


@router.get('/review-chats')
async def list_chats(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(ReviewChat).where(ReviewChat.user_id == user.id)
                            .order_by(ReviewChat.updated_at.desc(), ReviewChat.id.desc()))).scalars().all()
    return {'chats': [summary(chat) for chat in rows]}


@router.post('/sessions/{sid}/tasks/{task_id}/chat')
async def open_chat(sid: uuid.UUID, task_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    session = await get_session(db, str(sid))
    if session is None or session.user_id != user.id:
        raise HTTPException(404, 'Проверка не найдена')
    result = next((r for r in session.task_results if r.task_id == task_id), None)
    if result is None or result.status != 'done' or not result.judge_decision or task_id not in TASK_CONFIGS:
        raise HTTPException(409, 'Сначала дождитесь завершения проверки задания')
    revision = result.updated_at.isoformat()
    context = {'task_id': task_id, 'topic': TASK_CONFIGS[task_id]['topic'],
               'judge_decision': result.judge_decision, 'agent_verdicts': result.agent_verdicts or [],
               'ocr_text': result.ocr_text or '', 'criteria': TASK_CONFIGS[task_id]['criteria']}
    await db.execute(insert(ReviewChat).values(
        id=uuid.uuid4(), user_id=user.id, session_id=sid, task_id=task_id, revision=revision,
        title=f"Задание {task_id}: {context['topic']}", context=context, messages=[]
    ).on_conflict_do_nothing(index_elements=['user_id', 'session_id', 'task_id', 'revision']))
    chat = (await db.execute(select(ReviewChat).where(
        ReviewChat.user_id == user.id, ReviewChat.session_id == sid,
        ReviewChat.task_id == task_id, ReviewChat.revision == revision))).scalar_one()
    await db.commit()
    return detail(chat)


@router.get('/review-chats/{chat_id}')
async def get_chat(chat_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return detail(await owned_chat(db, chat_id, user))


class Question(BaseModel):
    text: str = Field(min_length=1, max_length=2000)

    @field_validator('text')
    @classmethod
    def strip_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError('Напишите вопрос')
        return value.strip()


@router.post('/review-chats/{chat_id}/messages')
async def ask(chat_id: uuid.UUID, body: Question, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Serialize simultaneous questions from the mini-chat and the assistant page.
    chat = await owned_chat(db, chat_id, user, lock=True)
    if not settings.llm_ready:
        raise HTTPException(503, NO_LLM)
    history = [*chat.messages, {'role': 'user', 'content': body.text}]
    try:
        reply = await asyncio.wait_for(llm.review_chat(chat.context, history), timeout=90)
        if not reply.strip():
            raise ValueError('Empty assistant reply')
    except Exception:
        await db.rollback()
        raise HTTPException(502, 'Помощник сейчас недоступен. Вопрос не отправлен — попробуйте ещё раз.')
    chat.messages = [*history, {'role': 'assistant', 'content': reply}]
    await db.commit()
    await db.refresh(chat)
    return detail(chat)
