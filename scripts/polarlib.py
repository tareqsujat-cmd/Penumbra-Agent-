"""Shared polar tiling helpers (used by prepare_trek.py and serve.py).

Polar quadtree = the NASA Moon Trek polar tile grid (WMTS default028mm): level 0 is one 256 px tile spanning
+-1,095,930 m of polar-stereographic metres; level L tiles span 2,191,860 / 2^L m. Tile (row, col) has its top-left
corner at (-1,095,930 + col*span, 1,095,930 - row*span).

Each polar tile is a composite of real imagery and real relief:
  photo   L <= 7   LRO WAC polar mosaic (USGS Astrogeology WMS, 100 m native; L7 = 67 m/px)
          L 8..11  LROC NAC polar mosaic, Avg Merge (Moon Trek, poleward of 85.5 deg; L11 = 4.2 m/px)
          L 8..10  elsewhere: Kaguya TC ortho mosaic (7.4 m/px, JAXA), reprojected, tone-matched to WAC
  relief  Chang'e-2 20 m DEM hillshade (whole cap, Moon Trek) and, poleward of 87.5 deg, the LOLA 10 m DEM hillshade.
Where the photo is dark (permanent or long shadow) the relief takes over at the local albedo, with soft edges, so
crater floors read as terrain instead of black holes.
Raw source tiles are cached under tiles/src/ so composites can be rebuilt offline.
"""
from __future__ import annotations

import io
import math
import os
import threading
import time
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, map_coordinates, median_filter

ROOT = Path(__file__).resolve().parents[1]
WS = ROOT.parent
ORIGIN = 1095930.0
SPAN0 = 2 * ORIGIN
CAP_RHO = 441_000.0  # |lat| = 75.6 deg is at rho = 439 km
NAC_EXT = 136_525.0  # NAC mosaics: |x|, |y| <= 136.5 km (85.5 deg)
LIM80 = 3799.5 * 80 * 0.998
HGT_LEVELS = 8
WAC_LEVELS = 7
NAC_LEVELS = 11
N = 65
WMS = "https://planetarymaps.usgs.gov/cgi-bin/mapserv?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&STYLES=&FORMAT=image/jpeg"
TREK = "https://trek.nasa.gov/tiles/Moon/{P}/{layer}/1.0.0/default/default028mm/{L}/{row}/{col}.png"
SRC = ROOT / "tiles" / "src"
LOLA_EXT = 75_840.0  # LOLA 10 m hillshade: |x|, |y| <= 75.8 km (87.5 deg)
RELIEF_LEVELS = 8    # deepest level of the Trek hillshades (33 m/px)
OUTER_LEVELS = 10    # outside the NAC area: Kaguya TC down to level 10 (8.4 m/px)
KBLOCK = 4          # outer tiles are built 4 x 4 per Kaguya request
GEO_WMS = ("https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=/maps/earth/moon_simp_cyl.map&SERVICE=WMS&VERSION=1.1.1"
           "&REQUEST=GetMap&STYLES=&SRS=EPSG:4326&FORMAT=image/jpeg")
R_M = 1_737_400.0
ALBEDO = {"s": 100.0, "n": 104.0}
NAC_GAMMA = {"s": 0.7, "n": 0.62}  # NAC averages are darker than the WAC mosaics (lit-pixel ratio ~1.6 S, ~1.9 N)
NAC_DARK = (12.0, 42.0)          # NAC is clean down to low grey levels: only near-black goes to relief
POLE = {
    "s": dict(map="/maps/earth/moon_spole.map", layer="LRO_WAC_south", srs="EPSG:32761", trek="SP",
              nac="LRO_NAC_AvgMosaic_SPole855_1mp", ce2="CE2_Hillshade_20m_SP", lola="LRO_LOLA_Shade_SPolar875_10m",
              z80=WS / "research/top3_probes/data/lola/ldem_80s_80m.img", z240=WS / "research/top3_probes/data/lola/ldem_75s_240m.img"),
    "n": dict(map="/maps/earth/moon_npole.map", layer="LRO_WAC_north", srs="EPSG:32661", trek="NP",
              nac="LRO_NAC_AvgMosaic_NPole855_1mp", ce2="CE2_Hillshade_20m_NP", lola="LRO_LOLA_Shade_NPolar875_10m",
              z80=WS / "penumbra_prep/data/raw/lola_north/ldem_80n_80m.img", z240=WS / "penumbra_prep/data/raw/lola_north/ldem_75n_240m.img"),
}


