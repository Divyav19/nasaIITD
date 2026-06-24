/**
 * TelemetryPanel.jsx — AETHER ACM v2
 *
 * Displays per-satellite telemetry in a rich scrollable table:
 *   - Satellite ID + clickable row selection
 *   - Status badge (colour-coded)
 *   - Fuel bar: filled fraction + percentage text + kg label
 *   - ΔV budget remaining (km/s and m/s)
 *   - Collisions avoided counter
 *   - Altitude (km)
 *   - WebSocket feed indicator in panel header
 *
 * Props:
 *   snapshot    {object}   — live snapshot from useVisualization/useWebSocket
 *   selectedSat {string}   — currently selected satellite ID
 *   onSelectSat {function} — callback when a row is clicked
 *   wsConnected {boolean}  — optional, true if data is coming via WebSocket
 */

import { useMemo } from 'react';
import { fuelColor, STATUS_COLORS } from '../lib/geoUtils';

const MAX_DV_KPS = 0.015 * 30; // heuristic max total DV budget displayed (30 evasions)
const M_FUEL_INIT = 50.0;      // kg — matches backend constant

const STATUS_LABEL = {
  NOMINAL:   'NOM',
  EVASION:   'EVA',
  RECOVERY:  'REC',
  GRAVEYARD: 'GYD',
  DEAD:      'DEAD',
};

function FuelBar({ pct, fuel_kg }) {
  const color = fuelColor(pct);
  return (
    <div className="telemetry-fuel-wrap" title={`${fuel_kg.toFixed(2)} kg remaining`}>
      <div
        className="telemetry-fuel-bar"
        style={{
          width: `${Math.max(2, pct)}%`,
          background: color,
          boxShadow: pct < 20 ? `0 0 4px ${color}` : 'none',
        }}
      />
      <span className="telemetry-fuel-label">{pct.toFixed(0)}%</span>
    </div>
  );
}

function StatusBadge({ status }) {
  const color = STATUS_COLORS[status] ?? '#8899aa';
  return (
    <span
      className="telemetry-status-badge"
      style={{ color, borderColor: color + '66', background: color + '14' }}
    >
      {STATUS_LABEL[status] ?? status.slice(0, 4)}
    </span>
  );
}

function DVBar({ dv_kmps }) {
  const pct = Math.min(100, (dv_kmps / MAX_DV_KPS) * 100);
  const dv_ms = (dv_kmps * 1000).toFixed(1);
  return (
    <div className="telemetry-dv-wrap" title={`${dv_ms} m/s total ΔV spent`}>
      <div className="telemetry-dv-bar" style={{ width: `${pct}%` }} />
      <span className="telemetry-dv-label">{dv_ms} m/s</span>
    </div>
  );
}

export default function TelemetryPanel({ snapshot, selectedSat, onSelectSat, wsConnected }) {
  const sats = useMemo(() => {
    if (!snapshot?.satellites) return [];
    // Sort: status-priority first, then alphabetically
    const ORDER = { EVASION: 0, RECOVERY: 1, GRAVEYARD: 2, DEAD: 3, NOMINAL: 4 };
    return [...snapshot.satellites].sort((a, b) =>
      (ORDER[a.status] ?? 4) - (ORDER[b.status] ?? 4) || a.id.localeCompare(b.id)
    );
  }, [snapshot]);

  const stats = snapshot?.stats ?? {};

  return (
    <div className="telemetry-panel">
      {/* Sub-header with connection indicator */}
      <div className="telemetry-meta">
        <span className="telemetry-meta-count">
          {sats.length} satellites · {stats.total_debris ?? 0} debris
        </span>
        <span
          className="telemetry-ws-badge"
          title={wsConnected ? 'WebSocket live stream' : 'HTTP polling (1 Hz)'}
          style={{ color: wsConnected ? '#00e5a0' : '#ffd32a' }}
        >
          {wsConnected ? '⬡ WS' : '⟳ POLL'}
        </span>
      </div>

      {/* Column headers */}
      <div className="telemetry-header-row">
        <span className="tcol id">SATELLITE ID</span>
        <span className="tcol status">ST</span>
        <span className="tcol fuel">FUEL</span>
        <span className="tcol dv">ΔV SPENT</span>
        <span className="tcol alt">ALT km</span>
        <span className="tcol ca">CA</span>
      </div>

      {/* Rows */}
      <div className="telemetry-scroll">
        {sats.length === 0 && (
          <div className="telemetry-empty">Waiting for satellite data…</div>
        )}
        {sats.map(sat => {
          const isSel = sat.id === selectedSat;
          return (
            <div
              key={sat.id}
              className={`telemetry-row${isSel ? ' telemetry-row-selected' : ''}`}
              onClick={() => onSelectSat?.(sat.id === selectedSat ? null : sat.id)}
              id={`telem-row-${sat.id}`}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && onSelectSat?.(sat.id)}
              aria-selected={isSel}
            >
              {/* ID */}
              <span className="tcol id" title={sat.id}>
                {isSel && <span className="telem-sel-dot" />}
                {sat.id.slice(0, 18)}
              </span>

              {/* Status badge */}
              <span className="tcol status">
                <StatusBadge status={sat.status} />
              </span>

              {/* Fuel bar */}
              <span className="tcol fuel">
                <FuelBar pct={sat.fuel_pct ?? 100} fuel_kg={sat.fuel_kg ?? M_FUEL_INIT} />
              </span>

              {/* ΔV bar */}
              <span className="tcol dv">
                <DVBar dv_kmps={sat.total_dv_kmps ?? 0} />
              </span>

              {/* Altitude */}
              <span className="tcol alt" style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 9 }}>
                {sat.alt_km?.toFixed(0) ?? '—'}
              </span>

              {/* Collisions avoided */}
              <span
                className="tcol ca"
                style={{
                  fontFamily: 'JetBrains Mono,monospace',
                  fontSize: 9,
                  color: sat.collisions_avoided > 0 ? '#00e5a0' : 'rgba(200,216,232,0.3)',
                }}
              >
                {sat.collisions_avoided ?? 0}
              </span>
            </div>
          );
        })}
      </div>

      {/* Footer summary */}
      <div className="telemetry-footer">
        <span>⚡ {stats.burns_executed ?? 0} burns</span>
        <span>⚠ {stats.active_cdm_warnings ?? 0} CDMs</span>
        <span style={{ color: stats.collisions_total > 0 ? '#ff4757' : 'rgba(200,216,232,0.3)' }}>
          ✕ {stats.collisions_total ?? 0} collisions
        </span>
      </div>
    </div>
  );
}
