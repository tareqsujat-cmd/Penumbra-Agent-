"""Site and region images for the landing views, cut from the polar photo + relief composites (polarlib.py).

    python scripts/prepare_site_images.py
site/{id}.jpg         each site's 30 km context box, 4096 px (~7 m/px) from level-10 LROC NAC composites
site/{id}_detail.jpg  the 1.4 km box of the 5 m landing terrain, 1024 px: level-11 photo (LROC NAC 4.2 m/px, else
                      Kaguya TC) with shadowed ground shown by relief computed from the site's own PGDA 78 5 m DEM
site/region_s.jpg     the planner's +-200 km south polar region, 4096 px (~98 m/px) from level-7 composites
Context and region boxes (polar-stereographic metres) are the ones listed in tiles/manifest.json under siteImages;
detail boxes come from the backend site registry (backend/app/services/sites.py) and are added there, with an image version used to bust browser caches.
"""
from __future__ import annotations

import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image
from scipy.ndimage import map_coordinates

sys.path.insert(0, str(Path(__file__).resolve().parent))
from polarlib import ALBEDO, ROOT, Dem, bounds, build_tile, compose, photo_tile, relief, save_jpg, span  # noqa: E402

TILES = ROOT / "tiles"


def tile(h: str, L: int, r: int, c: int, dem: Dem) -> np.ndarray | None:
    p = TILES / f"tp_{h}/img/{L}/{r}_{c}.jpg"
    if p.exists():
        return np.asarray(Image.open(p).convert("L"), dtype=np.float32)
    img = build_tile(h, L, r, c, dem)
    if img is not None:
        save_jpg(img, p, 90)
    return img


