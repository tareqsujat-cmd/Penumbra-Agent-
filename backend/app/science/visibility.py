"""Terrain-aware Sun and Earth visibility (Instructions §14-15; IMPLEMENTATION_PLAN §3.4, §3.6).

With e = E_target - H(A_target) (target elevation above the skyline at its azimuth) and rho its angular radius:
  solar-disc fraction (straight skyline across the disc):
      f = 1 if e >= rho;  0 if e <= -rho;  else 1 - [acos(e/rho) - (e/rho) sqrt(1 - (e/rho)^2)] / pi
  "any part of the disc" (used only for comparison with PGDA 69 / Glaser 2018, which use it):  e > -rho
  Earth visible (product): e >= margin (user-set; our assumption, not a NASA requirement)
  Earth visible (validation): e > -rho_earth
"""
from __future__ import annotations

import math

import numpy as np
from numba import njit, prange

NAZ = 720


@njit(cache=True, inline="always")
def disc_fraction(e: float, rho: float) -> float:
    if e >= rho:
        return 1.0
    if e <= -rho:
        return 0.0
    u = e / rho
    return 1.0 - (math.acos(u) - u * math.sqrt(1.0 - u * u)) / math.pi


def disc_fraction_np(e, rho):
    e = np.asarray(e, float)
    u = np.clip(e / rho, -1.0, 1.0)
    return 1.0 - (np.arccos(u) - u * np.sqrt(1.0 - u * u)) / np.pi


@njit(cache=True, inline="always")
def _hz(H, p, az):
    f = az / (360.0 / NAZ)
    k0 = int(math.floor(f))
    w = f - k0
    k0 = k0 % NAZ
    k1 = (k0 + 1) % NAZ
    return H[p, k0] * (1.0 - w) + H[p, k1] * w


@njit(cache=True, inline="always")
def _azel(dx, dy, dz, up, east, north, p):
    du = dx * up[p, 0] + dy * up[p, 1] + dz * up[p, 2]
    de = dx * east[p, 0] + dy * east[p, 1] + dz * east[p, 2]
    dn = dx * north[p, 0] + dy * north[p, 1] + dz * north[p, 2]
    el = math.degrees(math.asin(max(-1.0, min(1.0, du))))
    az = math.degrees(math.atan2(de, dn)) % 360.0
    return az, el


@njit(parallel=True, cache=True)
def grid_metrics(H, up, east, north, sun_d, sun_rho, earth_d, earth_rho, earth_margin, dsn_any, i0, i1, any_part):
    """Per-point metrics over hours [i0, i1): (sunlight mean %, Earth-visible %, DSN-opportunity %, longest
    darkness h). any_part=True switches to the 'any part of the disc' definitions used by the validation data."""
    npt = H.shape[0]
    sun = np.zeros(npt)
    earth = np.zeros(npt)
    dsn = np.zeros(npt)
    dark = np.zeros(npt)
    n = i1 - i0
    for p in prange(npt):
        s_sum = 0.0
        e_sum = 0.0
        d_sum = 0.0
        run = 0
        best = 0
        for t in range(i0, i1):
            az, el = _azel(sun_d[t, 0], sun_d[t, 1], sun_d[t, 2], up, east, north, p)
            e = el - _hz(H, p, az)
            if any_part:
                f = 1.0 if e > -sun_rho[t] else 0.0
            else:
                f = disc_fraction(e, sun_rho[t])
            s_sum += f
            if f <= 0.0:
                run += 1
                if run > best:
                    best = run
            else:
                run = 0
            az2, el2 = _azel(earth_d[t, 0], earth_d[t, 1], earth_d[t, 2], up, east, north, p)
            e2 = el2 - _hz(H, p, az2)
            vis = (e2 > -earth_rho[t]) if any_part else (e2 >= earth_margin)
            if vis:
                e_sum += 1.0
                if dsn_any[t]:
                    d_sum += 1.0
        sun[p] = 100.0 * s_sum / n
        earth[p] = 100.0 * e_sum / n
        dsn[p] = 100.0 * d_sum / n
        dark[p] = best
    return sun, earth, dsn, dark


def point_series(hz: np.ndarray, up, east, north, sun_d, sun_rho, earth_d, earth_rho, earth_margin):
    """Hourly series at one point: sun az/el, disc fraction, skyline at the Sun, Earth az/el and visibility."""
    from .coordinates import az_el
    saz, sel = az_el(sun_d, up, east, north)
    eaz, eel = az_el(earth_d, up, east, north)
    f = (np.arange(NAZ) * 360.0 / NAZ)
    sky_s = np.interp(saz, np.append(f, 360.0), np.append(hz, hz[0]))
    sky_e = np.interp(eaz, np.append(f, 360.0), np.append(hz, hz[0]))
    frac = disc_fraction_np(sel - sky_s, sun_rho)
    return {
        "sun_az": saz, "sun_el": sel, "sun_frac": frac, "sun_sky": sky_s,
        "earth_az": eaz, "earth_el": eel, "earth_vis": (eel - sky_e) >= earth_margin, "earth_sky": sky_e,
    }


def longest_run(mask: np.ndarray) -> tuple[int, int | None]:
    """Longest run of True values and the index where the first run starts (None if none)."""
    best = run = 0
    first = None
    for i, v in enumerate(mask):
        if v:
            run += 1
            if first is None:
                first = i
            best = max(best, run)
        else:
            run = 0
    return best, first
