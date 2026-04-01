/** Convert geodetic lat/lon to Mercator canvas pixel coordinates. */
export function latLonToMercator(lat, lon, width, height) {
  const x = ((lon + 180) / 360) * width;
  const latRad = (lat * Math.PI) / 180;
  const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const y = height / 2 - (height * mercN) / (2 * Math.PI);
  return [x, y];
}

/** Compute the solar subsatellite point (approx.) for terminator rendering. */
export function getSolarPosition(dateMs) {
  // Approximate solar declination and right ascension
  const dayOfYear = (dateMs - Date.UTC(new Date(dateMs).getUTCFullYear(), 0, 0)) / 86400000;
  const dec = -23.45 * Math.cos((2 * Math.PI * (dayOfYear + 10)) / 365.25);
  const gmst = ((dateMs / 86400000) % 1) * 360 - 180;
  return { lat: dec, lon: gmst };
}

/** Generate terminator line points (day/night boundary). */
export function getTerminatorPoints(dateMs, numPoints = 360) {
  const solar = getSolarPosition(dateMs);
  const sunLat = (solar.lat * Math.PI) / 180;
  const sunLon = (solar.lon * Math.PI) / 180;
  const points = [];

  for (let i = 0; i <= numPoints; i++) {
    const angle = (i / numPoints) * 2 * Math.PI;
    const lat = Math.asin(
      Math.sin(sunLat) * Math.cos(Math.PI / 2) +
      Math.cos(sunLat) * Math.sin(Math.PI / 2) * Math.cos(angle)
    );
    const lon =
      sunLon +
      Math.atan2(
        Math.sin(angle) * Math.sin(Math.PI / 2) * Math.cos(sunLat),
        Math.cos(Math.PI / 2) - Math.sin(sunLat) * Math.sin(lat)
      );
    points.push([
      (lat * 180) / Math.PI,
      ((lon * 180) / Math.PI + 180) % 360 - 180,
    ]);
  }
  return points;
}

/** Fuel percentage → CSS color gradient (green → yellow → red). */
export function fuelColor(pct) {
  if (pct > 60) return `hsl(160, 80%, 55%)`;
  if (pct > 30) return `hsl(${40 + (pct - 30) * 2.4}, 90%, 55%)`;
  return `hsl(${pct * 1.33}, 85%, 55%)`;
}

/** Status → color map. */
export const STATUS_COLORS = {
  NOMINAL:   '#00e5a0',
  EVASION:   '#a55eea',
  RECOVERY:  '#ffd32a',
  GRAVEYARD: '#576574',
  DEAD:      '#ff4757',
};
