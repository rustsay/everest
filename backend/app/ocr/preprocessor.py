import cv2
import numpy as np


def preprocess(img: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = _deskew(gray)
    gray = _enhance_contrast(gray)
    gray = _remove_ruled_lines(gray)
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)


def _deskew(gray: np.ndarray) -> np.ndarray:
    coords = np.column_stack(np.where(gray < 128))
    if len(coords) < 10:
        return gray
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = 90 + angle
    if abs(angle) < 0.5:
        return gray
    h, w = gray.shape
    M = cv2.getRotationMatrix2D((w / 2, h / 2), -angle, 1.0)
    return cv2.warpAffine(
        gray, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )


def _enhance_contrast(gray: np.ndarray) -> np.ndarray:
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return clahe.apply(gray)


def _remove_ruled_lines(gray: np.ndarray) -> np.ndarray:
    binary = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 15, 10
    )
    kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT, (max(gray.shape[1] // 30, 40), 1)
    )
    h_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel, iterations=2)
    return cv2.inpaint(gray, h_lines, 3, cv2.INPAINT_TELEA)
