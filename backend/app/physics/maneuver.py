"""
maneuver.py — Delta-V computation, Tsiolkovsky fuel model, and maneuver validation.
"""

import numpy as np
import math
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from .constants import (
    ISP, G0, G0_SI, MAX_DV, M_DRY, M_FUEL_INIT,
    THERMAL_COOLDOWN, FUEL_RESERVE_FRACTION
)


# ─── Data Classes ────────────────────────────────────────────────────────────

@dataclass
class Burn:
    burn_id: str
    burn_time: datetime
    dv_eci: np.ndarray          # ΔV vector in ECI frame [km/s]

    def __post_init__(self):
        self.dv_eci = np.asarray(self.dv_eci, dtype=float)


@dataclass
class ManeuverSequence:
    satellite_id: str
    burns: list[Burn] = field(default_factory=list)


@dataclass
class ValidationResult:
    valid: bool
    error: Optional[str] = None
    projected_fuel_remaining_kg: float = 0.0
    ground_station_los: bool = False
    sufficient_fuel: bool = False


# ─── Tsiolkovsky Rocket Equation ────────────────────────────────────────────

def fuel_consumed(dv_mag_kmps: float, m_current_kg: float) -> float:
    """
    Compute propellant mass consumed for a given ΔV using Tsiolkovsky.

    Δm = m_current * (1 - exp(−|ΔV| / (Isp * g0)))

    Note: g0 here must be consistent with ΔV units.
    If ΔV is in km/s and Isp is in seconds:
        effective exhaust velocity v_e = Isp * g0_SI / 1000  [km/s]

    Args:
        dv_mag_kmps: Magnitude of ΔV in km/s
        m_current_kg: Current wet mass in kg

    Returns:
        Propellant mass consumed in kg
    """
    v_e = ISP * G0_SI / 1000.0   # effective exhaust velocity in km/s
    delta_m = m_current_kg * (1.0 - math.exp(-dv_mag_kmps / v_e))
    return delta_m


def apply_burn(
    state: np.ndarray,
    dv_eci: np.ndarray,
    m_current: float,
    m_fuel: float
) -> tuple[np.ndarray, float, float, str]:
    """
    Apply an impulsive burn: velocity changes instantly, position unchanged.

    Args:
        state:     [x, y, z, vx, vy, vz] before burn
        dv_eci:    ΔV vector in ECI frame [km/s]
        m_current: Current total mass [kg]
        m_fuel:    Current fuel mass [kg]

    Returns:
        (new_state, new_total_mass, new_fuel_mass, status_msg)
    """
    dv_mag = float(np.linalg.norm(dv_eci))

    if dv_mag > MAX_DV + 1e-9:
        return state, m_current, m_fuel, f"REJECTED: ΔV {dv_mag*1000:.2f} m/s exceeds 15 m/s limit"

    dm = fuel_consumed(dv_mag, m_current)

    if dm > m_fuel:
        return state, m_current, m_fuel, "REJECTED: Insufficient propellant"

    new_state = state.copy()
    new_state[3:] += dv_eci          # velocity impulse
    new_fuel = m_fuel - dm
    new_mass = m_current - dm

    return new_state, new_mass, new_fuel, "OK"


def is_fuel_critical(m_fuel: float) -> bool:
    """Returns True if fuel is at or below the 5% reserve threshold."""
    return m_fuel <= M_FUEL_INIT * FUEL_RESERVE_FRACTION


def validate_burn_limits(dv_eci: np.ndarray, m_fuel: float, m_current: float) -> tuple[bool, str]:
    """
    Validate a single burn against spacecraft constraints.

    Returns (is_valid, reason)
    """
    dv_mag = float(np.linalg.norm(dv_eci))
    if dv_mag > MAX_DV + 1e-9:
        return False, f"ΔV {dv_mag*1000:.2f} m/s exceeds 15 m/s max"

    dm = fuel_consumed(dv_mag, m_current)
    if dm > m_fuel:
        return False, f"Requires {dm:.3f} kg but only {m_fuel:.3f} kg available"

    return True, "OK"


# ─── Greedy Evasion Burn Calculator ─────────────────────────────────────────

def compute_transverse_evasion_burn(
    r_eci: np.ndarray,
    v_eci: np.ndarray,
    dv_budget_kmps: float = 0.010
) -> np.ndarray:
    """
    Compute a transverse (in-track) evasion burn in ECI frame.

    Prefers transverse direction to minimise orbital energy change
    while achieving maximum radial separation. Avoids normal burns.

    Args:
        r_eci:          Current position [km]
        v_eci:          Current velocity [km/s]
        dv_budget_kmps: ΔV magnitude to use [km/s] (default 10 m/s)

    Returns:
        ΔV vector in ECI frame [km/s]
    """
    from .coordinates import eci_to_rtn_matrix
    M = eci_to_rtn_matrix(r_eci, v_eci)
    # Transverse direction is row 1 of M (t_hat), apply in ECI
    t_hat_eci = M[1, :]
    return dv_budget_kmps * t_hat_eci


def compute_recovery_burn(
    r_eci: np.ndarray,
    v_eci: np.ndarray,
    r_nominal_eci: np.ndarray,
    dv_budget_kmps: float = 0.010
) -> np.ndarray:
    """
    Compute a recovery burn pointing from current position toward
    the nominal orbital slot, projected onto the transverse direction.

    Args:
        r_eci:          Current position [km]
        v_eci:          Current velocity [km/s]
        r_nominal_eci:  Nominal slot position [km]
        dv_budget_kmps: ΔV magnitude [km/s]

    Returns:
        ΔV vector in ECI frame [km/s]
    """
    # Direction toward nominal slot
    error_vec = r_nominal_eci - r_eci
    if np.linalg.norm(error_vec) < 1e-9:
        return np.zeros(3)

    return dv_budget_kmps * (error_vec / np.linalg.norm(error_vec))
