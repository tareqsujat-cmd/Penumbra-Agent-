"""Local server for the Penumbra mock-up: serves dist/ and tiles/, and builds deeper imagery tiles on demand.

    python serve.py            -> http://127.0.0.1:4173/

/tiles/wac/{L}/{x}/{y}.jpg      (L <= 7)  LROC WAC global mosaic (USGS WMS).
/tiles/hr/{L}/{x}/{y}.jpg       (8..11)   Kaguya TC ortho mosaic (7.4 m/px, JAXA) x LOLA-Kaguya SLDEM2015 shaded relief
                                          (NASA/GSFC, JAXA), tone-matched to WAC. Built 4 x 4 tiles per request (one
                                          1024 px WMS call per layer), so a new area sharpens in a few seconds.
/tiles/tp_{s|n}/img/{L}/{r}_{c}.jpg       polar tiles on the Moon Trek grid: LRO WAC (L <= 7), LROC NAC (L 8-11, poleward
                                          of 85.5 deg) or Kaguya TC (L 8-10, elsewhere), with shadowed ground shown by
                                          Chang'e-2 / LOLA hillshade relief (see scripts/polarlib.py).
Every tile is cached under tiles/, so an area keeps working offline after the first visit.
"""
from __future__ import annotations

import io
import mimetypes
import re
import sys
import threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, median_filter

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "scripts"))
import polarlib as pl  # noqa: E402

DIST = ROOT / "dist"
TILES = ROOT / "tiles"
PORT = 4173
WMS = ("https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=/maps/earth/moon_simp_cyl.map&SERVICE=WMS&VERSION=1.1.1"
       "&REQUEST=GetMap&STYLES=&SRS=EPSG:4326&FORMAT=image/jpeg")
GEO_RE = re.compile(r"^/tiles/(wac|hr)/(\d+)/(\d+)/(\d+)\.jpg$")
POLAR_RE = re.compile(r"^/tiles/tp_([sn])/img/(\d+)/(\d+)_(\d+)\.jpg$")
UPSTREAM = threading.Semaphore(8)
POOL = ThreadPoolExecutor(16)
LOCKS: dict[str, threading.Lock] = {}
LOCKS_GUARD = threading.Lock()
DEMS: dict[str, pl.Dem] = {}
BLOCK = 4
mimetypes.add_type("application/octet-stream", ".bin")


def lock_for(key: str) -> threading.Lock:
    with LOCKS_GUARD:
        return LOCKS.setdefault(key, threading.Lock())


def dem(h: str) -> pl.Dem:
    with LOCKS_GUARD:
        if h not in DEMS:
            DEMS[h] = pl.Dem(h)
        return DEMS[h]


def wms_rect(layer: str, box: tuple[float, float, float, float], w: int, h: int) -> np.ndarray | None:
    if pl.OFFLINE:
        return None
    url = f"{WMS}&LAYERS={layer}&BBOX={box[0]},{box[1]},{box[2]},{box[3]}&WIDTH={w}&HEIGHT={h}"
    with UPSTREAM:
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "penumbra-mockup/1.0"}), timeout=90) as r:
                if not r.headers.get("Content-Type", "").startswith("image/"):
                    return None
                return np.asarray(Image.open(io.BytesIO(r.read())).convert("L"), dtype=np.float32)
        except Exception:  # noqa: BLE001 - offline or upstream error: the client keeps the coarser tile
            return None


def geo_box(L: int, x: int, y: int, nx: int = 1, ny: int = 1) -> tuple[float, float, float, float]:
    d = 180.0 / 2 ** L
    lon0, lat1 = -180 + x * d, 90 - y * d
    return lon0, lat1 - ny * d, lon0 + nx * d, lat1


def wac_reference(L: int, x: int, y: int) -> np.ndarray | None:
    for A in (6, 5, 4):
        k = L - A
        p = TILES / f"wac/{A}/{x >> k}/{y >> k}.jpg"
        if p.exists():
            a = np.asarray(Image.open(p).convert("L"), dtype=np.float32)
            n = max(1, 256 >> k)
            ox, oy = (x & ((1 << k) - 1)) * n, (y & ((1 << k) - 1)) * n
            return a[oy:oy + n, ox:ox + n]
    return None


