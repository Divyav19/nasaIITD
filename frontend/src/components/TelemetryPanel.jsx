import { fuelColor } from '../lib/geoUtils';

export default function TelemetryPanel({ snapshot, selectedSat, onSelectSat }) {
  const sats = snapshot?.satellites ?? [];

  // Sort: selected first, then by fuel (ascending = most critical)
  const sorted = [...sats].sort((a, b) => {
    if (a.id === selectedSat) return -1;
    if (b.id === selectedSat) return 1;
    return a.fuel_pct - b.fuel_pct;
  });

  return (
    <div className="satellite-list">
      {sorted.map((sat) => {
        const fuelPct = sat.fuel_pct ?? 100;
        const color = fuelColor(fuelPct);
        const isSel = sat.id === selectedSat;

        return (
          <div
            key={sat.id}
            id={`sat-row-${sat.id}`}
            className={`satellite-row${isSel ? ' selected' : ''}`}
            onClick={() => onSelectSat?.(isSel ? null : sat.id)}
            title={`${sat.id} — ${sat.status} — Fuel: ${sat.fuel_kg?.toFixed(2)} kg`}
          >
            <span className="sat-id">{sat.id}</span>

            <div className="fuel-bar-wrap" title={`Fuel: ${fuelPct.toFixed(1)}%`}>
              <div
                className="fuel-bar"
                style={{
                  width: `${Math.max(fuelPct, 0)}%`,
                  background: `linear-gradient(90deg, ${color}99, ${color})`,
                }}
              />
            </div>

            <span className="mono text-xxs text-dim" style={{ width: 34, textAlign: 'right', flexShrink: 0 }}>
              {fuelPct.toFixed(0)}%
            </span>

            <span className={`status-badge status-${sat.status}`}>
              {sat.status}
            </span>
          </div>
        );
      })}

      {sats.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px', color: 'rgba(200,216,232,0.3)' }}>
          No satellite telemetry
        </div>
      )}
    </div>
  );
}
