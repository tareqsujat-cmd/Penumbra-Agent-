"""Globe data for the mock-up: Moon albedo + relief textures, Earth texture, and 2027 Sun/Earth geometry.

Inputs (raw public data in penumbra_prep/data/raw/):
  lroc/lroc_wac_global_4096x2048.jpg   LROC WAC global mosaic, rendered by the USGS Astrogeology WMS (EPSG:4326, lon -180..180)
  lola_global/ldem_16.img (+ .lbl)      LOLA LDEM_16 v3.1, 16 px/deg simple cylindrical, lon 0..360, int16 x 0.5 m above 1737.4 km
  earth/world.topo.bathy.200412.3x5400x2700.jpg   NASA Blue Marble (Dec 2004)
  spice/*                               NAIF kernels (DE440, lunar orientation, Earth orientation)

Output: src/data/generated/globe.json
Run with the prepared environment (spiceypy):  ../penumbra_prep/env/.venv/Scripts/python scripts/prepare_globe.py
"""
from __future__ import annotations

import base64
import io
import json
from pathlib import Path

import numpy as np
import spiceypy as sp
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT.parent / "penumbra_prep" / "data" / "raw"
OUT = ROOT / "src" / "data" / "generated" / "globe.json"
R_KM = 1737.4


def data_uri(img: Image.Image, fmt: str, **kw) -> str:
    buf = io.BytesIO()
    img.save(buf, format=fmt, **kw)
    mime = "image/jpeg" if fmt == "JPEG" else "image/png"
    return f"data:{mime};base64," + base64.b64encode(buf.getvalue()).decode()


