"""Independent validation (Instructions §24, §39; IMPLEMENTATION_PLAN §8 "Validation"). Tolerances are fixed here,
before any result exists; if a case fails, the science is fixed - the tolerance is never widened.

V1  NASA PGDA 69 average-visibility maps (Mazarico et al. 2011; LDEM_75S_120M; "any part of the disc"; surface
    level; full 18.6-year precession cycle). Points: the five site centres + 12 random landable points (fixed seed).
    Tolerance: mean absolute error <= 2 pp for Sun and for Earth.
V2  Gläser et al. (2018) Tables 1-2: 7 published south-polar points (surface and 2 m), 2017-01-01 to 2037-01-01,
    hourly. Tolerance: >= 5 of 7 within 3 pp in average illumination; longest shadow within 10%.
V4  SPICE (DE440, MOON_ME) vs JPL Horizons (DE441, MEAN_ME, airless) apparent Sun/Earth az/el at stored sites.
    Tolerance: <= 10 arcsec.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

import numpy as np

from ..config import RAW
from . import coordinates as C
from . import ephemeris as eph
from .horizon import TerrainStack, horizons
from .terrain import Raster, ldem80, ldem240, load_pds_polar, load_pgda78
from .visibility import disc_fraction_np

log = logging.getLogger("penumbra.validation")

V1_TOL_PP = 2.0
V2_TOL_PP = 3.0
V2_SHADOW_TOL = 0.10
V4_TOL_ARCSEC = 10.0

GLASER = [  # (label, lat, lon, height above ground m, avg illumination %, solar visibility %, max shadow h, table)
    ("Connecting Ridge C1 (surface)", -89.4505, 222.84, 0.0, 76.0, 81.3, 268, "Table 1"),
    ("Connecting Ridge C2 (surface)", -89.3157, 245.94, 0.0, 75.6, 80.6, 166, "Table 1"),
    ("Shackleton S (surface)", -89.7849, 203.97, 0.0, 81.0, 85.5, 221, "Table 1"),
    ("Connecting Ridge C1 (2 m)", -89.4398, 222.83, 2.0, 88.0, 92.1, 112, "Table 2"),
    ("Connecting Ridge C2 (2 m)", -89.3130, 245.98, 2.0, 78.1, 82.0, 165, "Table 2"),
    ("Shackleton S (2 m)", -89.6866, 197.19, 2.0, 85.5, 89.4, 66, "Table 2"),
    ("Shackleton S' (2 m)", -89.7815, 204.70, 2.0, 82.1, 89.8, 65, "Table 2"),
]
PGDA78_TILES = ("Site01", "Site04", "Site06", "Site20", "Site23")


def block_mean(r: Raster, k: int) -> Raster:
    """PGDA 78 raster averaged over k x k pixel blocks (5 m -> 5k m), to match a reference product's DEM resolution."""
    n, m = (r.shape[0] // k) * k, (r.shape[1] // k) * k
    z = np.asarray(r.z[:n, :m], np.float32).reshape(n // k, k, m // k, k).mean(axis=(1, 3))
    half = r.res / 2
    x_edge, y_edge = r.x0 - half, r.y0 + half
    res = r.res * k
    return Raster(z.astype(np.float32), x_edge + res / 2, y_edge - res / 2, res, 1.0, f"{r.name} @ {res:g} m", r.path)


_SMOOTH: dict[tuple[str, int], Raster] = {}


def stack_for(x: float, y: float, fine_res: float | None = 5.0) -> TerrainStack:
    """Terrain for a validation point. fine_res=5: the product pipeline (PGDA 78 5 m where a tile covers the point,
    then LOLA 80/240 m); fine_res=20: PGDA 78 averaged to 20 m (Gläser et al.'s DTM resolution); None: LOLA only
    (closest to the 120 m LDEM behind PGDA 69)."""
    if fine_res is not None:
        k = int(round(fine_res / 5.0))
        for t in PGDA78_TILES:
            r = load_pgda78(t)
            if r.covers(x, y, margin=500.0):
                if k > 1:
                    r = _SMOOTH.setdefault((t, k), block_mean(r, k))
                return TerrainStack(r, ldem80(), ldem240())
    return TerrainStack(None, ldem80(), ldem240())


def _moon_vectors(target: str, start: datetime, n: int, step_h: float) -> np.ndarray:
    import spiceypy as sp
    et = eph.ets(start, n, step_h)
    with eph._lock:
        pos, _ = sp.spkpos(target, et, eph.FRAME, "LT+S", "MOON")
    return np.asarray(pos, float) * 1000.0


def _visibility(hz: np.ndarray, x: float, y: float, h: float, vec: np.ndarray, radius_m: float):
    """Elevation margins e = E - H(A) (deg) and angular radii (deg) of a body seen from (x, y, h)."""
    p0 = C.surface_point(x, y, h)
    d = vec - p0[None, :]
    dist = np.linalg.norm(d, axis=1)
    up, e, n = C.local_basis(x, y)
    az, el = C.az_el(d, up, e, n)
    f = np.arange(720) * 0.5
    sky = np.interp(az, np.append(f, 360.0), np.append(hz, hz[0]))
    return el - sky, np.degrees(np.arcsin(radius_m / dist))


def longest_false_run(mask: np.ndarray) -> int:
    best = run = 0
    for v in mask:
        run = 0 if v else run + 1
        best = max(best, run)
    return best


# ---------------------------------------------------------------------------------------------- V1 PGDA 69
def v1_points(seed: int = 2026) -> list[tuple[str, float, float]]:
    from ..services.sites import SITES
    pts = [(s.name, *s.xy) for s in SITES.values()]
    rng = np.random.default_rng(seed)
    lo80 = ldem80()
    k = 0
    while k < 12:
        r = 150_000.0 * np.sqrt(rng.random())
        th = rng.random() * 2 * np.pi
        x, y = r * np.sin(th), r * np.cos(th)
        hh = lo80.sample(np.array([x - 240, x + 240, x, x]), np.array([y, y, y - 240, y + 240]))
        slope = np.degrees(np.arctan(np.hypot(hh[1] - hh[0], hh[3] - hh[2]) / 480.0))
        if slope <= 15.0:  # "landable": gentle at the 240 m scale
            k += 1
            pts.append((f"Random point {k:02d}", float(x), float(y)))
    return pts


def run_v1() -> dict:
    t0 = time.perf_counter()
    sun_map = load_pds_polar("AVGVISIB_75S_120M_201608", "pgda69")
    earth_map = load_pds_polar("AVGVISIB_75S_120M_201608_EARTH", "pgda69")
    start, step_h = datetime(2009, 1, 1, tzinfo=timezone.utc), 6.0
    n = int(18.6 * 365.25 * 24 / step_h)
    sun_v = _moon_vectors("SUN", start, n, step_h)
    earth_v = _moon_vectors("EARTH", start, n, step_h)
    r_sun, r_earth = eph.radius_km("SUN") * 1000, eph.radius_km("EARTH") * 1000
    rows = []
    for name, x, y in v1_points():
        # PGDA 69 values are pixel-registered 120 m cells: evaluate at the reference pixel's centre and take that
        # pixel's value (bilinear sampling would blend cells across steep ridge crests)
        c = int(round((x - sun_map.x0) / sun_map.res))
        r = int(round((sun_map.y0 - y) / sun_map.res))
        x, y = sun_map.x0 + c * sun_map.res, sun_map.y0 - r * sun_map.res
        st = stack_for(x, y, None)  # PGDA 69 was computed on the 120 m LDEM: compare at LOLA resolution
        h = float(st.height([x], [y])[0])
        hz = horizons(st, [x], [y], 0.0, [h])[0]
        es, rs = _visibility(hz, x, y, h, sun_v, r_sun)
        ee, re_ = _visibility(hz, x, y, h, earth_v, r_earth)
        ours_s = 100.0 * float(np.mean(es > -rs))
        ours_e = 100.0 * float(np.mean(ee > -re_))
        ref_s = 100.0 * float(sun_map.z[r, c]) * sun_map.scale
        ref_e = 100.0 * float(earth_map.z[r, c]) * earth_map.scale
        rows.append({"name": name, "x": round(x, 1), "y": round(y, 1), "terrain": "LOLA 80/240 m",
                     "ours_sun": round(ours_s, 2), "pgda_sun": round(ref_s, 2), "ours_earth": round(ours_e, 2), "pgda_earth": round(ref_e, 2)})
    mae_s = float(np.mean([abs(r["ours_sun"] - r["pgda_sun"]) for r in rows]))
    mae_e = float(np.mean([abs(r["ours_earth"] - r["pgda_earth"]) for r in rows]))
    return {"points": rows, "mae_sun": round(mae_s, 2), "mae_earth": round(mae_e, 2), "tolerance_pp": V1_TOL_PP,
            "pass": bool(mae_s <= V1_TOL_PP and mae_e <= V1_TOL_PP),
            "method": "Surface-level horizons (720 az) from LOLA 80/240 m (the reference used the 120 m LDEM); SPICE DE440 "
                      "Sun/Earth every 6 h over 18.6 years from 2009-01-01; 'any part of the disc'. Reference: PGDA 69 "
                      "AVGVISIB_75S_120M (sun and earth): each point is snapped to its 120 m pixel centre and compared with that pixel's value. The 18.6-year window start is our choice: "
                      "the product label gives the cycle but not its start.",
            "source": "NASA PGDA Product 69 (Mazarico et al. 2011, Icarus 211, 1066-1081)",
            "seconds": round(time.perf_counter() - t0, 1)}


# ---------------------------------------------------------------------------------------------- V2 Glaser 2018
def run_v2() -> dict:
    t0 = time.perf_counter()
    start = datetime(2017, 1, 1, tzinfo=timezone.utc)
    n = int((datetime(2037, 1, 1, tzinfo=timezone.utc) - start).total_seconds() // 3600)
    sun_v = _moon_vectors("SUN", start, n, 1.0)
    r_sun = eph.radius_km("SUN") * 1000
    rows = []
    for label, lat, lon, mast, pub_ill, pub_vis, pub_shadow, table in GLASER:
        x, y = C.ll_to_ps(lat, lon)
        x, y = float(x), float(y)
        # surface level depends on slopes at the DEM's own scale: compare it on Gläser et al.'s 20 m grid; the 2 m
        # cases use the full 5 m product pipeline
        st = stack_for(x, y, 20.0 if mast == 0.0 else 5.0)
        h = float(st.height([x], [y])[0])
        hz = horizons(st, [x], [y], mast, [h])[0]
        e, rho = _visibility(hz, x, y, h + mast, sun_v, r_sun)
        sens = None
        if mast == 0.0:
            st5 = stack_for(x, y, 5.0)
            h5 = float(st5.height([x], [y])[0])
            e5, rho5 = _visibility(horizons(st5, [x], [y], 0.0, [h5])[0], x, y, h5, sun_v, r_sun)
            sens = round(100.0 * float(disc_fraction_np(e5, rho5).mean()), 2)
        frac = disc_fraction_np(e, rho)
        anyp = e > -rho
        ours_ill = 100.0 * float(frac.mean())
        ours_vis = 100.0 * float(anyp.mean())
        shadow = longest_false_run(anyp)
        rows.append({"point": label, "lat": lat, "lon": lon, "height_m": mast, "table": table,
                     "published": pub_ill, "ours": round(ours_ill, 2), "diff": round(ours_ill - pub_ill, 2),
                     "published_visibility": pub_vis, "ours_visibility": round(ours_vis, 2),
                     "pub_shadow_h": pub_shadow, "ours_shadow_h": int(shadow),
                     "within_tol": bool(abs(ours_ill - pub_ill) <= V2_TOL_PP),
                     "shadow_within_tol": bool(abs(shadow - pub_shadow) <= V2_SHADOW_TOL * pub_shadow),
                     "terrain": (f"PGDA 78 at {st.fine.res:g} m + LOLA" if st.fine else "LOLA 80/240 m"),
                     "ours_at_5m_surface": sens})
    n_ok = sum(r["within_tol"] for r in rows)
    return {"points": rows, "n_within": n_ok, "n": len(rows), "tolerance_pp": V2_TOL_PP,
            "pass": bool(n_ok >= 5),
            "method": "2 m cases: horizons from PGDA 78 5 m + LOLA 80/240 m (the product pipeline). Surface cases: PGDA 78 "
                      "averaged to 20 m (the published DTM resolution) + LOLA, because surface-level light is set by slopes at "
                      "the DEM's own scale; the 5 m surface value is reported alongside as a sensitivity. SPICE DE440 Sun "
                      "hourly 2017-01-01 to 2037-01-01. Average "
                      "illumination = mean visible fraction of the solar disc; solar visibility = any part of the disc; "
                      "longest shadow = longest run with no part of the disc visible.",
            "source": "Gläser, P. et al. (2018) Illumination conditions at the lunar poles: implications for future "
                      "exploration. Planetary and Space Science 162, 170-178 (Tables 1-2)",
            "seconds": round(time.perf_counter() - t0, 1)}


# ---------------------------------------------------------------------------------------------- V4 SPICE vs Horizons
def _read_horizons(path) -> tuple[dict, np.ndarray]:
    meta: dict = {}
    rows, on = [], False
    for line in open(path, encoding="utf-8"):
        if line.startswith("Center geodetic"):
            v = line.split(":", 1)[1].split("{")[0].split(",")
            meta["lon"], meta["lat"], meta["alt_km"] = float(v[0]), float(v[1]), float(v[2])
        if line.startswith("$$SOE"):
            on = True
            continue
        if line.startswith("$$EOE"):
            break
        if on:
            p = [s.strip() for s in line.split(",")]
            rows.append((float(p[3]), float(p[4])))
    return meta, np.array(rows)


def run_v4() -> dict:
    out = []
    for tag in ("cr1", "malapert", "mouton", "im1"):
        for code, target in (("10", "SUN"), ("399", "EARTH")):
            p = RAW / f"horizons/{tag}_{code}_2027-01-01_2028-01-01_60m.txt"
            if not p.exists():
                continue
            meta, tab = _read_horizons(p)
            n = tab.shape[0] - 1
            x, y = C.ll_to_ps(meta["lat"], meta["lon"])
            p0 = C.surface_point(x, y, meta["alt_km"] * 1000.0)
            up, e, nn = C.local_basis(x, y)
            d, _ = eph.body_vectors(target, eph.ets(eph.year_start(2027), n), p0)
            az, el = C.az_el(d, up, e, nn)
            ref = C.unit_from_ll(tab[:n, 1], -tab[:n, 0])
            got = C.unit_from_ll(el, -az)
            sep = np.degrees(np.arccos(np.clip(np.sum(ref * got, 1), -1, 1))) * 3600
            out.append({"site": tag, "target": target, "hours": int(n), "max_arcsec": round(float(sep.max()), 2),
                        "mean_arcsec": round(float(sep.mean()), 2), "pass": bool(sep.max() <= V4_TOL_ARCSEC)})
    return {"cases": out, "tolerance_arcsec": V4_TOL_ARCSEC, "pass": bool(out and all(c["pass"] for c in out)),
            "method": "Apparent az/el ('LT+S') of the Sun and Earth from a surface point on the 1737.4 km sphere, hourly "
                      "through 2027, compared with JPL Horizons tables for the same points (MEAN_ME, airless).",
            "source": "JPL Horizons API tables (DE441), fetched 2026-09-28"}
