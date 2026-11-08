"""The only place with lunar coordinate formulas (Instructions §10; docs/COORDINATE_SYSTEMS.md).

Frame: MOON_ME (mean Earth / polar axis). The terrain products (LOLA LDEM, PGDA 69, PGDA 78) are in the ME frame of
DE421; the SPICE kernels used here (moon_pa_de440_200625.bpc + moon_de440_250416.tf) realise MOON_ME as
MOON_ME_DE440_ME421, which differs from DE421's ME frame by < 3.1e-7 rad (~0.5 m) over 2000-2040 per the kernel notes.

Reference sphere R = 1737.4 km; every DEM height is relative to it.

South polar stereographic map (spherical, true scale at the pole), east longitude lambda, latitude phi < 0:
    rho = 2R tan(pi/4 + phi/2),  x = rho sin(lambda),  y = rho cos(lambda)
Equivalently, from a unit body-fixed vector v (projection from the north pole onto the plane tangent at the south
pole):  x = 2R v_y / (1 - v_z),  y = 2R v_x / (1 - v_z)  - no trigonometry, which the horizon tracer relies on.
"""
from __future__ import annotations

import math

import numpy as np
from numba import njit

R_MOON = 1_737_400.0  # m


# ---------------------------------------------------------------------------------------------- map <-> lat/lon
def ll_to_ps(lat_deg, lon_deg):
    """Latitude/east longitude (deg) -> south polar stereographic x, y (m). Works on scalars or arrays."""
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)
    rho = 2.0 * R_MOON * np.tan(np.pi / 4.0 + lat / 2.0)
    return rho * np.sin(lon), rho * np.cos(lon)


def ps_to_ll(x, y):
    """South polar stereographic x, y (m) -> latitude, east longitude in [0, 360) (deg)."""
    lat = np.degrees(2.0 * np.arctan(np.hypot(x, y) / (2.0 * R_MOON)) - np.pi / 2.0)
    lon = np.degrees(np.arctan2(x, y)) % 360.0
    return lat, lon


# ---------------------------------------------------------------------------------------------- body-fixed vectors
def unit_from_ll(lat_deg, lon_deg) -> np.ndarray:
    """Unit body-fixed vector (MOON_ME) for latitude/longitude in degrees; shape (..., 3)."""
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=-1)


@njit(cache=True, inline="always")
def unit_from_ps(x: float, y: float) -> tuple[float, float, float]:
    """Unit body-fixed vector of a south polar stereographic point (inverse of the trig-free projection)."""
    a = y / (2.0 * R_MOON)
    b = x / (2.0 * R_MOON)
    q = a * a + b * b
    d = q + 1.0
    return 2.0 * a / d, 2.0 * b / d, (q - 1.0) / d


@njit(cache=True, inline="always")
def ps_from_unit(vx: float, vy: float, vz: float) -> tuple[float, float]:
    k = 2.0 * R_MOON / (1.0 - vz)
    return vy * k, vx * k


def surface_point(x, y, h) -> np.ndarray:
    """Body-fixed position (m) of the point at map x, y with height h above the reference sphere."""
    ux, uy, uz = _unit_from_ps_np(np.asarray(x, float), np.asarray(y, float))
    r = R_MOON + np.asarray(h, float)
    return np.stack([ux * r, uy * r, uz * r], axis=-1)


def _unit_from_ps_np(x, y):
    a = y / (2.0 * R_MOON)
    b = x / (2.0 * R_MOON)
    q = a * a + b * b
    d = q + 1.0
    return 2.0 * a / d, 2.0 * b / d, (q - 1.0) / d


# ---------------------------------------------------------------------------------------------- local frame
def local_basis(x, y) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(up, east, north) unit vectors at map point(s) x, y; each shape (..., 3).

    up = radial unit vector; east = z x up normalised (direction of increasing longitude); north = up x east.
    """
    ux, uy, uz = _unit_from_ps_np(np.asarray(x, float), np.asarray(y, float))
    up = np.stack([ux, uy, uz], axis=-1)
    e = np.stack([-uy, ux, np.zeros_like(ux)], axis=-1)
    e /= np.linalg.norm(e, axis=-1, keepdims=True)
    north = np.cross(up, e)
    return up, e, north


def az_el(d: np.ndarray, up: np.ndarray, east: np.ndarray, north: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Azimuth (deg, clockwise from north, [0, 360)) and elevation (deg) of direction vector(s) d."""
    dn = np.linalg.norm(d, axis=-1)
    el = np.degrees(np.arcsin(np.clip(np.sum(d * up, axis=-1) / dn, -1.0, 1.0)))
    az = np.degrees(np.arctan2(np.sum(d * east, axis=-1), np.sum(d * north, axis=-1))) % 360.0
    return az, el


def offset_to_ll(cx: float, cy: float, dx: float, dy: float) -> tuple[float, float]:
    """Lat/lon of a point given as a map offset (m) from a site centre (cx, cy)."""
    lat, lon = ps_to_ll(cx + dx, cy + dy)
    return float(lat), float(lon)


def grid_north_bearing(x: float, y: float) -> float:
    """Angle (deg, clockwise) from local true north to map +y at (x, y): needed to turn map offsets into compass
    bearings (e.g. "180 m south-west") - at the pole the map grid and true north differ by the longitude."""
    _, e, n = local_basis(x, y)
    p = surface_point(x, y + 1.0, 0.0) - surface_point(x, y, 0.0)
    return float(math.degrees(math.atan2(float(np.dot(p, e)), float(np.dot(p, n)))) % 360.0)
