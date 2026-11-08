"""Terrain horizon (Instructions §11-12; IMPLEMENTATION_PLAN §3.2).

For an observer at map point (x, y), height h0 above the sphere, raised by mast m:
  1. up0 is the radial unit vector; azimuth alpha is measured clockwise from north;
  2. march along the great circle leaving the observer in direction t = cos(alpha) north + sin(alpha) east: the
     point at arc distance s has unit vector v(s) = cos(s/R) up0 + sin(s/R) t;
  3. sample the finest DEM that covers v(s) (PGDA 78 5 m, else LOLA 80 m, else LOLA 240 m), bilinear;
  4. the sample's apparent elevation is asin(((R+h(s)) v(s) - P0) . up0 / |...|); lunar curvature enters through
     this 3-D geometry, with no correction term;
  5. the horizon for alpha is the maximum over s, for s >= s_min.
s_min = 1.5 pixels of the finest DEM in use (7.5 m on PGDA 78 5 m; 120 m on LOLA 80 m): the observer's own DEM cell
must not shadow itself. Inside that cell the bilinear surface only encodes the cell's tilt, which at the pole (where
the Sun stays within ~1.5 deg of the horizon) would otherwise decide surface-level illumination on its own.
Output: 720 azimuths (0.5 deg bins, bin k at k * 0.5 deg).
"""
from __future__ import annotations

import math
import time

import numpy as np
from numba import njit, prange

from .coordinates import R_MOON, local_basis
from .terrain import Raster

NAZ = 720
FINE_MAX = 12_000.0  # m: beyond this the 5 m tile is not used even where it exists
MID_MAX = 150_000.0
FAR_MAX = 300_000.0


def arc_schedule() -> np.ndarray:
    """Arc distances (m) sampled along every azimuth: dense near the observer, coarser with distance (matching the
    resolution of the DEM that will be sampled there)."""
    parts = [
        np.arange(5.0, 2000.0 + 1e-6, 5.0),
        np.arange(2010.0, 6000.0 + 1e-6, 10.0),
        np.arange(6020.0, FINE_MAX + 1e-6, 20.0),
        np.arange(FINE_MAX + 80.0, MID_MAX + 1e-6, 80.0),
        np.arange(MID_MAX + 240.0, FAR_MAX + 1e-6, 240.0),
    ]
    return np.concatenate(parts)


@njit(cache=True, inline="always")
def _bilinear(z, scale, x0, y0, res, x, y):
    n, m = z.shape
    c = (x - x0) / res
    r = (y0 - y) / res
    if c < 0.0 or r < 0.0 or c > m - 1.000001 or r > n - 1.000001:
        return math.nan
    c0 = int(c)
    r0 = int(r)
    fc = c - c0
    fr = r - r0
    v = (z[r0, c0] * (1.0 - fc) * (1.0 - fr) + z[r0, c0 + 1] * fc * (1.0 - fr)
         + z[r0 + 1, c0] * (1.0 - fc) * fr + z[r0 + 1, c0 + 1] * fc * fr)
    return v * scale


@njit(parallel=True, cache=True)
def _horizons(px, py, ph, mast, s_arr,
              fz, fs, fx0, fy0, fres,
              mz, ms, mx0, my0, mres,
              gz, gs, gx0, gy0, gres, naz):
    npt = px.shape[0]
    out = np.empty((npt, naz), dtype=np.float32)
    ns = s_arr.shape[0]
    cth = np.cos(s_arr / R_MOON)
    sth = np.sin(s_arr / R_MOON)
    for job in prange(npt * naz):
        p = job // naz
        k = job % naz
        # observer unit vector and local basis (trig-free inverse projection)
        a = py[p] / (2.0 * R_MOON)
        b = px[p] / (2.0 * R_MOON)
        q = a * a + b * b
        d = q + 1.0
        ux = 2.0 * a / d
        uy = 2.0 * b / d
        uz = (q - 1.0) / d
        en = math.sqrt(ux * ux + uy * uy)
        ex = -uy / en
        ey = ux / en
        # north = up x east
        nx = uy * 0.0 - uz * ey
        ny = uz * ex - ux * 0.0
        nz = ux * ey - uy * ex
        alpha = k * (2.0 * math.pi / naz)
        ca = math.cos(alpha)
        sa = math.sin(alpha)
        tx = ca * nx + sa * ex
        ty = ca * ny + sa * ey
        tz = ca * nz
        r0 = R_MOON + ph[p] + mast
        p0x = ux * r0
        p0y = uy * r0
        p0z = uz * r0
        best = -1.0
        for i in range(ns):
            vx = cth[i] * ux + sth[i] * tx
            vy = cth[i] * uy + sth[i] * ty
            vz = cth[i] * uz + sth[i] * tz
            kk = 2.0 * R_MOON / (1.0 - vz)
            sx = vy * kk
            sy = vx * kk
            s = s_arr[i]
            h = math.nan
            if s <= 12000.0:
                h = _bilinear(fz, fs, fx0, fy0, fres, sx, sy)
            if math.isnan(h) and s <= 150000.0:
                h = _bilinear(mz, ms, mx0, my0, mres, sx, sy)
            if math.isnan(h):
                h = _bilinear(gz, gs, gx0, gy0, gres, sx, sy)
            if math.isnan(h):
                continue
            rr = R_MOON + h
            dx = vx * rr - p0x
            dy = vy * rr - p0y
            dz = vz * rr - p0z
            dn = math.sqrt(dx * dx + dy * dy + dz * dz)
            se = (dx * ux + dy * uy + dz * uz) / dn
            if se > best:
                best = se
        out[p, k] = math.degrees(math.asin(best))
    return out


