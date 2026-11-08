"""Landing uncertainty, landing-zone statistics and the robust-aim optimiser (Instructions §17-19;
IMPLEMENTATION_PLAN §3.7).

Touchdown models (offsets from the commanded aim, local east/north metres):
  circular            uniform over a disc of radius r
  elliptical Gaussian sigma_E, sigma_N, rotated by theta (counter-clockwise from east); the confidence-ellipse scale
                      for probability p is k = sqrt(-2 ln(1 - p))
Samples: N offsets drawn once from a fixed seed and reused for every candidate aim (common random numbers, so
rankings are stable). Metrics at aim + offset come from bilinear interpolation of the local performance grid; the
terrain horizon is never recomputed per sample (§17).
Robustness: Pq = q-th percentile of the utility over samples (P50 typical, P20 cautious, P10 conservative, P05 highly
conservative). Robust aim = argmax over candidate aims of Pq.
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass

import numpy as np
from numba import njit, prange

from .errors import InvalidUncertainty, OutOfCoverage

PERCENTILES = (50, 20, 10, 5)


@dataclass
class Model:
    kind: str  # "circular" | "gaussian"
    radius: float = 100.0
    sigma_e: float = 50.0
    sigma_n: float = 50.0
    rot_deg: float = 0.0

    def validate(self) -> None:
        if self.kind == "circular":
            if not (1.0 <= self.radius <= 2000.0):
                raise InvalidUncertainty("circular radius must be 1-2000 m", radius=self.radius)
        elif self.kind == "gaussian":
            if not (1.0 <= self.sigma_e <= 1000.0 and 1.0 <= self.sigma_n <= 1000.0):
                raise InvalidUncertainty("sigma_E and sigma_N must be 1-1000 m", sigma_e=self.sigma_e, sigma_n=self.sigma_n)
        else:
            raise InvalidUncertainty(f"unknown model kind {self.kind!r}")

    def extent(self) -> float:
        """Distance beyond which samples are (practically) never drawn: r, or 3.5 sigma."""
        return self.radius if self.kind == "circular" else 3.5 * max(self.sigma_e, self.sigma_n)


def confidence_scale(p: float) -> float:
    return math.sqrt(-2.0 * math.log(1.0 - p))


def draw_offsets_en(model: Model, n: int = 2000, seed: int = 7) -> np.ndarray:
    """Touchdown offsets in local (east, north) metres, shape (n, 2)."""
    model.validate()
    rng = np.random.default_rng(seed)
    if model.kind == "circular":
        r = model.radius * np.sqrt(rng.random(n))
        th = 2 * np.pi * rng.random(n)
        return np.stack([r * np.cos(th), r * np.sin(th)], axis=1)
    z = rng.standard_normal((n, 2)) * np.array([model.sigma_e, model.sigma_n])
    c, s = math.cos(math.radians(model.rot_deg)), math.sin(math.radians(model.rot_deg))
    return np.stack([z[:, 0] * c - z[:, 1] * s, z[:, 0] * s + z[:, 1] * c], axis=1)


def en_to_map(off_en: np.ndarray, bearing_deg: float) -> np.ndarray:
    """Local east/north offsets -> polar-stereographic map offsets, given the compass bearing of map +y at the
    site (coordinates.grid_north_bearing)."""
    b = math.radians(bearing_deg)
    e, n = off_en[:, 0], off_en[:, 1]
    return np.stack([e * math.cos(b) - n * math.sin(b), e * math.sin(b) + n * math.cos(b)], axis=1)


@dataclass
class Grid:
    """A metric on a regular grid of map offsets from the site centre (rows ascending y)."""
    x0: float
    y0: float
    dx: float
    values: np.ndarray  # (ny, nx)

    @property
    def nx(self) -> int:
        return self.values.shape[1]

    @property
    def ny(self) -> int:
        return self.values.shape[0]

    def contains(self, x, y, margin: float = 0.0) -> np.ndarray:
        x, y = np.asarray(x), np.asarray(y)
        return ((x >= self.x0 + margin) & (x <= self.x0 + (self.nx - 1) * self.dx - margin)
                & (y >= self.y0 + margin) & (y <= self.y0 + (self.ny - 1) * self.dx - margin))

    def sample(self, x, y) -> np.ndarray:
        x = np.asarray(x, float)
        y = np.asarray(y, float)
        return _bilinear_many(self.values.astype(np.float64), self.x0, self.y0, self.dx, x.ravel(), y.ravel()).reshape(x.shape)


@njit(parallel=True, cache=True)
def _bilinear_many(v, x0, y0, dx, xs, ys):
    ny, nx = v.shape
    out = np.empty(xs.shape[0])
    for i in prange(xs.shape[0]):
        gx = (xs[i] - x0) / dx
        gy = (ys[i] - y0) / dx
        if gx < 0.0 or gy < 0.0 or gx > nx - 1 or gy > ny - 1:
            out[i] = np.nan
            continue
        c = min(int(gx), nx - 2)
        r = min(int(gy), ny - 2)
        fx = gx - c
        fy = gy - r
        out[i] = (v[r, c] * (1 - fx) * (1 - fy) + v[r, c + 1] * fx * (1 - fy) + v[r + 1, c] * (1 - fx) * fy
                  + v[r + 1, c + 1] * fx * fy)
    return out


def percentiles(vals: np.ndarray) -> dict[int, float]:
    return {q: float(np.percentile(vals, q)) for q in PERCENTILES}


def landing_risk(grid: Grid, aim: tuple[float, float], offsets_map: np.ndarray, q: int, earth: Grid | None = None,
                 n_return: int = 500) -> dict:
    """Landing-zone statistics for one commanded aim."""
    t0 = time.perf_counter()
    ax, ay = aim
    if not grid.contains(ax, ay):
        raise OutOfCoverage("aim outside the high-resolution performance grid", aim=[ax, ay])
    xs = ax + offsets_map[:, 0]
    ys = ay + offsets_map[:, 1]
    v = grid.sample(xs, ys)
    inside = ~np.isnan(v)
    frac_in = float(inside.mean())
    if frac_in < 0.95:
        raise OutOfCoverage("more than 5% of the landing zone falls outside the performance grid; move the aim inward "
                            "or reduce the uncertainty", inside_fraction=round(frac_in, 3))
    vin = v[inside]
    p = percentiles(vin)
    out = {
        "nominal": float(grid.sample(np.array([ax]), np.array([ay]))[0]),
        "p": p,
        "pq": p[q],
        "mean": float(vin.mean()),
        "histogram": np.histogram(np.clip(vin, 0, 100), bins=20, range=(0, 100))[0].tolist(),
        "samples": [{"x": round(float(a), 1), "y": round(float(b), 1), "v": round(float(c), 2)}
                    for a, b, c in zip(xs[:n_return], ys[:n_return], v[:n_return]) if not np.isnan(c)],
        "n": int(inside.sum()),
        "inside_fraction": frac_in,
    }
    if earth is not None:
        ev = earth.sample(xs, ys)
        ev = ev[~np.isnan(ev)]
        out["earth_p"] = percentiles(ev)
        out["earth_pq"] = out["earth_p"][q]
    out["elapsed_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    return out


@njit(parallel=True, cache=True)
def _pq_for_candidates(v, x0, y0, dx, cx, cy, ox, oy, q):
    ny, nx = v.shape
    nc = cx.shape[0]
    ns = ox.shape[0]
    out = np.empty(nc)
    for c in prange(nc):
        vals = np.empty(ns)
        k = 0
        for s in range(ns):
            gx = (cx[c] + ox[s] - x0) / dx
            gy = (cy[c] + oy[s] - y0) / dx
            if gx < 0.0 or gy < 0.0 or gx > nx - 1 or gy > ny - 1:
                continue
            i = min(int(gx), nx - 2)
            j = min(int(gy), ny - 2)
            fx = gx - i
            fy = gy - j
            vals[k] = (v[j, i] * (1 - fx) * (1 - fy) + v[j, i + 1] * fx * (1 - fy) + v[j + 1, i] * (1 - fx) * fy
                       + v[j + 1, i + 1] * fx * fy)
            k += 1
        if k < 0.95 * ns:
            out[c] = np.nan
        else:
            out[c] = np.percentile(vals[:k], q)
    return out


def robust_aim(grid: Grid, offsets_map: np.ndarray, q: int, search_radius: float, center=(0.0, 0.0),
               slope: Grid | None = None, slope_max: float | None = None) -> dict:
    """Evaluate Pq at every grid node within `search_radius` of `center` whose landing zone stays on the grid;
    return the best nominal point, the robust aim and the score field (Pq per node, NaN where not evaluated)."""
    t0 = time.perf_counter()
    ys_idx, xs_idx = np.mgrid[0:grid.ny, 0:grid.nx]
    X = grid.x0 + xs_idx * grid.dx
    Y = grid.y0 + ys_idx * grid.dx
    reach = float(np.max(np.hypot(offsets_map[:, 0], offsets_map[:, 1])))
    cand = (np.hypot(X - center[0], Y - center[1]) <= search_radius) & grid.contains(X, Y, margin=min(reach, 0.45 * grid.dx * (grid.nx - 1)))
    if slope is not None and slope_max is not None:
        cand &= slope.sample(X, Y) <= slope_max
    if not cand.any():
        raise OutOfCoverage("no candidate aims: the landing zone does not fit inside the grid for this uncertainty")
    cx, cy = X[cand], Y[cand]
    pq = _pq_for_candidates(grid.values.astype(np.float64), grid.x0, grid.y0, grid.dx, cx, cy,
                            offsets_map[:, 0].copy(), offsets_map[:, 1].copy(), float(q))
    score = np.full(grid.values.shape, np.nan)
    score[cand] = pq
    ok = ~np.isnan(pq)
    if not ok.any():
        raise OutOfCoverage("no candidate aim keeps its landing zone on the grid")
    nom = grid.values[cand]
    # robust aim: highest Pq; ties broken by the higher nominal value
    order = np.lexsort((np.where(ok, nom, -1), np.where(ok, pq, -1)))
    r = order[-1]
    b = int(np.argmax(np.where(ok, nom, -1)))
    return {
        "best_nominal": {"x": float(cx[b]), "y": float(cy[b]), "value": float(nom[b]), "pq": float(pq[b])},
        "robust": {"x": float(cx[r]), "y": float(cy[r]), "value": float(nom[r]), "pq": float(pq[r])},
        "score": score,
        "candidates": int(ok.sum()),
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1),
    }
