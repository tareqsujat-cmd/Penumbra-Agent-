"""Cached scientific products (Instructions §45): disk .npz under data/cache/, keyed by the inputs, plus an in-memory
LRU. No database.

  horizons   per site (and terrain realisation, mast): the local performance grid's 720-bin skylines
  geometry   per site and year: hourly Sun/Earth unit vectors and angular radii seen from the site centre
  metrics    per site, year, window, margin, mask: sunlight / Earth / DSN / longest darkness on the grid
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from datetime import timedelta
from functools import lru_cache

import numpy as np

from ..config import CACHE
from ..science import coordinates as C
from ..science import dsn as D
from ..science import ephemeris as eph
from ..science.horizon import horizons
from ..science.visibility import grid_metrics
from . import sites as S

log = logging.getLogger("penumbra.products")
TERRAIN_VERSION = "pgda78-v1+ldem80s-v2+ldem75s-v2+smin1.5px"
_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()


def _lock(key: str) -> threading.Lock:
    with _guard:
        return _locks.setdefault(key, threading.Lock())


def _key(*parts) -> str:
    return hashlib.sha1(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------------------------- horizons grid
def horizon_grid(site_id: str, mast: float = 2.0, clone: int | None = None) -> dict:
    """Skylines on the site's performance grid: {xs, ys (offsets), X, Y (map), h, H (n, 720) float32}."""
    return _horizon_grid(site_id, round(float(mast), 2), clone)


@lru_cache(maxsize=6)
def _horizon_grid(site_id: str, mast: float, clone: int | None) -> dict:
    s = S.get(site_id)
    xs, ys = S.grid_axes(site_id)
    path = CACHE / "horizons" / f"{site_id}_m{mast:g}_c{clone or 0}_{_key(TERRAIN_VERSION, s.grid_dx, S.GRID_HALF)}.npz"
    with _lock(str(path)):
        if path.exists():
            z = np.load(path)
            out = {k: z[k] for k in z.files}
            log.info("horizons %s mast %s clone %s: cache hit", site_id, mast, clone)
            return out
        cx, cy = s.xy
        OX, OY = np.meshgrid(xs, ys)
        X, Y = cx + OX.ravel(), cy + OY.ravel()
        st = S.stack(site_id, clone)
        t0 = time.perf_counter()
        h = st.height(X, Y)
        H = horizons(st, X, Y, mast, h)
        dt = time.perf_counter() - t0
        log.info("horizons %s mast %s clone %s: %d points in %.1f s", site_id, mast, clone, X.size, dt)
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(path, xs=xs, ys=ys, X=X, Y=Y, h=h, H=H.astype(np.float32), seconds=dt)
        return {"xs": xs, "ys": ys, "X": X, "Y": Y, "h": h, "H": H.astype(np.float32), "seconds": np.array(dt)}


# ---------------------------------------------------------------------------------------------- geometry
@lru_cache(maxsize=16)
def geometry(site_id: str, year: int) -> dict:
    """Hourly Sun/Earth directions (unit, MOON_ME) and angular radii (deg) from the site centre for a calendar year,
    plus the DSN stations' Moon elevations."""
    s = S.get(site_id)
    path = CACHE / "geometry" / f"{site_id}_{year}_{_key(eph.KERNELS)}.npz"
    with _lock(str(path)):
        if path.exists():
            z = np.load(path)
            return {k: z[k] for k in z.files}
        cx, cy = s.xy
        h0 = float(S.stack(site_id).height([cx], [cy])[0])
        p0 = C.surface_point(cx, cy, h0)
        n = eph.hours_in_year(year)
        et = eph.ets(eph.year_start(year), n)
        sd, sdist = eph.body_vectors("SUN", et, p0)
        ed, edist = eph.body_vectors("EARTH", et, p0)
        r_sun = eph.radius_km("SUN") * 1000.0
        r_earth = eph.radius_km("EARTH") * 1000.0
        out = {
            "sun_d": sd.astype(np.float64), "sun_rho": np.degrees(np.arcsin(r_sun / sdist)),
            "earth_d": ed.astype(np.float64), "earth_rho": np.degrees(np.arcsin(r_earth / edist)),
            "earth_dist_km": edist / 1000.0,
        }
        for k, v in D.station_elevations(year).items():
            out[f"dsn_{k}"] = v
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(path, **out)
        return out


# ---------------------------------------------------------------------------------------------- metrics on the grid
def bases(X: np.ndarray, Y: np.ndarray):
    up, e, n = C.local_basis(X, Y)
    return np.ascontiguousarray(up), np.ascontiguousarray(e), np.ascontiguousarray(n)


def grid_metric_fields(site_id: str, year: int, earth_margin: float = 2.0, dsn_mask: float = 6.0,
                       start_h: int = 0, hours: int | None = None, mast: float = 2.0, clone: int | None = None) -> dict:
    """Sunlight %, Earth-visible %, DSN-opportunity % and longest darkness (h) on the grid over a window of the year.
    Fields are (ny, nx) with rows ascending y."""
    g = geometry(site_id, year)
    n_year = g["sun_d"].shape[0]
    hours = n_year - start_h if hours is None else hours
    if start_h < 0 or start_h + hours > n_year or hours <= 0:
        raise eph.DateOutOfRange("window outside the computed year", start_h=start_h, hours=hours)
    return _metrics(site_id, year, round(earth_margin, 2), round(dsn_mask, 2), start_h, hours, round(mast, 2), clone)


@lru_cache(maxsize=48)
def _metrics(site_id, year, earth_margin, dsn_mask, start_h, hours, mast, clone):
    hg = horizon_grid(site_id, mast, clone)
    g = geometry(site_id, year)
    up, e, n = bases(hg["X"], hg["Y"])
    dsn_any = (g["dsn_goldstone"] >= dsn_mask) | (g["dsn_madrid"] >= dsn_mask) | (g["dsn_canberra"] >= dsn_mask)
    t0 = time.perf_counter()
    sun, earth, dsnp, dark = grid_metrics(hg["H"], up, e, n, g["sun_d"], g["sun_rho"], g["earth_d"], g["earth_rho"],
                                          earth_margin, dsn_any, start_h, start_h + hours, False)
    ny, nx = hg["ys"].size, hg["xs"].size
    log.info("metrics %s %d [%d,+%d) margin %s mask %s: %.2f s", site_id, year, start_h, hours, earth_margin, dsn_mask,
             time.perf_counter() - t0)
    shape = lambda a: a.reshape(ny, nx)  # noqa: E731
    return {"sun": shape(sun), "earth": shape(earth), "dsn": shape(dsnp), "dark": shape(dark),
            "xs": hg["xs"], "ys": hg["ys"]}


def landing_window(year: int, start_h: int, days: int) -> tuple[int, int]:
    n = eph.hours_in_year(year)
    hours = min(days * 24, n - start_h)
    return start_h, hours


def utc_of(year: int, idx: int) -> str:
    return (eph.year_start(year) + timedelta(hours=idx)).strftime("%Y-%m-%dT%H:%MZ")
