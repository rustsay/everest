import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.learning import router as learning_router
from app.api.batch import router as batch_router
from app.api.review_chats import router as review_chats_router
from app.api.videos import router as videos_router, recover_videos
from app.api.router import router
from app.api.taskmaps import router as taskmaps_router
from app.api.bank import router as bank_router
from app.api.practice import router as practice_router
from app.api.paths import router as paths_router
from app.api.diag_work import router as diag_work_router
from app.api.walkthrough import router as walkthrough_router
from app.api.check1 import router as check1_router
from app.api.report import router as report_router, weekly_loop
from app.api.teacher import router as teacher_router
from app.api.push import router as push_router, remind_loop
from app.api.admin import router as admin_router
from app import activity
from app.auth.router import router as auth_router
from app.config import settings
from app.db.database import init_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)5s] %(name)s - %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Path(settings.uploads_dir).mkdir(parents=True, exist_ok=True)
    await init_db()
    await recover_videos()
    import asyncio
    weekly = asyncio.create_task(weekly_loop())  # weekly reports: notifications and parent emails
    reminders = asyncio.create_task(remind_loop())  # daily push reminders on study days
    stats = asyncio.create_task(activity.flush_loop())  # who used which section: for the admin panel
    # Warm up PaddleOCR in a background thread so models download once, not on the first check.
    # Not awaited: the site answers right away instead of returning 502 while models download.
    # Without a model OCR is not used at all, so the warm-up is skipped.
    if settings.llm_ready:
        import asyncio
        asyncio.get_running_loop().run_in_executor(None, _warmup_ocr)
    yield
    weekly.cancel()
    reminders.cancel()
    stats.cancel()
    await activity.flush()


def _warmup_ocr() -> None:
    try:
        from app.ocr.paddle_ocr import get_ocr
        get_ocr()
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("OCR warm-up failed: %s", exc)


app = FastAPI(title="Эверест", version="2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)



@app.middleware("http")
async def count_activity(request, call_next):
    response = await call_next(request)
    try:
        activity.track(request.url.path, request.headers.get("authorization"), response.status_code)
    except Exception:  # noqa: BLE001 - statistics must never break a request
        pass
    return response


app.include_router(auth_router, prefix="/api")
app.include_router(batch_router, prefix="/api")
app.include_router(review_chats_router, prefix="/api")
app.include_router(videos_router, prefix="/api")
app.include_router(router, prefix="/api")
app.include_router(learning_router, prefix="/api")
app.include_router(teacher_router, prefix="/api")
app.include_router(taskmaps_router, prefix="/api")
app.include_router(bank_router, prefix="/api")
app.include_router(practice_router, prefix="/api")
app.include_router(paths_router, prefix="/api")
app.include_router(diag_work_router, prefix="/api")
app.include_router(walkthrough_router, prefix="/api")
app.include_router(check1_router, prefix="/api")
app.include_router(report_router, prefix="/api")
app.include_router(push_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