def span(L: int) -> float:
    return SPAN0 / 2 ** L


def bounds(L: int, row: int, col: int) -> tuple[float, float, float, float]:
    s = span(L)
    x0 = -ORIGIN + col * s
    y1 = ORIGIN - row * s
    return x0, y1 - s, x0 + s, y1


def in_cap(L: int, row: int, col: int) -> bool:
    x0, y0, x1, y1 = bounds(L, row, col)
    nx = 0.0 if x0 <= 0 <= x1 else min(abs(x0), abs(x1))
    ny = 0.0 if y0 <= 0 <= y1 else min(abs(y0), abs(y1))
    return math.hypot(nx, ny) <= CAP_RHO


def in_nac(L: int, row: int, col: int) -> bool:
    x0, y0, x1, y1 = bounds(L, row, col)
    return x0 < NAC_EXT and x1 > -NAC_EXT and y0 < NAC_EXT and y1 > -NAC_EXT


def in80(L: int, row: int, col: int) -> bool:
    x0, y0, x1, y1 = bounds(L, row, col)
    return max(abs(x0), abs(x1), abs(y0), abs(y1)) <= LIM80


def hgt_exists(L: int, row: int, col: int) -> bool:
    if L > HGT_LEVELS or not in_cap(L, row, col):
        return False
    return L < HGT_LEVELS or in80(L, row, col)


OFFLINE = os.environ.get("PENUMBRA_OFFLINE") == "1"  # never contact USGS / Moon Trek; serve cached tiles only


def fetch_status(url: str, tries: int = 3, timeout: int = 60) -> tuple[bytes | None, bool]:
    """(data, definitive): definitive is True when the server answered (image or 404), False on network failure."""
    if OFFLINE:
        return None, False
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "penumbra-mockup/1.0"}), timeout=timeout) as r:
                if not r.headers.get("Content-Type", "").startswith("image/"):
                    return None, True
                return r.read(), True
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None, True
            time.sleep(2 * (k + 1))
        except Exception:  # noqa: BLE001
            time.sleep(2 * (k + 1))
    return None, False


def fetch(url: str, tries: int = 3, timeout: int = 60) -> bytes | None:
    return fetch_status(url, tries, timeout)[0]


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

    def grid(self, box: tuple[float, float, float, float], px: int) -> np.ndarray:
        x0, y0, x1, y1 = box
        res = (x1 - x0) / px
        X, Y = np.meshgrid(x0 + (np.arange(px) + 0.5) * res, y1 - (np.arange(px) + 0.5) * res)
        return self.heights(X, Y)


def in_lola(L: int, row: int, col: int) -> bool:
    x0, y0, x1, y1 = bounds(L, row, col)
    return x0 < LOLA_EXT and x1 > -LOLA_EXT and y0 < LOLA_EXT and y1 > -LOLA_EXT


def max_level(L: int, row: int, col: int) -> int:
    return NAC_LEVELS if in_nac(L, row, col) else OUTER_LEVELS


def trek_raw(h: str, key: str, L: int, row: int, col: int) -> np.ndarray | None:
    """One Moon Trek tile as float32 (256, 256, 2) [grey, alpha], cached under tiles/src (a .none file marks a 404)."""
    layer = POLE[h][key]
    p = SRC / layer / f"{L}/{row}_{col}.png"
    miss = p.with_suffix(".none")
    if not p.exists():
        if miss.exists():
            return None
        data, definitive = fetch_status(TREK.format(P=POLE[h]["trek"], layer=layer, L=L, row=row, col=col))
        p.parent.mkdir(parents=True, exist_ok=True)
        if data is None:
            if definitive:
                miss.touch()
            return None
        p.write_bytes(data)
    try:
        return np.asarray(Image.open(p).convert("LA"), dtype=np.float32)
    except Exception:  # noqa: BLE001 - truncated cache file: refetch next time
        p.unlink(missing_ok=True)
        return None


