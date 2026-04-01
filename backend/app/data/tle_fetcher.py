"""
tle_fetcher.py — Fetches real Two-Line Element (TLE) data from CelesTrak.

CelesTrak GP API: https://celestrak.org/NORAD/elements/gp.php?GROUP=<name>&FORMAT=tle
Data is cached locally for 2 hours to respect CelesTrak's rate limits.

TLE → ECI conversion uses standard formulas:
  1. Parse TLE → Keplerian elements (a, e, i, RAAN, argp, M0, epoch)
  2. Propagate mean anomaly to current time (Kepler's equation)
  3. Feed into keplerian_to_eci (already exists in physics/propagator.py)
"""

import math
import time
import json
import os
import logging
import urllib.request
import urllib.error
from datetime import datetime, timezone
from typing import Optional

import numpy as np

log = logging.getLogger("aether.tle_fetcher")

# ─── Config ───────────────────────────────────────────────────────────────────

CELESTRAK_BASE = "https://celestrak.org/NORAD/elements/gp.php?GROUP={group}&FORMAT=tle"
CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")
CACHE_TTL_SECONDS = 7200  # 2 hours

# Satellite groups to use as "managed" satellites
SAT_GROUPS = [
    "iridium",          # ~65 real Iridium sats (original constellation + NEXT)
    "noaa",             # NOAA weather sats
]

# Debris groups — real collision debris clouds
DEBRIS_GROUPS = [
    "cosmos-2251-debris",   # ~580 tracked pieces from 2009 Kosmos/Iridium collision
    "iridium-33-debris",    # ~110 debris from the same event
]

# Fallback: smaller additional sat groups if primary fetch fails
FALLBACK_SAT_GROUPS = ["stations", "weather"]  # ISS, Tianhe, weather sats

# ─── Cache helpers ────────────────────────────────────────────────────────────

os.makedirs(CACHE_DIR, exist_ok=True)


def _cache_path(group: str) -> str:
    return os.path.join(CACHE_DIR, f"{group.replace('-', '_')}.json")


def _load_cache(group: str) -> Optional[list[str]]:
    """Return cached TLE lines if cache is fresh, else None."""
    path = _cache_path(group)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r") as f:
            data = json.load(f)
        age = time.time() - data["fetched_at"]
        if age < CACHE_TTL_SECONDS:
            log.info(f"[TLE] Cache hit for '{group}' (age {age:.0f}s)")
            return data["lines"]
        log.info(f"[TLE] Cache expired for '{group}' (age {age:.0f}s)")
    except Exception as e:
        log.warning(f"[TLE] Cache read error for '{group}': {e}")
    return None


def _save_cache(group: str, lines: list[str]):
    path = _cache_path(group)
    try:
        with open(path, "w") as f:
            json.dump({"fetched_at": time.time(), "lines": lines}, f)
    except Exception as e:
        log.warning(f"[TLE] Cache write error for '{group}': {e}")


# ─── HTTP fetch ───────────────────────────────────────────────────────────────

def _fetch_tle_group(group: str) -> Optional[list[str]]:
    """Fetch raw TLE text from CelesTrak and return as list of lines."""
    cached = _load_cache(group)
    if cached is not None:
        return cached

    url = CELESTRAK_BASE.format(group=group)
    log.info(f"[TLE] Fetching '{group}' from CelesTrak: {url}")
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "ProjectAETHER/1.0 (hackathon-demo; contact@aether.edu)"}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            text = resp.read().decode("utf-8", errors="replace")

        # Validate — CelesTrak returns "Invalid query" on bad group name
        if "Invalid query" in text or len(text.strip()) < 60:
            log.warning(f"[TLE] '{group}' returned invalid/empty: {text[:80]!r}")
            return None

        lines = [l.strip() for l in text.splitlines() if l.strip()]
        log.info(f"[TLE] '{group}' fetched {len(lines)} raw lines "
                 f"({len(lines) // 3} objects)")
        _save_cache(group, lines)
        return lines

    except urllib.error.HTTPError as e:
        log.warning(f"[TLE] HTTP {e.code} for '{group}': {e.reason}")
    except urllib.error.URLError as e:
        log.warning(f"[TLE] URL error for '{group}': {e.reason}")
    except Exception as e:
        log.warning(f"[TLE] Unexpected error for '{group}': {e}")
    return None


# ─── TLE parsing ──────────────────────────────────────────────────────────────

def _parse_tle_blocks(lines: list[str]) -> list[dict]:
    """
    Parse TLE text lines into structured dicts.
    Returns list of {name, line1, line2} blocks.
    """
    blocks = []
    i = 0
    while i < len(lines):
        # TLE format: name line, then 2 data lines starting with '1 ' and '2 '
        if (i + 2 < len(lines)
                and lines[i+1].startswith("1 ")
                and lines[i+2].startswith("2 ")):
            blocks.append({
                "name": lines[i],
                "line1": lines[i+1],
                "line2": lines[i+2],
            })
            i += 3
        else:
            i += 1
    return blocks


