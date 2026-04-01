"""
constants.py — Physical and spacecraft constants for Project AETHER ACM.
All units: km, kg, seconds unless otherwise noted.
"""

# ─── Earth Gravity ─────────────────────────────────────────────────────────────
MU = 398600.4418          # km³/s²  — Earth's standard gravitational parameter
R_EARTH = 6378.137        # km      — Earth's equatorial radius
J2 = 1.08263e-3           # dimensionless — Second zonal harmonic coefficient

# ─── Mission / Conjunction ─────────────────────────────────────────────────────
D_CRIT = 0.100            # km      — Collision threshold (100 m)
D_WARNING = 5.0           # km      — CDM warning threshold
D_CRITICAL_CDM = 1.0      # km      — Red / critical CDM threshold
STATION_KEEPING_BOX = 10.0 # km    — Max drift from nominal orbital slot

# ─── Spacecraft ───────────────────────────────────────────────────────────────
M_DRY = 500.0             # kg      — Dry mass
M_FUEL_INIT = 50.0        # kg      — Initial propellant mass
M_WET_INIT = M_DRY + M_FUEL_INIT    # kg  — 550.0 kg initial wet mass
ISP = 300.0               # s       — Specific impulse (monopropellant)
G0 = 9.80665e-3           # km/s²   — Standard gravity (converted for km/s ΔV units)
G0_SI = 9.80665           # m/s²    — Standard gravity in SI
MAX_DV = 0.015            # km/s    — Max ΔV per burn (15 m/s = 0.015 km/s)
THERMAL_COOLDOWN = 600.0  # s       — Mandatory rest between burns on same satellite
FUEL_RESERVE_FRACTION = 0.05  # 5% fuel reserve — triggers graveyard orbit transition

# ─── Communication ─────────────────────────────────────────────────────────────
SIGNAL_DELAY = 10.0       # s       — Hardcoded uplink latency
MIN_ELEVATION_DEFAULT = 5.0  # deg  — Default minimum elevation angle for LOS

# ─── Simulation ────────────────────────────────────────────────────────────────
SEARCH_RADIUS = 50.0      # km      — KD-Tree query radius for conjunction screening
DEFAULT_STEP = 30.0       # s       — Default RK4 integration step size
SEARCH_RADIUS_AU = SEARCH_RADIUS   # alias
