"""
coordinates.py — Reference frame transformations for Project AETHER.

Conversions:
  - ECI position → Geodetic Latitude / Longitude / Altitude (LLA)
  - ECI ↔ RTN (Radial-Transverse-Normal) frame
  - LLA → ECEF (for ground station positions)
"""

import numpy as np
from .constants import R_EARTH


# ─── ECI → Geodetic (LLA) ────────────────────────────────────────────────────

def eci_to_lla(r_eci: np.ndarray, gmst: float = 0.0) -> tuple[float, float, float]:
    """
    Convert ECI position to Geodetic Latitude, Longitude, Altitude.

    Uses a simplified spherical Earth model (sufficient for visualization).
    For production, replace with iterative Bowring or Zhu algorithm.

    Args:
        r_eci: ECI position vector [x, y, z] in km
        gmst:  Greenwich Mean Sidereal Time in radians (rotation offset)

    Returns:
        (lat_deg, lon_deg, alt_km)
    """
    x, y, z = r_eci
    r = np.linalg.norm(r_eci)

    lat = np.degrees(np.arcsin(z / r))

    # Rotate by GMST to get geographic longitude
    lon_rad = np.arctan2(y, x) - gmst
    lon = np.degrees(lon_rad)

    # Wrap longitude to [-180, 180]
    lon = (lon + 180.0) % 360.0 - 180.0

    alt = r - R_EARTH
    return lat, lon, alt


def compute_gmst(epoch_seconds: float) -> float:
    """
    Compute Greenwich Mean Sidereal Time (GMST) in radians.

    Args:
        epoch_seconds: Seconds since J2000.0 (2000-01-01T12:00:00 TT)

    Returns:
        GMST in radians
    """
    # Earth's rotation rate: 7.2921150e-5 rad/s
    OMEGA_EARTH = 7.2921150e-5
    # GMST at J2000 epoch: ~280.46061837 degrees
    GMST_J2000 = np.radians(280.46061837)
    return (GMST_J2000 + OMEGA_EARTH * epoch_seconds) % (2.0 * np.pi)


# ─── LLA → ECEF ──────────────────────────────────────────────────────────────

def lla_to_ecef(lat_deg: float, lon_deg: float, alt_km: float) -> np.ndarray:
    """
    Convert geodetic LLA to ECEF Cartesian coordinates.

    Args:
        lat_deg: Geodetic latitude in degrees
        lon_deg: Longitude in degrees
        alt_km:  Altitude above reference sphere in km

    Returns:
        ECEF position vector [x, y, z] in km
    """
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)
    r = R_EARTH + alt_km

    x = r * np.cos(lat) * np.cos(lon)
    y = r * np.cos(lat) * np.sin(lon)
    z = r * np.sin(lat)

    return np.array([x, y, z])


# ─── ECI → RTN Frame ────────────────────────────────────────────────────────

def eci_to_rtn_matrix(r_eci: np.ndarray, v_eci: np.ndarray) -> np.ndarray:
    """
    Compute the rotation matrix from ECI to RTN (Hill's) frame.

    RTN axes:
      R (Radial):      r̂ = r_eci / |r_eci|
      N (Normal):      n̂ = (r_eci × v_eci) / |r_eci × v_eci|
      T (Transverse):  t̂ = n̂ × r̂

    Args:
        r_eci: Position vector in ECI [km]
        v_eci: Velocity vector in ECI [km/s]

    Returns:
        3×3 rotation matrix M such that v_RTN = M @ v_ECI
    """
    r_hat = r_eci / np.linalg.norm(r_eci)
    h = np.cross(r_eci, v_eci)
    n_hat = h / np.linalg.norm(h)
    t_hat = np.cross(n_hat, r_hat)

    return np.array([r_hat, t_hat, n_hat])


def rtn_to_eci_dv(dv_rtn: np.ndarray, r_eci: np.ndarray, v_eci: np.ndarray) -> np.ndarray:
    """
    Rotate a ΔV vector from RTN frame to ECI frame.

    Args:
        dv_rtn: ΔV in RTN frame [km/s]
        r_eci:  Current position [km]
        v_eci:  Current velocity [km/s]

    Returns:
        ΔV in ECI frame [km/s]
    """
    M = eci_to_rtn_matrix(r_eci, v_eci)
    return M.T @ dv_rtn  # M is orthogonal; inverse = transpose