def moon_textures() -> dict:
    alb = Image.open(RAW / "lroc/lroc_wac_global_4096x2048.jpg").convert("L")
    a = np.asarray(alb, dtype=np.float32)
    h, w = a.shape
    lat = 90 - (np.arange(h) + 0.5) * 180 / h
    # the WMS mosaic is unreliable poleward of ~85°: fade to the local mean grey there
    for band in (lat > 84.5, lat < -84.5):
        rows = np.where(band)[0]
        ref = a[(np.abs(lat) > 80) & (np.abs(lat) < 84)].mean()
        for r in rows:
            t = min(1.0, (abs(lat[r]) - 84.5) / 2.0)
            a[r] = a[r] * (1 - t) + ref * t
    albedo = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "L")

    z = np.fromfile(RAW / "lola_global/ldem_16.img", dtype="<i2").reshape(2880, 5760).astype(np.float32) * 0.5
    z = np.roll(z, 2880, axis=1)  # column 0 at lon -180, matching the albedo
    # height map for vertex displacement (1024 x 512, 16-bit in R/G)
    zs = np.asarray(Image.fromarray(z, "F").resize((1024, 512), Image.BILINEAR))
    hmin, hmax = float(zs.min()), float(zs.max())
    q = np.round((zs - hmin) / (hmax - hmin) * 65535).astype(np.uint32)
    rgb = np.zeros(zs.shape + (3,), np.uint8)
    rgb[..., 0], rgb[..., 1] = q >> 8, q & 255
    # tangent-space normal map (x = east, y = north, z = up) at 2048 x 1024
    zn = np.asarray(Image.fromarray(z, "F").resize((2048, 1024), Image.BILINEAR)).astype(np.float64)
    nh, nw = zn.shape
    latn = np.radians(90 - (np.arange(nh) + 0.5) * 180 / nh)
    dx = (R_KM * 1000) * np.maximum(np.cos(latn), 0.03)[:, None] * np.radians(360 / nw)
    dy = (R_KM * 1000) * np.radians(180 / nh)
    dzdx = (np.roll(zn, -1, 1) - np.roll(zn, 1, 1)) / (2 * dx)
    dzdy = (np.vstack([zn[:1], zn[:-2], zn[-1:]]) - np.vstack([zn[1:2], zn[2:], zn[-2:-1]])) / (2 * dy)
    n = np.dstack([-dzdx, -dzdy, np.ones_like(zn)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    normal = Image.fromarray(np.clip((n * 0.5 + 0.5) * 255, 0, 255).astype(np.uint8), "RGB")
    return dict(
        albedo=data_uri(albedo, "JPEG", quality=86, optimize=True),
        normal=data_uri(normal, "JPEG", quality=90, optimize=True),
        height=data_uri(Image.fromarray(rgb, "RGB"), "PNG", optimize=True),
        hmin=round(hmin, 1),
        hmax=round(hmax, 1),
        _z=z,
    )


def earth_texture() -> str:
    im = Image.open(RAW / "earth/world.topo.bathy.200412.3x5400x2700.jpg").convert("RGB").resize((2048, 1024), Image.LANCZOS)
    return data_uri(im, "JPEG", quality=85, optimize=True)


def ephemeris() -> dict:
    k = RAW / "spice"
    order = ["naif0012.tls", "pck00011.tpc", "gm_de440.tpc", "de440s.bsp", "moon_pa_de440_200625.bpc",
             "earth_2026_260806_2126_predict.bpc", "earth_latest_high_prec.bpc", "earth_assoc_itrf93.tf",
             "moon_de440_250416.tf"]  # DE440 lunar frame kernel last, so MOON_ME = MOON_ME_DE440_ME421
    for f in order:
        sp.furnsh(str(k / f))
    et0 = sp.str2et("2027-01-01T00:00:00")
    n = 8761
    sun = np.zeros((n, 3), np.float32)
    earth = np.zeros((n, 3), np.float32)
    quat = np.zeros((n, 4), np.float32)
    for i in range(n):
        et = et0 + i * 3600.0
        s, _ = sp.spkpos("SUN", et, "MOON_ME", "LT+S", "MOON")
        e, _ = sp.spkpos("EARTH", et, "MOON_ME", "LT+S", "MOON")
        m = sp.pxform("ITRF93", "MOON_ME", et)
        sun[i] = np.array(s) / np.linalg.norm(s)
        earth[i] = e
        w, x, y, z = sp.m2q(m)  # SPICE quaternion (scalar first); three.js uses (x, y, z, w)
        quat[i] = [x, y, z, w]
    enc = lambda a: base64.b64encode(a.astype("<f4").tobytes()).decode()
    return dict(start="2027-01-01T00:00Z", step_h=1, n=n, sun=enc(sun), earth_km=enc(earth), earth_quat=enc(quat),
                source="NAIF SPICE: DE440 (de440s.bsp), MOON_ME via moon_de440_250416.tf, ITRF93 via earth_*.bpc; apparent (LT+S) vectors from the Moon's centre")


def main() -> None:
    mt = moon_textures()
    z = mt.pop("_z")
    eph = ephemeris()
    s0 = np.frombuffer(base64.b64decode(eph["sun"]), "<f4").reshape(-1, 3)[0]
    e0 = np.frombuffer(base64.b64decode(eph["earth_km"]), "<f4").reshape(-1, 3)[0]
    doc = dict(moon=mt, earth_texture=earth_texture(), ephem=eph, radius_km=R_KM,
               dem=dict(source="NASA LRO LOLA LDEM_16 v3.1 (PDS), 16 px/deg; heights above 1737.4 km", global_min_m=float(z.min()), global_max_m=float(z.max())),
               albedo_source="LROC WAC global mosaic (NASA/GSFC/ASU), rendered by the USGS Astrogeology WMS at 4096 x 2048",
               earth_source="NASA Blue Marble: Next Generation, December 2004 (NASA Earth Observatory)")
    OUT.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    print(f"globe.json {OUT.stat().st_size / 1e6:.2f} MB; Sun dir 2027-01-01 {np.round(s0, 4)}; Earth {np.round(e0 / 1000, 1)} thousand km (|E| {np.linalg.norm(e0):.0f} km)")
    print("DEM range", float(z.min()), float(z.max()))


if __name__ == "__main__":
    main()
