"""
maneuver_scheduler.py — Validates, queues, and tracks scheduled burns.

Enforces:
  - 600s thermal cooldown between burns on the same satellite
  - 10s signal delay (burn_time >= current_sim_time + 10s)
  - ΔV magnitude ≤ 15 m/s per burn
  - LOS from at least one ground station at upload time
  - Sufficient fuel
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
import numpy as np

from ..physics.maneuver import validate_burn_limits, fuel_consumed, Burn, ManeuverSequence
from ..physics.constants import THERMAL_COOLDOWN, SIGNAL_DELAY


# ─── Scheduled Burn Record ─────────────────────────────────────────────────

@dataclass
class ScheduledBurn:
    burn_id: str
    satellite_id: str
    burn_time: datetime
    dv_eci: np.ndarray          # ECI frame [km/s]
    status: str = "PENDING"     # PENDING | EXECUTED | REJECTED | CANCELLED


# ─── Scheduler ─────────────────────────────────────────────────────────────

class ManeuverScheduler:
    """
    Manages the burn queue for all satellites.

    Per-satellite state tracks:
      - Queue of upcoming burns
      - Last burn execution time (for cooldown enforcement)
      - Cumulative ΔV expended
    """

    def __init__(self):
        # {sat_id: [ScheduledBurn, ...]}  sorted by burn_time
        self._queue: dict[str, list[ScheduledBurn]] = {}
        # {sat_id: datetime | None}  last executed burn time
        self._last_burn_time: dict[str, Optional[datetime]] = {}
        # Statistics
        self.total_burns_executed: int = 0
        self.total_burns_rejected: int = 0

    # ─── Queueing ──────────────────────────────────────────────────────────

    def schedule(
        self,
        sat_id: str,
        burns: list[dict],
        current_sim_time: datetime,
        m_current: float,
        m_fuel: float,
        has_los: bool,
    ) -> tuple[bool, str, float]:
        """
        Validate and queue a maneuver sequence for a satellite.

        Args:
            sat_id:           Satellite identifier
            burns:            List of burn dicts with 'burn_id', 'burn_time', 'dv_eci' (np.ndarray)
            current_sim_time: Current simulation time
            m_current:        Current total mass [kg]
            m_fuel:           Current fuel mass [kg]
            has_los:          Whether satellite has ground station LOS at upload time

        Returns:
            (accepted: bool, message: str, projected_fuel_remaining: float)
        """
        if not has_los:
            return False, "No ground station LOS at upload time", m_fuel

        remaining_fuel = m_fuel
        remaining_mass = m_current
        scheduled_burns: list[ScheduledBurn] = []

        prev_time: Optional[datetime] = self._last_burn_time.get(sat_id)

        for b in burns:
            burn_time: datetime = b["burn_time"]
            dv_eci: np.ndarray = np.asarray(b["dv_eci"], dtype=float)
            burn_id: str = b["burn_id"]

            # Signal delay check
            delay_secs = (burn_time - current_sim_time).total_seconds()
            if delay_secs < SIGNAL_DELAY:
                return False, (
                    f"Burn {burn_id}: burn_time must be at least "
                    f"{SIGNAL_DELAY}s after current sim time (got {delay_secs:.1f}s)"
                ), remaining_fuel

            # Cooldown check against previous scheduled burn in this sequence
            if prev_time is not None:
                gap = (burn_time - prev_time).total_seconds()
                if gap < THERMAL_COOLDOWN:
                    return False, (
                        f"Burn {burn_id}: violates 600s cooldown "
                        f"(gap = {gap:.0f}s)"
                    ), remaining_fuel

            # ΔV and fuel validation
            valid, reason = validate_burn_limits(dv_eci, remaining_fuel, remaining_mass)
            if not valid:
                return False, f"Burn {burn_id}: {reason}", remaining_fuel

            dm = fuel_consumed(float(np.linalg.norm(dv_eci)), remaining_mass)
            remaining_fuel -= dm
            remaining_mass -= dm
            prev_time = burn_time

            scheduled_burns.append(ScheduledBurn(
                burn_id=burn_id,
                satellite_id=sat_id,
                burn_time=burn_time,
                dv_eci=dv_eci,
            ))

        # All burns validated → commit to queue
        if sat_id not in self._queue:
            self._queue[sat_id] = []

        self._queue[sat_id].extend(scheduled_burns)
        self._queue[sat_id].sort(key=lambda b: b.burn_time)

        return True, "SCHEDULED", remaining_fuel

    # ─── Execution ─────────────────────────────────────────────────────────

    def pop_due_burns(self, sim_time: datetime) -> list[ScheduledBurn]:
        """
        Return all burns whose burn_time <= sim_time across all satellites.
        Marks them EXECUTED and removes from queue.
        """
        due: list[ScheduledBurn] = []

        for sat_id, burns in self._queue.items():
            still_pending = []
            for burn in burns:
                if burn.burn_time <= sim_time and burn.status == "PENDING":
                    burn.status = "EXECUTED"
                    self._last_burn_time[sat_id] = burn.burn_time
                    due.append(burn)
                    self.total_burns_executed += 1
                else:
                    still_pending.append(burn)
            self._queue[sat_id] = still_pending

        return due

    def get_pending_burns(self, sat_id: str) -> list[ScheduledBurn]:
        """Return all pending burn records for a satellite (for Gantt rendering)."""
        return [b for b in self._queue.get(sat_id, []) if b.status == "PENDING"]

    def get_all_scheduled(self) -> dict[str, list[ScheduledBurn]]:
        """Return full queue snapshot for all satellites."""
        return {sid: list(burns) for sid, burns in self._queue.items()}

    def last_burn_time(self, sat_id: str) -> Optional[datetime]:
        return self._last_burn_time.get(sat_id)
