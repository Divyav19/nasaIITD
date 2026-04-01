"""POST /api/telemetry — Ingest high-volume orbital telemetry objects."""

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


@router.post("/telemetry", response_model=TelemetryResponse)
async def ingest_telemetry(payload: TelemetryRequest):
    """
    Ingest a batch of orbital objects (satellites and/or debris).
    Updates or creates records in the simulation state.
    """
    engine = get_engine()

    raw_objects = []
    for obj in payload.objects:
        raw_objects.append({
            "id": obj.id,
            "type": obj.type,
            "r": {"x": obj.r.x, "y": obj.r.y, "z": obj.r.z},
            "v": {"x": obj.v.x, "y": obj.v.y, "z": obj.v.z},
        })

    count = engine.ingest_telemetry(raw_objects, payload.timestamp)
    cdm_count = engine.last_report.active_cdm_count() if engine.last_report else 0

    return TelemetryResponse(
        status="ACK",
        processed_count=count,
        active_cdm_warnings=cdm_count,
    )
