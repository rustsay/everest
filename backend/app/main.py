import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.learning import router as learning_router
from app.api.batch import router as batch_router
from app.api.videos import router as videos_router, recover_videos
from app.api.router import router
from app.api.teacher import router as teacher_router
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
    # Warm up PaddleOCR in a background thread so models download once, not on the first check.
    # Not awaited: the site answers right away instead of returning 502 while models download.
    # Without a model OCR is not used at all, so the warm-up is skipped.
    if settings.llm_ready:
        import asyncio
        asyncio.get_running_loop().run_in_executor(None, _warmup_ocr)
    yield


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

app.include_router(auth_router, prefix="/api")
app.include_router(batch_router, prefix="/api")
app.include_router(videos_router, prefix="/api")
app.include_router(router, prefix="/api")
app.include_router(learning_router, prefix="/api")
app.include_router(teacher_router, prefix="/api")
