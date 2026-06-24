"""
ws_stream.py — WebSocket push stream for Project AETHER ACM.

Endpoint: GET /api/ws/snapshot

Clients connect once via WebSocket and receive the full visualization
snapshot every PUSH_INTERVAL_S seconds.  This is a parallel transport
alongside the HTTP GET /api/visualization/snapshot polling route.

Protocol:
  Server → Client:  JSON-encoded snapshot dict (identical schema to REST)
  Client → Server:  Any message is silently ignored (read-only stream)
  Disconnect:       Server sets connected=False and exits cleanly

Performance:
  - asyncio.to_thread isolates the snapshot() CPU work from the event loop.
  - Each connection spawns its own push loop; no shared state needed.
  - On disconnect (WebSocketDisconnect) the coroutine ends gracefully.
"""

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..simulation.engine import get_engine

log = logging.getLogger("aether.ws_stream")

router = APIRouter()

# Push interval in seconds — 1 s matches the existing HTTP poll rate.
# Lower (e.g. 0.5) for faster UI updates at the cost of more CPU.
PUSH_INTERVAL_S: float = 1.0


@router.websocket("/ws/snapshot")
async def ws_snapshot(websocket: WebSocket):
    """
    Real-time snapshot WebSocket stream.

    Connect with:
        ws://localhost:8000/api/ws/snapshot

    Every PUSH_INTERVAL_S seconds the server serializes the current
    simulation state and sends it as a UTF-8 JSON string.
    """
    await websocket.accept()
    client = websocket.client
    log.info(f"[WS] Client connected: {client}")

    try:
        while True:
            # ── Build snapshot in a thread so we don't block the event loop ──
            engine = get_engine()
            snap = await asyncio.to_thread(engine.snapshot)

            # ── Serialize and send ──────────────────────────────────────────
            payload = json.dumps(snap, default=str)
            await websocket.send_text(payload)

            # ── Yield to event loop, then push again ───────────────────────
            await asyncio.sleep(PUSH_INTERVAL_S)

    except WebSocketDisconnect:
        log.info(f"[WS] Client disconnected: {client}")
    except Exception as exc:
        log.warning(f"[WS] Unexpected error for {client}: {exc}")
        try:
            await websocket.close(code=1011)
        except Exception:
            pass