def wac_raw_block(h: str, box: tuple[float, float, float, float], px: int) -> np.ndarray | None:
    p = POLE[h]
    x0, y0, x1, y1 = box
    data = fetch(f"{WMS}&map={p['map']}&LAYERS={p['layer']}&SRS={p['srs']}&BBOX={x0},{y0},{x1},{y1}&WIDTH={px}&HEIGHT={px}", timeout=180)
    if data is None:
        return None
    return np.asarray(Image.open(io.BytesIO(data)).convert("L"), dtype=np.float32)


def wac_raw_path(h: str, L: int, row: int, col: int) -> Path:
    return SRC / f"wac_{h}/{L}/{row}_{col}.jpg"


def wac_raw(h: str, L: int, row: int, col: int) -> np.ndarray | None:
    """Raw WAC polar photo of a level <= 7 tile (cached; fetched as a single 256 px tile when missing)."""
    p = wac_raw_path(h, L, row, col)
    if not p.exists():
        img = wac_raw_block(h, bounds(L, row, col), 256)
        if img is None:
            return None
        save_jpg(img, p, 92)
        return img
    return np.asarray(Image.open(p).convert("L"), dtype=np.float32)


def upsample_from(src: np.ndarray, k: int, row: int, col: int) -> np.ndarray:
    """Crop the part of an ancestor tile (k levels up) covering tile (row, col) and resize it to 256 px."""
    n = 256 >> k
    oy, ox = (row & ((1 << k) - 1)) * n, (col & ((1 << k) - 1)) * n
    return np.asarray(Image.fromarray(src[oy:oy + n, ox:ox + n]).resize((256, 256), Image.BICUBIC), dtype=np.float32)


def clean_wac(img: np.ndarray, L: int) -> np.ndarray:
    """WAC polar photo: remove salt-and-pepper noise and, at level 7 (finer than the 100 m source), the
    nearest-neighbour staircase of the map server's resampling."""
    img = median_filter(img, 3)
    return gaussian_filter(img, 0.7) if L >= WAC_LEVELS else img


def wac_under(h: str, L: int, row: int, col: int) -> np.ndarray | None:
    k = L - WAC_LEVELS
    a = wac_raw(h, WAC_LEVELS, row >> k, col >> k)
    return None if a is None else upsample_from(clean_wac(a, WAC_LEVELS), k, row, col)


def relief(h: str, L: int, row: int, col: int) -> np.ndarray | None:
    """Hillshade (CE-2 tone scale, light from the upper left) of a tile; deeper than level 8 it is upsampled."""
    if L > RELIEF_LEVELS:
        k = L - RELIEF_LEVELS
        a = relief(h, RELIEF_LEVELS, row >> k, col >> k)
        return None if a is None else upsample_from(a, k, row, col)
    ce = trek_raw(h, "ce2", L, row, col)
    out = None if ce is None else (gaussian_filter(ce[..., 0], 1.6) if L >= 8 else ce[..., 0])  # softens CE-2 ring artefacts
    wt = None if ce is None else ce[..., 1] / 255.0
    if in_lola(L, row, col) and L >= 3:
        lo = trek_raw(h, "lola", L, row, col)
        if lo is not None:
            inside = (lo[..., 1] > 128).astype(np.float32)
            lw = gaussian_filter(inside, 3.0) * inside
            lv = lo[..., 0] * 0.45 + 107.0  # LOLA 10 m shade has ~2x the CE-2 contrast
            if out is None:
                out, wt = lv, lw
            else:
                out = out * (1 - lw) + lv * lw
                wt = np.maximum(wt, lw)
    if out is None or wt.mean() < 0.05:
        return None
    return np.where(wt > 0.02, out, 170.0)


