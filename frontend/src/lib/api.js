// Production: https://aether-acm-backend.onrender.com
// Development: http://localhost:8000
const BASE = import.meta.env.VITE_API_BASE ?? 'https://aether-acm-backend.onrender.com';


async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

export const api = {
  // GET /api/visualization/snapshot
  snapshot: () => request('/api/visualization/snapshot'),

  // POST /api/simulate/step
  step: (stepSeconds = 3600) =>
    request('/api/simulate/step', {
      method: 'POST',
      body: JSON.stringify({ step_seconds: stepSeconds }),
    }),

  // POST /api/telemetry
  ingestTelemetry: (payload) =>
    request('/api/telemetry', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // POST /api/maneuver/schedule
  scheduleManeuver: (payload) =>
    request('/api/maneuver/schedule', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // GET /api/insight/{sat_id} — Explainable AI + TCA + strategies
  insight: (satId) => request(`/api/insight/${encodeURIComponent(satId)}`),

  // GET /api/insight/{sat_id}/trajectory?minutes=90
  trajectory: (satId, minutes = 90) =>
    request(`/api/insight/${encodeURIComponent(satId)}/trajectory?minutes=${minutes}`),

  // GET /health
  health: () => request('/health'),
};
