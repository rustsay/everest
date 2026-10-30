from pathlib import Path

import aiofiles

from app.config import settings


def task_dir(session_id: str, task_id: int) -> Path:
    return Path(settings.uploads_dir) / "sessions" / session_id / str(task_id)


def scan_path(session_id: str, task_id: int, idx: int, ext: str) -> Path:
    return task_dir(session_id, task_id) / f"scan_{idx}.{ext}"


async def save_scan(session_id: str, task_id: int, idx: int, ext: str, data: bytes) -> None:
    dest = scan_path(session_id, task_id, idx, ext)
    dest.parent.mkdir(parents=True, exist_ok=True)
    async with aiofiles.open(dest, "wb") as f:
        await f.write(data)
