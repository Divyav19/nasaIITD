"""POST /api/telemetry — Async ingest of high-volume orbital telemetry objects."""

import asyncio
from fastapi import APIRouter
from pydantic import BaseModel
from datetime import datetime
from typing import Literal

from ..simulation.engine import get_engine

router = APIRouter()


class Vector3(BaseModel):
    x: float
    y: float
    z: float


class TelemetryObject(BaseModel):
    id: str
    type: Literal["SATELLITE", "DEBRIS"] = "DEBRIS"
    r: Vector3
    v: Vector3


class TelemetryRequest(BaseModel):
    timestamp: datetime
    objects: list[TelemetryObject]


class TelemetryResponse(BaseModel):
    status: str
    processed_count: int
    active_cdm_warnings: int


@router.post("/telemetry", response_model=TelemetryResponse, status_code=202)
async def ingest_telemetry(payload: TelemetryRequest):
    """
    Asynchronously ingest a batch of orbital objects (satellites and/or debris).

    CPU-bound bulk state update dispatched to a thread pool via asyncio.to_thread
    so the ASGI event loop and WebSocket push stream remain unblocked even during
    10,000+ object batches.  Returns HTTP 202 Accepted.
    """
    engine = get_engine()

    raw_objects = [
        {
            "id":   obj.id,
            "type": obj.type,
            "r":    {"x": obj.r.x, "y": obj.r.y, "z": obj.r.z},
            "v":    {"x": obj.v.x, "y": obj.v.y, "z": obj.v.z},
        }
        for obj in payload.objects
    ]

    # Dispatch the bulk state-update loop to thread — non-blocking
    count = await asyncio.to_thread(engine.ingest_telemetry, raw_objects, payload.timestamp)
    cdm_count = engine.last_report.active_cdm_count() if engine.last_report else 0

    return TelemetryResponse(
        status="ACK",
        processed_count=count,
        active_cdm_warnings=cdm_count,
    )
