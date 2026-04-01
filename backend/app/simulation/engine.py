"""
engine.py — Global simulation state and time-step controller for Project AETHER ACM.

Responsibilities:
  - Maintain state vectors for all satellites and debris
  - Advance simulation time (step), propagating all objects
  - Execute due maneuver burns
  - Run KD-Tree conjunction detection each step
  - Auto-schedule evasion + recovery burns when conjunctions detected
  - Track fuel, mass, collidedset, statuses
  - Seed real constellation from CelesTrak TLE data on startup
"""

import math
import logging
import numpy as np
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

log = logging.getLogger("aether.engine")

from ..physics.constants import (
    MU, R_EARTH, M_DRY, M_FUEL_INIT, M_WET_INIT,
    D_CRIT, D_WARNING, STATION_KEEPING_BOX,
    THERMAL_COOLDOWN, FUEL_RESERVE_FRACTION, DEFAULT_STEP
)
from ..physics.propagator import propagate, propagate_trajectory, keplerian_to_eci
from ..physics.maneuver import (
    apply_burn, is_fuel_critical,
    compute_transverse_evasion_burn, compute_recovery_burn
)
from ..physics.coordinates import eci_to_lla, compute_gmst
from ..conjunction.detector import ConjunctionDetector, ConjunctionReport
from ..scheduler.maneuver_scheduler import ManeuverScheduler, ScheduledBurn
from ..ground_station.los import has_los, load_ground_stations


# ─── Satellite Record ─────────────────────────────────────────────────────────

@dataclass
class SatelliteRecord:
    sat_id: str
    state: np.ndarray           # [x,y,z,vx,vy,vz] ECI km/km·s⁻¹
    nominal_state: np.ndarray   # unperturbed ideal slot state
    m_total: float = M_WET_INIT
    m_fuel: float = M_FUEL_INIT
    status: str = "NOMINAL"     # NOMINAL | EVASION | RECOVERY | GRAVEYARD | DEAD
    total_dv_used_kmps: float = 0.0
    collisions_avoided: int = 0
    last_evasion_time: Optional[datetime] = None


# ─── Debris Record ────────────────────────────────────────────────────────────

@dataclass
class DebrisRecord:
    obj_id: str
    state: np.ndarray           # [x,y,z,vx,vy,vz] ECI


# ─── Simulation Engine ────────────────────────────────────────────────────────

