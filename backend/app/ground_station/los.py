"""
los.py — Ground Station Line-of-Sight (LOS) checks for the ACM backend.

Determines whether a satellite has unobstructed geometric LOS to any active
ground station, accounting for Earth's curvature and minimum elevation angle.
"""

import csv
import os
import math
import numpy as np
from dataclasses import dataclass
from typing import Optional

from ..physics.coordinates import lla_to_ecef
from ..physics.constants import R_EARTH


# ─── Data Class ──────────────────────────────────────────────────────────────

@dataclass
class GroundStation:
    station_id: str
    name: str
    lat_deg: float
    lon_deg: float
    elevation_m: float
    min_elevation_angle_deg: float

    def ecef_position(self) -> np.ndarray:
        """Return ECEF position of the ground station in km."""
        return lla_to_ecef(self.lat_deg, self.lon_deg, self.elevation_m / 1000.0)


# ─── CSV Loader ──────────────────────────────────────────────────────────────

_STATIONS: list[GroundStation] = []


def load_ground_stations(csv_path: Optional[str] = None) -> list[GroundStation]:
    """
    Load ground station data from CSV file.

    Expected columns:
        Station_ID, Station_Name, Latitude, Longitude,
        Elevation_m, Min_Elevation_Angle_deg

    Args:
        csv_path: Path to ground_stations.csv. Defaults to bundled data file.

    Returns:
        List of GroundStation objects.
    """
    global _STATIONS

    if csv_path is None:
        csv_path = os.path.join(os.path.dirname(__file__), "..", "data", "ground_stations.csv")

    csv_path = os.path.normpath(csv_path)
    stations = []

    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            gs = GroundStation(
                station_id=row["Station_ID"].strip(),
                name=row["Station_Name"].strip(),
                lat_deg=float(row["Latitude"]),
                lon_deg=float(row["Longitude"]),
                elevation_m=float(row["Elevation_m"]),
                min_elevation_angle_deg=float(row["Min_Elevation_Angle_deg"]),
            )
            stations.append(gs)

    _STATIONS = stations
    return stations


def get_stations() -> list[GroundStation]:
    """Return the currently loaded ground stations."""
    return _STATIONS


# ─── LOS Geometry ─────────────────────────────────────────────────────────────

def elevation_angle(gs_ecef: np.ndarray, sat_ecef: np.ndarray) -> float:
    """
    Compute the elevation angle of a satellite as seen from a ground station.

    Uses the local horizontal plane at the ground station to determine angle
    above horizon.

    Args:
        gs_ecef:  Ground station ECEF position [km]
        sat_ecef: Satellite ECEF position [km]

    Returns:
        Elevation angle in degrees (negative = below horizon)
    """
    # Vector from GS to satellite
    rho = sat_ecef - gs_ecef

    # GS zenith unit vector (outward normal from Earth surface)
    gs_hat = gs_ecef / np.linalg.norm(gs_ecef)

    # Project rho onto zenith to get elevation angle
    rho_mag = np.linalg.norm(rho)
    if rho_mag < 1e-9:
        return 90.0

    sin_el = np.dot(rho, gs_hat) / rho_mag
    # Clamp for numerical safety
    sin_el = max(-1.0, min(1.0, sin_el))
    return math.degrees(math.asin(sin_el))


def has_los(sat_r_eci: np.ndarray, gmst: float = 0.0) -> tuple[bool, Optional[str]]:
    """
    Check whether any ground station has LOS to the satellite.

    ECEF ≈ ECI for elevation angle purposes when we account for GMST rotation.
    Applies Earth-rotation correction to convert ECI → ECEF.

    Args:
        sat_r_eci: Satellite ECI position vector [km]
        gmst:      Greenwich Mean Sidereal Time in radians

    Returns:
        (has_los: bool, station_id: Optional[str])
            station_id is the first visible station's ID, or None.
    """
    if not _STATIONS:
        # Permissive fallback: no stations loaded → allow all
        return True, "NO_STATIONS_LOADED"

    # Rotate ECI position to ECEF using GMST
    cos_g, sin_g = math.cos(gmst), math.sin(gmst)
    R_eci_to_ecef = np.array([
        [ cos_g, sin_g, 0.0],
        [-sin_g, cos_g, 0.0],
        [  0.0,   0.0,  1.0]
    ])
    sat_ecef = R_eci_to_ecef @ sat_r_eci

    for gs in _STATIONS:
        gs_ecef = gs.ecef_position()
        el = elevation_angle(gs_ecef, sat_ecef)
        if el >= gs.min_elevation_angle_deg:
            return True, gs.station_id

    return False, None


def get_visible_stations(sat_r_eci: np.ndarray, gmst: float = 0.0) -> list[str]:
    """
    Return IDs of all ground stations with LOS to the satellite.

    Args:
        sat_r_eci: Satellite ECI position vector [km]
        gmst:      GMST in radians

    Returns:
        List of station_id strings
    """
    if not _STATIONS:
        return []

    cos_g, sin_g = math.cos(gmst), math.sin(gmst)
    R_eci_to_ecef = np.array([
        [ cos_g, sin_g, 0.0],
        [-sin_g, cos_g, 0.0],
        [  0.0,   0.0,  1.0]
    ])
    sat_ecef = R_eci_to_ecef @ sat_r_eci

    visible = []
    for gs in _STATIONS:
        gs_ecef = gs.ecef_position()
        el = elevation_angle(gs_ecef, sat_ecef)
        if el >= gs.min_elevation_angle_deg:
            visible.append(gs.station_id)

    return visible