def dem_relief(h: str, L: int, row: int, col: int, dem: Dem) -> np.ndarray:
    """Fallback hillshade from the local LOLA DEMs (used offline or where no hillshade tile exists)."""
    hgt = dem.grid(bounds(L, row, col), 256)
    gy, gx = np.gradient(hgt, max(span(L) / 256, 1.0))
    nx, ny = -gx, gy
    lv = np.array([-0.5, 0.5, 0.71])
    lv /= np.linalg.norm(lv)
    shade = np.clip((nx * lv[0] + ny * lv[1] + lv[2]) / np.sqrt(nx * nx + ny * ny + 1), 0, 1)
    return 170.0 + (shade - float(shade.mean())) * 160.0


def tone_match(img: np.ndarray, ref: np.ndarray, sigma: float = 20.0) -> np.ndarray:
    """Give `img` the low-frequency brightness of `ref` (a smooth gain field, not one gain per tile), so neighbouring
    tiles and blocks matched to the same reference mosaic meet without visible steps."""
    gain = gaussian_filter(ref, sigma, mode="nearest") / np.maximum(gaussian_filter(img, sigma, mode="nearest"), 1.0)
    return img * np.clip(gain, 0.45, 2.4)


def detail_of(rel: np.ndarray) -> np.ndarray:
    return np.clip(rel / np.maximum(gaussian_filter(rel, 2.5), 1.0), 0.55, 1.7)


def compose(img: np.ndarray | None, rel: np.ndarray, albedo: float, sharpen: float = 0.0,
            dark: tuple[float, float] = (30.0, 90.0)) -> np.ndarray:
    """Photo where lit, relief at the local albedo where the photo is dark (blend window `dark`, grey levels);
    `sharpen` injects relief detail into the photo (used where the photo is upsampled)."""
    z = (rel - 170.0) / 40.0
    fill = albedo * np.clip(1.0 + np.where(z > 0, 0.45, 0.28) * z, 0.4, 2.1)  # slopes facing away stay readable
    if img is None:
        return fill
    if sharpen > 0:
        img = img * detail_of(rel) ** sharpen
    g = gaussian_filter(img, 1.2)
    t = np.clip((g - dark[0]) / (dark[1] - dark[0]), 0, 1)
    w = gaussian_filter(t * t * (3 - 2 * t), 1.5)
    return np.clip(img * w + fill * (1 - w), 0, 255)


def nac_photo(nac_grey: np.ndarray, h: str) -> np.ndarray:
    """NAC average brought to the WAC tone with a gamma curve: dim ground is lifted by about the measured NAC/WAC
    ratio while sunlit rims keep their highlight detail instead of clipping to white."""
    return 255.0 * (np.clip(nac_grey, 0, 255) / 255.0) ** NAC_GAMMA[h]


def build_tile(h: str, L: int, row: int, col: int, dem: Dem | None = None) -> np.ndarray | None:
    """Composite polar tile, or None when it cannot be built (outside the cap / deeper than the data, or offline)."""
    if not in_cap(L, row, col) or L > max_level(L, row, col) or (L > WAC_LEVELS and not in_nac(L, row, col)):
        return None  # outer levels 8-10 are built 4 x 4 at a time by build_outer_block
    rel = relief(h, L, row, col)
    if rel is None:
        rel = dem_relief(h, L, row, col, dem or Dem(h))
    if L <= WAC_LEVELS:
        img = wac_raw(h, L, row, col)
        return None if img is None else compose(clean_wac(img, L), rel, ALBEDO[h])
    ph = photo_tile(h, L, row, col, rel)
    if ph is None:
        return None
    img, lo, hi = ph
    return compose(img, rel, ALBEDO[h], dark=(lo, hi))


