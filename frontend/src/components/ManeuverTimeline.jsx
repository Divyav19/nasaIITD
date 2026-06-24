import { useMemo } from 'react';

const COOLDOWN_S = 600;
const WINDOW_MS  = 4 * 3600 * 1000; // 4-hour view window

export default function ManeuverTimeline({ snapshot }) {
  const burns = snapshot?.scheduled_burns ?? [];
  const simTs = snapshot?.timestamp ? new Date(snapshot.timestamp).getTime() : Date.now();

  const windowEnd = simTs + WINDOW_MS;

  // Group burns by satellite
  const bySat = useMemo(() => {
    const map = {};
    for (const b of burns) {
      if (!map[b.sat_id]) map[b.sat_id] = [];
      map[b.sat_id].push(b);
    }
    return map;
  }, [burns]);

  const satIds = Object.keys(bySat).sort();

  if (satIds.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'rgba(200,216,232,0.3)', fontSize: 11 }}>
          No scheduled maneuvers
        </span>
      </div>
    );
  }

  const tsToX = (ts) => {
    const pct = (ts - simTs) / WINDOW_MS;
    return Math.max(0, Math.min(pct, 1)) * 100 + '%';
  };

  const durToW = (ms) => {
    return Math.max(2, (ms / WINDOW_MS) * 100) + '%';
  };

  // Time axis ticks (every 30 min)
  const ticks = [];
  for (let t = simTs; t <= windowEnd; t += 30 * 60 * 1000) {
    const d = new Date(t);
    ticks.push({
      pct: ((t - simTs) / WINDOW_MS) * 100,
      label: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`,
    });
  }

  return (
    <div className="gantt-scroll">
      {/* Time ruler */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 5, height: 18,
        background: '#0d1929', borderBottom: '1px solid rgba(32,180,255,0.1)',
        display: 'flex', alignItems: 'flex-end',
        paddingLeft: 96,
      }}>
        <div style={{ position: 'relative', flex: 1, height: '100%', minWidth: 400 }}>
          {ticks.map((tick) => (
            <div
              key={tick.pct}
              style={{
                position: 'absolute', left: `${tick.pct}%`,
                bottom: 2, fontSize: 8, fontFamily: 'JetBrains Mono, monospace',
                color: 'rgba(200,216,232,0.35)',
                transform: 'translateX(-50%)',
                whiteSpace: 'nowrap',
              }}
            >
              {tick.label}
            </div>
          ))}
          {/* Now marker */}
          <div style={{
            position: 'absolute', left: '0%', top: 0, bottom: 0,
            width: 1.5, background: '#20b4ff99',
          }} />
        </div>
      </div>

      {/* Gantt rows */}
      <div className="gantt-track">
        {satIds.map((satId) => {
          const satBurns = bySat[satId];
          return (
            <div className="gantt-row" key={satId} id={`gantt-${satId}`}>
              <div className="gantt-sat-label">{satId.slice(-8)}</div>
              <div className="gantt-track-area">
                {satBurns.map((burn, bi) => {
                  const bTs = new Date(burn.burn_time).getTime();
                  const isEvasion = burn.burn_id.includes('EVASION');
                  const isRecovery = burn.burn_id.includes('RECOVERY');
                  const blockMs = 120 * 1000; // visual width ~2min

                  return (
                    <div key={burn.burn_id}>
                      {/* Burn block */}
                      <div
                        className={`gantt-block ${isRecovery ? 'recovery' : isEvasion ? 'evasion' : 'burn'}`}
                        style={{
                          left: tsToX(bTs),
                          width: '32px',
                        }}
                        title={`${burn.burn_id}\nΔV: ${burn.dv_mag_ms} m/s`}
                      >
                        {burn.dv_mag_ms}
                      </div>

                      {/* Cooldown stripe after burns (except last) */}
                      {bi < satBurns.length - 1 && (
                        <div
                          className="gantt-block cooldown"
                          style={{
                            left: tsToX(bTs + blockMs),
                            width: durToW(COOLDOWN_S * 1000),
                          }}
                          title="600s thermal cooldown"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