class TerrainStack:
    """The three DEMs used for horizons around one site (fine may be None away from PGDA 78 tiles)."""

    def __init__(self, fine: Raster | None, mid: Raster, far: Raster):
        self.fine, self.mid, self.far = fine, mid, far

    def height(self, x, y) -> np.ndarray:
        """Surface height at map points: finest covering DEM."""
        x = np.atleast_1d(np.asarray(x, float))
        y = np.atleast_1d(np.asarray(y, float))
        h = np.full(x.shape, np.nan)
        for r in (self.fine, self.mid, self.far):
            if r is None:
                continue
            m = np.isnan(h) & r.covers(x, y, r.res)
            if m.any():
                h[m] = r.sample(x[m], y[m])
        return h

    def args(self):
        f = self.fine
        if f is None:  # a 2 x 2 dummy that never covers anything
            fz, fs, fx0, fy0, fres = np.zeros((2, 2), np.float32), 1.0, 1e12, 1e12, 1.0
        else:
            fz, fs, fx0, fy0, fres = f.z, f.scale, f.x0, f.y0, f.res
        m, g = self.mid, self.far
        # np.asarray drops the memmap subclass (Numba needs a plain ndarray; no copy is made)
        return (np.asarray(fz), fs, fx0, fy0, fres, np.asarray(m.z), m.scale, m.x0, m.y0, m.res, np.asarray(g.z), g.scale, g.x0, g.y0, g.res)


def min_distance(stack: TerrainStack) -> float:
    return 1.5 * (stack.fine.res if stack.fine is not None else stack.mid.res)


def horizons(stack: TerrainStack, x, y, mast: float = 2.0, h=None, smin: float | None = None) -> np.ndarray:
    """Horizon elevations (deg), shape (n_points, 720), for observers at map points x, y (m)."""
    x = np.atleast_1d(np.asarray(x, float))
    y = np.atleast_1d(np.asarray(y, float))
    if h is None:
        h = stack.height(x, y)
    h = np.atleast_1d(np.asarray(h, float))
    if np.isnan(h).any():
        from .errors import OutOfCoverage
        raise OutOfCoverage("observer outside terrain coverage")
    s = arc_schedule()
    s = s[s >= (min_distance(stack) if smin is None else smin)]
    return _horizons(x, y, h, float(mast), s, *stack.args(), NAZ)


def horizon_at(stack: TerrainStack, x: float, y: float, mast: float = 2.0) -> dict:
    t0 = time.perf_counter()
    hz = horizons(stack, [x], [y], mast)[0]
    return {
        "azimuth_deg": (np.arange(NAZ) * 360.0 / NAZ).tolist(),
        "horizon_elevation_deg": [round(float(v), 4) for v in hz],
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1),
    }


def interp_horizon(hz: np.ndarray, az_deg: np.ndarray) -> np.ndarray:
    """Linear interpolation of a 720-bin horizon at azimuths (deg)."""
    f = (np.asarray(az_deg) % 360.0) / (360.0 / NAZ)
    k0 = np.floor(f).astype(np.int64) % NAZ
    k1 = (k0 + 1) % NAZ
    w = f - np.floor(f)
    return hz[..., k0] * (1 - w) + hz[..., k1] * w


__all__ = ["NAZ", "TerrainStack", "horizons", "horizon_at", "interp_horizon", "arc_schedule", "local_basis"]