def photo_tile(h: str, L: int, row: int, col: int, rel: np.ndarray | None = None):
    """Photo of a level 8-11 tile in the NAC area before any relief fill: (image, dark_lo, dark_hi), where the dark
    window (per pixel) is narrower for the clean NAC data; None when no photo can be had."""
    nac = trek_raw(h, "nac", L, row, col)
    a = None if nac is None else nac[..., 1] / 255.0
    if a is not None and a.mean() > 0.98:
        return nac_photo(nac[..., 0], h), np.float32(NAC_DARK[0]), np.float32(NAC_DARK[1])
    # gaps in the NAC mosaic (and its corners beyond 85.5 deg): Kaguya TC (7.4 m/px), else the upsampled WAC
    under = kaguya_tile(h, L, row, col)
    if under is None:
        w = wac_under(h, L, row, col)
        under = None if w is None else (w * detail_of(rel) ** 0.7 if rel is not None else w)
    if under is None:
        return None
    if a is None or a.mean() < 0.01:
        return under, np.float32(30.0), np.float32(90.0)
    lo = NAC_DARK[0] * a + 30.0 * (1 - a)
    hi = NAC_DARK[1] * a + 90.0 * (1 - a)
    return nac_photo(nac[..., 0], h) * a + under * (1 - a), lo, hi


