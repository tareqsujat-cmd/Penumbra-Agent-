"""Site bundle for the UI: terrain (PGDA 78 5 m + LOLA 80 m), the computed metric fields, hourly Sun/Earth
geometry, the skyline at the best point and verified reference points. Every number is read from NASA data or
computed by the science modules; nothing is hard-coded."""
from __future__ import annotations

import base64
import io
import json
import logging
from functools import lru_cache

import numpy as np
from PIL import Image

from ..config import CACHE, DEFAULT_YEAR
from ..science import coordinates as C
from ..science.horizon import horizons
from ..science.terrain import ldem80, ldem240, load_pgda78
from . import products as P
from . import sites as S

log = logging.getLogger("penumbra.bundle")
CTX_HALF = 14_960.0  # m: LOLA 80 m context window around the site (375 px)
REGION_HALF = 199_800.0
REGION_RES = 960.0


def _png(img: Image.Image) -> str:
    b = io.BytesIO()
    img.save(b, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(b.getvalue()).decode()


def _height_png(h: np.ndarray) -> tuple[str, float, float]:
    """Heights as 16-bit values in the R (high) and G (low) bytes of an RGB PNG, scaled to [hmin, hmax]."""
    hmin, hmax = float(h.min()), float(h.max())
    q = np.round((h - hmin) / max(hmax - hmin, 1e-6) * 65535).astype(np.uint32)
    rgb = np.zeros(h.shape + (3,), np.uint8)
    rgb[..., 0], rgb[..., 1] = q >> 8, q & 255
    return _png(Image.fromarray(rgb, "RGB")), round(hmin, 2), round(hmax, 2)


def terrain_block(site_id: str) -> dict:
    s = S.get(site_id)
    cx, cy = s.xy
    surf = load_pgda78(s.tile, "surf")
    slp = load_pgda78(s.tile, "slp")
    _, _, h = surf.window(cx, cy, S.GRID_HALF, 5.0)
    _, _, sl = slp.window(cx, cy, S.GRID_HALF, 5.0)
    png, hmin, hmax = _height_png(h)
    slope = np.clip(sl / 40.0 * 255, 0, 255).astype(np.uint8)
    return {"half": S.GRID_HALF, "px": int(h.shape[0]), "res": 5.0, "hmin": hmin, "hmax": hmax, "height_png": png,
            "slope_png": _png(Image.fromarray(slope, "L")), "slope_max_deg": 40, "center_xy": [round(cx, 1), round(cy, 1)],
            "source": f"NASA PGDA 78 {s.tile} 5 m (surface and slope)"}


def context_block(site_id: str) -> dict:
    s = S.get(site_id)
    cx, cy = s.xy
    r = ldem80()
    # snap the window centre to an LDEM pixel centre so the grid samples the DEM nodes exactly
    sx = r.x0 + round((cx - r.x0) / r.res) * r.res
    sy = r.y0 - round((r.y0 - cy) / r.res) * r.res
    _, _, h = r.window(sx, sy, CTX_HALF, r.res)
    png, hmin, hmax = _height_png(h)
    return {"half": CTX_HALF, "px": int(h.shape[0]), "res": r.res, "hmin": hmin, "hmax": hmax, "height_png": png,
            "center_offset": [round(sx - cx, 1), round(sy - cy, 1)], "source": "NASA LRO LOLA LDEM_80S_80M (PDS)"}


@lru_cache(maxsize=1)
def region_block() -> dict:
    r = ldem240()
    k = int(REGION_HALF / REGION_RES)
    xs = np.arange(-k, k + 1) * REGION_RES
    X, Y = np.meshgrid(xs, -xs)
    h = r.sample(X, Y)
    png, hmin, hmax = _height_png(h)
    return {"px": int(h.shape[0]), "res": REGION_RES, "x0": float(xs[0]), "y0": float(-xs[0]), "hmin": hmin, "hmax": hmax,
            "height_png": png, "source": "NASA LRO LOLA LDEM_75S_240M (PDS), sampled every 960 m"}


def ephem_block(site_id: str, year: int) -> dict:
    """Hourly Sun/Earth azimuth/elevation at the site centre, packed as uint16 (az*100, (el+90)*100)."""
    s = S.get(site_id)
    g = P.geometry(site_id, year)
    cx, cy = s.xy
    up, e, n = C.local_basis(cx, cy)
    saz, sel = C.az_el(g["sun_d"], up, e, n)
    eaz, eel = C.az_el(g["earth_d"], up, e, n)
    arr = np.stack([saz * 100, (sel + 90) * 100, eaz * 100, (eel + 90) * 100], axis=1)
    u16 = np.clip(np.round(arr), 0, 65535).astype("<u2")
    return {"start": f"{year}-01-01T00:00Z", "step_h": 1, "n": int(u16.shape[0]),
            "b64": base64.b64encode(u16.tobytes()).decode(),
            "source": "NAIF SPICE: DE440 (de440s.bsp), MOON_ME via moon_pa_de440_200625.bpc + moon_de440_250416.tf; apparent ('LT+S')"}


def field_block(site_id: str, year: int, earth_margin: float, dsn_mask: float) -> dict:
    s = S.get(site_id)
    m = P.grid_metric_fields(site_id, year, earth_margin, dsn_mask)
    r2 = lambda a: np.round(a, 2).tolist()  # noqa: E731
    return {"kind": "computed", "x0": float(m["xs"][0]), "y0": float(m["ys"][0]), "dx": s.grid_dx,
            "nx": int(m["xs"].size), "ny": int(m["ys"].size), "sun": r2(m["sun"]), "earth": r2(m["earth"]),
            "dsn": r2(m["dsn"]), "dark_h": np.round(m["dark"]).astype(int).tolist(),
            "year": year, "earth_margin_deg": earth_margin, "dsn_mask_deg": dsn_mask, "mast_m": 2.0,
            "source": f"Computed: 720-azimuth horizons on a {s.grid_dx:g} m grid (PGDA 78 5 m + LOLA 80/240 m), "
                      f"SPICE hourly geometry {year}, solar-disc fraction; 2 m mast"}


def bundle(site_id: str, year: int = DEFAULT_YEAR, earth_margin: float = 2.0, dsn_mask: float = 6.0) -> dict:
    key = P._key("bundle-v1", site_id, year, earth_margin, dsn_mask, P.TERRAIN_VERSION)
    path = CACHE / "bundles" / f"{site_id}_{key}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    s = S.get(site_id)
    cx, cy = s.xy
    field = field_block(site_id, year, earth_margin, dsn_mask)
    sun = np.array(field["sun"])
    j, i = np.unravel_index(int(np.argmax(sun)), sun.shape)
    bx, by = field["x0"] + i * field["dx"], field["y0"] + j * field["dx"]
    sky = horizons(S.stack(site_id), [cx + bx], [cy + by], 2.0)[0]
    known = []
    for label, lat, lon, src in s.known:
        kx, ky = C.ll_to_ps(lat, lon)
        if abs(kx - cx) <= S.GRID_HALF and abs(ky - cy) <= S.GRID_HALF:
            known.append({"label": label, "xy": [round(float(kx - cx), 1), round(float(ky - cy), 1)], "source": src})
    neighbours = []
    for o in S.SITES.values():
        if o.id == site_id:
            continue
        ox, oy = o.xy
        if np.hypot(ox - cx, oy - cy) < 40_000:
            neighbours.append({"id": o.id, "name": o.name, "xy": [round(ox - cx, 1), round(oy - cy, 1)]})
    out = {
        "id": s.id, "name": s.name, "short": s.short, "lat": round(float(s.lat), 5), "lon": round(float(s.lon), 4),
        "tile": f"PGDA 78 {s.tile}", "note": s.note, "centre_source": s.centre_source,
        "terrain": terrain_block(site_id), "context": context_block(site_id), "field": field,
        "ephem": ephem_block(site_id, year),
        "skyline": {"kind": "computed", "deg": [round(float(v), 3) for v in sky], "at": [bx, by],
                    "source": "Computed horizon at the brightest grid point, 2 m mast"},
        "ephem_note": "", "known_points": known, "neighbours": neighbours, "pole_xy": [round(-cx, 1), round(-cy, 1)],
        "has_clones": s.clones,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out), encoding="utf-8")
    return out
