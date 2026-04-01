/**
 * ExplainableAIPanel.jsx
 *
 * Explainable AI decision panel for AETHER ACM.
 * Fetches /api/insight/{sat_id} and renders:
 *  - TCA (Time of Closest Approach) events
 *  - Risk before → after
 *  - Multi-strategy comparison with optimization scores
 *  - Anti-gravity phasing callout
 *  - Fuel / delta-v breakdown
 */

import { useState, useEffect, useRef } from 'react';

const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';

const RISK_COLOR = {
  NOMINAL:   'var(--color-green)',
  WARNING:   'var(--color-yellow)',
  CRITICAL:  'var(--color-red)',
  COLLISION: '#ff0020',
  EVASION:   'var(--color-purple)',
  RECOVERY:  'var(--color-yellow)',
};

const SEV_GLYPH = { COLLISION: '☠', CRITICAL: '⚠', WARNING: '⚠', NOMINAL: '●' };

function ScoreBar({ score, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        flex: 1, height: 4, background: 'var(--color-deep)',
        borderRadius: 2, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', width: `${score}%`,
          background: `linear-gradient(90deg, ${color}88, ${color})`,
          borderRadius: 2,
          transition: 'width 0.6s ease',
        }} />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color, width: 28, textAlign: 'right' }}>
        {score.toFixed(0)}
      </span>
    </div>
  );
}

