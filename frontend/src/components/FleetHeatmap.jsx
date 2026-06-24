/**
 * FleetHeatmap.jsx — AETHER ACM v3 (ResizeObserver fix)
 *
 * Fix applied: canvas dimensions are set ONCE via ResizeObserver so that
 * ctx.clearRect() + ctx.setTransform() is used inside the draw loop — NOT
 * canvas.width/height.  Setting canvas.width/height inside a snapshot-driven
 * useEffect re-runs on every 1-second poll, forcing a context reset and
 * visible per-second flash on all 100+ satellite rows.
 *
 * Fleet-wide heatmap showing three metrics per satellite:
 *  - Fuel level (green → yellow → red bar)
 *  - Risk level (from active CDM warnings / satellite status)
 *  - Efficiency score (ΔV spent vs collisions avoided ratio)
 *
 * Sorted by risk priority (COLLISION first, DEAD last).
 */

import { useEffect, useRef } from 'react';
import { fuelColor } from '../lib/geoUtils';

const RISK_ORDER = {
  COLLISION: 0, CRITICAL: 1, WARNING: 2,
  EVASION: 3, RECOVERY: 4, NOMINAL: 5, GRAVEYARD: 6, DEAD: 7,
};

function riskColor(sat, cdmWarnings) {
  const worst = cdmWarnings
    .filter(w => w.sat_id === sat.id)
    .sort((a, b) => (RISK_ORDER[a.severity] ?? 9) - (RISK_ORDER[b.severity] ?? 9))[0];
  if (!worst) {
    if (sat.status === 'EVASION')   return '#a55eea';
    if (sat.status === 'RECOVERY')  return '#ffd32a';
    if (sat.status === 'GRAVEYARD') return '#576574';
    if (sat.status === 'DEAD')      return '#ff4757';
    return '#00e5a0';
  }
  if (worst.severity === 'COLLISION') return '#ff0020';
  if (worst.severity === 'CRITICAL')  return '#ff4757';
  return '#ffd32a';
}

function efficiencyScore(sat) {
  // Higher CA-per-ΔV = better efficiency. Normalize 0–100.
  const dv = sat.total_dv_kmps || 0;
  const ca = sat.collisions_avoided || 0;
  if (dv === 0 && ca === 0) return 100;
  if (dv === 0) return 100;
  const rawScore = ca / (dv + 0.001) * 0.5;
  return Math.min(100, rawScore * 100);
}

function effColor(score) {
  if (score > 70) return '#20b4ff';
  if (score > 40) return '#ffd32a';
  return '#ff4757';
}

export default function FleetHeatmap({ snapshot }) {
  const canvasRef   = useRef(null);
  const snapshotRef = useRef(snapshot);

  // Keep ref in sync — draw function reads from ref, never from stale closure
  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);

  // ── Size canvas ONCE and only when the DOM element resizes ───────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function sizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      const W   = canvas.offsetWidth;
      const H   = canvas.offsetHeight;
      if (canvas.width  !== Math.round(W * dpr) ||
          canvas.height !== Math.round(H * dpr)) {
        canvas.width  = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      }
    }

    const ro = new ResizeObserver(sizeCanvas);
    ro.observe(canvas);
    sizeCanvas();
    return () => ro.disconnect();
  }, []);

  // ── Redraw on every snapshot update using clearRect (no canvas resize) ───
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !snapshot?.satellites) return;

    const dpr = window.devicePixelRatio || 1;
    const ctx  = canvas.getContext('2d');
    const w    = canvas.width  / dpr;
    const h    = canvas.height / dpr;

    // Restore DPR scaling without resetting canvas dimensions
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#070d17';
    ctx.fillRect(0, 0, w, h);

    const sats = [...snapshot.satellites].sort((a, b) =>
      (RISK_ORDER[a.status] ?? 5) - (RISK_ORDER[b.status] ?? 5)
    );
    const cdms = snapshot.cdm_warnings || [];
    const n = sats.length;
    if (n === 0) return;

    // 3 columns: Fuel | Risk | Efficiency
    const COLS    = 3;
    const PAD     = 4;
    const LABEL_W = 70;
    const COL_H   = Math.max(14, Math.min(22, (h - 28) / n));
    const COL_W   = (w - LABEL_W - PAD * 2) / COLS;

    // Column headers
    const headers = ['FUEL', 'RISK', 'EFFICIENCY'];
    headers.forEach((hdr, ci) => {
      ctx.font      = '600 8px Inter, sans-serif';
      ctx.fillStyle = 'rgba(32,180,255,0.6)';
      ctx.textAlign = 'center';
      ctx.fillText(hdr, LABEL_W + PAD + ci * COL_W + COL_W / 2, 12);
    });

    sats.forEach((sat, ri) => {
      const y = 18 + ri * COL_H;
      if (y + COL_H > h) return;

      // Sat label
      ctx.font      = '9px JetBrains Mono, monospace';
      ctx.fillStyle = 'rgba(200,216,232,0.55)';
      ctx.textAlign = 'right';
      ctx.fillText(sat.id.slice(-10), LABEL_W - 4, y + COL_H / 2 + 3);

      // ── Column 0: Fuel bar ──────────────────────────────────────────────
      const fc    = fuelColor(sat.fuel_pct ?? 100);
      const barW0 = Math.max(2, ((sat.fuel_pct ?? 100) / 100) * (COL_W - 4));
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(LABEL_W + PAD, y + 2, COL_W - 4, COL_H - 4);
      ctx.fillStyle = fc + 'cc';
      ctx.fillRect(LABEL_W + PAD, y + 2, barW0, COL_H - 4);
      ctx.font      = '7px JetBrains Mono';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(
        `${(sat.fuel_pct ?? 100).toFixed(0)}%`,
        LABEL_W + PAD + (COL_W - 4) / 2,
        y + COL_H / 2 + 2.5
      );

      // ── Column 1: Risk ──────────────────────────────────────────────────
      const rc = riskColor(sat, cdms);
      ctx.fillStyle   = rc + '33';
      ctx.fillRect(LABEL_W + PAD + COL_W, y + 2, COL_W - 4, COL_H - 4);
      ctx.strokeStyle = rc + '99';
      ctx.lineWidth   = 1;
      ctx.strokeRect(LABEL_W + PAD + COL_W + 0.5, y + 2.5, COL_W - 5, COL_H - 5);
      ctx.font      = '7px Inter, sans-serif';
      ctx.fillStyle = rc;
      ctx.textAlign = 'center';
      ctx.fillText(
        sat.status,
        LABEL_W + PAD + COL_W + (COL_W - 4) / 2,
        y + COL_H / 2 + 2.5
      );

      // ── Column 2: Efficiency ────────────────────────────────────────────
      const eff   = efficiencyScore(sat);
      const ec    = effColor(eff);
      const barW2 = Math.max(2, (eff / 100) * (COL_W - 4));
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(LABEL_W + PAD + 2 * COL_W, y + 2, COL_W - 4, COL_H - 4);
      ctx.fillStyle = ec + '88';
      ctx.fillRect(LABEL_W + PAD + 2 * COL_W, y + 2, barW2, COL_H - 4);
      ctx.font      = '7px JetBrains Mono';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(
        `${eff.toFixed(0)}`,
        LABEL_W + PAD + 2 * COL_W + (COL_W - 4) / 2,
        y + COL_H / 2 + 2.5
      );
    });
  }, [snapshot]);

  return (
    <div className="heatmap-wrap">
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%' }}
        aria-label="Fleet heatmap showing fuel, risk, and efficiency per satellite"
      />
    </div>
  );
}
