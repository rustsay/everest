"""Who used which section on which day: counted from API requests, written to user_activity once a minute.
Only the user id, the day and request counts per section are kept: no texts, answers or addresses."""
from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from datetime import date, datetime, timedelta

from sqlalchemy.orm.attributes import flag_modified

from app.config import settings

log = logging.getLogger(__name__)

# first part of the path after /api/ -> section. None: not counted (polling, pictures, sign-in, the admin himself)
SECTIONS: dict[str, str | None] = {
    "me": "Главная", "dashboard": "Главная", "events": "Главная", "nodes": "Главная", "map": "Главная",
    "diagnostics": "Диагностика и пробники",
    "plan": "Расписание",
    "daily": "Задача дня",
    "path": "Траектория", "paths": "Траектория",
    "taskmaps": "Карты заданий", "skills": "Карты заданий", "taskfiles": "Карты заданий",
    "practice": "Банк задач", "redo": "Банк задач",
    "variants": "Варианты",
    "sessions": "Проверка по фото", "check1": "Проверка по фото", "check2": "Проверка по фото", "review-chats": "Проверка по фото",
    "videos": "Разборы", "walkthrough": "Разборы",
    "chat": "Помощник",
    "report": "Итоги недели",
    "bank": "Банк задач учителя",
    "teacher": "Кабинет учителя", "classes": "Кабинет учителя", "assignments": "Кабинет учителя",
    "textbooks": "Конспекты и презентации", "materials": "Конспекты и презентации",
    "notifications": None, "push": None, "auth": None, "fipi": None, "admin": None, "ws": None,
}

_buf: dict[tuple[int, date], dict[str, int]] = defaultdict(lambda: defaultdict(int))


def today() -> date:
    return (datetime.utcnow() + timedelta(hours=settings.stats_utc_offset)).date()


def section_of(path: str) -> str | None:
    parts = path.split("/")
    if len(parts) < 3 or parts[1] != "api":
        return None
    first = parts[2]
    if first == "teacher" and len(parts) > 3:
        first = {"paths": "paths", "report": "report"}.get(parts[3], "teacher")
    if first == "me" and len(parts) > 3:
        first = {"events": "plan", "target": "path"}.get(parts[3], "me")
    if first == "sessions" and parts[-1] == "status":
        return None  # polled while a check runs
    if first == "diagnostics" and parts[-1] == "work":
        return None  # polled while photos are analysed
    return SECTIONS.get(first)


def track(path: str, auth_header: str | None, status: int) -> None:
    if status >= 400 or not auth_header or not auth_header.startswith("Bearer "):
        return
    sec = section_of(path)
    if sec is None:
        return
    from app.auth.service import decode_token
    try:
        uid = decode_token(auth_header[7:])
    except ValueError:
        return
    _buf[(uid, today())][sec] += 1


async def flush() -> int:
    if not _buf:
        return 0
    from app.db.database import AsyncSessionLocal
    from app.db.models import UserActivity
    items = list(_buf.items())
    _buf.clear()
    async with AsyncSessionLocal() as db:
        for (uid, day), secs in items:
            row = await db.get(UserActivity, (uid, day))
            if row is None:
                row = UserActivity(user_id=uid, day=day, hits=0, sections={})
                db.add(row)
            s = dict(row.sections or {})
            for k, n in secs.items():
                s[k] = int(s.get(k, 0)) + n
            row.sections = s
            row.hits = int(row.hits or 0) + sum(secs.values())
            flag_modified(row, "sections")
        try:
            await db.commit()
        except Exception:  # noqa: BLE001 - e.g. the user was deleted meanwhile: lose this minute, keep the loop
            log.exception("activity flush failed")
            return 0
    return len(items)


async def flush_loop() -> None:
    while True:
        await asyncio.sleep(60)
        try:
            await flush()
        except Exception:  # noqa: BLE001
            log.exception("activity flush failed")
