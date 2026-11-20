"""Shared female narration for the mascot and all solution boards."""
import asyncio
import hashlib
import logging
import os
from collections import OrderedDict
from pathlib import Path

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
_cache: OrderedDict[str, bytes] = OrderedDict()
_cache_bytes = 0
_MAX_CACHE_BYTES = 32 * 1024 * 1024
_pending: dict[str, asyncio.Task] = {}
_CACHE_DIR = Path(os.getenv("SPEECH_CACHE_DIR", "/tmp/everest-speech"))


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


def _remember(key: str, audio: bytes) -> bytes:
    global _cache_bytes
    old = _cache.pop(key, None)
    if old is not None:
        _cache_bytes -= len(old)
    _cache[key] = audio
    _cache_bytes += len(audio)
    while _cache and (len(_cache) > 128 or _cache_bytes > _MAX_CACHE_BYTES):
        _cache_bytes -= len(_cache.popitem(last=False)[1])
    return audio


def _disk_read(key: str) -> bytes | None:
    try:
        audio = (_CACHE_DIR / f"{key}.mp3").read_bytes()
        return audio if len(audio) >= 1024 else None
    except (FileNotFoundError, OSError):
        return None


def _disk_write(key: str, audio: bytes) -> None:
    try:
        _CACHE_DIR.mkdir(parents=True, exist_ok=True)
        target = _CACHE_DIR / f"{key}.mp3"
        temporary = _CACHE_DIR / f".{key}.{os.getpid()}.tmp"
        temporary.write_bytes(audio)
        os.replace(temporary, target)
    except OSError:
        log.warning("Cannot persist speech cache", exc_info=True)


async def _generate(key: str, text: str) -> bytes:
    audio = await asyncio.to_thread(_disk_read, key)
    if audio is None:
        audio = await asyncio.wait_for(synthesize(text), timeout=40)
        await asyncio.to_thread(_disk_write, key, audio)
    return _remember(key, audio)


def _key(text: str) -> str:
    return hashlib.sha256(f"{VOICE}\0{RATE}\0{text}".encode()).hexdigest()


async def prepare_many(texts: list[str]) -> int:
    phrases = list(dict.fromkeys(text.strip() for text in texts if text.strip()))
    cursor = 0

    async def worker():
        nonlocal cursor
        while cursor < len(phrases):
            text = phrases[cursor]
            cursor += 1
            await _generate(_key(text), text)

    await asyncio.gather(*(worker() for _ in range(min(4, len(phrases)))))
    return len(phrases)


def _finished(key, task):
    _pending.pop(key, None)
    if not task.cancelled():
        task.exception()  # Also collect failures when the requesting page has closed.


@router.post("")
async def speech(body: SpeechIn, user: User = Depends(get_current_user)):
    text = body.text.strip()
    if not text:
        raise HTTPException(422, "Введите текст для озвучки.")
    # Reusing an exact phrase does not reveal the cache contents to another user,
    # but makes fixed mascot messages instant for every account.
    key = _key(text)
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
