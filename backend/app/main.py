import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import router
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
    # Warm up PaddleOCR in a thread so models download once at startup, not on first request
    import asyncio
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _warmup_ocr)
    yield


def _warmup_ocr() -> None:
    try:
        from app.ocr.paddle_ocr import get_ocr
        get_ocr()
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("OCR warm-up failed: %s", exc)


app = FastAPI(title="ЕГЭ Checker", version="1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
app.include_router(router, prefix="/api")
