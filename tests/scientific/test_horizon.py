"""S4-S6: terrain horizon geometry on synthetic and real terrain."""
import math

import numpy as np

from backend.app.science import coordinates as C
from backend.app.science.horizon import NAZ, TerrainStack, horizons
from backend.app.science.terrain import Raster


def flat(res: float, half: float, z=None) -> Raster:
    n = int(2 * half / res) + 1
    arr = np.zeros((n, n), np.float32) if z is None else z
    return Raster(arr, -half, half, res, 1.0, "synthetic")


def stack_flat():
    return TerrainStack(flat(20.0, 20_000.0), flat(400.0, 420_000.0), flat(800.0, 500_000.0))


def test_s4_flat_moon_dip():
    st = stack_flat()
    x, y = C.ll_to_ps(-88.0, 30.0)
    hz = horizons(st, [x], [y], mast=2.0, h=[0.0])[0]
    expected = -math.degrees(math.acos(C.R_MOON / (C.R_MOON + 2.0)))  # ~ -0.0869 deg at ~2.64 km
    assert np.max(np.abs(hz - expected)) < 1e-3


def _ray_max(x0, y0, mast, height_fn, az_deg, smax=60_000.0, ds=2.0):
    """Independent brute-force reference: dense ray in lat/lon space with numpy."""
    up, e, n = C.local_basis(x0, y0)
    a = math.radians(az_deg)
    t = math.cos(a) * n + math.sin(a) * e
    s = np.arange(ds, smax, ds)
    v = np.cos(s / C.R_MOON)[:, None] * up + np.sin(s / C.R_MOON)[:, None] * t
    lat = np.degrees(np.arcsin(v[:, 2]))
    lon = np.degrees(np.arctan2(v[:, 1], v[:, 0]))
    sx, sy = C.ll_to_ps(lat, lon)
    p = (C.R_MOON + height_fn(sx, sy))[:, None] * v
    p0 = (C.R_MOON + height_fn(np.array([x0]), np.array([y0]))[0] + mast) * up
    d = p - p0
    return float(np.degrees(np.arcsin(np.max(d @ up / np.linalg.norm(d, axis=1)))))


def test_s5_gaussian_hill():
    res, half = 20.0, 20_000.0
    xs = -half + np.arange(int(2 * half / res) + 1) * res
    X, Y = np.meshgrid(xs, -xs)
    x0, y0 = 0.0, -8000.0
    hx, hy, H, sig = 0.0, 4000.0, 600.0, 1500.0  # hill 12 km "north" in map terms of the observer
    hill = lambda x, y: H * np.exp(-((x - hx) ** 2 + (y - hy) ** 2) / (2 * sig**2))  # noqa: E731
    st = TerrainStack(flat(res, half, hill(X, Y).astype(np.float32)), flat(400.0, 420_000.0), flat(800.0, 500_000.0))
    hz = horizons(st, [x0], [y0], mast=2.0)[0]
    # azimuth from the observer toward the hill (map +y direction expressed as a compass bearing)
    bearing = C.grid_north_bearing(x0, y0)
    k = int(round(bearing / (360.0 / NAZ))) % NAZ
    ref = _ray_max(x0, y0, 2.0, hill, k * 360.0 / NAZ, smax=20_000.0)
    assert abs(hz[k] - ref) < 0.05
    assert hz[k] > 1.0  # the hill clearly raises the horizon


def test_s6_mast_monotonic_on_real_terrain():
    from backend.app.science.terrain import ldem80, ldem240, load_pgda78
    st = TerrainStack(load_pgda78("Site01"), ldem80(), ldem240())
    x, y = -11000.0, -12000.0
    low = horizons(st, [x], [y], mast=0.0)[0]
    high = horizons(st, [x], [y], mast=10.0)[0]
    assert np.all(high <= low + 1e-6)
    assert np.isfinite(low).all() and low.max() < 20.0
