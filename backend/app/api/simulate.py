"""POST /api/simulate/step — Advance the simulation by N seconds."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..simulation.engine import get_engine

router = APIRouter()


class StepRequest(BaseModel):
    step_seconds: float = Field(default=3600.0, gt=0, le=86400)


class StepResponse(BaseModel):
    status: str
    new_timestamp: str
    collisions_detected: int
    maneuvers_executed: int
    active_cdm_warnings: int


@router.post("/simulate/step", response_model=StepResponse)
async def simulate_step(payload: StepRequest):
    """
    Advance simulation time by step_seconds.

    Internally:
      1. Executes all due burns
      2. Propagates all objects (RK4 + J2)
      3. Runs KD-Tree conjunction detection
      4. Auto-schedules evasion burns for critical conjunctions
    """
    engine = get_engine()
    result = engine.step(payload.step_seconds)

    return StepResponse(
        status=result["status"],
        new_timestamp=result["new_timestamp"],
        collisions_detected=result["collisions_detected"],
        maneuvers_executed=result["maneuvers_executed"],
        active_cdm_warnings=result.get("active_cdm_warnings", 0),
    )
