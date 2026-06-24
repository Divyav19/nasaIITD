FROM ubuntu:22.04

# ═══════════════════════════════════════════════════════════════════
# Project AETHER — Autonomous Constellation Manager
# Docker image: ubuntu:22.04 | Port: 8000 (0.0.0.0)
# ═══════════════════════════════════════════════════════════════════

# ── Avoid interactive prompts ──────────────────────────────────────
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# ── System dependencies ────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-dev \
    python3-pip \
    curl \
    ca-certificates \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# ── Node.js 20 LTS (for frontend build) ───────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ── Set python3.11 as default ─────────────────────────────────────
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 \
    && update-alternatives --install /usr/bin/python  python  /usr/bin/python3.11 1

# ── Working directory ──────────────────────────────────────────────
WORKDIR /app

# ── Install Python dependencies ────────────────────────────────────
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip3 install --no-cache-dir -r backend/requirements.txt

# ── Build React frontend ───────────────────────────────────────────
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci --silent

COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# ── Copy backend source ────────────────────────────────────────────
COPY backend/ ./backend/

# ── Expose port ────────────────────────────────────────────────────
EXPOSE 8000

# ── Launch FastAPI server on 0.0.0.0:8000 ─────────────────────────
CMD ["python3", "-m", "uvicorn", "backend.app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1", \
     "--log-level", "info"]
