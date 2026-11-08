"""DSN geometric visibility (Instructions §16; IMPLEMENTATION_PLAN §3.5).

DSN geometric opportunity at hour t = Earth visible from the lunar site AND the Moon above the elevation mask at one
or more of DSS-14 (Goldstone), DSS-63 (Madrid), DSS-43 (Canberra). Station positions: earthstns_itrf93_260814.bsp;
topocentric frames: earth_topo_260814.tf. Masks (DSN 810-005 module 301 Rev. P): receive ~6 deg (mechanical limit;
real masks follow local terrain), uplink 10.1 deg.

Geometric visibility does not guarantee scheduled DSN service or a successful communications link.
"""
from __future__ import annotations

from datetime import datetime
from functools import lru_cache

import numpy as np

from . import ephemeris as eph

CAVEAT = "Geometric visibility does not guarantee scheduled DSN service or a successful communications link."
MASKS = {"downlink": 6.0, "uplink": 10.1}


@lru_cache(maxsize=8)
def station_elevations(year: int) -> dict[str, np.ndarray]:
    """Hourly Moon elevation (deg) at each station over a calendar year (site-independent)."""
    n = eph.hours_in_year(year)
    et = eph.ets(eph.year_start(year), n)
    return {name: eph.moon_elevation_at_station(code, et).astype(np.float32) for name, code in eph.STATIONS.items()}


def station_visible(year: int, mask_deg: float) -> dict[str, np.ndarray]:
    return {k: v >= mask_deg for k, v in station_elevations(year).items()}


def any_station(year: int, mask_deg: float) -> np.ndarray:
    v = station_visible(year, mask_deg)
    return v["goldstone"] | v["madrid"] | v["canberra"]


def elevations_at(start: datetime, n: int) -> dict[str, np.ndarray]:
    et = eph.ets(start, n)
    return {name: eph.moon_elevation_at_station(code, et) for name, code in eph.STATIONS.items()}
