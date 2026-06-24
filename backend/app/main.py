"""
main.py — FastAPI application entry point for Project AETHER ACM.
Binds to 0.0.0.0:8000 for Docker grading compatibility.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
import os
import logging

# Enable informational logging so TLE fetch progress is visible in console
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)

from .api import telemetry, maneuver, simulate, visualization, insight, ws_stream, admin
from .simulation.engine import get_engine

# ─── App Initialization ────────────────────────────────────────────────────────

app = FastAPI(
    title="Project AETHER — Autonomous Constellation Manager",
    description=(
        "High-performance orbital mechanics simulation engine featuring "
        "J2-perturbed RK4 propagation, KD-Tree conjunction detection (sub-O(N²)), "
        "and autonomous evasion maneuver scheduling."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ─── CORS ─────────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],       # Permit frontend dev server + Docker access
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── GZip Compression ─────────────────────────────────────────────────────────
# Compresses debris cloud tuple-arrays and other large JSON payloads.
# At 10k debris objects, uncompressed snapshot ≈ 4 MB → compressed ≈ 600 KB.
from fastapi.middleware.gzip import GZipMiddleware
app.add_middleware(GZipMiddleware, minimum_size=500)


# ─── API Routers ──────────────────────────────────────────────────────────────

app.include_router(telemetry.router,     prefix="/api", tags=["Telemetry"])
app.include_router(maneuver.router,      prefix="/api", tags=["Maneuver"])
app.include_router(simulate.router,      prefix="/api", tags=["Simulation"])
app.include_router(visualization.router, prefix="/api", tags=["Visualization"])
app.include_router(insight.router,       prefix="/api", tags=["Insight"])
app.include_router(ws_stream.router,     prefix="/api", tags=["WebSocket"])  # WS push stream
app.include_router(admin.router,         prefix="/api", tags=["Admin"])       # TLE refresh

# ─── Serve Frontend Build (Docker / production mode) ─────────────────────────

STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
if os.path.isdir(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        index = os.path.join(STATIC_DIR, "index.html")
        return FileResponse(index)

# ─── Root & Health (always available) ────────────────────────────────────────

@app.get("/", include_in_schema=False, tags=["Meta"])
async def root():
    """
    API root — returns system status and guide.
    In Docker, the React SPA is served here instead.
    """
    engine = get_engine()
    return JSONResponse({
        "project": "AETHER — Autonomous Constellation Manager",
        "version": "1.0.0",
        "status": "RUNNING",
        "note": "Open the frontend at http://localhost:5173 (dev) or via Docker on :8000",
        "api_docs": "http://localhost:8000/docs",
        "simulation": {
            "sim_time":   engine.sim_time.isoformat(),
            "satellites": len(engine.satellites),
            "debris":     len(engine.debris),
        },
        "endpoints": {
            "POST /api/telemetry":              "Ingest orbital telemetry objects",
            "POST /api/maneuver/schedule":      "Schedule satellite maneuver sequence",
            "POST /api/simulate/step":          "Advance simulation by N seconds",
            "GET  /api/visualization/snapshot": "Full visualization state snapshot",
        },
    })


@app.get("/health", tags=["Meta"])
async def health():
    engine = get_engine()
    return {
        "status": "OK",
        "sim_time": engine.sim_time.isoformat(),
        "satellites": len(engine.satellites),
        "debris": len(engine.debris),
    }

# ─── Startup ──────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup_event():
    """Initialize the simulation engine on startup."""
    engine = get_engine()
    print(f"[AETHER ACM] Engine ready.")
    print(f"  Satellites : {len(engine.satellites)}")
    print(f"  Debris     : {len(engine.debris)}")
    print(f"  Sim time   : {engine.sim_time.isoformat()}")
    print(f"  API docs   : http://localhost:8000/docs")
    print(f"  Frontend   : http://localhost:5173  (dev mode)")
