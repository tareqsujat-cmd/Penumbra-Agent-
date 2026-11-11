"""Tile pyramids for the zoomable Moon globe (served by serve.py from penumbra_mockup/tiles/).

  tiles/wac/{L}/{x}/{y}.jpg   LROC WAC global mosaic (USGS Astrogeology WMS), geographic quadtree,
                              level L = 2^(L+1) x 2^L tiles of 256 px, y = 0 at the north edge.
                              Levels 0..6 prefetched here (~330 m/px); 7..8 fetched on demand by serve.py.
  tiles/polar/{L}/{i}_{j}.bin South polar LOLA terrain, polar-stereographic quadtree over the LDEM_75S_240M square,
                              65 x 65 int16 heights (0.5 m units above 1737.4 km), row 0 = north (max y).
                              Heights from LDEM_80S_80M where covered, else LDEM_75S_240M. Levels 0..7.
  tiles/ldem16.bin            LOLA LDEM_16 (int16, 0.5 m units), 5760 x 2880, column 0 at lon -180, row 0 at lat +90.
  tiles/manifest.json

Run:  python scripts/prepare_tiles.py [wac|polar|ldem|all]      (downloads use 3 parallel requests)
"""
from __future__ import annotations

import io
import json
import math
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates

ROOT = Path(__file__).resolve().parents[1]
TILES = ROOT / "tiles"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from polarlib import raw_path  # noqa: E402

WMS = ("https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=/maps/earth/moon_simp_cyl.map&SERVICE=WMS&VERSION=1.1.1"
       "&REQUEST=GetMap&LAYERS=LROC_WAC&STYLES=&SRS=EPSG:4326&FORMAT=image/jpeg")
WAC_PREFETCH = 6
WAC_MAX = 8
POLAR_S = 3812 * 240 / 2  # half-width of the LDEM_75S_240M square (m)
POLAR_LEVELS = 7
N = 65


def fetch(url: str, tries: int = 4) -> bytes:
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "penumbra-mockup/1.0"}), timeout=120) as r:
                data = r.read()
                if r.headers.get("Content-Type", "").startswith("image/"):
                    return data
                raise ValueError(f"not an image: {r.headers.get('Content-Type')}")
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(3 * (k + 1))
    raise RuntimeError(f"{url[-80:]}: {err}")


def wac_level(L: int) -> None:
    nx, ny = 2 ** (L + 1), 2 ** L
    d = 180.0 / 2 ** L
    bt = 8  # tiles per block side (2048 px)
    jobs = []
    for by in range(0, ny, bt):
        for bx in range(0, nx, bt):
            tx, ty = min(bt, nx - bx), min(bt, ny - by)
            if all((TILES / f"wac/{L}/{bx + i}/{by + j}.jpg").exists() for i in range(tx) for j in range(ty)):
                continue
            jobs.append((bx, by, tx, ty))

    def run(job):
        bx, by, tx, ty = job
        lon0, lat1 = -180 + bx * d, 90 - by * d
        url = f"{WMS}&BBOX={lon0},{lat1 - ty * d},{lon0 + tx * d},{lat1}&WIDTH={tx * 256}&HEIGHT={ty * 256}"
        im = Image.open(io.BytesIO(fetch(url))).convert("L")
        for i in range(tx):
            for j in range(ty):
                p = TILES / f"wac/{L}/{bx + i}/{by + j}.jpg"
                p.parent.mkdir(parents=True, exist_ok=True)
                im.crop((i * 256, j * 256, (i + 1) * 256, (j + 1) * 256)).save(p, "JPEG", quality=82, optimize=True)
        return job

    with ThreadPoolExecutor(3) as ex:
        for k, _ in enumerate(ex.map(run, jobs)):
            if (k + 1) % 16 == 0 or k + 1 == len(jobs):
                print(f"  wac L{L}: {k + 1}/{len(jobs)} blocks", flush=True)
    print(f"wac L{L} done ({nx * ny} tiles)", flush=True)


def load_polar():
    z80 = np.fromfile(raw_path("lola/ldem_80s_80m.img", "research/top3_probes/data/lola/ldem_80s_80m.img"),
                      dtype="<i2").reshape(7600, 7600).astype(np.float32) * 0.5
    z240 = np.fromfile(raw_path("lola/ldem_75s_240m.img", "research/top3_probes/data/lola/ldem_75s_240m.img"),
                       dtype="<i2").reshape(3812, 3812).astype(np.float32) * 0.5
    return (z80, 80.0, (7600 - 1) / 2.0), (z240, 240.0, (3812 - 1) / 2.0)