def _tle_to_keplerian(block: dict, epoch: datetime) -> Optional[dict]:
    """
    Convert TLE block to Keplerian elements at the given epoch.

    Returns:
        {name, norad_id, a, e, i, raan, argp, ta, epoch_delta_s}
        or None if parsing fails.

    TLE line 2 format (fixed-width):
      Col 1:     '2'
      Col 3-7:   NORAD catalog number
      Col 9-16:  Inclination (°)
      Col 18-25: RAAN (°)
      Col 27-33: Eccentricity (leading decimal point omitted)
      Col 35-42: Argument of Perigee (°)
      Col 44-51: Mean Anomaly (°)
      Col 53-63: Mean Motion (rev/day)
    """
    try:
        l1 = block["line1"]
        l2 = block["line2"]
        name = block["name"].strip()

        norad_id = int(l2[2:7].strip())
        inc_deg  = float(l2[8:16].strip())
        raan_deg = float(l2[17:25].strip())
        ecc      = float("0." + l2[26:33].strip())
        argp_deg = float(l2[34:42].strip())
        M0_deg   = float(l2[43:51].strip())
        n_rev_d  = float(l2[52:63].strip())   # mean motion [rev/day]

        # TLE epoch from line 1: YYDDD.DDDDDDDD
        epoch_str = l1[18:32].strip()
        yr2 = int(epoch_str[:2])
        yr = 2000 + yr2 if yr2 < 57 else 1900 + yr2
        day_frac = float(epoch_str[2:])
        day_of_year = int(day_frac)
        frac_day = day_frac - day_of_year
        tle_epoch = datetime(yr, 1, 1, tzinfo=timezone.utc) + \
                    __import__("datetime").timedelta(days=day_of_year - 1 + frac_day)

        # Propagate mean anomaly from TLE epoch to current sim epoch
        n_rad_s = n_rev_d * 2 * math.pi / 86400.0   # rad/s
        dt = (epoch - tle_epoch).total_seconds()
        M = math.radians(M0_deg) + n_rad_s * dt
        M = M % (2 * math.pi)

        # Solve Kepler's equation E - e*sin(E) = M (Newton-Raphson)
        E = M
        for _ in range(50):
            dE = (M - E + ecc * math.sin(E)) / (1.0 - ecc * math.cos(E))
            E += dE
            if abs(dE) < 1e-12:
                break

        # True anomaly from eccentric anomaly
        ta = 2.0 * math.atan2(
            math.sqrt(1 + ecc) * math.sin(E / 2),
            math.sqrt(1 - ecc) * math.cos(E / 2)
        )

        # Semi-major axis from mean motion: n = sqrt(mu/a^3) → a = (mu/n^2)^(1/3)
        MU = 398600.4418   # km³/s²
        a = (MU / (n_rad_s ** 2)) ** (1.0 / 3.0)

        return {
            "name":    name,
            "norad_id": norad_id,
            "a":       a,
            "e":       ecc,
            "i":       math.radians(inc_deg),
            "raan":    math.radians(raan_deg),
            "argp":    math.radians(argp_deg),
            "ta":      ta,
        }
    except Exception as ex:
        log.debug(f"[TLE] Parse error for '{block.get('name', '?')}': {ex}")
        return None


# ─── Public API ───────────────────────────────────────────────────────────────

def fetch_real_satellites(epoch: datetime, max_count: int = 80) -> list[dict]:
    """
    Fetch real satellite TLEs and return Keplerian elements.

    Args:
        epoch:     The simulation epoch datetime (UTC).
        max_count: Maximum number of satellites to return.

    Returns:
        List of Keplerian element dicts (see _tle_to_keplerian).
    """
    results = []
    groups_to_try = SAT_GROUPS + FALLBACK_SAT_GROUPS

    for group in groups_to_try:
        if len(results) >= max_count:
            break
        lines = _fetch_tle_group(group)
        if not lines:
            continue
        blocks = _parse_tle_blocks(lines)
        for blk in blocks:
            if len(results) >= max_count:
                break
            kep = _tle_to_keplerian(blk, epoch)
            if kep and _is_valid_leo(kep):
                kep["source_group"] = group
                results.append(kep)

    log.info(f"[TLE] Loaded {len(results)} real satellites")
    return results


def fetch_real_debris(epoch: datetime, max_count: int = 2000) -> list[dict]:
    """
    Fetch real debris TLEs and return Keplerian elements.
    Uses Cosmos-2251 and Iridium-33 debris clouds.

    Args:
        epoch:     The simulation epoch datetime (UTC).
        max_count: Maximum number of debris objects to return.

    Returns:
        List of Keplerian element dicts.
    """
    results = []

    for group in DEBRIS_GROUPS:
        if len(results) >= max_count:
            break
        lines = _fetch_tle_group(group)
        if not lines:
            log.warning(f"[TLE] Could not fetch debris group '{group}', skipping")
            continue
        blocks = _parse_tle_blocks(lines)
        for blk in blocks:
            if len(results) >= max_count:
                break
            kep = _tle_to_keplerian(blk, epoch)
            if kep and _is_valid_leo(kep):
                kep["source_group"] = group
                results.append(kep)

    log.info(f"[TLE] Loaded {len(results)} real debris objects")
    return results


def _is_valid_leo(kep: dict) -> bool:
    """Filter to low-Earth orbit objects (100–2000 km altitude, eccentricity < 0.3)."""
    R_EARTH = 6378.137
    alt_km = kep["a"] - R_EARTH
    return (100.0 <= alt_km <= 2000.0) and (kep["e"] < 0.3)
