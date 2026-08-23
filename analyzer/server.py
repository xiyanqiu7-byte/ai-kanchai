"""Local HTTP API for the Electron desktop app."""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from pipeline import (
    analyze_character,
    detect_faces_in_image,
    enroll_from_image,
    export_segments,
    probe_video,
)

app = FastAPI(title="AI Kanchai Analyzer", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

jobs: dict[str, dict[str, Any]] = {}


class EnrollRequest(BaseModel):
    image_path: str
    box: list[int] | None = None


class AnalyzeRequest(BaseModel):
    video_path: str
    embeddings: list[list[float]]
    buffer_sec: float = 0.4
    match_threshold: float = 0.35
    merge_gap_sec: float = 1.0


class ExportSegment(BaseModel):
    id: str | None = None
    start: float
    end: float
    filename: str


class ExportRequest(BaseModel):
    video_path: str
    output_dir: str
    segments: list[ExportSegment]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/probe")
def probe(path: str) -> dict[str, Any]:
    try:
        return probe_video(path)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, str(exc)) from exc


@app.post("/faces/detect")
def faces_detect(body: EnrollRequest) -> dict[str, Any]:
    try:
        faces = detect_faces_in_image(body.image_path)
        return {"faces": faces}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, str(exc)) from exc


@app.post("/faces/enroll")
def faces_enroll(body: EnrollRequest) -> dict[str, Any]:
    try:
        return enroll_from_image(body.image_path, body.box)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, str(exc)) from exc


@app.post("/analyze")
async def analyze(body: AnalyzeRequest) -> dict[str, str]:
    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "running", "percent": 0, "stage": "queued", "result": None, "error": None}

    def run() -> None:
        try:

            def progress(evt: dict[str, Any]) -> None:
                jobs[job_id].update(
                    {
                        "status": "running",
                        "percent": evt.get("percent", jobs[job_id].get("percent", 0)),
                        "stage": evt.get("stage"),
                        "meta": evt,
                    }
                )

            result = analyze_character(
                body.video_path,
                body.embeddings,
                buffer_sec=body.buffer_sec,
                match_threshold=body.match_threshold,
                merge_gap_sec=body.merge_gap_sec,
                progress=progress,
            )
            jobs[job_id] = {"status": "done", "percent": 100, "stage": "done", "result": result, "error": None}
        except Exception as exc:  # noqa: BLE001
            jobs[job_id] = {
                "status": "error",
                "percent": jobs[job_id].get("percent", 0),
                "stage": "error",
                "result": None,
                "error": str(exc),
            }

    asyncio.create_task(asyncio.to_thread(run))
    return {"job_id": job_id}


@app.get("/analyze/{job_id}")
def analyze_status(job_id: str) -> dict[str, Any]:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    return job


@app.post("/export")
def export(body: ExportRequest) -> dict[str, Any]:
    try:
        results = export_segments(
            body.video_path,
            [s.model_dump() for s in body.segments],
            body.output_dir,
        )
        return {"results": results}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, str(exc)) from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