def polar_tiles() -> None:
    (z80, s80, c80), (z240, s240, c240) = load_polar()
    lim80 = c80 * s80 * 0.998
    total = 0
    for L in range(POLAR_LEVELS + 1):
        n = 2 ** L
        size = 2 * POLAR_S / n
        count = 0
        for i in range(n):
            for j in range(n):
                x0 = -POLAR_S + i * size
                y1 = POLAR_S - j * size
                x1, y0 = x0 + size, y1 - size
                # skip tiles entirely outside the 75 S circle
                dx = max(abs(x0), abs(x1)) if x0 * x1 > 0 else 0.0
                dy = max(abs(y0), abs(y1)) if y0 * y1 > 0 else 0.0
                near = math.hypot(min(abs(x0), abs(x1)) if x0 * x1 > 0 else 0.0, min(abs(y0), abs(y1)) if y0 * y1 > 0 else 0.0)
                if near > 458_000:
                    continue
                in80 = max(abs(x0), abs(x1)) <= lim80 and max(abs(y0), abs(y1)) <= lim80
                if L == POLAR_LEVELS and not in80:
                    continue  # the deepest level only where the 80 m map exists
                p = TILES / f"polar/{L}/{i}_{j}.bin"
                if p.exists():
                    count += 1
                    continue
                xs = np.linspace(x0, x1, N)
                ys = np.linspace(y1, y0, N)
                X, Y = np.meshgrid(xs, ys)
                h = map_coordinates(z240, [c240 - Y / s240, c240 + X / s240], order=1, mode="nearest")
                m = (np.abs(X) <= lim80) & (np.abs(Y) <= lim80)
                if m.any():
                    h[m] = map_coordinates(z80, [c80 - Y[m] / s80, c80 + X[m] / s80], order=1, mode="nearest")
                p.parent.mkdir(parents=True, exist_ok=True)
                np.round(h * 2).astype("<i2").tofile(p)
                count += 1
                del dx, dy
        total += count
        print(f"polar L{L}: {count} tiles (tile {size / 1000:.2f} km, spacing {size / (N - 1):.0f} m)", flush=True)
    print(f"polar total {total} tiles", flush=True)


def ldem16() -> None:
    z = np.fromfile(raw_path("lola_global/ldem_16.img", "penumbra_prep/data/raw/lola_global/ldem_16.img"), dtype="<i2").reshape(2880, 5760)
    np.roll(z, 2880, axis=1).astype("<i2").tofile(TILES / "ldem16.bin")
    print("ldem16.bin written", flush=True)


def polar_albedo() -> float:
    """Mean WAC grey level in the 70-75 S belt (from L4 tiles), used as the uniform albedo of the polar terrain."""
    vals = []
    for x in range(32):
        p = TILES / f"wac/4/{x}/14.jpg"  # L4 row 14 spans 67.5-78.75 S
        if p.exists():
            a = np.asarray(Image.open(p), dtype=np.float32)
            vals.append(a[:, :].mean())
    return round(float(np.mean(vals)) / 255, 4) if vals else 0.42


def manifest() -> None:
    m = dict(
        wac=dict(prefetched=WAC_PREFETCH, max=WAC_MAX, source="LROC WAC global mosaic via USGS Astrogeology WMS (moon_simp_cyl, LROC_WAC)"),
        polar=dict(S=POLAR_S, levels=POLAR_LEVELS, n=N, scale=0.5, source="LOLA LDEM_80S_80M + LDEM_75S_240M v2.0 (PDS)"),
        ldem16=dict(w=5760, h=2880, scale=0.5, source="LOLA LDEM_16 v3.1 (PDS)"),
        polarAlbedo=polar_albedo(),
    )
    (TILES / "manifest.json").write_text(json.dumps(m, indent=1), encoding="utf-8")
    print("manifest", m["polarAlbedo"], flush=True)


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    TILES.mkdir(exist_ok=True)
    if what in ("ldem", "all"):
        ldem16()
    if what in ("polar", "all"):
        polar_tiles()
    if what in ("wac", "all"):
        for L in range(WAC_PREFETCH + 1):
            wac_level(L)
    manifest()