export default function ExplainableAIPanel({ selectedSat, snapshot }) {
  const [insight, setInsight] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const timerRef = useRef(null);

  const effectiveSat = selectedSat || snapshot?.satellites?.[0]?.id;

  useEffect(() => {
    if (!effectiveSat) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`${BASE}/api/insight/${encodeURIComponent(effectiveSat)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setInsight(data);
      } catch (e) {
        if (!cancelled) setErr(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    timerRef.current = setInterval(load, 5000);  // refresh every 5s
    return () => { cancelled = true; clearInterval(timerRef.current); };
  }, [effectiveSat]);

  if (!effectiveSat) {
    return (
      <div className="xai-empty">
        <span>Select a satellite to view AI decision reasoning</span>
      </div>
    );
  }

  if (loading && !insight) {
    return <div className="xai-empty"><span className="xai-loading">⟳ Analyzing...</span></div>;
  }

  if (err) {
    return <div className="xai-empty" style={{ color: 'var(--color-red)' }}>⚠ {err}</div>;
  }

  if (!insight) return null;

  const bestStrategy = insight.strategies.reduce((a, b) =>
    a.optimization_score > b.optimization_score ? a : b
  );

  return (
    <div className="xai-panel">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="xai-sat-header">
        <div className="xai-sat-id">{insight.sat_id}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className={`status-badge status-${insight.status}`}>{insight.status}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(200,216,232,0.5)' }}>
            {insight.timestamp.slice(11, 19)} UTC
          </span>
        </div>
      </div>

      {/* ── Quick Stats Strip ────────────────────────────────────────────── */}
      <div className="xai-stats-row">
        <div className="xai-stat">
          <span className="xai-stat-label">Fuel</span>
          <span className="xai-stat-val" style={{ color: insight.fuel_pct > 50 ? 'var(--color-green)' : insight.fuel_pct > 20 ? 'var(--color-yellow)' : 'var(--color-red)' }}>
            {insight.fuel_pct.toFixed(1)}%
          </span>
        </div>
        <div className="xai-stat">
          <span className="xai-stat-label">ΔV Used</span>
          <span className="xai-stat-val">{insight.total_dv_used_ms.toFixed(1)} m/s</span>
        </div>
        <div className="xai-stat">
          <span className="xai-stat-label">CA Avoided</span>
          <span className="xai-stat-val" style={{ color: 'var(--color-green)' }}>
            {insight.collisions_avoided}
          </span>
        </div>
        <div className="xai-stat">
          <span className="xai-stat-label">Opt Score</span>
          <span className="xai-stat-val" style={{ color: 'var(--color-cyan)' }}>
            {insight.optimization_score.toFixed(0)}
          </span>
        </div>
      </div>

      {/* ── Last Maneuver Trigger ─────────────────────────────────────────── */}
      {insight.last_trigger && (
        <div className="xai-section">
          <div className="xai-section-title">⚡ Last Trigger</div>
          <div className="xai-trigger-box">
            <p className="xai-trigger-text">{insight.last_trigger}</p>
            <div className="xai-risk-row">
              <div className="xai-risk-chip" style={{ borderColor: RISK_COLOR[insight.risk_before], color: RISK_COLOR[insight.risk_before] }}>
                BEFORE: {insight.risk_before}
              </div>
              <div className="xai-arrow">→</div>
              <div className="xai-risk-chip" style={{ borderColor: RISK_COLOR[insight.risk_after], color: RISK_COLOR[insight.risk_after] }}>
                AFTER: {insight.risk_after}
              </div>
              {insight.fuel_consumed_last_kg > 0 && (
                <div className="xai-fuel-chip">
                  -{(insight.fuel_consumed_last_kg * 1000).toFixed(2)} g propellant
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── TCA Events ────────────────────────────────────────────────────── */}
      <div className="xai-section">
        <div className="xai-section-title">
          ⏱ Time of Closest Approach (next 24h)
          <span className="xai-badge">{insight.tca_events.length}</span>
        </div>
        {insight.tca_events.length === 0 ? (
          <div className="xai-tca-safe">✓ No conjunctions predicted in next 24 hours</div>
        ) : (
          <div className="xai-tca-list">
            {insight.tca_events.slice(0, 5).map((evt, i) => (
              <div key={i} className="xai-tca-row" style={{ borderLeftColor: RISK_COLOR[evt.severity] }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="xai-tca-debris">{SEV_GLYPH[evt.severity]} {evt.debris_id}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: RISK_COLOR[evt.severity] }}>
                    {evt.miss_distance_km.toFixed(3)} km
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                  <span className="xai-tca-time">TCA in {Math.round(evt.seconds_until_tca / 60)} min</span>
                  <span className={`status-badge status-${evt.severity === 'COLLISION' ? 'DEAD' : evt.severity === 'CRITICAL' ? 'DEAD' : 'EVASION'}`}
                    style={{ fontSize: 7 }}>
                    {evt.severity}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Strategy Comparison ───────────────────────────────────────────── */}
      <div className="xai-section">
        <div className="xai-section-title">🔀 Alternative Strategies</div>
        <div className="xai-strategies">
          {insight.strategies.map((s, i) => {
            const isBest = s.name === bestStrategy.name;
            const scoreColor = s.optimization_score >= 80 ? 'var(--color-green)' :
                               s.optimization_score >= 60 ? 'var(--color-yellow)' : 'var(--color-red)';
            return (
              <div key={i} className={`xai-strategy-card${isBest ? ' xai-strategy-best' : ''}`}>
                <div className="xai-strategy-header">
                  <span className="xai-strategy-name">
                    {isBest && '★ '}{s.name}
                  </span>
                  <span className="xai-strategy-dv">{s.dv_ms.toFixed(1)} m/s</span>
                </div>
                <ScoreBar score={s.optimization_score} color={scoreColor} />
                <div className="xai-strategy-meta">
                  <span>⛽ {(s.fuel_cost_kg * 1000).toFixed(1)}g</span>
                  <span style={{ color: RISK_COLOR[s.risk_after] }}>→ {s.risk_after}</span>
                  <span>⏱ {Math.round(s.uptime_impact_s / 60)}m downtime</span>
                </div>
                <p className="xai-strategy-desc">{s.description}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Anti-Gravity Phasing Callout ─────────────────────────────────── */}
      <div className="xai-section">
        <div className="xai-phasing-callout">
          <div className="xai-phasing-header">
            <span className="xai-phasing-icon">⚛</span>
            <span className="xai-phasing-title">Anti-Gravity Phasing Insight</span>
            <span className="xai-phasing-save">-{insight.phasing_dv_saving_pct.toFixed(0)}% fuel</span>
          </div>
          <p className="xai-phasing-text">{insight.phasing_insight}</p>
        </div>
      </div>

    </div>
  );
}
