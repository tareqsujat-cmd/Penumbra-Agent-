"""Star field: the Yale Bright Star Catalogue (BSC5, Hoffleit & Warren 1991; VizieR V/50), every star to V = 6.5,
with J2000 positions, plus the rotation from J2000 to MOON_ME so the sky turns correctly over the Moon.

The sky seen from the Moon: no atmosphere, so stars do not twinkle and are not dimmed toward the horizon; the
celestial sphere turns once per sidereal month (27.3 days) about the lunar pole.
"""
from __future__ import annotations

import math
from functools import lru_cache

import numpy as np
import spiceypy as sp

from ..config import RAW
from . import ephemeris as eph
from .errors import DatasetMissing

CATALOG = RAW / "stars" / "bsc5_vizier.tsv"


@lru_cache(maxsize=1)
def catalog() -> dict:
    """HR number, RA/Dec (J2000, deg), V magnitude, B-V colour and name for every star with a position."""
    if not CATALOG.exists():
        raise DatasetMissing(f"star catalogue missing: {CATALOG.name}", file=str(CATALOG))
    hr, ra, de, vm, bv, names = [], [], [], [], [], {}
    started = False
    for line in CATALOG.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.startswith("----"):
            started = True
            continue
        if not started or not line.strip() or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) < 5 or not parts[1].strip() or not parts[3].strip():
            continue  # a few BSC entries (novae, non-stellar objects) have no position or magnitude
        h = int(parts[0])
        hr.append(h)
        ra.append(float(parts[1]))
        de.append(float(parts[2]))
        vm.append(float(parts[3]))
        bv.append(float(parts[4]) if parts[4].strip() else 0.6)
        if len(parts) > 5 and parts[5].strip():
            names[h] = " ".join(parts[5].split())
    return {"hr": np.array(hr), "ra": np.array(ra), "dec": np.array(de), "vmag": np.array(vm), "bv": np.array(bv), "names": names}


def frame_quaternions(year: int, step_h: int = 6) -> np.ndarray:
    """Unit quaternions (x, y, z, w) rotating J2000 vectors into MOON_ME, every `step_h` hours of `year`."""
    n = eph.hours_in_year(year) // step_h + 1
    et = eph.ets(eph.year_start(year), n, float(step_h))
    out = np.empty((n, 4))
    with eph._lock:
        for i, t in enumerate(et):
            m = np.array(sp.pxform("J2000", eph.FRAME, float(t)))
            w, x, y, z = sp.m2q(m)  # SPICE quaternion (w first) for the rotation m
            out[i] = (x, y, z, w)
    # keep consecutive quaternions in the same hemisphere so the client can interpolate them directly
    for i in range(1, n):
        if np.dot(out[i], out[i - 1]) < 0:
            out[i] = -out[i]
    return out


def sky(year: int) -> dict:
    c = catalog()
    order = np.argsort(c["vmag"])  # brightest first: the client can draw a prefix for low-power devices
    q = frame_quaternions(year)
    return {
        "source": "Yale Bright Star Catalogue, 5th rev. (Hoffleit & Warren 1991), VizieR V/50; J2000",
        "count": int(order.size),
        "ra": np.round(c["ra"][order], 4).tolist(),
        "dec": np.round(c["dec"][order], 4).tolist(),
        "vmag": np.round(c["vmag"][order], 2).tolist(),
        "bv": np.round(c["bv"][order], 2).tolist(),
        "named": {int(c["hr"][k]): c["names"][int(c["hr"][k])] for k in order[:40] if int(c["hr"][k]) in c["names"]},
        "frame": {"from": "J2000", "to": eph.FRAME, "year": year, "step_h": 6,
                  "quaternions_xyzw": np.round(q, 8).tolist(),
                  "note": "q rotates a J2000 unit vector into MOON_ME (three.js Quaternion order x, y, z, w); "
                          "interpolate (slerp) between steps"},
        "sidereal_month_days": round(27.321661, 6),
    }


def bv_to_rgb(bv: float) -> tuple[float, float, float]:
    """Approximate star colour from B-V (Ballesteros 2012 temperature, then a blackbody-like ramp)."""
    t = 4600.0 * (1.0 / (0.92 * bv + 1.7) + 1.0 / (0.92 * bv + 0.62))
    x = math.log10(max(t, 1000.0))
    r = 1.0 if t < 6600 else max(0.0, min(1.0, 1.29 * ((t / 100 - 60) ** -0.133)))
    g = (max(0.0, min(1.0, 0.39 * math.log(t / 100) - 0.63)) if t < 6600 else max(0.0, min(1.0, 1.13 * ((t / 100 - 60) ** -0.0755))))
    b = 1.0 if t >= 6600 else (0.0 if t < 1900 else max(0.0, min(1.0, 0.543 * math.log(t / 100 - 10) - 1.19)))
    del x
    return r, g, b
