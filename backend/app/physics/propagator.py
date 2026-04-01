"""
propagator.py — RK4 orbital propagator with J2 perturbation.

State vector: [x, y, z, vx, vy, vz]  (ECI J2000, units: km, km/s)
"""

import numpy as np
from .constants import MU, R_EARTH, J2, DEFAULT_STEP


# ─── J2 Acceleration ──────────────────────────────────────────────────────────

def j2_acceleration(r_vec: np.ndarray) -> np.ndarray:
    """
    Compute J2 perturbation acceleration in ECI frame.

    a_J2 = (3/2) * (J2 * μ * R_E²) / |r|^5 * [
        x * (5*z²/|r|² - 1),
        y * (5*z²/|r|² - 1),
        z * (5*z²/|r|² - 3)
    ]

    Args:
        r_vec: Position vector [x, y, z] in km.

    Returns:
        J2 acceleration vector [ax, ay, az] in km/s².
    """
    x, y, z = r_vec
    r = np.linalg.norm(r_vec)
    r2 = r * r
    r5 = r2 * r2 * r

    factor = (3.0 / 2.0) * J2 * MU * (R_EARTH ** 2) / r5
    z2_r2 = z * z / r2

    ax = factor * x * (5.0 * z2_r2 - 1.0)
    ay = factor * y * (5.0 * z2_r2 - 1.0)
    az = factor * z * (5.0 * z2_r2 - 3.0)

    return np.array([ax, ay, az])


# ─── Equations of Motion ──────────────────────────────────────────────────────

def equations_of_motion(state: np.ndarray) -> np.ndarray:
    """
    ODE: d/dt [r, v] = [v, a_gravity + a_J2]

    Args:
        state: [x, y, z, vx, vy, vz]

    Returns:
        Derivative [vx, vy, vz, ax, ay, az]
    """
    r_vec = state[:3]
    v_vec = state[3:]

    r = np.linalg.norm(r_vec)
    a_grav = -(MU / (r ** 3)) * r_vec
    a_j2 = j2_acceleration(r_vec)
    a_total = a_grav + a_j2

    return np.concatenate([v_vec, a_total])


# ─── RK4 Integrator ───────────────────────────────────────────────────────────

def rk4_step(state: np.ndarray, dt: float) -> np.ndarray:
    """
    Single Runge-Kutta 4th-order integration step.

    Args:
        state: Current state vector [x, y, z, vx, vy, vz]
        dt:    Time step in seconds

    Returns:
        New state vector after dt seconds.
    """
    k1 = equations_of_motion(state)
    k2 = equations_of_motion(state + 0.5 * dt * k1)
    k3 = equations_of_motion(state + 0.5 * dt * k2)
    k4 = equations_of_motion(state + dt * k3)

    return state + (dt / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)


def propagate(state: np.ndarray, duration: float, dt: float = DEFAULT_STEP) -> np.ndarray:
    """
    Propagate a state vector over a duration using adaptive RK4 sub-stepping.

    Args:
        state:    Initial state [x, y, z, vx, vy, vz]
        duration: Total propagation time in seconds
        dt:       Integration step size in seconds

    Returns:
        Final state vector after 'duration' seconds.
    """
    remaining = duration
    current = state.copy()

    while remaining > 1e-9:
        step = min(dt, remaining)
        current = rk4_step(current, step)
        remaining -= step

    return current


def propagate_trajectory(
    state: np.ndarray,
    duration: float,
    dt: float = DEFAULT_STEP
) -> list:
    """
    Propagate and collect all intermediate states (for track rendering).

    Args:
        state:    Initial state vector
        duration: Total time in seconds
        dt:       Step size in seconds

    Returns:
        List of state vectors at each step.
    """
    trajectory: list[np.ndarray] = [state.copy()]
    remaining = duration
    current = state.copy()

    while remaining > 1e-9:
        step = min(dt, remaining)
        current = rk4_step(current, step)
        trajectory.append(current.copy())
        remaining -= step

    return trajectory


# ─── Keplerian seed (for initialising satellites) ─────────────────────────────

def keplerian_to_eci(a: float, e: float, i: float, raan: float,
                     argp: float, ta: float) -> np.ndarray:
    """
    Convert classical Keplerian elements to ECI state vector.

    Args:
        a:    Semi-major axis (km)
        e:    Eccentricity
        i:    Inclination (radians)
        raan: Right Ascension of Ascending Node (radians)
        argp: Argument of Perigee (radians)
        ta:   True Anomaly (radians)

    Returns:
        State vector [x, y, z, vx, vy, vz] in km, km/s
    """
    p = a * (1.0 - e ** 2)
    r_mag = p / (1.0 + e * np.cos(ta))

    # Perifocal frame
    r_pqw = np.array([r_mag * np.cos(ta), r_mag * np.sin(ta), 0.0])
    v_pqw = np.sqrt(MU / p) * np.array([-np.sin(ta), e + np.cos(ta), 0.0])

    # Rotation matrix: Perifocal → ECI (3-1-3 Euler: RAAN, i, argp)
    cos_O, sin_O = np.cos(raan), np.sin(raan)
    cos_i, sin_i = np.cos(i), np.sin(i)
    cos_w, sin_w = np.cos(argp), np.sin(argp)

    R = np.array([
        [cos_O*cos_w - sin_O*sin_w*cos_i, -cos_O*sin_w - sin_O*cos_w*cos_i,  sin_O*sin_i],
        [sin_O*cos_w + cos_O*sin_w*cos_i, -sin_O*sin_w + cos_O*cos_w*cos_i, -cos_O*sin_i],
        [sin_w*sin_i,                       cos_w*sin_i,                        cos_i      ]
    ])

    r_eci = R @ r_pqw
    v_eci = R @ v_pqw

    return np.concatenate([r_eci, v_eci])
