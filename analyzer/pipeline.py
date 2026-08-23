"""Shot detection and character matching pipeline."""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Callable

import cv2
import numpy as np
from scenedetect import SceneManager, open_video
from scenedetect.detectors import ContentDetector

from face_engine import DEFAULT_MATCH_THRESHOLD, FaceEngine


ProgressCb = Callable[[dict[str, Any]], None]


def probe_video(path: str) -> dict[str, Any]:
    cmd = [
        "ffprobe",
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        path,
    ]
    raw = subprocess.check_output(cmd, text=True)
    data = json.loads(raw)
    video_stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
    duration = float(data.get("format", {}).get("duration") or video_stream.get("duration") or 0)
    fps_raw = video_stream.get("avg_frame_rate") or video_stream.get("r_frame_rate") or "24/1"
    if "/" in fps_raw:
        num, den = fps_raw.split("/", 1)
        fps = float(num) / max(float(den), 1e-6)
    else:
        fps = float(fps_raw or 24)
    return {
        "duration": duration,
        "fps": fps,
        "width": int(video_stream.get("width") or 0),
        "height": int(video_stream.get("height") or 0),
        "codec": video_stream.get("codec_name"),
        "format": data.get("format", {}).get("format_name"),
    }


def detect_shots(video_path: str, threshold: float = 27.0) -> list[dict[str, float]]:
    video = open_video(video_path)
    scene_manager = SceneManager()
    scene_manager.add_detector(ContentDetector(threshold=threshold))
    scene_manager.detect_scenes(video)
    scenes = scene_manager.get_scene_list()
    shots: list[dict[str, float]] = []
    for i, (start, end) in enumerate(scenes):
        shots.append(
            {
                "index": i,
                "start": start.get_seconds(),
                "end": end.get_seconds(),
            }
        )
    if not shots:
        info = probe_video(video_path)
        shots.append({"index": 0, "start": 0.0, "end": info["duration"]})
    return shots


def _extract_frame_at(video_path: str, time_sec: float) -> np.ndarray | None:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return None
    cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, time_sec) * 1000.0)
    ok, frame = cap.read()
    cap.release()
    if not ok or frame is None:
        return None
    return frame


def _sample_times(start: float, end: float, max_samples: int = 3) -> list[float]:
    dur = max(0.0, end - start)
    if dur <= 0.05:
        return [start]
    if max_samples <= 1:
        return [start + dur * 0.5]
    return [start + dur * (i + 1) / (max_samples + 1) for i in range(max_samples)]


def analyze_character(
    video_path: str,
    gallery_embeddings: list[list[float]],
    *,
    buffer_sec: float = 0.4,
    match_threshold: float = DEFAULT_MATCH_THRESHOLD,
    merge_gap_sec: float = 1.0,
    progress: ProgressCb | None = None,
) -> dict[str, Any]:
    def report(stage: str, **kwargs: Any) -> None:
        if progress:
            progress({"stage": stage, **kwargs})

    report("probe", percent=2)
    info = probe_video(video_path)

    report("shots", percent=8)
    shots = detect_shots(video_path)
    report("shots_done", percent=15, shot_count=len(shots))

    engine = FaceEngine()
    gallery = [np.asarray(e, dtype=np.float32) for e in gallery_embeddings]

    candidates: list[dict[str, Any]] = []
    total = max(len(shots), 1)

    for i, shot in enumerate(shots):
        best = 0.0
        hit = False
        for t in _sample_times(shot["start"], shot["end"], max_samples=3):
            frame = _extract_frame_at(video_path, t)
            if frame is None:
                continue
            # Downscale for speed on long 4K sources
            h, w = frame.shape[:2]
            scale = 720.0 / max(h, 1)
            if scale < 1.0:
                frame = cv2.resize(frame, (int(w * scale), int(h * scale)))
            faces = engine.detect_and_embed(frame)
            for face in faces:
                score = engine.match_score(face["embedding"], gallery)
                best = max(best, score)
                if score >= match_threshold:
                    hit = True
        if hit:
            start = max(0.0, shot["start"] - buffer_sec)
            end = min(info["duration"], shot["end"] + buffer_sec)
            candidates.append(
                {
                    "shot_index": shot["index"],
                    "start": start,
                    "end": end,
                    "score": round(best, 4),
                    "source": "face_match",
                }
            )
        report(
            "matching",
            percent=15 + int(80 * (i + 1) / total),
            current_shot=i + 1,
            total_shots=total,
            candidate_count=len(candidates),
        )

    merged = _merge_segments(candidates, merge_gap_sec=merge_gap_sec)
    report("done", percent=100, candidate_count=len(merged))
    return {
        "video": info,
        "shot_count": len(shots),
        "segments": merged,
        "threshold": match_threshold,
        "buffer_sec": buffer_sec,
    }