class SimulationEngine:
    """
    Central ACM simulation engine.

    Public API used by FastAPI routes:
      - ingest_telemetry(objects, timestamp)
      - schedule_maneuver(sat_id, burns, ...)
      - step(duration_seconds)
      - snapshot()
    """

    def __init__(self):
        # Use real current UTC time so TLE propagation is accurate to now
        self.sim_time: datetime = datetime.now(timezone.utc).replace(microsecond=0)
        self.satellites: dict[str, SatelliteRecord] = {}
        self.debris: dict[str, DebrisRecord] = {}
        self.collisions_total: int = 0
        self.last_report: Optional[ConjunctionReport] = None
        self._evasion_scheduled: set[str] = set()  # sat_ids with pending auto-evasion

        self.detector = ConjunctionDetector()
        self.scheduler = ManeuverScheduler()

        # Seed constellation from real CelesTrak TLE data
        self._seed_from_real_tle()
        load_ground_stations()

    # ─── Seeding from real TLE data ──────────────────────────────────────────

    def _seed_from_real_tle(self):
        """
        Populate constellation and debris field from live CelesTrak TLE data.

        Satellites: Real Iridium + NOAA LEO satellites (~50–80 objects)
        Debris:     Real Cosmos-2251 and Iridium-33 collision debris (~700 objects)

        Falls back gracefully if CelesTrak is unavailable.
        """
        from ..data.tle_fetcher import fetch_real_satellites, fetch_real_debris

        log.info("[Engine] Fetching real satellite TLEs from CelesTrak...")
        sat_keps = fetch_real_satellites(self.sim_time, max_count=80)

        if sat_keps:
            for kep in sat_keps:
                try:
                    state = keplerian_to_eci(
                        a=kep["a"], e=kep["e"], i=kep["i"],
                        raan=kep["raan"], argp=kep["argp"], ta=kep["ta"]
                    )
                    # Use NORAD ID + name as sat ID
                    sat_id = f"{kep['name'][:20].strip()}-{kep['norad_id']}"
                    rec = SatelliteRecord(
                        sat_id=sat_id,
                        state=state.copy(),
                        nominal_state=state.copy(),
                    )
                    self.satellites[sat_id] = rec
                except Exception as ex:
                    log.debug(f"[Engine] Skipping satellite {kep.get('name')}: {ex}")
            log.info(f"[Engine] Loaded {len(self.satellites)} real satellites")
        else:
            log.warning("[Engine] CelesTrak unavailable — no satellites loaded. "
                        "Retry pending next fetch cycle.")

        log.info("[Engine] Fetching real debris TLEs from CelesTrak...")
        debris_keps = fetch_real_debris(self.sim_time, max_count=2000)

        if debris_keps:
            for kep in debris_keps:
                try:
                    state = keplerian_to_eci(
                        a=kep["a"], e=kep["e"], i=kep["i"],
                        raan=kep["raan"], argp=kep["argp"], ta=kep["ta"]
                    )
                    obj_id = f"DEB-{kep['norad_id']}"
                    self.debris[obj_id] = DebrisRecord(obj_id=obj_id, state=state)
                except Exception as ex:
                    log.debug(f"[Engine] Skipping debris {kep.get('name')}: {ex}")
            log.info(f"[Engine] Loaded {len(self.debris)} real debris objects")
        else:
            log.warning("[Engine] No debris TLEs loaded from CelesTrak.")

    # ─── Telemetry Ingestion ─────────────────────────────────────────────────

    def ingest_telemetry(self, objects: list[dict], timestamp: datetime) -> int:
        """
        Ingest external telemetry objects (satellites or debris).

        Args:
            objects:   List of telemetry dicts (id, type, r, v)
            timestamp: Telemetry epoch

        Returns:
            Number of objects processed.
        """
        self.sim_time = timestamp
        count = 0

        for obj in objects:
            obj_id = obj["id"]
            obj_type = obj.get("type", "DEBRIS").upper()
            r = obj["r"]
            v = obj["v"]

            state = np.array([
                r["x"], r["y"], r["z"],
                v["x"], v["y"], v["z"]
            ], dtype=float)

            if obj_type == "SATELLITE":
                if obj_id in self.satellites:
                    self.satellites[obj_id].state = state
                else:
                    self.satellites[obj_id] = SatelliteRecord(
                        sat_id=obj_id,
                        state=state,
                        nominal_state=state.copy()
                    )
            else:  # DEBRIS or unknown
                self.debris[obj_id] = DebrisRecord(obj_id=obj_id, state=state)

            count += 1

        return count

    # ─── Manual Maneuver Scheduling ──────────────────────────────────────────

    def schedule_maneuver(self, sat_id: str, burn_sequence: list[dict]) -> dict:
        """
        Validate and schedule a maneuver sequence uploaded by an operator.

        Args:
            sat_id:        Satellite ID
            burn_sequence: List of {burn_id, burn_time, dv_eci}

        Returns:
            Result dict with status and validation fields.
        """
        if sat_id not in self.satellites:
            return {"status": "REJECTED", "reason": f"Unknown satellite {sat_id}"}

        rec = self.satellites[sat_id]
        gmst = compute_gmst((self.sim_time - datetime(2000, 1, 1, 12, tzinfo=timezone.utc)).total_seconds())

        los, station_id = has_los(rec.state[:3], gmst)

        accepted, msg, projected_fuel = self.scheduler.schedule(
            sat_id=sat_id,
            burns=burn_sequence,
            current_sim_time=self.sim_time,
            m_current=rec.m_total,
            m_fuel=rec.m_fuel,
            has_los=los,
        )

        return {
            "status": "SCHEDULED" if accepted else "REJECTED",
            "validation": {
                "ground_station_los": los,
                "sufficient_fuel": accepted,
                "projected_mass_remaining_kg": round(M_DRY + projected_fuel, 3),
            },
            "reason": msg if not accepted else None,
        }

    # ─── Time Step ───────────────────────────────────────────────────────────

    def step(self, duration_seconds: float) -> dict:
        """
        Advance simulation by duration_seconds.

        Steps:
          1. Execute all due burns
          2. Propagate all objects (RK4 + J2)
          3. Run conjunction detection (KD-Tree)
          4. Auto-schedule evasion for critical conjunctions
          5. Update satellite statuses and graveyard transitions

        Returns:
            Step result dict compatible with POST /api/simulate/step response.
        """
        new_time = self.sim_time + timedelta(seconds=duration_seconds)

        # ── 1. Execute due burns ────────────────────────────────────────────
        due_burns = self.scheduler.pop_due_burns(new_time)
        maneuvers_executed = 0

        for burn in due_burns:
            sat_id = burn.satellite_id
            if sat_id not in self.satellites:
                continue

            rec = self.satellites[sat_id]
            if rec.status == "DEAD" or rec.status == "GRAVEYARD":
                continue

            new_state, new_mass, new_fuel, status_msg = apply_burn(
                state=rec.state,
                dv_eci=burn.dv_eci,
                m_current=rec.m_total,
                m_fuel=rec.m_fuel,
            )

            if status_msg == "OK":
                dv_mag = float(np.linalg.norm(burn.dv_eci))
                rec.state = new_state
                rec.m_total = new_mass
                rec.m_fuel = new_fuel
                rec.total_dv_used_kmps += dv_mag
                maneuvers_executed += 1

                # Graveyard transition check
                if is_fuel_critical(rec.m_fuel):
                    rec.status = "GRAVEYARD"
                    self._raise_to_graveyard(rec)

        # ── 2. Propagate all objects ────────────────────────────────────────
        for rec in self.satellites.values():
            if rec.status != "DEAD":
                rec.state = propagate(rec.state, duration_seconds)
                rec.nominal_state = propagate(rec.nominal_state, duration_seconds)

        for drec in self.debris.values():
            drec.state = propagate(drec.state, duration_seconds)

        self.sim_time = new_time

        # ── 3. Conjunction detection ────────────────────────────────────────
        sat_states = {sid: rec.state for sid, rec in self.satellites.items()
                      if rec.status not in ("DEAD", "GRAVEYARD")}
        debris_states = {did: drec.state for did, drec in self.debris.items()}

        report = self.detector.run(sat_states, debris_states, self.sim_time)
        self.last_report = report
        self.collisions_total += report.collision_count

        # ── 4. Auto-schedule evasion ────────────────────────────────────────
        auto_count = self._auto_evasion(report)

        # ── 5. Update satellite statuses ────────────────────────────────────
        self._update_statuses(report)

        return {
            "status": "STEP_COMPLETE",
            "new_timestamp": new_time.isoformat().replace("+00:00", "Z"),
            "collisions_detected": report.collision_count,
            "maneuvers_executed": maneuvers_executed + auto_count,
            "active_cdm_warnings": report.active_cdm_count(),
        }

    # ─── Auto Evasion ────────────────────────────────────────────────────────

    def _auto_evasion(self, report: ConjunctionReport) -> int:
        """
        Auto-schedule transverse evasion + recovery burns for CRITICAL conjunctions.
        Only schedules if no evasion is already queued for this satellite.
        """
        gmst = compute_gmst(
            (self.sim_time - datetime(2000, 1, 1, 12, tzinfo=timezone.utc)).total_seconds()
        )
        count = 0

        # Deduplicate by sat_id — one evasion per satellite per step
        critical_sats: set[str] = set()
        for w in report.warnings:
            if w.severity in ("CRITICAL", "COLLISION") and w.sat_id not in self._evasion_scheduled:
                critical_sats.add(w.sat_id)

        for sat_id in critical_sats:
            if sat_id not in self.satellites:
                continue
            rec = self.satellites[sat_id]
            if rec.m_fuel < 0.5:
                continue

            # LOS check for uplink
            los, _ = has_los(rec.state[:3], gmst)

            # Evasion burn: T + 10s (signal delay)
            evasion_time = self.sim_time + timedelta(seconds=10)
            evasion_dv = compute_transverse_evasion_burn(
                r_eci=rec.state[:3], v_eci=rec.state[3:], dv_budget_kmps=0.010
            )

            # Recovery burn: T + 10s + 600s (after cooldown)
            recovery_time = evasion_time + timedelta(seconds=THERMAL_COOLDOWN + 10)
            recovery_dv = compute_recovery_burn(
                r_eci=rec.state[:3], v_eci=rec.state[3:],
                r_nominal_eci=rec.nominal_state[:3], dv_budget_kmps=0.010
            )

            burns = [
                {
                    "burn_id": f"AUTO_EVASION_{sat_id}_{self.sim_time.isoformat()}",
                    "burn_time": evasion_time,
                    "dv_eci": evasion_dv,
                },
                {
                    "burn_id": f"AUTO_RECOVERY_{sat_id}_{self.sim_time.isoformat()}",
                    "burn_time": recovery_time,
                    "dv_eci": recovery_dv,
                }
            ]

            accepted, _, _ = self.scheduler.schedule(
                sat_id=sat_id,
                burns=burns,
                current_sim_time=self.sim_time,
                m_current=rec.m_total,
                m_fuel=rec.m_fuel,
                has_los=True,  # System command bypasses blackout constraint
            )

            if accepted:
                self._evasion_scheduled.add(sat_id)
                rec.status = "EVASION"
                rec.last_evasion_time = self.sim_time
                rec.collisions_avoided += 1
                count += 1

        return count

    def _raise_to_graveyard(self, rec: SatelliteRecord):
        """Apply a small radial burn to raise apogee by ~200 km for graveyard transition."""
        r_hat = rec.state[:3] / np.linalg.norm(rec.state[:3])
        # Small radial burn — graveyard delta-v (within constraints)
        rec.state[3:] += 0.005 * r_hat
        rec.status = "GRAVEYARD"

    def _update_statuses(self, report: ConjunctionReport):
        """Update satellite operational statuses after each step."""
        critical_sat_ids = {w.sat_id for w in report.warnings if w.severity == "COLLISION"}

        for sat_id, rec in self.satellites.items():
            if rec.status == "DEAD":
                continue

            # Mark collided satellites as DEAD
            if sat_id in critical_sat_ids:
                rec.status = "DEAD"
                continue

            # Clear evasion tracking for satellites not in current critical set
            if sat_id in self._evasion_scheduled:
                pending = self.scheduler.get_pending_burns(sat_id)
                if not pending:
                    self._evasion_scheduled.discard(sat_id)
                    if rec.status == "EVASION":
                        rec.status = "RECOVERY"

            # Check station-keeping box
            slot_dist = float(np.linalg.norm(rec.state[:3] - rec.nominal_state[:3]))
            if rec.status not in ("EVASION", "GRAVEYARD", "DEAD"):
                if slot_dist > STATION_KEEPING_BOX:
                    rec.status = "RECOVERY"
                else:
                    if rec.status == "RECOVERY":
                        rec.status = "NOMINAL"

    # ─── Snapshot ────────────────────────────────────────────────────────────

    def snapshot(self) -> dict:
        """
        Generate visualization snapshot for GET /api/visualization/snapshot.
        """
        gmst = compute_gmst(
            (self.sim_time - datetime(2000, 1, 1, 12, tzinfo=timezone.utc)).total_seconds()
        )

        sat_list = []
        for rec in self.satellites.values():
            lat, lon, alt = eci_to_lla(rec.state[:3], gmst)
            sat_list.append({
                "id": rec.sat_id,
                "lat": round(lat, 4),
                "lon": round(lon, 4),
                "alt_km": round(alt, 2),
                "fuel_kg": round(rec.m_fuel, 3),
                "fuel_pct": round(100.0 * rec.m_fuel / M_FUEL_INIT, 1),
                "status": rec.status,
                "total_dv_kmps": round(rec.total_dv_used_kmps, 5),
                "collisions_avoided": rec.collisions_avoided,
            })

        # Debris: flat arrays [ID, lat, lon, alt] for compression
        debris_list = []
        for drec in self.debris.values():
            lat, lon, alt = eci_to_lla(drec.state[:3], gmst)
            debris_list.append([drec.obj_id, round(lat, 3), round(lon, 3), round(alt, 1)])

        cdm_warnings = []
        if self.last_report:
            for w in self.last_report.warnings:
                cdm_warnings.append({
                    "sat_id": w.sat_id,
                    "debris_id": w.debris_id,
                    "miss_distance_km": round(w.miss_distance_km, 4),
                    "severity": w.severity,
                })

        # Gantt data: all pending burns
        gantt_data = []
        for sat_id, burns in self.scheduler.get_all_scheduled().items():
            for b in burns:
                if b.status == "PENDING":
                    gantt_data.append({
                        "sat_id": sat_id,
                        "burn_id": b.burn_id,
                        "burn_time": b.burn_time.isoformat().replace("+00:00", "Z"),
                        "dv_mag_ms": round(float(np.linalg.norm(b.dv_eci)) * 1000, 3),
                    })

        return {
            "timestamp": self.sim_time.isoformat().replace("+00:00", "Z"),
            "satellites": sat_list,
            "debris_cloud": debris_list,
            "cdm_warnings": cdm_warnings,
            "scheduled_burns": gantt_data,
            "stats": {
                "total_satellites": len(self.satellites),
                "total_debris": len(self.debris),
                "active_cdm_warnings": self.last_report.active_cdm_count() if self.last_report else 0,
                "collisions_total": self.collisions_total,
                "burns_executed": self.scheduler.total_burns_executed,
            }
        }


# ─── Global Singleton ────────────────────────────────────────────────────────

_engine: Optional[SimulationEngine] = None


def get_engine() -> SimulationEngine:
    global _engine
    if _engine is None:
        _engine = SimulationEngine()
    return _engine
