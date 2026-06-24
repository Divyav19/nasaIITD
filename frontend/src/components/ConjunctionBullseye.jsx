/**
 * ConjunctionBullseye.jsx — AETHER ACM v3  (RAF-correct implementation)
 *
 * Fix applied: canvas dimensions are set ONCE via ResizeObserver so that
 * context.clearRect() is used inside the draw loop — NOT canvas.width/height.
 * Setting canvas.width/height inside a RAF loop clears the canvas AND resets
 * the 2D context transform every frame, causing a completely blank display.
 *
 * Polar "Bullseye" CDM chart per hackathon spec:
 *   - Centre = selected satellite
 *   - Radial axis = miss distance (km) on a log scale
 *   - Colour rings: Green > 5km | Yellow 1–5km | Red < 1km | White < 0.1km
 *   - Each threat plotted at (miss_distance_km, deterministic_angle)
 *   - CRITICAL threats animate with a pulsing ring
 *   - Connector lines + miss-distance labels per threat
 *   - No DOM elements — pure Canvas2D (60 FPS capable)
 */

import { useEffect, useRef } from 'react';

// Risk ring boundaries (km) — outer to inner for z-order
const RINGS = [
  { km: 50.0, color: '#00e5a0', label: '50 km',   alpha: '20' },
  { km:  5.0, color: '#ffd32a', label: '5 km',    alpha: '28' },
  { km:  1.0, color: '#ff4757', label: '1 km',    alpha: '30' },
  { km:  0.1, color: '#ffffff', label: '0.1 km',  alpha: '45' },
];

const SEV_COLOR = {
  COLLISION: '#ffffff',
  CRITICAL:  '#ff4757',
  WARNING:   '#ffd32a',
  NOMINAL:   '#00e5a0',
};

/** Log-scale distance → canvas radius. 0.05 km ≈ innermost, 50 km ≈ outermost. */
function distToR(dist_km, maxR) {
  const MIN_LOG = Math.log10(0.05);
  const MAX_LOG = Math.log10(50.0);
  const t = (Math.log10(Math.max(dist_km, 0.05)) - MIN_LOG) / (MAX_LOG - MIN_LOG);
  return Math.max(5, Math.min(t, 1.0) * maxR);
}