def _merge_segments(segments: list[dict[str, Any]], merge_gap_sec: float) -> list[dict[str, Any]]:
    if not segments:
        return []
    ordered = sorted(segments, key=lambda s: s["start"])
    merged: list[dict[str, Any]] = [dict(ordered[0])]
    for seg in ordered[1:]:
        last = merged[-1]
        if seg["start"] <= last["end"] + merge_gap_sec:
            last["end"] = max(last["end"], seg["end"])
            last["score"] = max(last["score"], seg["score"])
            last["shot_index"] = last.get("shot_index", seg["shot_index"])
        else:
            merged.append(dict(seg))
    for i, seg in enumerate(merged):
        seg["id"] = f"ai-{i + 1}"
        seg["duration"] = round(seg["end"] - seg["start"], 3)
    return merged


def enroll_from_image(
    image_path: str,
    box: list[int] | None = None,
) -> dict[str, Any]:
    from face_engine import FaceEngine, crop_face_preview, load_image

    engine = FaceEngine()
    image = load_image(image_path)
    faces = engine.detect_and_embed(image)
    if not faces:
        raise ValueError("未在画面中检测到人脸，请换一帧或放大后再试")

    chosen = None
    if box is not None:
        bx, by, bw, bh = box
        target_cx, target_cy = bx + bw / 2, by + bh / 2
        best_dist = 1e18
        for face in faces:
            x, y, w, h = face["box"]
            cx, cy = x + w / 2, y + h / 2
            dist = (cx - target_cx) ** 2 + (cy - target_cy) ** 2
            if dist < best_dist:
                best_dist = dist
                chosen = face
    else:
        chosen = max(faces, key=lambda f: f["box"][2] * f["box"][3])

    assert chosen is not None
    preview = crop_face_preview(image, chosen["box"])
    ok, buf = cv2.imencode(".jpg", preview, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    if not ok:
        raise RuntimeError("人脸预览编码失败")

    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        tmp.write(buf.tobytes())
        preview_path = tmp.name

    return {
        "box": chosen["box"],
        "score": chosen["score"],
        "embedding": chosen["embedding"].astype(float).tolist(),
        "preview_path": preview_path,
        "all_faces": [{"box": f["box"], "score": f["score"]} for f in faces],
    }


def detect_faces_in_image(image_path: str) -> list[dict[str, Any]]:
    from face_engine import FaceEngine, load_image

    engine = FaceEngine()
    image = load_image(image_path)
    faces = engine.detect(image)
    return faces


def export_segments(
    video_path: str,
    segments: list[dict[str, Any]],
    output_dir: str,
) -> list[dict[str, Any]]:
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []
    for seg in segments:
        name = seg.get("filename") or f"clip_{seg.get('id', 'x')}.mp4"
        # sanitize
        safe = "".join(c if c not in '<>:"/\\|?*' else "_" for c in name)
        if not safe.lower().endswith(".mp4"):
            safe += ".mp4"
        dest = out_dir / safe
        start = float(seg["start"])
        end = float(seg["end"])
        duration = max(0.05, end - start)
        cmd = [
            "ffmpeg",
            "-y",
            "-ss",
            f"{start:.3f}",
            "-i",
            video_path,
            "-t",
            f"{duration:.3f}",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "18",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            str(dest),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        results.append(
            {
                "id": seg.get("id"),
                "path": str(dest),
                "ok": proc.returncode == 0,
                "stderr": proc.stderr[-2000:] if proc.returncode != 0 else "",
            }
        )
    return results
