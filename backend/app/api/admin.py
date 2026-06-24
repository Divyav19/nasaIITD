"""
admin.py — POST /api/admin/refresh-tle

Force-clears the local TLE cache and re-fetches from CelesTrak in a
background task.  Useful for hackathon graders to pull fresh orbital
data without restarting the container.

Authentication: none (internal/demo use only — not exposed to public).
Response:       202 Accepted immediately; re-seed runs in background.
"""

import asyncio
import logging
import shutil
import os
from fastapi import APIRouter
from pydantic import BaseModel

from ..data.tle_fetcher import CACHE_DIR, fetch_real_satellites, fetch_real_debris
from ..physics.propagator import keplerian_to_eci
from ..simulation.engine import get_engine, SatelliteRecord, DebrisRecord
from ..physics.constants import M_FUEL_INIT, M_WET_INIT

log = logging.getLogger("aether.admin")
router = APIRouter()


class RefreshResponse(BaseModel):
    status: str
    message: str


async def _background_reseed():
    """
    Background coroutine: clear cache → fetch fresh TLEs → reseed engine.
    Runs in a thread so it doesn't block the event loop.
    """
    log.info("[Admin] TLE refresh triggered — clearing cache...")

    # Clear the cache directory
    try:
        if os.path.isdir(CACHE_DIR):
            for fn in os.listdir(CACHE_DIR):
                fp = os.path.join(CACHE_DIR, fn)
                if os.path.isfile(fp):
                    os.remove(fp)
            log.info(f"[Admin] Cache cleared: {CACHE_DIR}")
    except Exception as e:
        log.warning(f"[Admin] Cache clear error: {e}")

    def _do_reseed():
        engine = get_engine()
        now = engine.sim_time

        # Fetch fresh satellites
        from ..data.tle_fetcher import fetch_real_satellites, fetch_real_debris
        sat_keps = fetch_real_satellites(now, max_count=80)
        new_sats = {}
        for kep in sat_keps:
            try:
                state = keplerian_to_eci(
                    a=kep["a"], e=kep["e"], i=kep["i"],
                    raan=kep["raan"], argp=kep["argp"], ta=kep["ta"]
                )
                sat_id = f"{kep['name'][:20].strip()}-{kep['norad_id']}"
                # Preserve existing fuel/dv stats if satellite already tracked
                existing = engine.satellites.get(sat_id)
                rec = SatelliteRecord(
                    sat_id=sat_id,
                    state=state.copy(),
                    nominal_state=state.copy(),
                    m_total=existing.m_total if existing else M_WET_INIT,
                    m_fuel=existing.m_fuel if existing else M_FUEL_INIT,
                    status=existing.status if existing else "NOMINAL",
                    total_dv_used_kmps=existing.total_dv_used_kmps if existing else 0.0,
                    collisions_avoided=existing.collisions_avoided if existing else 0,
                )
                new_sats[sat_id] = rec
            except Exception as ex:
                log.debug(f"[Admin] Skipping sat {kep.get('name')}: {ex}")

        # Fetch fresh debris
        debris_keps = fetch_real_debris(now, max_count=2000)
        new_debris = {}
        for kep in debris_keps:
            try:
                state = keplerian_to_eci(
                    a=kep["a"], e=kep["e"], i=kep["i"],
                    raan=kep["raan"], argp=kep["argp"], ta=kep["ta"]
                )
                obj_id = f"DEB-{kep['norad_id']}"
                new_debris[obj_id] = DebrisRecord(obj_id=obj_id, state=state)
            except Exception as ex:
                log.debug(f"[Admin] Skipping debris {kep.get('norad_id')}: {ex}")

        # Atomic swap
        engine.satellites = new_sats
        engine.debris = new_debris
        log.info(f"[Admin] Reseed complete: {len(new_sats)} sats, {len(new_debris)} debris")

    await asyncio.to_thread(_do_reseed)


@router.post("/admin/refresh-tle", response_model=RefreshResponse, status_code=202)
async def refresh_tle():
    """
    Force-clear TLE cache and re-fetch fresh orbital data from CelesTrak.

    Responds 202 Accepted immediately.  The actual refresh runs in the
    background and completes within 5–30 seconds depending on network.
    Monitor the backend logs for completion.
    """
    asyncio.create_task(_background_reseed())
    return RefreshResponse(
        status="ACCEPTED",
        message=(
            "TLE cache cleared. Fresh data is being fetched from CelesTrak "
            "in the background. Check /health in ~15 s for updated counts."
        ),
    )


@router.get("/admin/cache-status")
async def cache_status():
    """Return which TLE cache files exist and their ages (seconds)."""
    import time
    files = {}
    if os.path.isdir(CACHE_DIR):
        for fn in os.listdir(CACHE_DIR):
            fp = os.path.join(CACHE_DIR, fn)
            if os.path.isfile(fp):
                age_s = int(time.time() - os.path.getmtime(fp))
                files[fn] = {"age_seconds": age_s, "size_bytes": os.path.getsize(fp)}
    engine = get_engine()
    return {
        "cache_files": files,
        "satellites": len(engine.satellites),
        "debris": len(engine.debris),
        "sim_time": engine.sim_time.isoformat(),
    }