def build_hr_block(L: int, bx: int, by: int) -> None:
    """Build the 4 x 4 block of level-L hr tiles whose top-left tile is (bx, by)."""
    nx = min(BLOCK, 2 ** (L + 1) - bx)
    ny = min(BLOCK, 2 ** L - by)
    box = geo_box(L, bx, by, nx, ny)
    w, h = nx * 256, ny * 256
    fk = POOL.submit(wms_rect, "KaguyaTC_Ortho", box, w, h)
    fs = POOL.submit(wms_rect, "LOLA_Kaguya_Shade", box, w, h)
    K, Sh = fk.result(), fs.result()
    kaguya_ok = K is not None and K.std() > 1.0 and (K < 3).mean() < 0.5
    if not kaguya_ok:
        K = wms_rect("LROC_WAC", box, w, h)
        if K is None:
            return
        out = K
    else:
        out = median_filter(K, 3) * 0.5 + K * 0.5 if L >= 11 else K
        if Sh is not None and Sh.std() > 2.0 and (Sh > 250).mean() < 0.5:
            if L >= 9:
                Sh = gaussian_filter(Sh, 0.9 * 2 ** (L - 9))
            rel = np.clip(Sh / max(1.0, float(np.median(Sh))), 0.15, 2.2)
            out = out * rel ** {8: 0.9, 9: 0.7, 10: 0.5, 11: 0.35}[L]
        if L >= 9:
            out = out + 0.55 * (out - gaussian_filter(out, 3.0))
    if kaguya_ok:
        # tone-match to the WAC mosaic with a smooth gain field: neighbouring tiles and blocks meet without steps
        refs = [wac_reference(L, bx + i, by + j) for j in range(ny) for i in range(nx)]
        if all(r is not None for r in refs):
            up = [np.asarray(Image.fromarray(r).resize((256, 256), Image.BILINEAR), dtype=np.float32) for r in refs]
            ref = np.concatenate([np.concatenate(up[j * nx:(j + 1) * nx], axis=1) for j in range(ny)], axis=0)
            out = pl.tone_match(out, ref)
    for j in range(ny):
        for i in range(nx):
            pl.save_jpg(out[j * 256:(j + 1) * 256, i * 256:(i + 1) * 256], TILES / f"hr/{L}/{bx + i}/{by + j}.jpg", 88)


def ensure_geo(kind: str, L: int, x: int, y: int) -> bool:
    if x >= 2 ** (L + 1) or y >= 2 ** L or (kind == "wac" and L > 7) or (kind == "hr" and not 8 <= L <= 11):
        return False
    path = TILES / f"{kind}/{L}/{x}/{y}.jpg"
    if path.exists():
        return True
    if kind == "wac":
        with lock_for(f"wac{L}/{x}/{y}"):
            if not path.exists():
                a = wms_rect("LROC_WAC", geo_box(L, x, y), 256, 256)
                if a is None:
                    return False
                pl.save_jpg(a, path, 85)
        return True
    bx, by = x - x % BLOCK, y - y % BLOCK
    with lock_for(f"hr{L}/{bx}/{by}"):
        if not path.exists():
            build_hr_block(L, bx, by)
    return path.exists()


def ensure_polar(h: str, L: int, r: int, c: int, spread: bool = True) -> bool:
    path = TILES / f"tp_{h}/img/{L}/{r}_{c}.jpg"
    if path.exists():
        return True
    if r >= 2 ** L or c >= 2 ** L or not pl.in_cap(L, r, c) or L > pl.max_level(L, r, c):
        return False
    if L <= pl.WAC_LEVELS or pl.in_nac(L, r, c):
        with lock_for(f"tp{h}{L}/{r}_{c}"):
            if not path.exists():
                with UPSTREAM:
                    img = pl.build_tile(h, L, r, c, dem(h))
                if img is None:
                    return False
                pl.save_jpg(img, path, 90)
        if spread and L > pl.WAC_LEVELS:
            spread_block(h, L, r, c)
        return True
    br, bc = r - r % pl.KBLOCK, c - c % pl.KBLOCK
    with lock_for(f"tpb{h}{L}/{br}_{bc}"):
        if not path.exists():
            with UPSTREAM:
                block = pl.build_outer_block(h, L, br, bc, dem(h))
            for (rr, cc), img in block.items():
                pl.save_jpg(img, TILES / f"tp_{h}/img/{L}/{rr}_{cc}.jpg", 90)
    return path.exists()


def spread_block(h: str, L: int, r: int, c: int) -> None:
    """Build the rest of the 4 x 4 NAC block around a requested tile in the background: the view usually needs the
    neighbours next, so panning finds them ready."""
    if POOL._work_queue.qsize() > 48:  # noqa: SLF001 - skip when the server is already busy
        return
    br, bc = r - r % BLOCK, c - c % BLOCK
    for rr in range(br, br + BLOCK):
        for cc in range(bc, bc + BLOCK):
            if (rr, cc) != (r, c) and not (TILES / f"tp_{h}/img/{L}/{rr}_{cc}.jpg").exists():
                POOL.submit(ensure_polar, h, L, rr, cc, False)


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quiet, except errors on non-tile paths
        if args and str(args[1]).startswith(("4", "5")) and "/tiles/" not in str(args[0]):
            super().log_message(fmt, *args)

    def end_headers(self):
        if self.path.startswith("/tiles/"):
            # revalidate (Last-Modified -> 304): rebuilt tiles and site images show up without a stale browser cache
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def translate_path(self, path: str) -> str:
        path = path.split("?", 1)[0].split("#", 1)[0]
        if path.startswith("/tiles/"):
            return str(TILES / path[len("/tiles/"):])
        p = DIST / path.lstrip("/")
        if path == "/" or not p.exists():
            return str(DIST / "index.html")
        return str(p)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        m = GEO_RE.match(path)
        if m and not ensure_geo(m.group(1), *map(int, m.groups()[1:])):
            self.send_error(404, "tile not available")
            return
        m = POLAR_RE.match(path)
        if m and not ensure_polar(m.group(1), *map(int, m.groups()[1:])):
            self.send_error(404, "tile not available")
            return
        super().do_GET()


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 256  # the browser opens many tile requests at once; the default backlog of 5 refuses them


if __name__ == "__main__":
    srv = Server(("127.0.0.1", PORT), Handler)
    print(f"Penumbra mock-up at http://127.0.0.1:{PORT}/  (close this window to stop)", flush=True)
    srv.serve_forever()
