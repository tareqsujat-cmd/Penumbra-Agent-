"""Sun, Earth and DSN geometry from local SPICE kernels (Instructions §13; IMPLEMENTATION_PLAN §3.3, §3.5).

Kernel set and load order (docs/COORDINATE_SYSTEMS.md):
  naif0012.tls, pck00011.tpc, gm_de440.tpc, de440s.bsp,
  moon_pa_de440_200625.bpc + moon_de440_250416.tf  (MOON_ME = MOON_ME_DE440_ME421; the DE421 frame kernel
                                                   moon_080317.tf also defines MOON_ME and is NOT loaded),
  earth_2026_260806_2126_predict.bpc then earth_latest_high_prec.bpc (measured data win where they overlap),
  earth_assoc_itrf93.tf, earthstns_itrf93_260814.bsp, earth_topo_260814.tf  (DSN stations and topocentric frames).
Target vectors: spkpos(target, et, 'MOON_ME', 'LT+S', 'MOON') minus the observer's body-fixed position.
"""
from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone

import numpy as np
import spiceypy as sp

from ..config import RAW
from .errors import DateOutOfRange, KernelMissing

KERNELS = [
    "naif0012.tls", "pck00011.tpc", "gm_de440.tpc", "de440s.bsp",
    "moon_pa_de440_200625.bpc", "moon_de440_250416.tf",
    "earth_2026_260806_2126_predict.bpc", "earth_latest_high_prec.bpc", "earth_assoc_itrf93.tf",
    "earthstns_itrf93_260814.bsp", "earth_topo_260814.tf",
]
FRAME = "MOON_ME"
STATIONS = {"goldstone": "DSS-14", "madrid": "DSS-63", "canberra": "DSS-43"}
_lock = threading.RLock()  # CSPICE is not thread-safe
_loaded = False


def load() -> None:
    global _loaded
    with _lock:
        if _loaded:
            return
        for k in KERNELS:
            p = RAW / "spice" / k
            if not p.exists():
                raise KernelMissing(f"SPICE kernel missing: {k}", kernel=k, path=str(p))
            sp.furnsh(str(p))
        _loaded = True


def kernel_list() -> list[str]:
    return list(KERNELS)


def coverage() -> dict[str, str]:
    """UTC coverage of the time-limiting kernels (lunar orientation and planetary ephemeris)."""
    load()
    out = {}
    with _lock:
        for k, body in (("de440s.bsp", None), ("moon_pa_de440_200625.bpc", 31008)):
            path = str(RAW / "spice" / k)
            cov = sp.cell_double(2000)
            if k.endswith(".bsp"):
                sp.spkcov(path, 301, cov)
            else:
                sp.pckcov(path, body, cov)
            iv = sp.wnfetd(cov, 0)
            out[k] = f"{sp.et2utc(iv[0], 'ISOC', 0)} to {sp.et2utc(iv[1], 'ISOC', 0)}"
    return out


# coverage window used for validation of requested dates (the earth orientation predict kernel ends 2126)
VALID_START = datetime(1900, 1, 1, tzinfo=timezone.utc)
VALID_END = datetime(2126, 1, 1, tzinfo=timezone.utc)


def check_dates(start: datetime, end: datetime) -> None:
    if start < VALID_START or end > VALID_END:
        raise DateOutOfRange(f"dates must lie within {VALID_START:%Y-%m-%d} - {VALID_END:%Y-%m-%d} (kernel coverage)",
                             start=start.isoformat(), end=end.isoformat())


def ets(start: datetime, n: int, step_h: float = 1.0) -> np.ndarray:
    load()
    check_dates(start, start + timedelta(hours=n * step_h))
    with _lock:
        et0 = sp.str2et(start.strftime("%Y-%m-%d %H:%M:%S") + " UTC")
    return et0 + np.arange(n) * step_h * 3600.0


def radius_km(body: str) -> float:
    """Mean of the PCK triaxial radii (km)."""
    load()
    with _lock:
        return float(np.mean(sp.bodvrd(body, "RADII", 3)[1]))


def body_vectors(target: str, et: np.ndarray, observer_m: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Unit direction (MOON_ME) and distance (m) from a surface observer to `target` at each et."""
    load()
    with _lock:
        pos, _ = sp.spkpos(target, et, FRAME, "LT+S", "MOON")
    d = np.asarray(pos, float) * 1000.0 - observer_m[None, :]
    dist = np.linalg.norm(d, axis=1)
    return d / dist[:, None], dist


def moon_elevation_at_station(station: str, et: np.ndarray) -> np.ndarray:
    """Elevation (deg) of the Moon's centre above the local horizontal plane of a DSN station (topocentric frame,
    +Z = zenith)."""
    load()
    with _lock:
        pos, _ = sp.spkpos("MOON", et, f"{station}_TOPO", "LT+S", station)
    pos = np.asarray(pos, float)
    return np.degrees(np.arcsin(pos[:, 2] / np.linalg.norm(pos, axis=1)))


def station_position_km(station: str) -> np.ndarray:
    """ITRF93 position (km) of a DSN station at J2000 epoch (for the 810-005 cross-check)."""
    load()
    with _lock:
        pos, _ = sp.spkpos(station, 0.0, "ITRF93", "NONE", "EARTH")
    return np.asarray(pos, float)


def year_start(year: int) -> datetime:
    return datetime(year, 1, 1, tzinfo=timezone.utc)


def hours_in_year(year: int) -> int:
    return int((year_start(year + 1) - year_start(year)).total_seconds() // 3600)
