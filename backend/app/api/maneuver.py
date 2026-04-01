"""POST /api/maneuver/schedule — Schedule a maneuver sequence for a satellite."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import datetime
from typing import Optional
import numpy as np

from ..simulation.engine import get_engine

router = APIRouter()


class DeltaVVector(BaseModel):
    x: float
    y: float
    z: float


class BurnCommand(BaseModel):
    burn_id: str
    burnTime: datetime
    deltaV_vector: DeltaVVector


class ManeuverRequest(BaseModel):
    satelliteId: str
    maneuver_sequence: list[BurnCommand]


class ValidationResult(BaseModel):
    ground_station_los: bool
    sufficient_fuel: bool
    projected_mass_remaining_kg: float


class ManeuverResponse(BaseModel):
    status: str
    validation: ValidationResult
    reason: Optional[str] = None


@router.post("/maneuver/schedule", response_model=ManeuverResponse, status_code=202)
async def schedule_maneuver(payload: ManeuverRequest):
    """
    Validate and schedule a maneuver sequence for a satellite.

    Validates:
      - Ground station LOS at upload time
      - Signal delay (burn_time >= sim_time + 10s)
      - 600s thermal cooldown between burns
      - ΔV ≤ 15 m/s per burn
      - Sufficient propellant
    """
    engine = get_engine()

    burn_sequence = []
    for burn in payload.maneuver_sequence:
        dv = burn.deltaV_vector
        dv_eci = np.array([dv.x, dv.y, dv.z], dtype=float)
        burn_sequence.append({
            "burn_id": burn.burn_id,
            "burn_time": burn.burnTime,
            "dv_eci": dv_eci,
        })

    result = engine.schedule_maneuver(
        sat_id=payload.satelliteId,
        burn_sequence=burn_sequence,
    )

    if result["status"] == "REJECTED" and result.get("reason") == f"Unknown satellite {payload.satelliteId}":
        raise HTTPException(status_code=404, detail=f"Satellite {payload.satelliteId} not found")

    val = result["validation"]
    return ManeuverResponse(
        status=result["status"],
        validation=ValidationResult(
            ground_station_los=val["ground_station_los"],
            sufficient_fuel=val["sufficient_fuel"],
            projected_mass_remaining_kg=val["projected_mass_remaining_kg"],
        ),
        reason=result.get("reason"),
    )
