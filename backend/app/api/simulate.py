"""
POST /api/simulate/step — Advance the simulation by N seconds.

The heavy RK4 propagation loop (50+ sats, 10 k+ debris) is dispatched
to a thread via asyncio.to_thread so the ASGI event loop never blocks.
The WebSocket push stream and HTTP requests remain responsive during
long step operations.
"""

import asyncio
from fastapi import APIRouter
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

    Steps (all executed in a thread pool — non-blocking):
      1. Execute all due burns (Tsiolkovsky fuel deduction)
      2. Propagate all objects via RK4 + J2 perturbation
      3. Run KD-Tree conjunction detection  O((N+M) log N)
      4. Auto-schedule evasion + recovery burns for CRITICAL conjunctions
      5. Check graveyard trigger (fuel ≤ 5%)
    """
    engine = get_engine()

    # Dispatch CPU-bound physics to a thread pool so the event loop stays free.
    # asyncio.to_thread wraps the sync call and awaits completion without blocking.
    result = await asyncio.to_thread(engine.step, payload.step_seconds)

    return StepResponse(
        status=result["status"],
        new_timestamp=result["new_timestamp"],
        collisions_detected=result["collisions_detected"],
        maneuvers_executed=result["maneuvers_executed"],
        active_cdm_warnings=result.get("active_cdm_warnings", 0),
    )