def stereo_ll(h: str, X: np.ndarray, Y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Polar stereographic metres -> (lat, lon) degrees."""
    c = np.degrees(2 * np.arctan(np.hypot(X, Y) / (2 * R_M)))
    if h == "s":
        return c - 90.0, np.degrees(np.arctan2(X, Y))
    return 90.0 - c, np.degrees(np.arctan2(X, -Y))


def geo_rect(layer: str, lon0: float, lat0: float, lon1: float, lat1: float, w: int, hgt: int) -> np.ndarray | None:
    """Simple-cylindrical WMS image; lon may run past 180 (fetched in two parts)."""
    if lon1 > 180.0:
        w1 = max(1, int(round(w * (180.0 - lon0) / (lon1 - lon0))))
        a = geo_rect(layer, lon0, lat0, 180.0, lat1, w1, hgt) if w1 < w else None
        b = geo_rect(layer, -180.0, lat0, lon1 - 360.0, lat1, w - w1, hgt) if w1 < w else None
        if a is None or b is None:
            return None
        return np.concatenate([a, b], axis=1)
    data = fetch(f"{GEO_WMS}&LAYERS={layer}&BBOX={lon0},{lat0},{lon1},{lat1}&WIDTH={w}&HEIGHT={hgt}", timeout=180)
    if data is None:
        return None
    return np.asarray(Image.open(io.BytesIO(data)).convert("L"), dtype=np.float32)


def kaguya_polar(h: str, box: tuple[float, float, float, float], px: int) -> np.ndarray | None:
    """Kaguya TC ortho mosaic resampled onto a polar-stereographic box (px x px), or None where it has no data."""
    x0, y0, x1, y1 = box
    res = (x1 - x0) / px
    X, Y = np.meshgrid(x0 + (np.arange(px) + 0.5) * res, y1 - (np.arange(px) + 0.5) * res)
    lat, lon = stereo_ll(h, X, Y)
    if lon.max() - lon.min() > 180.0:
        lon = np.where(lon < 0, lon + 360.0, lon)
    la0, la1 = float(lat.min()), float(lat.max())
    lo0, lo1 = float(lon.min()), float(lon.max())
    if max(abs(la0), abs(la1)) > 89.5:
        return None
    dlat = np.degrees(res / R_M) * 0.8
    dlon = dlat / np.cos(np.radians(min(abs(la0), abs(la1))))
    pad_la, pad_lo = 2 * dlat, 2 * dlon
    la0, la1, lo0, lo1 = la0 - pad_la, la1 + pad_la, lo0 - pad_lo, lo1 + pad_lo
    hgt = int(min(2048, max(64, np.ceil((la1 - la0) / dlat))))
    w = int(min(4096, max(64, np.ceil((lo1 - lo0) / dlon))))
    img = geo_rect("KaguyaTC_Ortho", lo0, la0, lo1, la1, w, hgt)
    if img is None or img.std() < 2.0 or (img < 4).mean() > 0.6:
        return None
    img = median_filter(img, 3)
    rr = (la1 - lat) / (la1 - la0) * hgt - 0.5
    cc = (lon - lo0) / (lo1 - lo0) * w - 0.5
    return map_coordinates(img, [rr, cc], order=1, mode="nearest").astype(np.float32)


_KLOCKS: dict[str, threading.Lock] = {}
_KGUARD = threading.Lock()


def kaguya_block(h: str, L: int, br: int, bc: int) -> np.ndarray | None:
    """Kaguya TC for the KBLOCK x KBLOCK block with top-left tile (br, bc), reprojected and tone-matched to the WAC
    mosaic with a smooth gain field; cached under tiles/src/kag_{h} (a .none file marks no data)."""
    n = min(KBLOCK, 2 ** L - br, 2 ** L - bc)
    p = SRC / f"kag_{h}/{L}/{br}_{bc}.jpg"
    miss = p.with_suffix(".none")
    with _KGUARD:
        lock = _KLOCKS.setdefault(str(p), threading.Lock())
    with lock:
        if p.exists():
            return np.asarray(Image.open(p).convert("L"), dtype=np.float32)
        if miss.exists():
            return None
        x0, _, _, y1 = bounds(L, br, bc)
        s = span(L) * n
        kag = kaguya_polar(h, (x0, y1 - s, x0 + s, y1), n * 256)
        p.parent.mkdir(parents=True, exist_ok=True)
        if kag is None:
            miss.touch()
            return None
        ref = np.zeros_like(kag)  # WAC reference (Kaguya itself outside the cap)
        for a in range(n):
            for b in range(n):
                u = wac_under(h, L, br + a, bc + b) if in_cap(L, br + a, bc + b) else None
                ref[a * 256:(a + 1) * 256, b * 256:(b + 1) * 256] = u if u is not None else kag[a * 256:(a + 1) * 256, b * 256:(b + 1) * 256]
        kag = tone_match(kag, ref)
        save_jpg(kag, p, 92)
        return kag


def kaguya_tile(h: str, L: int, row: int, col: int) -> np.ndarray | None:
    if L < 8:
        return None
    br, bc = row - row % KBLOCK, col - col % KBLOCK
    k = kaguya_block(h, L, br, bc)
    if k is None:
        return None
    a, b = row - br, col - bc
    t = k[a * 256:(a + 1) * 256, b * 256:(b + 1) * 256]
    return t if t.shape == (256, 256) else None


def build_outer_block(h: str, L: int, br: int, bc: int, dem: Dem | None = None) -> dict[tuple[int, int], np.ndarray]:
    """Outer-cap tiles of level 8-10 (outside the NAC area): the KBLOCK x KBLOCK block with top-left tile (br, bc)."""
    n = min(KBLOCK, 2 ** L - br, 2 ** L - bc)
    want = [(br + a, bc + b) for a in range(n) for b in range(n)
            if in_cap(L, br + a, bc + b) and not in_nac(L, br + a, bc + b) and L <= OUTER_LEVELS]
    if not want:
        return {}
    kag = kaguya_block(h, L, br, bc)
    unders = {rc: wac_under(h, L, *rc) for rc in want}
    gain = 1.0
    out: dict[tuple[int, int], np.ndarray] = {}
    for (r, c) in want:
        under = unders[(r, c)]
        rel = relief(h, L, r, c)
        if rel is None:
            rel = dem_relief(h, L, r, c, dem or Dem(h))
        a, b = r - br, c - bc
        k = None if kag is None else kag[a * 256:(a + 1) * 256, b * 256:(b + 1) * 256] * gain
        img = k if k is not None else under
        if img is None:
            continue
        out[(r, c)] = compose(img, rel, ALBEDO[h], sharpen=0.0 if k is not None else 0.5)
    return out


def save_jpg(arr: np.ndarray, path: Path, q: int = 90) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(path, "JPEG", quality=q, optimize=True)
