import { useState } from 'react';
import './index.css';

import { useVisualization } from './hooks/useVisualization';
import { useSimulation }    from './hooks/useSimulation';

import GroundTrackMap       from './components/GroundTrackMap';
import ConjunctionBullseye  from './components/ConjunctionBullseye';
import TelemetryPanel       from './components/TelemetryPanel';
import DVChart              from './components/DVChart';
import ManeuverTimeline     from './components/ManeuverTimeline';
import ExplainableAIPanel   from './components/ExplainableAIPanel';
import FleetHeatmap         from './components/FleetHeatmap';
import MultiFutureSimView   from './components/MultiFutureSimView';

const STEP_OPTIONS = [
  { label: '+1 min',   value: 60    },
  { label: '+10 min',  value: 600   },
  { label: '+1 hr',    value: 3600  },
  { label: '+6 hr',    value: 21600 },
  { label: '+24 hr',   value: 86400 },
];

// Tab definitions for the right panel
const RIGHT_TABS = [
  { id: 'telemetry', label: '⬡ Telemetry' },
  { id: 'xai',       label: '⚡ AI Insight' },
  { id: 'heatmap',   label: '◈ Fleet Map' },
];

// Tab definitions for the bottom strip
const BOTTOM_TABS = [
  { id: 'timeline',  label: '▷ Timeline' },
  { id: 'dvchart',   label: '△ ΔV Cost' },
  { id: 'multisim',  label: '⟁ Multi-Sim' },
];

