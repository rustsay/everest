"""Shared female narration for the mascot and all solution boards."""
import asyncio
import hashlib
import logging
from collections import OrderedDict

import edge_tts
from aiohttp import ClientError
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from app.auth.deps import get_current_user
from app.db.models import User

router = APIRouter(prefix="/speech", tags=["speech"])
log = logging.getLogger(__name__)
VOICE = "ru-RU-SvetlanaNeural"
RATE = "-6%"  # Same pace as the supplied video generator.
_slots = asyncio.Semaphore(4)
_cache: OrderedDict[tuple[int, str], bytes] = OrderedDict()
_cache_bytes = 0
_MAX_CACHE_BYTES = 32 * 1024 * 1024
_pending: dict[tuple[int, str], asyncio.Task] = {}


class SpeechIn(BaseModel):
    text: str = Field(min_length=1, max_length=6000)


async def synthesize(text: str) -> bytes:
    async with _slots:
        for attempt in range(3):
            try:
                return await asyncio.wait_for(_render(text), timeout=12)
            except (edge_tts.exceptions.NoAudioReceived, ClientError, TimeoutError, RuntimeError):
                if attempt == 2:
                    raise
                await asyncio.sleep(0.3 * (attempt + 1))


async def _render(text: str) -> bytes:
    chunks = []
    async for chunk in edge_tts.Communicate(
        text, VOICE, rate=RATE, connect_timeout=5, receive_timeout=10,
    ).stream():
        if chunk["type"] == "audio":
            chunks.append(chunk["data"])
    audio = b"".join(chunks)
    if len(audio) < 1024:
        raise RuntimeError("TTS returned no audio")
    return audio


async def _generate(key: tuple[int, str], text: str) -> bytes:
    global _cache_bytes
    audio = await asyncio.wait_for(synthesize(text), timeout=40)
    _cache[key] = audio
    _cache_bytes += len(audio)
    while _cache and (len(_cache) > 128 or _cache_bytes > _MAX_CACHE_BYTES):
        _cache_bytes -= len(_cache.popitem(last=False)[1])
    return audio


def _finished(key, task):
    _pending.pop(key, None)
    if not task.cancelled():
        task.exception()  # Also collect failures when the requesting page has closed.


@router.post("")
async def speech(body: SpeechIn, user: User = Depends(get_current_user)):
    text = body.text.strip()
    if not text:
        raise HTTPException(422, "Введите текст для озвучки.")
    key = (user.id, hashlib.sha256(text.encode()).hexdigest())
    audio = _cache.get(key)
    if audio is None:
        task = _pending.get(key)
        if task is None:
            task = asyncio.create_task(_generate(key, text))
            _pending[key] = task
            task.add_done_callback(lambda done: _finished(key, done))
        try:
            # Replay/prefetch share the same generation, even if one client disconnects.
            audio = await asyncio.shield(task)
        except Exception:
            log.warning("Speech synthesis unavailable", exc_info=True)
            raise HTTPException(503, "Озвучка временно недоступна. Попробуйте ещё раз.")
    elif key in _cache:
        _cache.move_to_end(key)
    return Response(audio, media_type="audio/mpeg", headers={
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
    })