/** Deterministic pseudo-angle from IDs — distributes threats around the circle. */
function threatAngle(sat_id, debris_id, index) {
  let h = 0;
  const s = `${sat_id}${debris_id}${index}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 360) * (Math.PI / 180);
}

export default function ConjunctionBullseye({ snapshot, selectedSat }) {
  const canvasRef  = useRef(null);
  const animRef    = useRef(null);
  const frameRef   = useRef(0);
  // Store latest props in refs so the RAF closure always has fresh data
  const snapshotRef    = useRef(snapshot);
  const selectedSatRef = useRef(selectedSat);

  // Keep refs in sync with props without restarting the animation
  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);
  useEffect(() => { selectedSatRef.current = selectedSat; }, [selectedSat]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // ── Size canvas correctly — set once and on resize only ──────────────────
    function sizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width  = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      }
    }

    const ro = new ResizeObserver(sizeCanvas);
    ro.observe(canvas);
    sizeCanvas();  // initial size

    let stopped = false;

    function draw() {
      if (stopped) return;
      frameRef.current += 1;
      const t = frameRef.current;

      const snap    = snapshotRef.current;
      const selSat  = selectedSatRef.current;
      const targetSat = selSat || snap?.satellites?.[0]?.id;
      const allWarnings = snap?.cdm_warnings ?? [];
      const warnings = targetSat
        ? allWarnings.filter(w => w.sat_id === targetSat)
        : allWarnings;

      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width  / dpr;
      const h = canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);  // restore DPR scale (clearRect resets nothing)

      // ── Clear frame ───────────────────────────────────────────────────────
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.min(cx, cy) - 22;

      // ── Background ────────────────────────────────────────────────────────
      const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 1.3);
      bgGrad.addColorStop(0, '#060f20');
      bgGrad.addColorStop(1, '#020810');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // ── Risk rings (outer → inner) ────────────────────────────────────────
      RINGS.forEach(ring => {
        const r = distToR(ring.km, maxR);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = ring.color + ring.alpha;
        ctx.fill();
        ctx.strokeStyle = ring.color + '66';
        ctx.lineWidth = 0.6;
        ctx.stroke();
        ctx.font = '7px JetBrains Mono, monospace';
        ctx.fillStyle = ring.color + 'cc';
        ctx.textAlign = 'center';
        ctx.fillText(ring.label, cx, cy - r + 9);
      });

      // ── Crosshairs ────────────────────────────────────────────────────────
      ctx.strokeStyle = 'rgba(32,180,255,0.10)';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.moveTo(cx, cy - maxR); ctx.lineTo(cx, cy + maxR); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - maxR, cy); ctx.lineTo(cx + maxR, cy); ctx.stroke();
      ctx.setLineDash([]);

      // ── Centre satellite dot ───────────────────────────────────────────────
      const pulse = 0.7 + 0.3 * Math.sin(t / 12);
      ctx.beginPath();
      ctx.arc(cx, cy, 7 + 2 * pulse, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(32,180,255,${0.12 * pulse})`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#20b4ff';
      ctx.shadowColor = '#20b4ff';
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();

      // Sat label
      if (targetSat) {
        ctx.font = '600 8px JetBrains Mono, monospace';
        ctx.fillStyle = 'rgba(32,180,255,0.8)';
        ctx.textAlign = 'center';
        ctx.fillText(targetSat.slice(0, 16), cx, cy + 16);
      }

      // ── No threats ────────────────────────────────────────────────────────
      if (warnings.length === 0) {
        ctx.font = '500 9px Inter, sans-serif';
        ctx.fillStyle = 'rgba(0,229,160,0.5)';
        ctx.textAlign = 'center';
        ctx.fillText('CLEAR — No active conjunctions', cx, h - 12);
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      // ── Threat dots and labels ─────────────────────────────────────────────
      warnings.forEach((w, idx) => {
        const dist  = w.miss_distance_km;
        const color = SEV_COLOR[w.severity] ?? '#ffd32a';
        const r     = distToR(dist, maxR);
        const angle = threatAngle(w.sat_id, w.debris_id, idx);
        const tx = cx + r * Math.cos(angle);
        const ty = cy + r * Math.sin(angle);

        // Pulsing ring for CRITICAL / COLLISION
        if (w.severity === 'CRITICAL' || w.severity === 'COLLISION') {
          const pR = 8 + 6 * Math.abs(Math.sin(t / 8 + idx));
          ctx.beginPath();
          ctx.arc(tx, ty, pR, 0, Math.PI * 2);
          ctx.strokeStyle = color + '66';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Connector line
        ctx.beginPath();
        ctx.moveTo(cx, cy); ctx.lineTo(tx, ty);
        ctx.strokeStyle = color + '30';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([2, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Threat dot
        ctx.beginPath();
        ctx.arc(tx, ty, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Label
        const labelOffset = r + 14;
        const lx = cx + labelOffset * Math.cos(angle);
        const ly = cy + labelOffset * Math.sin(angle);
        ctx.font = '600 7px JetBrains Mono, monospace';
        ctx.fillStyle = color;
        ctx.textAlign = Math.cos(angle) >= 0 ? 'left' : 'right';
        ctx.fillText(`${dist.toFixed(2)}km`, lx, ly);
        ctx.font = '6px Inter, sans-serif';
        ctx.fillStyle = color + 'aa';
        ctx.fillText(w.debris_id.slice(0, 10), lx, ly + 9);
      });

      // ── Legend ────────────────────────────────────────────────────────────
      const legendItems = [
        { color: '#00e5a0', label: 'NOMINAL  > 5 km'  },
        { color: '#ffd32a', label: 'WARNING  1–5 km'  },
        { color: '#ff4757', label: 'CRITICAL < 1 km'  },
        { color: '#ffffff', label: 'COLLISION < 100 m' },
      ];
      legendItems.forEach(({ color, label }, i) => {
        const lx = 6, ly = h - 12 - (legendItems.length - 1 - i) * 12;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(lx + 3, ly - 3, 3, 0, Math.PI * 2); ctx.fill();
        ctx.font = '7px Inter, sans-serif';
        ctx.fillStyle = 'rgba(200,216,232,0.55)';
        ctx.textAlign = 'left';
        ctx.fillText(label, lx + 9, ly);
      });

      // ── Title + threat count ───────────────────────────────────────────────
      ctx.font = '600 7.5px JetBrains Mono, monospace';
      ctx.fillStyle = 'rgba(32,180,255,0.5)';
      ctx.textAlign = 'left';
      ctx.fillText('⊕ CDM BULLSEYE — LOG SCALE', 4, 10);
      if (warnings.length > 0) {
        const crit = warnings.filter(x => x.severity === 'CRITICAL' || x.severity === 'COLLISION').length;
        ctx.textAlign = 'right';
        ctx.fillStyle = crit > 0 ? '#ff4757' : '#ffd32a';
        ctx.fillText(`${warnings.length} threat${warnings.length > 1 ? 's' : ''}`, w - 4, 10);
      }

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);

    return () => {
      stopped = true;
      ro.disconnect();
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);  // empty deps — RAF loop reads snapshot via ref, never restarts

  return (
    <canvas
      ref={canvasRef}
      id="conjunction-bullseye-canvas"
      style={{ width: '100%', height: '100%', display: 'block' }}
      aria-label="Conjunction Bullseye polar chart — log-scale miss distance"
    />
  );
}
