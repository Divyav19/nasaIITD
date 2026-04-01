/**
 * MultiFutureSimView.jsx  — AETHER ACM
 *
 * Shows 3 alternative maneuver strategies side-by-side:
 *   1. Anti-Gravity Phasing (2 m/s transverse — ANTI-GRAVITY INSIGHT)
 *   2. Standard Evasion (10 m/s)
 *   3. Max-Δv Emergency (15 m/s)
 *
 * Fetches live strategy scores from /api/insight/{sat_id}.
 * Renders projected ground track divergence on Canvas (WebGL-ready).
 * Multi-objective radar chart: fuel efficiency × safety × uptime.
 */

import { useEffect, useRef, useState } from 'react';

const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';

const STRATEGY_COLORS = ['#20b4ff', '#00e5a0', '#ffd32a'];
const STRATEGY_LABELS = ['Anti-Gravity Phasing', 'Standard Evasion', 'Max-Δv Emergency'];
const DV_VALUES       = [2, 10, 15]; // m/s

/** Mercator projection helper */
function mercator(lat, lon, w, h) {
  const x = ((lon + 180) / 360) * w;
  const latRad = (lat * Math.PI) / 180;
  const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const y = h / 2 - (h * mercN) / (2 * Math.PI);
  return [x, y];
}

