import { useEffect, useRef, useState, useCallback } from 'react';
import {
  latLonToMercator,
  getTerminatorPoints,
  STATUS_COLORS,
} from '../lib/geoUtils';

const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';
const TRAIL_POINTS = 120; // rendering budget per satellite
const trailHistory = {}; // global trail buffer

// Ground stations (visual markers - major stations)
const GROUND_STATIONS = [
  { name: 'Goldstone', lat: 35.43, lon: -116.89 },
  { name: 'Madrid', lat: 40.43, lon: -4.25 },
  { name: 'Canberra', lat: -35.40, lon: 148.98 },
  { name: 'Svalbard', lat: 78.23, lon: 15.40 },
  { name: 'McMurdo', lat: -77.85, lon: 166.67 },
];

// Cache for future trajectory data per sat
const futureTrackCache = {};

export default function GroundTrackMap({ snapshot, selectedSat, onSelectSat }) {
  const canvasRef = useRef(null);
  const [futureTrack, setFutureTrack] = useState(null);

  // Fetch future trajectory when selected satellite changes
  useEffect(() => {
    if (!selectedSat) { setFutureTrack(null); return; }
    let cancelled = false;

    // Check cache freshness (30s)
    const cached = futureTrackCache[selectedSat];
    if (cached && Date.now() - cached.ts < 30000) {
      setFutureTrack(cached.data);
      return;
    }

    fetch(`${BASE}/api/insight/${encodeURIComponent(selectedSat)}/trajectory?minutes=90`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!cancelled && data?.future_track_90min) {
          futureTrackCache[selectedSat] = { data: data.future_track_90min, ts: Date.now() };
          setFutureTrack(data.future_track_90min);
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [selectedSat]);

  useEffect(() => {
    if (!snapshot) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // ── Resize to device pixel ratio ──────────────────────────────────────
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const w = W, h = H;
    const simTs = new Date(snapshot.timestamp).getTime();

    // ── Helper ─────────────────────────────────────────────────────────────
    const proj = (lat, lon) => latLonToMercator(lat, lon, w, h);

    // ── Background: deep space gradient ───────────────────────────────────
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#020810');
    bgGrad.addColorStop(0.5, '#040c18');
    bgGrad.addColorStop(1, '#060f1e');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // ── Subtle star field ─────────────────────────────────────────────────
    const starSeed = 42;
    for (let i = 0; i < 180; i++) {
      const sx = ((Math.sin(i * 1.732 + starSeed) + 1) / 2) * w;
      const sy = ((Math.cos(i * 2.618 + starSeed) + 1) / 2) * h;
      const brightness = 0.1 + (Math.sin(i * 3.14) + 1) * 0.1;
      ctx.beginPath();
      ctx.arc(sx, sy, 0.6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${brightness})`;
      ctx.fill();
    }

    // ── Grid lines ─────────────────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(32,180,255,0.06)';
    ctx.lineWidth = 0.5;
    for (let lon = -180; lon <= 180; lon += 30) {
      const [x] = proj(0, lon);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      // Longitude label
      if (lon !== -180 && lon !== 180) {
        ctx.font = '7px JetBrains Mono, monospace';
        ctx.fillStyle = 'rgba(32,180,255,0.25)';
        ctx.textAlign = 'center';
        ctx.fillText(`${lon}°`, x, h - 3);
      }
    }
    for (let lat = -90; lat <= 90; lat += 30) {
      const [, y] = proj(lat, 0);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      if (lat !== 0 && lat !== 90 && lat !== -90) {
        ctx.font = '7px JetBrains Mono, monospace';
        ctx.fillStyle = 'rgba(32,180,255,0.25)';
        ctx.textAlign = 'left';
        ctx.fillText(`${lat}°`, 3, y - 2);
      }
    }

    // Equator highlight
    ctx.strokeStyle = 'rgba(32,180,255,0.18)';
    ctx.lineWidth = 1;
    const [, eqY] = proj(0, 0);
    ctx.beginPath(); ctx.moveTo(0, eqY); ctx.lineTo(w, eqY); ctx.stroke();

    // ── Terminator (day/night shadow) ─────────────────────────────────────
    const termPoints = getTerminatorPoints(simTs);
    if (termPoints.length > 2) {
      // Night side gradient fill
      const nightGrad = ctx.createLinearGradient(0, 0, w, 0);
      nightGrad.addColorStop(0, 'rgba(0,0,0,0.42)');
      nightGrad.addColorStop(1, 'rgba(0,5,20,0.38)');

      ctx.beginPath();
      const [firstLat, firstLon] = termPoints[0];
      const [fx, fy] = proj(firstLat, firstLon);
      ctx.moveTo(fx, fy);
      for (let i = 1; i < termPoints.length; i++) {
        const [la, lo] = termPoints[i];
        const [px, py] = proj(la, lo);
        ctx.lineTo(px, py);
      }
      ctx.lineTo(0, h); ctx.lineTo(w, h); ctx.closePath();
      ctx.fillStyle = nightGrad;
      ctx.fill();

      // Terminator glow line
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      for (let i = 1; i < termPoints.length; i++) {
        const [la, lo] = termPoints[i];
        const [px, py] = proj(la, lo);
        ctx.lineTo(px, py);
      }
      ctx.strokeStyle = 'rgba(255, 200, 80, 0.65)';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = 'rgba(255, 180, 60, 0.5)';
      ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // ── Ground Station Markers ─────────────────────────────────────────────
    for (const gs of GROUND_STATIONS) {
      const [gx, gy] = proj(gs.lat, gs.lon);
      ctx.beginPath();
      ctx.arc(gx, gy, 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,200,60,0.7)';
      ctx.fill();
      // Dish icon: small triangle above
      ctx.beginPath();
      ctx.moveTo(gx, gy - 3);
      ctx.lineTo(gx - 4, gy - 8);
      ctx.lineTo(gx + 4, gy - 8);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,200,60,0.35)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,200,60,0.6)';
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }

    // ── Debris cloud (dots, altitude-colored) ─────────────────────────────
    if (snapshot.debris_cloud) {
      for (const [, lat, lon, alt] of snapshot.debris_cloud) {
        const [x, y] = proj(lat, lon);
        // Color by altitude: lower orbit = more orange, higher = blue
        const altNorm = Math.min((alt - 200) / 1000, 1);
        const alpha = 0.25 + altNorm * 0.1;
        ctx.beginPath();
        ctx.arc(x, y, 1.1, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${Math.round(100 + altNorm * 20)},${Math.round(160 + altNorm * 30)},220,${alpha})`;
        ctx.fill();
      }
    }

    // ── Future trajectory (dashed cyan, 90 min forward) ───────────────────
    if (futureTrack && futureTrack.length > 1) {
      const selColor = selectedSat
        ? (STATUS_COLORS[snapshot.satellites?.find(s => s.id === selectedSat)?.status] || STATUS_COLORS.NOMINAL)
        : '#20b4ff';

      ctx.save();
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = `${selColor}80`;
      ctx.lineWidth = 1.2;
      ctx.shadowColor = selColor;
      ctx.shadowBlur = 4;
      ctx.beginPath();
      let started = false;
      let prevLon = null;
      for (const pt of futureTrack) {
        const [fx, fy] = proj(pt.lat, pt.lon);
        // Break line on antimeridian crossing
        if (prevLon !== null && Math.abs(pt.lon - prevLon) > 180) {
          ctx.stroke();
          ctx.beginPath();
          started = false;
        }
        if (!started) { ctx.moveTo(fx, fy); started = true; }
        else ctx.lineTo(fx, fy);
        prevLon = pt.lon;
      }
      ctx.stroke();
      ctx.restore();

      // Future track end marker
      const last = futureTrack[futureTrack.length - 1];
      if (last) {
        const [lx, ly] = proj(last.lat, last.lon);
        ctx.beginPath();
        ctx.arc(lx, ly, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(32,180,255,0.5)';
        ctx.fill();
        ctx.font = '8px JetBrains Mono, monospace';
        ctx.fillStyle = 'rgba(32,180,255,0.7)';
        ctx.textAlign = 'left';
        ctx.fillText('+90min', lx + 4, ly + 3);
      }
    }

    // ── Satellites ─────────────────────────────────────────────────────────
    for (const sat of (snapshot.satellites || [])) {
      const { id, lat, lon, status } = sat;
      const [x, y] = proj(lat, lon);
      const color = STATUS_COLORS[status] || STATUS_COLORS.NOMINAL;
      const isSel = id === selectedSat;

      // Update trail
      if (!trailHistory[id]) trailHistory[id] = [];
      trailHistory[id].push([lat, lon]);
      if (trailHistory[id].length > TRAIL_POINTS) trailHistory[id].shift();

      // Draw historical trail
      const trail = trailHistory[id];
      if (trail.length > 1) {
        ctx.beginPath();
        let prevTLon = null;
        let trailStarted = false;
        for (let i = 0; i < trail.length; i++) {
          if (prevTLon !== null && Math.abs(trail[i][1] - prevTLon) > 180) {
            trailStarted = false;
          }
          const [tx, ty] = proj(trail[i][0], trail[i][1]);
          const alpha = (i / trail.length) * 0.7;
          if (!trailStarted) { ctx.moveTo(tx, ty); trailStarted = true; }
          else ctx.lineTo(tx, ty);
          prevTLon = trail[i][1];
        }
        ctx.strokeStyle = isSel ? `rgba(32,180,255,0.65)` : `${color}55`;
        ctx.lineWidth = isSel ? 1.5 : 0.8;
        ctx.stroke();
      }

      // Satellite dot with glow
      const r = isSel ? 6 : (status === 'EVASION' || status === 'RECOVERY' ? 5 : 4);
      ctx.shadowColor = color;
      ctx.shadowBlur = isSel ? 18 : (status !== 'NOMINAL' ? 10 : 5);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Outer ring for selected  
      if (isSel) {
        // Pulsing outer ring
        ctx.beginPath();
        ctx.arc(x, y, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = `${color}60`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, r + 10, 0, Math.PI * 2);
        ctx.strokeStyle = `${color}25`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Status indicator for non-nominal
      if (status === 'EVASION') {
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = `${color}88`;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Label
      if (isSel || status === 'EVASION' || status === 'DEAD') {
        ctx.font = isSel ? '600 10px JetBrains Mono, monospace' : '9px JetBrains Mono, monospace';
        ctx.fillStyle = isSel ? '#fff' : color;
        ctx.textAlign = 'left';
        ctx.fillText(id.slice(0, 14), x + r + 4, y + 4);
      }
    }

    // ── CDM warning zones ─────────────────────────────────────────────────
    for (const cdm of (snapshot.cdm_warnings || [])) {
      const sat = snapshot.satellites?.find(s => s.id === cdm.sat_id);
      if (!sat) continue;
      const [x, y] = proj(sat.lat, sat.lon);
      const radius = cdm.severity === 'CRITICAL' ? 16 : 11;
      const hue = cdm.severity === 'CRITICAL' ? '#ff4757' : '#ffd32a';
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `${hue}77`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // CDM fill flash for critical
      if (cdm.severity === 'CRITICAL') {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,71,87,0.08)';
        ctx.fill();
      }
    }

    // ── Scan-line overlay (mission control aesthetic) ───────────────────
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    for (let sy = 0; sy < h; sy += 3) {
      ctx.fillRect(0, sy, w, 1);
    }

  }, [snapshot, selectedSat, futureTrack]);

  // Click handler to select satellite
  const handleClick = useCallback((e) => {
    if (!snapshot?.satellites) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const w = rect.width, h = rect.height;

    for (const sat of snapshot.satellites) {
      const [sx, sy] = latLonToMercator(sat.lat, sat.lon, w, h);
      if (Math.hypot(cx - sx, cy - sy) < 9) {
        onSelectSat?.(sat.id === selectedSat ? null : sat.id);
        return;
      }
    }
    onSelectSat?.(null);
  }, [snapshot, selectedSat, onSelectSat]);

  return (
    <div className="map-canvas-wrapper" onClick={handleClick}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', cursor: 'crosshair' }} />
      <div className="map-legend">
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <div className="legend-item" key={status}>
            <div className="legend-dot" style={{ background: color, boxShadow: `0 0 4px ${color}` }} />
            <span>{status}</span>
          </div>
        ))}
        <div className="legend-item">
          <div className="legend-dot" style={{ background: 'rgba(120,180,220,0.6)' }} />
          <span>DEBRIS</span>
        </div>
        <div className="legend-item" style={{ borderTop: '1px solid rgba(32,180,255,0.1)', paddingTop: 4, marginTop: 2 }}>
          <div style={{ width: 16, borderTop: '1.5px dashed rgba(32,180,255,0.7)', marginRight: 0 }} />
          <span style={{ color: 'rgba(32,180,255,0.7)' }}>FUTURE TRACK</span>
        </div>
        <div className="legend-item">
          <div style={{ width: 6, height: 6, background: 'rgba(255,200,60,0.7)', clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)', marginRight: 1 }} />
          <span style={{ color: 'rgba(255,200,60,0.7)' }}>GND STATION</span>
        </div>
      </div>
      {selectedSat && (
        <div className="map-sat-badge">
          <span className="map-sat-badge-dot" />
          {selectedSat.slice(0, 22)} — 90min track active
        </div>
      )}
    </div>
  );
}
