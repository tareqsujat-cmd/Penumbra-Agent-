"""Request-level analyses behind the API: visibility series at an aim, landing risk, robust aim, comparison."""
from __future__ import annotations

import logging
import time
from functools import lru_cache

import numpy as np

from ..science import coordinates as C
from ..science import ephemeris as eph
from ..science.errors import OutOfCoverage
from ..science.horizon import horizons
from ..science.landing import Grid, Model, draw_offsets_en, en_to_map, landing_risk, robust_aim
from ..science.power import Vehicle, energy_balance, panel_power
from ..science.visibility import disc_fraction_np, longest_run
from . import products as P
from . import sites as S

log = logging.getLogger("penumbra.analysis")


# ---------------------------------------------------------------------------------------------- skyline at an aim
def aim_horizon(site_id: str, ax: float, ay: float, mast: float = 2.0) -> np.ndarray:
    return _aim_horizon(site_id, round(ax, 1), round(ay, 1), round(mast, 2))


@lru_cache(maxsize=256)
def _aim_horizon(site_id: str, ax: float, ay: float, mast: float) -> np.ndarray:
    s = S.get(site_id)
    if abs(ax) > S.GRID_HALF or abs(ay) > S.GRID_HALF:
        raise OutOfCoverage("high-resolution terrain is unavailable here: the point is outside the site's 5 m window",
                            aim=[ax, ay], half=S.GRID_HALF)
    cx, cy = s.xy
    return horizons(S.stack(site_id), [cx + ax], [cy + ay], mast)[0]


# ---------------------------------------------------------------------------------------------- visibility
def visibility(site_id: str, ax: float, ay: float, year: int, start: int, hours: int, earth_margin: float,
               dsn_mask: float, vehicle: Vehicle, heading: float | None, mast: float = 2.0) -> dict:
    t0 = time.perf_counter()
    s = S.get(site_id)
    g = P.geometry(site_id, year)
    n_year = g["sun_d"].shape[0]
    if start < 0 or start >= n_year:
        raise eph.DateOutOfRange("landing time outside the computed year", start=start, year=year)
    hours = int(min(hours, n_year - start))
    hz = aim_horizon(site_id, ax, ay, mast)
    cx, cy = s.xy
    up, e, n = C.local_basis(cx + ax, cy + ay)
    full = slice(0, n_year)
    saz, sel = C.az_el(g["sun_d"][full], up, e, n)
    eaz, eel = C.az_el(g["earth_d"][full], up, e, n)
    f = np.arange(720) * 0.5
    sky = lambda az: np.interp(az, np.append(f, 360.0), np.append(hz, hz[0]))  # noqa: E731
    frac_year = disc_fraction_np(sel - sky(saz), g["sun_rho"])
    earth_year = (eel - sky(eaz)) >= earth_margin
    st = {k: g[f"dsn_{k}"] >= dsn_mask for k in ("goldstone", "madrid", "canberra")}
    w = slice(start, start + hours)
    frac = frac_year[w]
    earth = earth_year[w]
    any_st = st["goldstone"][w] | st["madrid"][w] | st["canberra"][w]
    dsn = earth & any_st
    blocked = (frac <= 0) & (sel[w] > -g["sun_rho"][w])  # Sun above the mathematical horizon yet hidden by terrain
    dark_run, dark_first = longest_run(frac <= 0)
    hd = (saz[start] + 180.0) % 360.0 if heading is None else heading  # aft panel toward the Sun at landing
    p_in = panel_power(vehicle, saz[w], sel[w], frac, hd)
    pw = energy_balance(vehicle, p_in)
    days = n_year // 24
    daily = frac_year[: days * 24].reshape(days, 24).mean(axis=1) * 100.0
    return {
        "start_idx": start, "hours": hours, "year": year,
        "sun_frac": np.round(frac, 3).tolist(),
        "terrain_blocked": blocked.astype(int).tolist(),
        "earth": earth.astype(int).tolist(), "dsn": dsn.astype(int).tolist(),
        "station": {k: v[w].astype(int).tolist() for k, v in st.items()},
        "soc": np.round(pw["soc"], 4).tolist(), "hibernating": pw["hibernating"].tolist(),
        "depleted_at": pw["depleted_at"], "heading_deg": round(float(hd), 1),
        "summary": {
            "sunlight_pct": round(float(frac.mean() * 100), 2), "earth_pct": round(float(earth.mean() * 100), 2),
            "dsn_pct": round(float(dsn.mean() * 100), 2), "longest_dark_h": int(dark_run),
            "dark_starts_in_h": dark_first, "endurance_days": pw["endurance_days"],
        },
        "skyline_deg": [round(float(v), 3) for v in hz],
        "daily_sun_pct": np.round(daily, 2).tolist(),
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1),
    }


