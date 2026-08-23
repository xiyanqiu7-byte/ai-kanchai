"""Face detection + recognition using OpenCV YuNet + SFace."""

from __future__ import annotations

import urllib.request
from pathlib import Path
from typing import Any

import cv2
import numpy as np

MODELS_DIR = Path(__file__).resolve().parent / "models"
YUNET_PATH = MODELS_DIR / "face_detection_yunet_2023mar.onnx"
SFACE_PATH = MODELS_DIR / "face_recognition_sface_2021dec.onnx"

YUNET_URL = (
    "https://github.com/opencv/opencv_zoo/raw/main/models/"
    "face_detection_yunet/face_detection_yunet_2023mar.onnx"
)
SFACE_URL = (
    "https://github.com/opencv/opencv_zoo/raw/main/models/"
    "face_recognition_sface/face_recognition_sface_2021dec.onnx"
)

# Cosine similarity threshold for SFace (higher = stricter). 0.363 is OpenCV default-ish.
DEFAULT_MATCH_THRESHOLD = 0.35


def ensure_models() -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    for path, url in ((YUNET_PATH, YUNET_URL), (SFACE_PATH, SFACE_URL)):
        if path.exists() and path.stat().st_size > 1000:
            continue
        print(f"Downloading face model: {path.name} ...")
        tmp = path.with_suffix(path.suffix + ".part")
        urllib.request.urlretrieve(url, tmp)
        tmp.replace(path)


class FaceEngine:
    def __init__(self, score_threshold: float = 0.6) -> None:
        ensure_models()
        if not YUNET_PATH.exists() or not SFACE_PATH.exists():
            raise FileNotFoundError(
                f"Face models missing. Expected:\n  {YUNET_PATH}\n  {SFACE_PATH}"
            )
        self.score_threshold = score_threshold
        self._detector = cv2.FaceDetectorYN.create(
            str(YUNET_PATH),
            "",
            (320, 320),
            score_threshold,
            0.3,
            5000,
        )
        self._recognizer = cv2.FaceRecognizerSF.create(str(SFACE_PATH), "")

    def detect(self, image_bgr: np.ndarray) -> list[dict[str, Any]]:
        h, w = image_bgr.shape[:2]
        self._detector.setInputSize((w, h))
        _, faces = self._detector.detect(image_bgr)
        if faces is None:
            return []
        results: list[dict[str, Any]] = []
        for face in faces:
            box = face[:4].astype(int).tolist()  # x, y, w, h
            score = float(face[-1])
            results.append({"box": box, "score": score, "landmarks": face[4:14].tolist()})
        return results

    def embed(self, image_bgr: np.ndarray, face_row: np.ndarray | list[float]) -> np.ndarray:
        face = np.asarray(face_row, dtype=np.float32)
        aligned = self._recognizer.alignCrop(image_bgr, face)
        feature = self._recognizer.feature(aligned)
        return np.asarray(feature).reshape(-1)

    def detect_and_embed(self, image_bgr: np.ndarray) -> list[dict[str, Any]]:
        h, w = image_bgr.shape[:2]
        self._detector.setInputSize((w, h))
        _, faces = self._detector.detect(image_bgr)
        if faces is None:
            return []
        out: list[dict[str, Any]] = []
        for face in faces:
            emb = self.embed(image_bgr, face)
            out.append(
                {
                    "box": face[:4].astype(int).tolist(),
                    "score": float(face[-1]),
                    "embedding": emb,
                }
            )
        return out

    @staticmethod
    def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
        a = a.reshape(-1).astype(np.float32)
        b = b.reshape(-1).astype(np.float32)
        denom = float(np.linalg.norm(a) * np.linalg.norm(b))
        if denom < 1e-8:
            return 0.0
        return float(np.dot(a, b) / denom)

    def match_score(self, probe: np.ndarray, gallery: list[np.ndarray]) -> float:
        if not gallery:
            return 0.0
        return max(self.cosine_similarity(probe, g) for g in gallery)


def load_image(path: str | Path) -> np.ndarray:
    data = np.fromfile(str(path), dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"Cannot read image: {path}")
    return img


def crop_face_preview(image_bgr: np.ndarray, box: list[int], pad: float = 0.25) -> np.ndarray:
    x, y, w, h = box
    ih, iw = image_bgr.shape[:2]
    px, py = int(w * pad), int(h * pad)
    x1 = max(0, x - px)
    y1 = max(0, y - py)
    x2 = min(iw, x + w + px)
    y2 = min(ih, y + h + py)
    return image_bgr[y1:y2, x1:x2]
