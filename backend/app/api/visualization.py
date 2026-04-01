"""GET /api/visualization/snapshot — Full state snapshot for the frontend."""

from fastapi import APIRouter
from ..simulation.engine import get_engine

router = APIRouter()


@router.get("/visualization/snapshot")
async def get_snapshot():
    """
    Return a complete visualization snapshot of current simulation state.

    Includes:
      - All satellite positions (lat/lon/alt), fuel, status
      - All debris positions (compressed flat arrays)
      - Active CDM warnings with severity
      - Scheduled burns (for Gantt chart)
      - Global statistics
    """
    engine = get_engine()
    return engine.snapshot()
