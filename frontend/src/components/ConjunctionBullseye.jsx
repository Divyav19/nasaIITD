import { useEffect, useRef } from 'react';

const RINGS = [
  { r: 0.2, label: '1 km',  color: 'rgba(255,71,87,0.5)'   },
  { r: 0.5, label: '5 km',  color: 'rgba(255,211,42,0.5)'  },
  { r: 1.0, label: '50 km', color: 'rgba(32,180,255,0.25)' },
];

export default function ConjunctionBullseye({ snapshot, selectedSat }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const w = W, h = H;
    const cx = w / 2, cy = h / 2;
    const MAX_R = Math.min(w, h) * 0.44;

    // ── Background ─────────────────────────────────────────────────────────
    ctx.fillStyle = '#070d17';
    ctx.fillRect(0, 0, w, h);

    // ── Concentric rings ───────────────────────────────────────────────────
    for (const ring of RINGS) {
      const r = ring.r * MAX_R;
      // Fill zones
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = ring.color.replace('0.5)', '0.06)').replace('0.25)', '0.03)');
      ctx.fill();
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = 1;
      ctx.stroke();
      // Label
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillStyle = ring.color.replace('0.5)', '0.8)').replace('0.25)', '0.6)');
      ctx.fillText(ring.label, cx + r + 3, cy - 3);
    }

    // ── Cross-hair ─────────────────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(32,180,255,0.15)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
    ctx.setLineDash([]);

    // ── Center satellite marker ────────────────────────────────────────────
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#20b4ff';
    ctx.fill();
    ctx.shadowColor = '#20b4ff';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;

    // ── CDM threat points ─────────────────────────────────────────────────
    const warnings = (snapshot?.cdm_warnings || []).filter(
      w => !selectedSat || w.sat_id === selectedSat
    );

    if (warnings.length === 0) {
      // "Safe" indicator
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.fillStyle = '#00e5a0';
      ctx.textAlign = 'center';
      ctx.fillText('NO ACTIVE THREATS', cx, h - 12);
      ctx.textAlign = 'left';
    }

    for (const w of warnings) {
      const dist = w.miss_distance_km;
      // Map 0–50 km → 0–MAX_R (log scale for readability)
      const fraction = Math.min(dist / 50.0, 1.0);
      const plotR = fraction * MAX_R;

      // Arbitrary angle based on hash of debris ID for visual spread
      const angle = (Array.from(w.debris_id).reduce((a, c) => a + c.charCodeAt(0), 0) % 360)
        * (Math.PI / 180);

      const px = cx + plotR * Math.cos(angle);
      const py = cy + plotR * Math.sin(angle);

      const color =
        w.severity === 'COLLISION' ? '#ff4757' :
        w.severity === 'CRITICAL'  ? '#ff6b81' :
        '#ffd32a';

      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Line to center
      ctx.beginPath();
      ctx.moveTo(cx, cy); ctx.lineTo(px, py);
      ctx.strokeStyle = `${color}44`;
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // Distance label
      ctx.font = '8px JetBrains Mono, monospace';
      ctx.fillStyle = color;
      ctx.fillText(`${dist.toFixed(2)}km`, px + 5, py - 2);
    }

    // ── Title ──────────────────────────────────────────────────────────────
    ctx.font = '500 10px Inter, sans-serif';
    ctx.fillStyle = 'rgba(200,216,232,0.5)';
    ctx.textAlign = 'center';
    ctx.fillText(selectedSat ? `BULLSEYE — ${selectedSat}` : 'BULLSEYE — ALL SATELLITES', cx, 14);
    ctx.textAlign = 'left';

  }, [snapshot, selectedSat]);

  return (
    <div className="bullseye-canvas-wrap">
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%' }}
        aria-label="Conjunction Bullseye polar chart"
      />
    </div>
  );
}
