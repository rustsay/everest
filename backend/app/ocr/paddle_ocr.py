import numpy as np
from paddleocr import PaddleOCR

_ocr: PaddleOCR | None = None


def get_ocr() -> PaddleOCR:
    global _ocr
    if _ocr is None:
        _ocr = PaddleOCR(use_angle_cls=True, lang="ru", show_log=False)
    return _ocr


def recognize(img: np.ndarray) -> tuple[str, float]:
    result = get_ocr().ocr(img, cls=True)
    if not result or not result[0]:
        return "", 0.0
    lines = result[0]
    texts = [line[1][0] for line in lines]
    confs = [line[1][1] for line in lines]
    return "\n".join(texts), sum(confs) / len(confs)