def endurance_by_landing_day(site_id: str, ax: float, ay: float, year: int, window_days: int, vehicle: Vehicle,
                             step_days: int = 1, mast: float = 2.0) -> dict:
    """Energy endurance estimate (days) for every landing day of the year (heading: aft panel toward the Sun at
    landing). None = the battery outlasted the window."""
    t0 = time.perf_counter()
    s = S.get(site_id)
    g = P.geometry(site_id, year)
    n_year = g["sun_d"].shape[0]
    hz = aim_horizon(site_id, ax, ay, mast)
    cx, cy = s.xy
    up, e, n = C.local_basis(cx + ax, cy + ay)
    saz, sel = C.az_el(g["sun_d"], up, e, n)
    f = np.arange(720) * 0.5
    sky = np.interp(saz, np.append(f, 360.0), np.append(hz, hz[0]))
    frac = disc_fraction_np(sel - sky, g["sun_rho"])
    hours = window_days * 24
    days, out = [], []
    for d in range(0, n_year // 24 - window_days + 1, step_days):
        i0 = d * 24
        w = slice(i0, i0 + hours)
        p_in = panel_power(vehicle, saz[w], sel[w], frac[w], (saz[i0] + 180.0) % 360.0)
        days.append(d)
        out.append(energy_balance(vehicle, p_in)["endurance_days"])
    return {"days": days, "endurance_days": out, "window_days": window_days,
            "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1)}


def best_landing_day(daily: list[float], window_days: int) -> tuple[int, float]:
    d = np.asarray(daily)
    if window_days >= d.size:
        return 0, float(d.mean())
    c = np.convolve(d, np.ones(window_days) / window_days, mode="valid")
    k = int(np.argmax(c))
    return k, float(c[k])


# ---------------------------------------------------------------------------------------------- landing risk
def _grids(site_id: str, year: int, earth_margin: float, dsn_mask: float, start: int | None, hours: int | None):
    m = P.grid_metric_fields(site_id, year, earth_margin, dsn_mask, start or 0, hours)
    x0, y0, dx = float(m["xs"][0]), float(m["ys"][0]), float(m["xs"][1] - m["xs"][0])
    return Grid(x0, y0, dx, m["sun"]), Grid(x0, y0, dx, m["earth"])


def offsets(site_id: str, model: Model, n: int, seed: int) -> np.ndarray:
    cx, cy = S.get(site_id).xy
    return en_to_map(draw_offsets_en(model, n, seed), C.grid_north_bearing(cx, cy))


def risk(site_id: str, aim: tuple[float, float], model: Model, q: int, year: int, n: int = 2000, seed: int = 7,
         earth_margin: float = 2.0, dsn_mask: float = 6.0, start: int | None = None, hours: int | None = None) -> dict:
    sun, earth = _grids(site_id, year, earth_margin, dsn_mask, start, hours)
    return landing_risk(sun, aim, offsets(site_id, model, n, seed), q, earth)


def compare(site_ids: list[str], model: Model, q: int, year: int, start_idx: int, window_days: int, vehicle: Vehicle,
            search_radius: float = 450.0, earth_margin: float = 2.0, dsn_mask: float = 6.0) -> dict:
    """Score each site at its own robust aim over the same mission window (sunlight in the first `window_days` days
    after the landing date), so changing the date can change the ranking. Used by POST /api/compare and the assistant."""
    n_year = eph.hours_in_year(year)
    start = min(start_idx, n_year - 24)
    hours = min(window_days * 24, n_year - start)
    rows = []
    for sid in site_ids:
        ra = robust(sid, model, q, year, search_radius, earth_margin=earth_margin, dsn_mask=dsn_mask, start=start, hours=hours)
        aim = (ra["robust"]["x"], ra["robust"]["y"])
        rk = risk(sid, aim, model, q, year, earth_margin=earth_margin, dsn_mask=dsn_mask, start=start, hours=hours)
        v = visibility(sid, aim[0], aim[1], year, start_idx, window_days * 24, earth_margin, dsn_mask, vehicle, None)
        day, pct = best_landing_day(v["daily_sun_pct"], window_days)
        rows.append({"site": sid, "name": S.get(sid).name, "brightest": ra["best_nominal"]["value"],
                     "brightestPq": ra["best_nominal"]["pq"], "robustAt": {"x": aim[0], "y": aim[1]},
                     "robustNominal": ra["robust"]["value"], "p50": rk["p"][50], "p20": rk["p"][20], "p10": rk["p"][10],
                     "p05": rk["p"][5], "longestDarkH": v["summary"]["longest_dark_h"], "earthPct": v["summary"]["earth_pct"],
                     "dsnPct": v["summary"]["dsn_pct"], "windowSunPct": v["summary"]["sunlight_pct"],
                     "bestLandingIdx": day * 24, "bestLandingSunPct": round(pct, 2), "fieldKind": "computed"})
    key = {50: "p50", 20: "p20", 10: "p10", 5: "p05"}[q]
    ranking = [r["site"] for r in sorted(rows, key=lambda r: -r[key])]
    return {"rows": rows, "ranking": ranking, "window": {"startIdx": start, "hours": hours},
            "rankedBy": f"P{q} sunlight in the first {hours // 24} days after landing, at each site's robust aim"}


def robust(site_id: str, model: Model, q: int, year: int, search_radius: float = 450.0, n: int = 2000, seed: int = 7,
           earth_margin: float = 2.0, dsn_mask: float = 6.0, start: int | None = None, hours: int | None = None,
           slope_max: float | None = None) -> dict:
    sun, _ = _grids(site_id, year, earth_margin, dsn_mask, start, hours)
    slope = None
    if slope_max is not None:
        s = S.get(site_id)
        from ..science.terrain import load_pgda78
        r = load_pgda78(s.tile, "slp")
        cx, cy = s.xy
        X, Y = np.meshgrid(cx + sun.x0 + np.arange(sun.nx) * sun.dx, cy + sun.y0 + np.arange(sun.ny) * sun.dx)
        slope = Grid(sun.x0, sun.y0, sun.dx, r.sample(X, Y))
    return robust_aim(sun, offsets(site_id, model, n, seed), q, search_radius, slope=slope, slope_max=slope_max)
