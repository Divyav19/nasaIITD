"""
detector.py — Sub-O(N²) conjunction detection using scipy KD-Tree.

Algorithm per simulation step:
  1. Build cKDTree from all debris ECI positions  → O(N log N)
  2. Per satellite: query_ball_point(r=SEARCH_RADIUS) → O(log N)
  3. Precisely compute distance for all returned candidates
  4. Emit CDM (Conjunction Data Message) warnings for close approaches

Complexity: O((N + M) log N)  vs brute-force O(N·M)
At 10k debris, 50 satellites: ~100× speedup.
"""

import numpy as np
from scipy.spatial import cKDTree
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from ..physics.constants import D_CRIT, D_WARNING, D_CRITICAL_CDM, SEARCH_RADIUS


# ─── Data Classes ────────────────────────────────────────────────────────────

@dataclass
class CDMWarning:
    """Conjunction Data Message warning."""
    sat_id: str
    debris_id: str
    miss_distance_km: float
    timestamp: datetime
    sat_pos: np.ndarray
    debris_pos: np.ndarray
    severity: str = "NOMINAL"       # "NOMINAL" | "WARNING" | "CRITICAL" | "COLLISION"

    def __post_init__(self):
        if self.miss_distance_km < D_CRIT:
            self.severity = "COLLISION"
        elif self.miss_distance_km < D_CRITICAL_CDM:
            self.severity = "CRITICAL"
        elif self.miss_distance_km < D_WARNING:
            self.severity = "WARNING"


@dataclass
class ConjunctionReport:
    timestamp: datetime
    warnings: list[CDMWarning] = field(default_factory=list)
    collision_count: int = 0

    def active_cdm_count(self) -> int:
        return len(self.warnings)


# ─── KD-Tree Detector ────────────────────────────────────────────────────────

class ConjunctionDetector:
    """
    Efficient conjunction detection via 3-D KD-Tree indexing of debris objects.

    Usage:
        detector = ConjunctionDetector()
        report = detector.run(sat_states, debris_states, sim_time)
    """

    def __init__(self, search_radius: float = SEARCH_RADIUS):
        self.search_radius = search_radius
        self._tree: Optional[cKDTree] = None
        self._debris_ids: list[str] = []
        self._debris_positions: Optional[np.ndarray] = None

    def build_tree(self, debris_states: dict[str, np.ndarray]) -> None:
        """
        Build KD-Tree from current debris positions.

        Args:
            debris_states: dict {debris_id: state_vector [x,y,z,vx,vy,vz]}
        """
        if not debris_states:
            self._tree = None
            self._debris_ids = []
            self._debris_positions = None
            return

        self._debris_ids = list(debris_states.keys())
        positions = np.array([debris_states[did][:3] for did in self._debris_ids])
        self._debris_positions = positions
        self._tree = cKDTree(positions)

    def query_satellite(
        self,
        sat_id: str,
        sat_state: np.ndarray,
        sim_time: datetime
    ) -> list[CDMWarning]:
        """
        Find all debris objects within SEARCH_RADIUS of a satellite.

        Args:
            sat_id:    Satellite identifier
            sat_state: [x,y,z,vx,vy,vz] in ECI
            sim_time:  Current simulation time

        Returns:
            List of CDMWarning objects (may be empty)
        """
        if self._tree is None or self._debris_positions is None:
            return []

        sat_pos = sat_state[:3]

        # O(log N) query — returns indices of debris within search_radius
        candidate_indices = self._tree.query_ball_point(sat_pos, r=self.search_radius)

        warnings = []
        for idx in candidate_indices:
            debris_pos = self._debris_positions[idx]
            dist = float(np.linalg.norm(sat_pos - debris_pos))

            if dist < D_WARNING:  # Only emit CDM for objects within warning distance
                w = CDMWarning(
                    sat_id=sat_id,
                    debris_id=self._debris_ids[idx],
                    miss_distance_km=dist,
                    timestamp=sim_time,
                    sat_pos=sat_pos.copy(),
                    debris_pos=debris_pos.copy()
                )
                warnings.append(w)

        return warnings

    def run(
        self,
        sat_states: dict[str, np.ndarray],
        debris_states: dict[str, np.ndarray],
        sim_time: datetime
    ) -> ConjunctionReport:
        """
        Full conjunction detection run for one simulation snapshot.

        Steps:
          1. Build KD-Tree from debris  — O(N log N)
          2. Query each satellite        — O(M log N)

        Args:
            sat_states:    dict {sat_id: state}
            debris_states: dict {debris_id: state}
            sim_time:      Current simulation timestamp

        Returns:
            ConjunctionReport with all CDM warnings.
        """
        self.build_tree(debris_states)

        report = ConjunctionReport(timestamp=sim_time)

        for sat_id, sat_state in sat_states.items():
            cdms = self.query_satellite(sat_id, sat_state, sim_time)
            report.warnings.extend(cdms)

        report.collision_count = sum(
            1 for w in report.warnings if w.severity == "COLLISION"
        )

        return report