function TabBar({ tabs, active, onSelect }) {
  return (
    <div className="tab-bar" role="tablist">
      {tabs.map(t => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          className={`tab-btn${active === t.id ? ' tab-active' : ''}`}
          onClick={() => onSelect(t.id)}
          id={`tab-${t.id}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const { snapshot, error, loading, wsConnected } = useVisualization();
  const { step, stepping, stepSeconds, setStepSeconds } = useSimulation();
  const [selectedSat, setSelectedSat]   = useState(null);
  const [rightTab, setRightTab]         = useState('telemetry');
  const [bottomTab, setBottomTab]       = useState('timeline');

  const stats      = snapshot?.stats ?? {};
  const cdmCount   = stats.active_cdm_warnings ?? 0;
  const collisions = stats.collisions_total ?? 0;

  return (
    <div className="app-shell">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="app-header" role="banner">
        <div className="app-logo">
          <div className="logo-icon">
            <div className="logo-orbit" aria-hidden="true" />
          </div>
          <div className="logo-text">
            <span className="logo-title">AETHER</span>
            <span className="logo-sub">Orbital Insight — ACM v1.0</span>
          </div>
        </div>

        <div className="header-stats" aria-label="Global statistics">
          <div className="header-stat">
            <span className="stat-value">{stats.total_satellites ?? '—'}</span>
            <span className="stat-label">Satellites</span>
          </div>
          <div className="header-stat">
            <span className="stat-value">{stats.total_debris ?? '—'}</span>
            <span className="stat-label">Debris</span>
          </div>
          <div className="header-stat">
            <span className={`stat-value ${cdmCount > 0 ? (cdmCount > 3 ? 'critical' : 'warning') : 'good'}`}>
              {cdmCount}
            </span>
            <span className="stat-label">CDM Alerts</span>
          </div>
          <div className="header-stat">
            <span className={`stat-value ${collisions > 0 ? 'critical' : 'good'}`}>
              {collisions}
            </span>
            <span className="stat-label">Collisions</span>
          </div>
          <div className="header-stat">
            <span className="stat-value">{stats.burns_executed ?? 0}</span>
            <span className="stat-label">Burns Exec</span>
          </div>
        </div>

        <div className="header-actions">
          <div className="live-indicator" aria-live="polite">
            <div className="live-dot" />
            LIVE
          </div>

          <div className="sim-time" aria-label="Simulation time">
            {snapshot?.timestamp
              ? new Date(snapshot.timestamp).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
              : 'Connecting...'}
          </div>

          <select
            id="step-select"
            value={stepSeconds}
            onChange={e => setStepSeconds(Number(e.target.value))}
            style={{
              background: 'var(--color-deep)', color: 'var(--color-cyan)',
              border: '1px solid var(--color-border-bright)', borderRadius: 'var(--radius-sm)',
              padding: '4px 8px', fontFamily: 'var(--font-mono)', fontSize: 11,
              cursor: 'pointer',
            }}
            aria-label="Step duration"
          >
            {STEP_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <button
            id="step-btn"
            className={`step-btn${stepping ? ' stepping' : ''}`}
            onClick={() => step()}
            disabled={stepping}
            aria-label="Advance simulation"
          >
            {stepping ? '⟳ Stepping...' : '▶ STEP SIM'}
          </button>
        </div>
      </header>

      {/* ── Main Layout ─────────────────────────────────────────────────────── */}
      <div className="main-layout" role="main">

        {/* ── Ground Track Map (left, top) ─────────────────────────────────── */}
        <section className="panel ground-track-panel" aria-label="Ground Track Map">
          <div className="panel-header">
            <div className="panel-title">
              <span>◎</span> Ground Track · Mercator
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {cdmCount > 0 && (
                <span className={`panel-badge ${cdmCount > 3 ? 'critical' : 'warning'}`}>
                  {cdmCount} CDM
                </span>
              )}
              <span className="panel-badge">{stats.total_satellites ?? 0} SATs</span>
              <span className="panel-badge text-dim">{stats.total_debris ?? 0} DEB</span>
            </div>
          </div>

          {/* CDM alert bar */}
          {(snapshot?.cdm_warnings?.length ?? 0) > 0 && (
            <div className="cdm-bar" role="alert" aria-label="Active CDM warnings">
              {snapshot.cdm_warnings.slice(0, 12).map((w, i) => (
                <div key={i} className={`cdm-chip ${w.severity}`}>
                  ⚠ {w.sat_id} ↔ {w.debris_id.slice(0, 10)} @ {w.miss_distance_km.toFixed(3)} km
                </div>
              ))}
            </div>
          )}

          <div className="panel-content">
            {loading && !snapshot && (
              <div className="loading-overlay">
                <div className="spinner" aria-label="Loading" />
              </div>
            )}
            {error && (
              <div style={{ padding: 16, color: 'var(--color-red)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                ⚠ Backend unreachable: {error}
              </div>
            )}
            <GroundTrackMap
              snapshot={snapshot}
              selectedSat={selectedSat}
              onSelectSat={setSelectedSat}
            />
          </div>
        </section>

        {/* ── Right Panel with tabs ────────────────────────────────────────── */}
        <div className="right-panel">

          {/* Conjunction Bullseye — always visible at top */}
          <section className="panel bullseye-panel" aria-label="Conjunction Bullseye">
            <div className="panel-header">
              <div className="panel-title">⊕ Conjunction Bullseye</div>
              {selectedSat && (
                <span className="panel-badge">{selectedSat.slice(0, 14)}</span>
              )}
            </div>
            <div className="panel-content">
              <ConjunctionBullseye snapshot={snapshot} selectedSat={selectedSat} />
            </div>
          </section>

          {/* Tabbed lower-right: Telemetry | AI Insight | Fleet Heatmap */}
          <section className="panel right-tab-panel" aria-label="Right panel tabs">
            <div className="panel-header" style={{ padding: 0, borderBottom: 'none' }}>
              <TabBar tabs={RIGHT_TABS} active={rightTab} onSelect={setRightTab} />
            </div>
            <div className="panel-content" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

              {rightTab === 'telemetry' && (
                <TelemetryPanel
                  snapshot={snapshot}
                  selectedSat={selectedSat}
                  onSelectSat={setSelectedSat}
                  wsConnected={wsConnected}
                />
              )}

              {rightTab === 'xai' && (
                <div className="panel-content" style={{ overflow: 'auto', flex: 1 }}>
                  <ExplainableAIPanel
                    selectedSat={selectedSat}
                    snapshot={snapshot}
                  />
                </div>
              )}

              {rightTab === 'heatmap' && (
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <FleetHeatmap snapshot={snapshot} />
                </div>
              )}

            </div>
          </section>

        </div>

        {/* ── Bottom Strip with tabs ───────────────────────────────────────── */}
        <div className="bottom-strip">

          {/* Tabbed bottom: Timeline | ΔV | Multi-Sim */}
          <section className="panel bottom-tab-panel" aria-label="Bottom panel tabs">
            <div className="panel-header" style={{ padding: '0 0 0 8px', gap: 12 }}>
              <TabBar tabs={BOTTOM_TABS} active={bottomTab} onSelect={setBottomTab} />
              {/* Existing legend badges for timeline tab */}
              {bottomTab === 'timeline' && (
                <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', paddingRight: 8 }}>
                  <span className="panel-badge" style={{ background: 'rgba(165,94,234,0.15)', color: 'var(--color-purple)', borderColor: 'var(--color-purple)' }}>EVASION</span>
                  <span className="panel-badge" style={{ background: 'var(--color-green-dim)', color: 'var(--color-green)', borderColor: 'var(--color-green)' }}>RECOVERY</span>
                  <span className="panel-badge" style={{ background: 'var(--color-yellow-dim)', color: 'var(--color-yellow)', borderColor: 'var(--color-yellow)' }}>COOLDOWN</span>
                </div>
              )}
              {bottomTab === 'multisim' && (
                <span style={{ marginLeft: 'auto', fontSize: 9, fontFamily: 'var(--font-mono)', color: 'rgba(200,216,232,0.4)', paddingRight: 8 }}>
                  ⚛ Anti-gravity phasing = minimum fuel strategy
                </span>
              )}
            </div>
            <div className="panel-content" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

              {bottomTab === 'timeline' && <ManeuverTimeline snapshot={snapshot} />}
              {bottomTab === 'dvchart'  && <DVChart snapshot={snapshot} />}
              {bottomTab === 'multisim' && (
                <MultiFutureSimView snapshot={snapshot} selectedSat={selectedSat} />
              )}

            </div>
          </section>

        </div>

      </div>
    </div>
  );
}
