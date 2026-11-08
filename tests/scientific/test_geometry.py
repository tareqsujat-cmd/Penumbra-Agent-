"""S3, S7-S10, S12 and the V4 SPICE-vs-Horizons cross-check (IMPLEMENTATION_PLAN §8)."""
import math

import numpy as np
import pytest
import spiceypy as sp

from backend.app.science import coordinates as C
from backend.app.science import ephemeris as eph
from backend.app.science.landing import Grid, Model, draw_offsets_en, en_to_map, landing_risk, robust_aim
from backend.app.science.power import Vehicle, energy_balance, panel_power
from backend.app.science.visibility import disc_fraction, disc_fraction_np


def test_s3_moon_me_is_really_used():
    eph.load()
    et = eph.ets(eph.year_start(2027), 24 * 30, 24.0)
    me, _ = sp.spkpos("SUN", et, "MOON_ME", "LT+S", "MOON")
    pa, _ = sp.spkpos("SUN", et, "MOON_PA", "LT+S", "MOON")
    me, pa = np.asarray(me), np.asarray(pa)
    ang = np.degrees(np.arccos(np.clip(np.sum(me * pa, 1) / np.linalg.norm(me, axis=1) / np.linalg.norm(pa, axis=1), -1, 1)))
    # ME-PA rotation is a fixed ~0.0289 deg (moon_de440_250416.tf); the separation of a vector varies with its
    # direction relative to the rotation axis but can never exceed it
    assert ang.max() < 0.0295 and ang.max() > 0.02


def test_kernel_coverage_includes_mission_years():
    cov = eph.coverage()
    assert cov["de440s.bsp"][:4] <= "2017" and cov["moon_pa_de440_200625.bpc"][-19:-15] >= "2037"


def test_s7_disc_fraction():
    rho = 0.2666
    assert disc_fraction(-rho, rho) == 0.0
    assert abs(disc_fraction(0.0, rho) - 0.5) < 1e-12
    assert disc_fraction(rho, rho) == 1.0
    # pixel-counting check: fraction of a disc above a horizontal line at height -e
    n = 2001
    g = np.linspace(-1, 1, n)
    X, Y = np.meshgrid(g, g)
    inside = X**2 + Y**2 <= 1
    for e in (-0.15, -0.05, 0.03, 0.11):
        frac = (inside & (Y >= -e / rho)).sum() / inside.sum()
        assert abs(disc_fraction_np(e, rho) - frac) < 1e-3


def test_s8_sampling_models():
    off = draw_offsets_en(Model("circular", radius=100.0), 100_000, 3)
    r2 = (off**2).sum(1) / 100.0**2
    from scipy.stats import kstest
    assert kstest(r2, "uniform").pvalue > 0.01
    g = draw_offsets_en(Model("gaussian", sigma_e=80.0, sigma_n=30.0, rot_deg=30.0), 100_000, 4)
    cov = np.cov(g.T)
    c, s = math.cos(math.radians(30)), math.sin(math.radians(30))
    Rm = np.array([[c, -s], [s, c]])
    expected = Rm @ np.diag([80.0**2, 30.0**2]) @ Rm.T
    assert np.allclose(cov, expected, rtol=0.02, atol=40.0)


def test_s9_percentiles_on_planar_field():
    xs = np.arange(-500, 501, 10.0)
    X, Y = np.meshgrid(xs, xs)
    g = Grid(-500.0, -500.0, 10.0, (50 + 0.02 * X).astype(float))  # exact under bilinear interpolation
    off = en_to_map(draw_offsets_en(Model("circular", radius=100.0), 4000, 1), 0.0)
    r = landing_risk(g, (0.0, 0.0), off, 10)
    assert abs(r["nominal"] - 50.0) < 1e-9
    assert abs(r["pq"] - np.percentile(50 + 0.02 * off[:, 0], 10)) < 1e-9


def test_s10_robust_aim_prefers_the_plateau():
    xs = np.arange(-600, 601, 10.0)
    X, Y = np.meshgrid(xs, xs)
    spike = 95 * np.exp(-((X - 250) ** 2 + Y**2) / (2 * 15.0**2))
    plateau = 70 * np.exp(-(((X + 200) ** 2 + Y**2) / (2 * 220.0**2)) ** 2)
    field = np.maximum(spike, plateau) + 5
    g = Grid(-600.0, -600.0, 10.0, field)
    off = en_to_map(draw_offsets_en(Model("circular", radius=100.0), 2000, 7), 0.0)
    res = robust_aim(g, off, 10, search_radius=500.0)
    assert abs(res["best_nominal"]["x"] - 250) <= 10  # nominal best = the spike
    assert res["robust"]["x"] < 0  # robust aim = the plateau
    assert res["robust"]["pq"] > res["best_nominal"]["pq"] + 10


def test_s12_power_model():
    v = Vehicle([(0.0, 300.0)], 1000.0, 50.0, 10.0, 20.0)
    az = np.zeros(48)
    el = np.zeros(48)
    assert panel_power(v, az, el, np.zeros(48), 0.0).max() == 0.0
    p = panel_power(v, az, el, np.ones(48), 0.0)
    assert np.allclose(p, 300.0)  # panel facing the Sun at elevation 0 gives rated x f
    out = energy_balance(v, np.concatenate([np.zeros(30), np.full(18, 500.0)]))
    assert out["soc"].min() >= 0.0 and out["soc"].max() <= 1.0


def _horizons_table(path):
    rows = []
    on = False
    for line in open(path, encoding="utf-8"):
        if line.startswith("$$SOE"):
            on = True
            continue
        if line.startswith("$$EOE"):
            break
        if on:
            parts = [p.strip() for p in line.split(",")]
            rows.append((float(parts[3]), float(parts[4])))
    return np.array(rows)


@pytest.mark.parametrize("target,code", [("SUN", "10"), ("EARTH", "399")])
def test_v4_spice_matches_horizons(target, code):
    from backend.app.config import RAW
    tab = _horizons_table(RAW / f"horizons/cr1_{code}_2027-01-01_2028-01-01_60m.txt")
    n = tab.shape[0] - 1  # last row is 2028-01-01 00:00
    step = 37
    idx = np.arange(0, n, step)
    x, y = C.ll_to_ps(-89.45, 222.69)
    p0 = C.surface_point(x, y, 0.0)
    up, e, nn = C.local_basis(x, y)
    et = eph.ets(eph.year_start(2027), n)[idx]
    d, _ = eph.body_vectors(target, et, p0)
    az, el = C.az_el(d, up, e, nn)
    ref = C.unit_from_ll(tab[idx, 1], -tab[idx, 0])  # treat (az, el) as a sphere point to measure separations
    got = C.unit_from_ll(el, -az)
    sep = np.degrees(np.arccos(np.clip(np.sum(ref * got, 1), -1, 1))) * 3600
    assert np.max(sep) < 10.0, f"max separation {np.max(sep):.2f} arcsec"
