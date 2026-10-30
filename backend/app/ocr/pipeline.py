import io
import logging
from pathlib import Path

import cv2
import numpy as np
from pdf2image import convert_from_bytes
from PIL import Image

from app.ocr.paddle_ocr import recognize
from app.ocr.preprocessor import preprocess

log = logging.getLogger(__name__)


FileInput = list[tuple[bytes, str]]  # [(file_bytes, filename), ...]


def run_ocr(files: FileInput) -> dict:
    texts, confs = [], []
    for file_bytes, filename in files:
        pages = _load_pages(file_bytes, filename)
        log.info("ocr file=%s pages=%d", filename, len(pages))
        for i, page in enumerate(pages):
            processed = preprocess(page)
            text, conf = recognize(processed)
            log.info("ocr page=%d chars=%d conf=%.3f", i, len(text), conf)
            if text:
                texts.append(text)
                confs.append(conf)
    avg_conf = sum(confs) / len(confs) if confs else 0.0
    log.info("ocr done total_chars=%d avg_conf=%.3f", sum(len(t) for t in texts), avg_conf)
    return {
        "text": "\n\n".join(texts),
        "confidence": round(avg_conf, 3),
        "low_confidence": avg_conf < 0.6,
    }


def get_scan_jpegs(files: FileInput, max_width: int = 1280, max_images: int = 4) -> list[bytes]:
    """Return up to max_images JPEG bytes across all files/pages for VLM input."""
    result = []
    for file_bytes, filename in files:
        for page in _load_pages(file_bytes, filename):
            if len(result) >= max_images:
                break
            h, w = page.shape[:2]
            if w > max_width:
                page = cv2.resize(page, (max_width, int(h * max_width / w)))
            _, buf = cv2.imencode(".jpg", page, [cv2.IMWRITE_JPEG_QUALITY, 85])
            result.append(buf.tobytes())
        if len(result) >= max_images:
            break
    log.info("scan_jpegs prepared count=%d", len(result))
    return result


def _load_pages(file_bytes: bytes, filename: str) -> list[np.ndarray]:
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        pil_pages = convert_from_bytes(file_bytes, dpi=200)
        return [_pil_to_cv2(p) for p in pil_pages]
    arr = np.frombuffer(file_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return [img] if img is not None else []


def _pil_to_cv2(pil_img: Image.Image) -> np.ndarray:
    return cv2.cvtColor(np.array(pil_img.convert("RGB")), cv2.COLOR_RGB2BGR)