def render(h: str, box: tuple[float, float, float, float], px: int, L: int) -> np.ndarray:
    dem = Dem(h)
    x0, y0, x1, y1 = box
    s = span(L)
    c0, c1 = int((x0 + 1095930) // s), int((x1 + 1095930) // s)
    r0, r1 = int((1095930 - y1) // s), int((1095930 - y0) // s)
    jobs = [(r, c) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)]
    with ThreadPoolExecutor(6) as ex:
        tiles = list(ex.map(lambda rc: tile(h, L, rc[0], rc[1], dem), jobs))
    mos = np.full(((r1 - r0 + 1) * 256, (c1 - c0 + 1) * 256), np.nan, np.float32)
    for (r, c), t in zip(jobs, tiles):
        if t is not None:
            mos[(r - r0) * 256:(r - r0 + 1) * 256, (c - c0) * 256:(c - c0 + 1) * 256] = t
    if np.isnan(mos).any():
        mos = np.where(np.isnan(mos), np.nanmean(mos), mos)
    mx0, _, _, my1 = bounds(L, r0, c0)
    res = (x1 - x0) / px
    X, Y = np.meshgrid(x0 + (np.arange(px) + 0.5) * res, y1 - (np.arange(px) + 0.5) * res)
    return map_coordinates(mos, [(my1 - Y) / s * 256 - 0.5, (X - mx0) / s * 256 - 0.5], order=1, mode="nearest")


PGDA78 = {"cr1": "Site01", "shk": "Site04", "nob": "Site06", "mou": "Site20", "mal": "Site23"}


def relief5(site: str, box: tuple[float, float, float, float], px: int) -> np.ndarray:
    """Hillshade of the site's PGDA 78 5 m surface (light from the upper left, 45 deg up), on the CE-2 tone scale
    (flat ground 170) that compose() expects."""
    tile = PGDA78[site]
    p = ROOT / f"data/raw/pgda78/{tile}/{tile}_final_adj_5mpp_surf.tif"
    with tifffile.TiffFile(p) as tf:
        page = tf.pages[0]
        z = page.asarray().astype(np.float32)
        tie = page.tags["ModelTiepointTag"].value
        res = page.tags["ModelPixelScaleTag"].value[0]
    gx0, gy1 = tie[3], tie[4]  # corner of pixel (0, 0); rows run south
    gy, gx = np.gradient(z, res)
    nx, ny = -gx, gy  # surface normal components in map x (east-ish) and y (north-ish)
    lv = np.array([-1.0, 1.0, np.sqrt(2.0)]) / 2.0  # azimuth upper-left, elevation 45 deg
    shade = (nx * lv[0] + ny * lv[1] + lv[2]) / np.sqrt(nx * nx + ny * ny + 1)
    rel = 170.0 + 560.0 * (shade - np.sqrt(0.5))  # a little stronger than the regional relief: plateaus are very flat
    x0, y0, x1, y1 = box
    r = (x1 - x0) / px
    X, Y = np.meshgrid(x0 + (np.arange(px) + 0.5) * r, y1 - (np.arange(px) + 0.5) * r)
    return map_coordinates(rel, [(gy1 - Y) / res - 0.5, (X - gx0) / res - 0.5], order=1, mode="nearest").astype(np.float32)


def render_detail(site: str, box: tuple[float, float, float, float], px: int, L: int = 11) -> np.ndarray:
    """Level-L photo mosaic composed with 5 m DEM relief (sharper than the 33 m regional relief in the tiles)."""
    x0, y0, x1, y1 = box
    s = span(L)
    c0, c1 = int((x0 + 1095930) // s), int((x1 + 1095930) // s)
    r0, r1 = int((1095930 - y1) // s), int((1095930 - y0) // s)
    shape = ((r1 - r0 + 1) * 256, (c1 - c0 + 1) * 256)
    photo, lo, hi = np.full(shape, 100.0, np.float32), np.full(shape, 30.0, np.float32), np.full(shape, 90.0, np.float32)
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            ph = photo_tile("s", L, r, c, relief("s", L, r, c))
            if ph is None:
                continue
            sl = np.s_[(r - r0) * 256:(r - r0 + 1) * 256, (c - c0) * 256:(c - c0 + 1) * 256]
            photo[sl], lo[sl], hi[sl] = ph[0], ph[1], ph[2]
    mx0, _, _, my1 = bounds(L, r0, c0)
    res = (x1 - x0) / px
    X, Y = np.meshgrid(x0 + (np.arange(px) + 0.5) * res, y1 - (np.arange(px) + 0.5) * res)
    rc = [(my1 - Y) / s * 256 - 0.5, (X - mx0) / s * 256 - 0.5]
    smp = lambda a: map_coordinates(a, rc, order=1, mode="nearest")  # noqa: E731
    lo, hi = smp(lo), smp(hi)
    soft = lo > 20.0  # no NAC here (Kaguya / WAC only): prefer the crisp 5 m relief except where the photo is bright
    lo, hi = np.where(soft, 70.0, lo), np.where(soft, 190.0, hi)
    return compose(smp(photo), relief5(site, box, px), ALBEDO["s"], dark=(lo, hi))


if __name__ == "__main__":
    mp = TILES / "manifest.json"
    man = json.loads(mp.read_text(encoding="utf-8"))
    boxes = {k: v for k, v in man["siteImages"].items() if not k.endswith("_detail")}
    sys.path.insert(0, str(ROOT))
    from backend.app.services.sites import GRID_HALF, SITES  # the same site centres the API uses
    for sid, site in SITES.items():
        cx, cy = site.xy
        half = GRID_HALF + 2.5
        boxes[f"{sid}_detail"] = [round(v, 1) for v in (cx - half, cy - half, cx + half, cy + half)]
    only = set(sys.argv[1:])
    for sid, box in boxes.items():
        if only and sid not in only:
            continue
        if sid.endswith("_detail"):
            img = render_detail(sid[:-7], tuple(box), 1024)
        else:
            img = render("s", tuple(box), 4096, 7 if sid == "region_s" else 10)
        save_jpg(img, TILES / f"site/{sid}.jpg", 90)
        print("site image", sid, flush=True)
    man["siteImages"] = boxes
    man["imageVersion"] = int(time.time())
    mp.write_text(json.dumps(man, indent=1), encoding="utf-8")
