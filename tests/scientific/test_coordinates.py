"""S1-S2 and frame helpers (IMPLEMENTATION_PLAN §8)."""
import numpy as np
import pytest

from backend.app.science import coordinates as C
from backend.app.science.terrain import load_pgda78


def test_s1_round_trip_over_the_cap():
    rng = np.random.default_rng(1)
    lat = rng.uniform(-90.0, -75.0, 5000)
    lon = rng.uniform(0.0, 360.0, 5000)
    x, y = C.ll_to_ps(lat, lon)
    lat2, lon2 = C.ps_to_ll(x, y)
    assert np.max(np.abs(lat2 - lat)) < 1e-9
    dlon = (lon2 - lon + 180.0) % 360.0 - 180.0
    assert np.max(np.abs(dlon * np.cos(np.radians(lat)))) < 1e-9


def test_s1_matches_pyproj():
    pyproj = pytest.importorskip("pyproj")
    t = pyproj.Transformer.from_crs(
        pyproj.CRS.from_proj4("+proj=longlat +R=1737400 +no_defs"),
        pyproj.CRS.from_proj4("+proj=stere +lat_0=-90 +lon_0=0 +k=1 +R=1737400 +units=m +no_defs"),
        always_xy=True,
    )
    lat = np.array([-89.4632, -89.7668, -85.0, -80.0, -76.0])
    lon = np.array([222.51, 188.13, 31.7, 300.0, 0.0])
    px, py = t.transform(lon, lat)
    x, y = C.ll_to_ps(lat, lon)
    assert np.max(np.hypot(px - x, py - y)) < 1e-3  # 1 mm


def test_trig_free_projection_matches_formula():
    lat, lon = -88.0, 123.0
    x, y = C.ll_to_ps(lat, lon)
    v = C.unit_from_ll(lat, lon)
    assert np.allclose(C.unit_from_ps(x, y), v, atol=1e-12)
    assert np.allclose(C.ps_from_unit(*v), (x, y), atol=1e-6)


@pytest.mark.parametrize("tile,lat,lon", [("Site01", -89.4632, 222.510), ("Site04", -89.7668, 188.130)])
def test_s2_pgda78_tile_centres(tile, lat, lon):
    r = load_pgda78(tile)
    x0, y0, x1, y1 = r.bounds()
    ex, ey = C.ll_to_ps(lat, lon)
    # published centres are given to 1e-4 deg in latitude (~3 m) and 1e-3 deg in longitude (~0.3 m at 89.5 S)
    assert np.hypot((x0 + x1) / 2 - ex, (y0 + y1) / 2 - ey) < 5.0


def test_local_basis_and_az_el():
    x, y = C.ll_to_ps(-89.5, 45.0)
    up, e, n = C.local_basis(x, y)
    assert abs(np.dot(up, e)) < 1e-12 and abs(np.dot(up, n)) < 1e-12 and abs(np.dot(e, n)) < 1e-12
    az, el = C.az_el(up, up, e, n)
    assert abs(el - 90.0) < 1e-9
    az, el = C.az_el(n, up, e, n)
    assert abs(az) < 1e-9 and abs(el) < 1e-9
    az, el = C.az_el(e, up, e, n)
    assert abs(az - 90.0) < 1e-9
