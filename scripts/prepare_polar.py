"""Polar imagery and terrain for the zoomable globe (both poles), plus imagery for the landing-site terrain.

Outputs in tiles/ (served by serve.py):
  polar/{L}/{i}_{j}.bin      south LOLA height tiles (already built by prepare_tiles.py)
  polar_n/{L}/{i}_{j}.bin    north LOLA height tiles, same layout (LDEM_80N_80M inside 80 N, else LDEM_75N_240M)
  pimg_s/{L}/{i}_{j}.jpg     LRO WAC south polar mosaic tiles (USGS WMS, polar stereographic, 256 px)
  pimg_n/{L}/{i}_{j}.jpg     LRO WAC north polar mosaic tiles
  polar_s_coarse.bin, polar_n_coarse.bin   1440 m height grids (636 x 636 int16) for the camera floor
  site/{id}.jpg              WAC imagery over each site's 30 km context box (1024 px)
  site/region_s.jpg          WAC imagery over the planner's +-200 km south polar region (2048 px)

Permanently shadowed crater floors are black in the WAC mosaics; they are filled with relief shading computed from
the LOLA heights (and speckle noise in dark areas is removed), so they read as terrain instead of holes.

Run:  python scripts/prepare_polar.py [north|images|sites|all]
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
from scipy.ndimage import map_coordinates, median_filter, uniform_filter

ROOT = Path(__file__).resolve().parents[1]
TILES = ROOT / "tiles"
WS = ROOT.parent
GEN = ROOT / "src" / "data" / "generated"
S = 3812 * 240 / 2
N = 65
LEVELS = 7
IMG_LEVELS = 7
LIM80 = 3799.5 * 80 * 0.998
WMS = "https://planetarymaps.usgs.gov/cgi-bin/mapserv?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&STYLES=&FORMAT=image/jpeg"
POLE = {
    "s": dict(map="/maps/earth/moon_spole.map", layer="LRO_WAC_south", srs="EPSG:32761",
              z80=WS / "research/top3_probes/data/lola/ldem_80s_80m.img", z240=WS / "research/top3_probes/data/lola/ldem_75s_240m.img"),
    "n": dict(map="/maps/earth/moon_npole.map", layer="LRO_WAC_north", srs="EPSG:32661",
              z80=WS / "penumbra_prep/data/raw/lola_north/ldem_80n_80m.img", z240=WS / "penumbra_prep/data/raw/lola_north/ldem_75n_240m.img"),
}


def fetch(url: str, tries: int = 4) -> bytes:
    err: Exception | None = None
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "penumbra-mockup/1.0"}), timeout=180) as r:
                if not r.headers.get("Content-Type", "").startswith("image/"):
                    raise ValueError(r.read(200))
                return r.read()
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(4 * (k + 1))
    raise RuntimeError(f"{url[-120:]}: {err}")


class Dem:
    """LOLA polar DEMs of one hemisphere (memory-mapped), sampled in polar-stereographic metres."""

    def __init__(self, h: str):
        p = POLE[h]
        self.z80 = np.memmap(p["z80"], dtype="<i2", mode="r", shape=(7600, 7600))
        self.z240 = np.memmap(p["z240"], dtype="<i2", mode="r", shape=(3812, 3812))

    def heights(self, X: np.ndarray, Y: np.ndarray) -> np.ndarray:
        c240 = (3812 - 1) / 2
        h = map_coordinates(self.z240, [c240 - Y / 240.0, c240 + X / 240.0], order=1, mode="nearest").astype(np.float32) * 0.5
        m = (np.abs(X) <= LIM80) & (np.abs(Y) <= LIM80)
        if m.any():
            c80 = (7600 - 1) / 2
            h[m] = map_coordinates(self.z80, [c80 - Y[m] / 80.0, c80 + X[m] / 80.0], order=1, mode="nearest").astype(np.float32) * 0.5
        return h


def tile_exists(L: int, i: int, j: int, deepest: int) -> bool:
    size = 2 * S / 2 ** L
    x0, y1 = -S + i * size, S - j * size
    x1, y0 = x0 + size, y1 - size
    nx = min(abs(x0), abs(x1)) if x0 * x1 > 0 else 0.0
    ny = min(abs(y0), abs(y1)) if y0 * y1 > 0 else 0.0
    if math.hypot(nx, ny) > 458_000:
        return False
    if L == deepest and not (max(abs(x0), abs(x1)) <= LIM80 and max(abs(y0), abs(y1)) <= LIM80):
        return False
    return True


def height_tiles(h: str) -> None:
    dem = Dem(h)
    out = "polar" if h == "s" else "polar_n"
    total = 0
    for L in range(LEVELS + 1):
        n = 2 ** L
        size = 2 * S / n
        cnt = 0
        for i in range(n):
            for j in range(n):
                if not tile_exists(L, i, j, LEVELS):
                    continue
                p = TILES / f"{out}/{L}/{i}_{j}.bin"
                cnt += 1
                if p.exists():
                    continue
                x0, y1 = -S + i * size, S - j * size
                X, Y = np.meshgrid(np.linspace(x0, x0 + size, N), np.linspace(y1, y1 - size, N))
                p.parent.mkdir(parents=True, exist_ok=True)
                np.round(dem.heights(X, Y) * 2).astype("<i2").tofile(p)
        total += cnt
        print(f"{out} L{L}: {cnt} tiles", flush=True)
    print(f"{out}: {total} tiles", flush=True)


def fill_shadows(img: np.ndarray, hgt: np.ndarray, res: float) -> np.ndarray:
    """Replace near-black (permanently shadowed / noisy) pixels by LOLA relief shading at the local albedo."""
    med = median_filter(img, 3)
    t = np.clip((34.0 - med) / 22.0, 0, 1)
    dark = t * t * (3 - 2 * t)
    gy, gx = np.gradient(hgt, res)  # rows run toward -y (south on the map)
    nx, ny = -gx, gy
    nrm = np.sqrt(nx * nx + ny * ny + 1)
    L = np.array([-0.45, 0.55, 0.70])
    L /= np.linalg.norm(L)
    shade = np.clip((nx * L[0] + ny * L[1] + L[2]) / nrm, 0, 1)
    lit = 1 - dark
    k = max(9, img.shape[0] // 6)
    num = uniform_filter(img * lit, k)
    den = uniform_filter(lit, k)
    base = np.where(den > 0.05, num / np.maximum(den, 1e-3), 0)
    base = np.where(base > 20, base, np.mean(img[lit > 0.5]) if (lit > 0.5).any() else 105.0)
    fill = base * (0.42 + 0.78 * shade)
    out = np.where(dark > 0, img * lit + fill * dark, img)
    return np.clip(out, 0, 255)


def image_tiles(h: str) -> None:
    dem = Dem(h)
    p = POLE[h]
    total = 0
    for L in range(IMG_LEVELS + 1):
        n = 2 ** L
        size = 2 * S / n
        bt = min(8, n)
        jobs = []
        for bi in range(0, n, bt):
            for bj in range(0, n, bt):
                need = [(bi + a, bj + b) for a in range(bt) for b in range(bt)
                        if tile_exists(L, bi + a, bj + b, IMG_LEVELS) and not (TILES / f"pimg_{h}/{L}/{bi + a}_{bj + b}.jpg").exists()]
                if need:
                    jobs.append((bi, bj, need))

        def run(job):
            bi, bj, need = job
            x0 = -S + bi * size
            y1 = S - bj * size
            x1, y0 = x0 + bt * size, y1 - bt * size
            px = bt * 256
            url = f"{WMS}&map={p['map']}&LAYERS={p['layer']}&SRS={p['srs']}&BBOX={x0},{y0},{x1},{y1}&WIDTH={px}&HEIGHT={px}"
            img = np.asarray(Image.open(io.BytesIO(fetch(url))).convert("L"), dtype=np.float32)
            res = (x1 - x0) / px
            xs = x0 + (np.arange(px) + 0.5) * res
            ys = y1 - (np.arange(px) + 0.5) * res
            X, Y = np.meshgrid(xs, ys)
            filled = fill_shadows(img, dem.heights(X, Y), res)
            for (i, j) in need:
                a, b = i - bi, j - bj
                q = TILES / f"pimg_{h}/{L}/{i}_{j}.jpg"
                q.parent.mkdir(parents=True, exist_ok=True)
                Image.fromarray(filled[b * 256:(b + 1) * 256, a * 256:(a + 1) * 256].astype(np.uint8)).save(q, "JPEG", quality=88, optimize=True)
            return len(need)

        done = 0
        with ThreadPoolExecutor(3) as ex:
            for k, c in enumerate(ex.map(run, jobs)):
                done += c
                if (k + 1) % 20 == 0:
                    print(f"  pimg_{h} L{L}: {k + 1}/{len(jobs)} blocks", flush=True)
        cnt = sum(1 for i in range(n) for j in range(n) if tile_exists(L, i, j, IMG_LEVELS))
        total += cnt
        print(f"pimg_{h} L{L}: {cnt} tiles ({size / 256:.0f} m/px)", flush=True)
    print(f"pimg_{h}: {total} tiles", flush=True)


def coarse(h: str) -> None:
    z = np.fromfile(POLE[h]["z240"], dtype="<i2").reshape(3812, 3812)[::6, ::6]
    np.ascontiguousarray(z).astype("<i2").tofile(TILES / f"polar_{h}_coarse.bin")


def wms_box(h: str, box: tuple[float, float, float, float], px: int, dem: Dem) -> Image.Image:
    p = POLE[h]
    x0, y0, x1, y1 = box
    url = f"{WMS}&map={p['map']}&LAYERS={p['layer']}&SRS={p['srs']}&BBOX={x0},{y0},{x1},{y1}&WIDTH={px}&HEIGHT={px}"
    img = np.asarray(Image.open(io.BytesIO(fetch(url))).convert("L"), dtype=np.float32)
    res = (x1 - x0) / px
    X, Y = np.meshgrid(x0 + (np.arange(px) + 0.5) * res, y1 - (np.arange(px) + 0.5) * res)
    return Image.fromarray(fill_shadows(img, dem.heights(X, Y), res).astype(np.uint8))


def site_images() -> dict:
    dem = Dem("s")
    out: dict = {}
    (TILES / "site").mkdir(parents=True, exist_ok=True)
    for f in sorted(GEN.glob("site_*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        cx, cy = d["terrain"]["center_xy"]
        c = d["context"]
        ccx, ccy = cx + c["center_offset"][0], cy + c["center_offset"][1]
        half = c["half"] + c["res"] / 2
        box = (ccx - half, ccy - half, ccx + half, ccy + half)
        wms_box("s", box, 1024, dem).save(TILES / f"site/{d['id']}.jpg", "JPEG", quality=90, optimize=True)
        out[d["id"]] = [round(v, 1) for v in box]
        print("site image", d["id"], flush=True)
    rg = json.loads((GEN / "region.json").read_text(encoding="utf-8"))
    x0, y1 = rg["x0"] - rg["res"] / 2, rg["y0"] + rg["res"] / 2
    w = rg["px"] * rg["res"]
    box = (x0, y1 - w, x0 + w, y1)
    wms_box("s", box, 2048, dem).save(TILES / "site/region_s.jpg", "JPEG", quality=88, optimize=True)
    out["region_s"] = [round(v, 1) for v in box]
    return out


def update_manifest(sites: dict | None) -> None:
    mp = TILES / "manifest.json"
    m = json.loads(mp.read_text(encoding="utf-8"))
    m["polar"] = dict(S=S, levels=LEVELS, imgLevels=IMG_LEVELS, n=N, scale=0.5, hemis=["s", "n"],
                      source="LOLA LDEM_80S/80N_80M + LDEM_75S/75N_240M v2.0 (PDS); imagery LRO WAC polar mosaics (USGS WMS), shadows filled with LOLA relief")
    m["coarse"] = dict(px=636, res=1440.0, x0=round(-1905.0 * 240, 1), scale=0.5)
    m["hr"] = dict(from_level=8, max=11, source="Kaguya TC ortho (JAXA) x LOLA-Kaguya SLDEM2015 shaded relief (NASA/GSFC, JAXA) via USGS WMS")
    m["wac"]["max"] = 11
    if sites is not None:
        m["siteImages"] = sites
    mp.write_text(json.dumps(m, indent=1), encoding="utf-8")
    print("manifest updated", flush=True)


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    sites = None
    if what in ("north", "all"):
        height_tiles("n")
        coarse("n")
        coarse("s")
    if what in ("images", "all"):
        image_tiles("s")
        image_tiles("n")
    if what in ("sites", "all"):
        sites = site_images()
    update_manifest(sites)
