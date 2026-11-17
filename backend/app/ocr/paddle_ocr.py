from __future__ import annotations

import numpy as np
from threading import RLock

_ocr = None
_lock = RLock()


def get_ocr():
    # imported lazily: paddle is heavy, and the rest of the site must start even if it cannot load
    global _ocr
    with _lock:
        if _ocr is None:
            from paddleocr import PaddleOCR
            _ocr = PaddleOCR(use_angle_cls=True, lang="ru", show_log=False)
    return _ocr


def recognize(img: np.ndarray) -> tuple[str, float]:
    # The shared Paddle predictor and its initial model downloads are not thread-safe.
    with _lock:
        result = get_ocr().ocr(img, cls=True)
    if not result or not result[0]:
        return "", 0.0
    lines = result[0]
    texts = [line[1][0] for line in lines]
    confs = [line[1][1] for line in lines]
    return "\n".join(texts), sum(confs) / len(confs)
