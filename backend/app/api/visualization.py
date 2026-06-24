"""GET /api/visualization/snapshot — Full state snapshot, GZip-compressed."""

import asyncio
from fastapi import APIRouter
from ..simulation.engine import get_engine

router = APIRouter()


@router.get(
    "/visualization/snapshot",
    responses={200: {"description": "GZip-compressed JSON snapshot (tuple-array debris cloud)"}},
)
async def get_snapshot():
    """
    Return a complete, GZip-compressed visualization snapshot.

    Debris cloud returned as flat tuple-arrays [id, lat, lon, alt_km] for
    minimal wire size.  GZip applied automatically via GZipMiddleware
    configured in main.py (threshold=500 bytes).

    ECI→LLA conversion work for all objects dispatched to a thread pool
    so the ASGI event loop stays non-blocking during large fleets.
    """
    engine = get_engine()
    snap = await asyncio.to_thread(engine.snapshot)
    return snap
