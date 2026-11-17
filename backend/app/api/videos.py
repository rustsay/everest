import asyncio
import logging
import uuid
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy import select, update, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.config import settings, NO_LLM
from app.db.database import AsyncSessionLocal, get_db
from app.db.models import GeneratedVideo, User
from app.video.steps import generate_steps, display_steps

router = APIRouter(prefix='/videos', tags=['videos'])
log = logging.getLogger(__name__)
_queue = asyncio.Semaphore(1)
_enqueue = asyncio.Lock()
_jobs: set[asyncio.Task] = set()

def media_dir() -> Path:
    path = Path(settings.uploads_dir) / 'videos'
    path.mkdir(parents=True, exist_ok=True)
    return path

async def recover_videos():
    async with AsyncSessionLocal() as db:
        await db.execute(update(GeneratedVideo).where(GeneratedVideo.status == 'pending').values(status='error', stage='', error='Подготовка прервалась при перезапуске. Нажмите «Повторить».'))
        await db.commit()

def view(row: GeneratedVideo) -> dict:
    # Stable during polling: changing a <video> URL would restart playback.
    token = jwt.encode({'sub': str(row.user_id), 'video': str(row.id), 'purpose': 'video-media', 'exp': (int(time.time()) // 3600 + 5) * 3600}, settings.secret_key, algorithm=settings.jwt_algorithm)
    base = f'/api/videos/{row.id}/media/'
    return {'id': str(row.id), 'problem': row.problem, 'title': row.title, 'status': row.status, 'stage': row.stage, 'error': row.error, 'duration': row.duration, 'steps': display_steps(row.steps, row.html),
            'created_at': row.created_at.isoformat(), 'board_url': base+'board?token='+token if row.html else None,
            'video_url': base+'mp4?token='+token if row.status == 'ready' and (media_dir()/f'{row.id}.mp4').is_file() else None,
            'audio_url': base+'mp3?token='+token if row.status == 'ready' and (media_dir()/f'{row.id}.mp3').is_file() else None}

async def own(vid: uuid.UUID, user: User, db: AsyncSession):
    row = await db.get(GeneratedVideo, vid)
    if row is None or row.user_id != user.id:
        raise HTTPException(404, 'Разбор не найден')
    return row

async def change(vid, **values):
    async with AsyncSessionLocal() as db:
        await db.execute(update(GeneratedVideo).where(GeneratedVideo.id == vid).values(**values))
        await db.commit()

async def generate(vid):
    async with _queue:
        try:
            async with AsyncSessionLocal() as db:
                row = await db.get(GeneratedVideo, vid)
                problem, steps, title = row.problem, display_steps(row.steps, row.html), row.title
            if not steps:
                await change(vid, stage='Готовим пошаговое решение')
                data = await generate_steps(problem)
                steps, title = data['steps'], data['title']
            await change(vid, title=title, steps=steps, status='ready', stage='Разбор готов', error=None)
        except Exception:
            log.exception('Step generation failed: %s', vid)
            await change(vid, status='error', stage='', error='Не удалось подготовить разбор. Попробуйте ещё раз.')

def launch(vid):
    task = asyncio.create_task(generate(vid))
    _jobs.add(task)
    task.add_done_callback(_jobs.discard)

class VideoIn(BaseModel):
    problem: str = Field(min_length=5, max_length=6000)

async def check_capacity(db, uid):
    if not settings.llm_ready:
        raise HTTPException(503, NO_LLM)
    if await db.scalar(select(func.count()).select_from(GeneratedVideo).where(GeneratedVideo.user_id==uid, GeneratedVideo.status=='pending')):
        raise HTTPException(409, 'Дождитесь завершения текущего разбора.')
    if (await db.scalar(select(func.count()).select_from(GeneratedVideo).where(GeneratedVideo.status=='pending'))) >= 8:
        raise HTTPException(429, 'Очередь заполнена. Попробуйте немного позже.')

@router.get('')
async def list_videos(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(select(GeneratedVideo).where(GeneratedVideo.user_id==user.id).order_by(GeneratedVideo.created_at.desc()).limit(50))).all()
    return {'videos': [view(r) for r in rows]}

@router.post('', status_code=202)
async def create(body: VideoIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if len(body.problem.strip()) < 5:
        raise HTTPException(422, 'Введите условие задачи.')
    async with _enqueue:
        await check_capacity(db, user.id)
        row = GeneratedVideo(user_id=user.id, problem=body.problem.strip())
        db.add(row); await db.commit(); await db.refresh(row)
        launch(row.id)
    return view(row)

@router.get('/{vid}')
async def get_video(vid: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return view(await own(vid, user, db))

@router.post('/{vid}/retry', status_code=202)
async def retry(vid: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    async with _enqueue:
        row = await own(vid, user, db)
        if row.status != 'error':
            raise HTTPException(409, 'Повтор доступен для незавершённого разбора.')
        await check_capacity(db, user.id)
        row.status, row.stage, row.error = 'pending', 'В очереди', None
        await db.commit(); launch(row.id)
    return view(row)

@router.get('/{vid}/media/{kind}')
async def media(vid: uuid.UUID, kind: str, token: str, download: bool = False, db: AsyncSession = Depends(get_db)):
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
        if payload.get('purpose') != 'video-media' or payload.get('video') != str(vid):
            raise ValueError()
        uid = int(payload['sub'])
    except (JWTError, ValueError, KeyError):
        raise HTTPException(401, 'Ссылка устарела. Обновите страницу.')
    row = await db.get(GeneratedVideo, vid)
    if row is None or row.user_id != uid:
        raise HTTPException(404, 'Разбор не найден')
    headers = {'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff'}
    if kind == 'board' and row.html:
        return HTMLResponse(row.html, headers={**headers, 'Content-Security-Policy': "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"})
    if kind not in ('mp4', 'mp3'):
        raise HTTPException(404, 'Файл не найден')
    path = media_dir()/f'{vid}.{kind}'
    if row.status != 'ready' or not path.is_file():
        raise HTTPException(409, 'Видео ещё не готово')
    return FileResponse(path, media_type='video/mp4' if kind=='mp4' else 'audio/mpeg', filename=f'everest-{vid}.{kind}', content_disposition_type='attachment' if download else 'inline', headers=headers)