/** Draw minimal world grid */
function drawGrid(ctx, w, h) {
  const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
  bgGrad.addColorStop(0, '#020810');
  bgGrad.addColorStop(1, '#040c18');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(32,180,255,0.05)';
  ctx.lineWidth = 0.5;
  for (let lon = -180; lon <= 180; lon += 45) {
    const [x] = mercator(0, lon, w, h);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const [, y] = mercator(lat, 0, w, h);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  // equator
  ctx.strokeStyle = 'rgba(32,180,255,0.14)';
  const [, ey] = mercator(0, 0, w, h);
  ctx.beginPath(); ctx.moveTo(0, ey); ctx.lineTo(w, ey); ctx.stroke();
}

/**
 * Simulate diverged trajectory based on strategy ΔV magnitude.
 * Uses Kepler-phasing approximation: larger Δv → larger along-track drift.
 */
function divergedTrack(baseLat, baseLon, dvMs) {
  const POINTS = 48; // ~90 min orbit at 2-min steps
  const track = [];
  // Period change factor: Δv changes period, causing accumulated drift
  // Along-track drift accumulates as: Δx ≈ 3π * (Δv/v_orbital) * orbit_count * semi_major  
  const driftFactor = (dvMs / 1000) * 0.15; // normalized phasing offset per point
  let prevLon = baseLon;

  for (let i = 0; i < POINTS; i++) {
    const t = (i + 1) / POINTS;
    // Sinusoidal latitude oscillation (orbital inclination approximation ~52°)
    const lat = 52 * Math.sin(2 * Math.PI * t + (baseLat / 90) * Math.PI);
    // Eastward progression + strategy-specific phasing drift
    const lon = ((baseLon + t * 380 + driftFactor * i * 2) % 360) - 180;
    track.push([lat, lon]);
    prevLon = lon;
  }
  return track;
}

/** Radar chart for 3 objectives: fuel efficiency, safety, uptime */
function drawRadar(ctx, cx, cy, R, scores) {
  const axes = ['Fuel Eff.', 'Safety', 'Uptime'];
  const N = axes.length;
  const angleStep = (2 * Math.PI) / N;

  // Background glow
  const radialGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  radialGlow.addColorStop(0, 'rgba(32,180,255,0.04)');
  radialGlow.addColorStop(1, 'transparent');
  ctx.fillStyle = radialGlow;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  // Grid rings
  for (let ring = 1; ring <= 4; ring++) {
    const r = (ring / 4) * R;
    ctx.beginPath();
    for (let a = 0; a < N; a++) {
      const angle = a * angleStep - Math.PI / 2;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = ring === 4 ? 'rgba(32,180,255,0.2)' : 'rgba(32,180,255,0.08)';
    ctx.lineWidth = ring === 4 ? 0.8 : 0.5;
    ctx.stroke();

    // Ring label
    if (ring < 4) {
      ctx.font = '6px Inter, sans-serif';
      ctx.fillStyle = 'rgba(32,180,255,0.3)';
      ctx.textAlign = 'center';
      ctx.fillText(`${ring * 25}%`, cx + 3, cy - r + 6);
    }
  }

  // Axes
  axes.forEach((label, i) => {
    const angle = i * angleStep - Math.PI / 2;
    const x = cx + R * Math.cos(angle);
    const y = cy + R * Math.sin(angle);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y);
    ctx.strokeStyle = 'rgba(32,180,255,0.25)';
    ctx.lineWidth = 0.7;
    ctx.stroke();

    // Axis endpoint dots
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(32,180,255,0.4)';
    ctx.fill();

    // Labels
    ctx.font = '7px Inter, sans-serif';
    ctx.fillStyle = 'rgba(200,216,232,0.65)';
    ctx.textAlign = 'center';
    const lx = cx + (R + 12) * Math.cos(angle);
    const ly = cy + (R + 12) * Math.sin(angle);
    ctx.fillText(label, lx, ly + 3);
  });

  // Strategy polygons
  const strategyData = scores || [
    { scores: [0.82, 0.85, 0.96], color: STRATEGY_COLORS[0] },
    { scores: [0.65, 0.98, 0.60], color: STRATEGY_COLORS[1] },
    { scores: [0.44, 1.00, 0.38], color: STRATEGY_COLORS[2] },
  ];

  strategyData.forEach(({ scores: sc, color }) => {
    ctx.beginPath();
    sc.forEach((s, i) => {
      const angle = i * angleStep - Math.PI / 2;
      const r = Math.max(s, 0.02) * R;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = color + '20';
    ctx.fill();
    ctx.strokeStyle = color + 'bb';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Vertex dots
    sc.forEach((s, i) => {
      const angle = i * angleStep - Math.PI / 2;
      const r = Math.max(s, 0.02) * R;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 5;
      ctx.fill();
      ctx.shadowBlur = 0;
    });
  });

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(32,180,255,0.7)';
  ctx.fill();
}

export default function MultiFutureSimView({ snapshot, selectedSat }) {
  const mapCanvasRef   = useRef(null);
  const radarCanvasRef = useRef(null);
  const [insight, setInsight] = useState(null);

  const effectiveSat = selectedSat || snapshot?.satellites?.[0]?.id;

  // Fetch live strategies from insight API
  useEffect(() => {
    if (!effectiveSat) return;
    let cancelled = false;
    fetch(`${BASE}/api/insight/${encodeURIComponent(effectiveSat)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d) setInsight(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [effectiveSat]);

  // Draw the projected ground track map
  useEffect(() => {
    const canvas = mapCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const w = W, h = H;

    drawGrid(ctx, w, h);

    const sat = snapshot?.satellites?.find(s => s.id === effectiveSat)
              || snapshot?.satellites?.[0];
    if (!sat) {
      ctx.font = '10px Inter, sans-serif';
      ctx.fillStyle = 'rgba(200,216,232,0.25)';
      ctx.textAlign = 'center';
      ctx.fillText('Select a satellite to view projected tracks', w / 2, h / 2);
      return;
    }

    const baseLat = sat.lat, baseLon = sat.lon;
    const [px0, py0] = mercator(baseLat, baseLon, w, h);

    // Draw convergence zone background
    const zoneGrad = ctx.createRadialGradient(px0, py0, 0, px0, py0, 30);
    zoneGrad.addColorStop(0, 'rgba(32,180,255,0.12)');
    zoneGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = zoneGrad;
    ctx.beginPath();
    ctx.arc(px0, py0, 30, w, h);
    ctx.fill();

    // Draw 3 diverging future trajectories
    DV_VALUES.forEach((dv, i) => {
      const track = divergedTrack(baseLat, baseLon, dv);
      if (track.length < 2) return;

      // Gradient stroke (fades with time)
      ctx.beginPath();
      let prevLon = baseLon;
      let moved = false;
      for (let j = 0; j < track.length; j++) {
        const [lt, ln] = track[j];
        if (Math.abs(ln - prevLon) > 180) { ctx.stroke(); ctx.beginPath(); moved = false; }
        const [fx, fy] = mercator(lt, ln, w, h);
        if (!moved) { ctx.moveTo(fx, fy); moved = true; } else ctx.lineTo(fx, fy);
        prevLon = ln;
      }
      const alpha = i === 0 ? 'cc' : i === 1 ? '88' : '66';
      ctx.strokeStyle = STRATEGY_COLORS[i] + alpha;
      ctx.lineWidth = i === 0 ? 2.0 : 1.3;
      ctx.setLineDash(i === 0 ? [] : i === 1 ? [5, 4] : [3, 6]);
      ctx.shadowColor = STRATEGY_COLORS[i];
      ctx.shadowBlur = i === 0 ? 5 : 2;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.setLineDash([]);

      // Track end marker
      const [el, eln] = track[track.length - 1];
      const [ex, ey] = mercator(el, eln, w, h);
      ctx.beginPath();
      ctx.arc(ex, ey, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = STRATEGY_COLORS[i];
      ctx.shadowColor = STRATEGY_COLORS[i];
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.font = `600 8px JetBrains Mono, monospace`;
      ctx.fillStyle = STRATEGY_COLORS[i];
      ctx.textAlign = 'left';
      ctx.fillText(`S${i + 1}`, ex + 5, ey + 3);
    });

    // Current position marker (bright)
    ctx.beginPath();
    ctx.arc(px0, py0, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#20b4ff';
    ctx.shadowColor = '#20b4ff';
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.shadowBlur = 0;

    // White inner dot
    ctx.beginPath();
    ctx.arc(px0, py0, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();

    // Satellite label
    ctx.font = '600 9px JetBrains Mono, monospace';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(sat.id.slice(0, 14), px0, py0 - 12);

    // Legend
    const legends = [
      { label: `S1: Anti-Grav Phasing (+${DV_VALUES[0]} m/s)`, c: STRATEGY_COLORS[0] },
      { label: `S2: Standard Evasion (+${DV_VALUES[1]} m/s)`,  c: STRATEGY_COLORS[1] },
      { label: `S3: Max-Δv Emergency (+${DV_VALUES[2]} m/s)`,  c: STRATEGY_COLORS[2] },
    ];
    legends.forEach(({ label, c }, i) => {
      const lx = 8, ly = h - 14 - i * 16;
      ctx.fillStyle = c + 'cc';
      ctx.fillRect(lx, ly - 4, 18, 2.5);
      ctx.font = '8px Inter, sans-serif';
      ctx.fillStyle = 'rgba(200,216,232,0.65)';
      ctx.textAlign = 'left';
      ctx.fillText(label, lx + 22, ly);
    });

    // Label header
    ctx.font = '500 8px JetBrains Mono, monospace';
    ctx.fillStyle = 'rgba(32,180,255,0.45)';
    ctx.textAlign = 'left';
    ctx.fillText('▷ PROJECTED GROUND TRACKS — 90 MIN', 4, 10);

  }, [snapshot, selectedSat, effectiveSat]);

  // Draw the radar chart
  useEffect(() => {
    const canvas = radarCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const w = W, h = H;

    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#040c18');
    bgGrad.addColorStop(1, '#070d17');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Build radar data from live strategies if available
    let radarData = null;
    if (insight?.strategies?.length >= 3) {
      const maxScore = Math.max(...insight.strategies.map(s => s.optimization_score));
      radarData = insight.strategies.map((s, i) => ({
        scores: [
          // Fuel efficiency = inverted fuel cost, normalized
          Math.max(0.1, 1 - (s.fuel_cost_kg / 0.1)),
          // Safety score = normalized optimization score (safety-weighted)
          (s.risk_after === 'NOMINAL' ? 1.0 : s.risk_after === 'WARNING' ? 0.6 : 0.3),
          // Uptime = inverted uptime_impact
          Math.max(0.1, 1 - s.uptime_impact_s / 3000),
        ],
        color: STRATEGY_COLORS[i] || '#aaa',
      }));
    }

    const R = Math.min(w, h) * 0.27;
    const cx = w / 2, cy = h * 0.40;
    drawRadar(ctx, cx, cy, R, radarData);

    // Strategy color key — at very bottom, compact
    const abbr = ['Anti-Grav', 'Standard', 'Max-Δv'];
    STRATEGY_LABELS.forEach((label, i) => {
      const ly = h - 38 + i * 12;
      ctx.fillStyle = STRATEGY_COLORS[i];
      ctx.fillRect(4, ly, 10, 2);
      ctx.font = '6px Inter, sans-serif';
      ctx.fillStyle = 'rgba(200,216,232,0.5)';
      ctx.textAlign = 'left';
      ctx.fillText(`S${i + 1} ${abbr[i]}`, 17, ly + 4);
    });

    ctx.font = '600 7.5px JetBrains Mono, monospace';
    ctx.fillStyle = 'rgba(32,180,255,0.45)';
    ctx.textAlign = 'center';
    ctx.fillText('MULTI-OBJ RADAR', cx, 10);

  }, [insight]);

  // Derive live scores
  const liveScores = insight?.strategies ?? [
    { name: 'Anti-Gravity Phasing', dv_ms: 2.0,  optimization_score: 88.4, fuel_cost_kg: 0.001, risk_after: 'WARNING',  uptime_impact_s: 120  },
    { name: 'Standard Evasion',     dv_ms: 10.0, optimization_score: 76.1, fuel_cost_kg: 0.005, risk_after: 'NOMINAL',  uptime_impact_s: 1200 },
    { name: 'Max-Δv Emergency',     dv_ms: 15.0, optimization_score: 62.3, fuel_cost_kg: 0.008, risk_after: 'NOMINAL',  uptime_impact_s: 2400 },
  ];

  const bestIdx = liveScores.reduce((bi, s, i) =>
    s.optimization_score > liveScores[bi].optimization_score ? i : bi, 0);

  return (
    <div className="mfsv-wrap">
      {/* Map pane */}
      <div className="mfsv-map-pane">
        <canvas ref={mapCanvasRef} style={{ width: '100%', height: '100%' }} />
      </div>

      {/* Radar + scores pane */}
      <div className="mfsv-radar-pane">
        <canvas ref={radarCanvasRef} style={{ width: '100%', height: '65%' }} />

        {/* Live strategy scoreboard */}
        <div className="mfsv-scores">
          {liveScores.map((s, i) => {
            const isBest = i === bestIdx;
            // Abbreviated names so they never wrap
            const shortNames = ['Anti-Grav', 'Standard', 'Max-Δv'];
            return (
              <div
                key={i}
                className={`mfsv-score-row${isBest ? ' mfsv-best' : ''}`}
                style={{ borderLeftColor: STRATEGY_COLORS[i] }}
              >
                <span className="mfsv-score-name" style={{ color: STRATEGY_COLORS[i] }}>
                  {isBest && '★ '}{shortNames[i]}
                </span>
                <span className="mfsv-score-dv">{s.dv_ms?.toFixed(0) ?? DV_VALUES[i]}m/s</span>
                <div className="mfsv-score-bar-wrap">
                  <div
                    className="mfsv-score-bar"
                    style={{
                      width: `${s.optimization_score}%`,
                      background: `linear-gradient(90deg, ${STRATEGY_COLORS[i]}44, ${STRATEGY_COLORS[i]}cc)`,
                    }}
                  />
                </div>
                <span className="mfsv-score-num" style={{ color: STRATEGY_COLORS[i] }}>
                  {s.optimization_score.toFixed(0)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Anti-gravity callout */}
        {bestIdx === 0 && (
          <div className="mfsv-phasing-tag">
            <span className="mfsv-phasing-icon">⚛</span>
            Anti-gravity phasing selected as optimal strategy
          </div>
        )}
      </div>
    </div>
  );
}
