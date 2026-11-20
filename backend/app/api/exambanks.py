"""Pictures of the open FIPI banks of OGE and EGE base (learning/exambank.py): problems, long answers, shared texts."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.learning import exambank

router = APIRouter(tags=["exambanks"])


@router.get("/bank/{key}/img/{name}")
async def bank_image(key: str, name: str):
    path = exambank.image_path(key, name)
    if path is None:
        raise HTTPException(404, "Нет такой картинки")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "public, max-age=604800"})
