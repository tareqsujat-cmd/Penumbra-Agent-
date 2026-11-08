"""Terrain rasters: NASA PGDA 78 5 m GeoTIFFs and LOLA polar LDEM (PDS .img), in south polar stereographic metres.

A Raster stores the value array plus the map position of pixel (0, 0)'s centre and the pixel size; rows run
toward -y (north-up image of the polar map). Heights are metres above the 1737.4 km reference sphere.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import numpy as np
import tifffile

from ..config import RAW
from .errors import DatasetMissing, OutOfCoverage


@dataclass
class Raster:
    z: np.ndarray  # float32 heights, or int16 DN (see scale)
    x0: float  # map x of the centre of pixel (row 0, col 0)
    y0: float  # map y of the centre of pixel (row 0, col 0)
    res: float  # m per pixel
    scale: float = 1.0  # height = z * scale
    name: str = ""
    path: str = ""
    meta: dict = field(default_factory=dict)

    @property
    def shape(self) -> tuple[int, int]:
        return self.z.shape  # type: ignore[return-value]

    def bounds(self) -> tuple[float, float, float, float]:
        """Outer edges (xmin, ymin, xmax, ymax)."""
        n, m = self.shape
        h = self.res / 2
        return self.x0 - h, self.y0 - (n - 1) * self.res - h, self.x0 + (m - 1) * self.res + h, self.y0 + h

    def covers(self, x, y, margin: float = 0.0) -> np.ndarray:
        x0, y0, x1, y1 = self.bounds()
        x, y = np.asarray(x), np.asarray(y)
        return (x >= x0 + margin) & (x <= x1 - margin) & (y >= y0 + margin) & (y <= y1 - margin)

    def sample(self, x, y) -> np.ndarray:
        """Bilinear values at map points (arrays); raises OutOfCoverage when any point is outside."""
        x = np.asarray(x, float)
        y = np.asarray(y, float)
        if not np.all(self.covers(x, y)):
            raise OutOfCoverage(f"point outside {self.name} coverage")
        n, m = self.shape
        c = np.clip((x - self.x0) / self.res, 0, m - 1.000001)
        r = np.clip((self.y0 - y) / self.res, 0, n - 1.000001)
        c0 = np.floor(c).astype(np.int64)
        r0 = np.floor(r).astype(np.int64)
        fc, fr = c - c0, r - r0
        z = self.z
        v = (z[r0, c0] * (1 - fc) * (1 - fr) + z[r0, c0 + 1] * fc * (1 - fr) + z[r0 + 1, c0] * (1 - fc) * fr
             + z[r0 + 1, c0 + 1] * fc * fr)
        return v.astype(np.float64) * self.scale

    def window(self, cx: float, cy: float, half: float, res: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Regular grid of values centred on (cx, cy): returns (xs, ys, values[rows=y descending, cols=x])."""
        k = int(round(half / res))
        xs = cx + np.arange(-k, k + 1) * res
        ys = cy + np.arange(k, -k - 1, -1) * res
        X, Y = np.meshgrid(xs, ys)
        return xs, ys, self.sample(X, Y)


# ---------------------------------------------------------------------------------------------- PGDA 78 GeoTIFF
PGDA78_KINDS = ("surf", "slp", "toterr", "slperr")


def pgda78_path(tile: str, kind: str = "surf", clone: int | None = None) -> Path:
    if clone is not None:
        return RAW / f"pgda78/{tile}/Clones/{tile}_final_adj_5mpp_{clone:04d}_err.tif"
    return RAW / f"pgda78/{tile}/{tile}_final_adj_5mpp_{kind}.tif"


@lru_cache(maxsize=8)
def load_pgda78(tile: str, kind: str = "surf", clone: int | None = None) -> Raster:
    """PGDA 78 5 m product. GeoKey RasterPixelIsArea: the tiepoint is the outer corner of pixel (0, 0) (the GMT
    'pixel-registered' convention in the PGDA 78 README), so centres sit half a pixel inside."""
    p = pgda78_path(tile, kind, clone)
    if not p.exists():
        raise DatasetMissing(f"PGDA 78 file missing: {p.name}", file=str(p))
    with tifffile.TiffFile(p) as tf:
        page = tf.pages[0]
        z = page.asarray().astype(np.float32)
        tie = page.tags["ModelTiepointTag"].value
        res = float(page.tags["ModelPixelScaleTag"].value[0])
    if np.isnan(z).any():
        z = np.where(np.isnan(z), np.nanmean(z), z).astype(np.float32)
    name = f"PGDA78 {tile} {kind if clone is None else f'clone {clone:04d}'}"
    return Raster(z, float(tie[3]) + res / 2, float(tie[4]) - res / 2, res, 1.0, name, str(p),
                  {"product": "NASA PGDA 78", "tile": tile, "kind": kind, "clone": clone})


# ---------------------------------------------------------------------------------------------- LOLA LDEM (PDS)
def _label(path: Path) -> dict[str, str]:
    txt = path.read_text(encoding="latin-1")
    out: dict[str, str] = {}
    for m in re.finditer(r"^\s*([A-Z_^]+)\s*=\s*(\S+)", txt, re.M):
        out.setdefault(m.group(1), m.group(2))
    return out


def _num(s: str) -> float:
    return float(re.sub(r"[^0-9eE+\-.]", "", s))


@lru_cache(maxsize=6)
def load_pds_polar(stem: str, folder: str = "lola") -> Raster:
    """LOLA polar stereographic product (LDEM or PGDA 69 AVGVISIB). Pixel (line i, sample j), 0-based, has its
    centre at x = (j - SAMPLE_PROJECTION_OFFSET) * MAP_SCALE, y = (LINE_PROJECTION_OFFSET - i) * MAP_SCALE."""
    lbl = next((p for p in (RAW / folder / f"{stem}.lbl", RAW / folder / f"{stem}.LBL") if p.exists()), None)
    img = next((p for p in (RAW / folder / f"{stem}.img", RAW / folder / f"{stem}.IMG") if p.exists()), None)
    if lbl is None or img is None:
        raise DatasetMissing(f"PDS product missing: {stem} (.img + .lbl)", file=str(RAW / folder / stem))
    L = _label(lbl)
    n, m = int(_num(L["LINES"])), int(_num(L["LINE_SAMPLES"]))
    if L.get("SAMPLE_TYPE") != "LSB_INTEGER" or int(_num(L["SAMPLE_BITS"])) != 16:
        raise DatasetMissing(f"unexpected sample type in {lbl.name}", file=str(lbl))
    z = np.memmap(img, dtype="<i2", mode="r", shape=(n, m))
    scale = _num(L["SCALING_FACTOR"])
    res = _num(L["MAP_SCALE"])
    loff, soff = _num(L["LINE_PROJECTION_OFFSET"]), _num(L["SAMPLE_PROJECTION_OFFSET"])
    meta = {k: L.get(k) for k in ("PRODUCT_ID", "START_TIME", "STOP_TIME", "COORDINATE_SYSTEM_NAME", "MAP_PROJECTION_TYPE")}
    return Raster(z, -soff * res, loff * res, res, scale, stem, str(img), meta)


def ldem80() -> Raster:
    return load_pds_polar("ldem_80s_80m")


def ldem240() -> Raster:
    return load_pds_polar("ldem_75s_240m")
