"""Polar tiles on the Moon Trek grid (see polarlib.py): LOLA height tiles and photo + relief composites.

    python scripts/prepare_trek.py [heights|wacraw|compose|all]
heights  65 x 65 LOLA height tiles, levels 0-8
wacraw   raw LRO WAC polar photo, levels 0-7 (8 x 8 tiles per WMS call)
compose  composite images for levels 0-7 and, inside the NAC area, level 8 (fetches the Moon Trek NAC / CE-2 / LOLA
         hillshade tiles it needs and caches them under tiles/src)
Deeper levels (8 outside the NAC area, 9-11 inside it) are built on demand by serve.py and cached.
"""
from __future__ import annotations

import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from polarlib import (HGT_LEVELS, N, ROOT, WAC_LEVELS, Dem, bounds, build_tile, hgt_exists, in_cap, in_nac,  # noqa: E402
                      save_jpg, span, wac_raw_block, wac_raw_path)

TILES = ROOT / "tiles"


def heights(h: str) -> None:
    dem = Dem(h)
    for L in range(HGT_LEVELS + 1):
        n = 2 ** L
        cnt = 0
        for row in range(n):
            for col in range(n):
                if not hgt_exists(L, row, col):
                    continue
                cnt += 1
                p = TILES / f"tp_{h}/hgt/{L}/{row}_{col}.bin"
                if p.exists():
                    continue
                x0, y0, x1, y1 = bounds(L, row, col)
                X, Y = np.meshgrid(np.linspace(x0, x1, N), np.linspace(y1, y0, N))
                p.parent.mkdir(parents=True, exist_ok=True)
                np.round(dem.heights(X, Y) * 2).astype("<i2").tofile(p)
        print(f"tp_{h} hgt L{L}: {cnt}", flush=True)


def wacraw(h: str) -> None:
    for L in range(WAC_LEVELS + 1):
        n = 2 ** L
        bt = min(8, n)
        jobs = []
        for br in range(0, n, bt):
            for bc in range(0, n, bt):
                need = [(br + a, bc + b) for a in range(bt) for b in range(bt)
                        if in_cap(L, br + a, bc + b) and not wac_raw_path(h, L, br + a, bc + b).exists()]
                if need:
                    jobs.append((br, bc, need))

        def run(job):
            br, bc, need = job
            x0, _, _, y1 = bounds(L, br, bc)
            s = span(L) * bt
            img = wac_raw_block(h, (x0, y1 - s, x0 + s, y1), bt * 256)
            if img is None:
                return 0
            for (row, col) in need:
                a, b = row - br, col - bc
                save_jpg(img[a * 256:(a + 1) * 256, b * 256:(b + 1) * 256], wac_raw_path(h, L, row, col), 92)
            return len(need)

        with ThreadPoolExecutor(3) as ex:
            done = sum(ex.map(run, jobs))
        print(f"wac_{h} raw L{L}: {done} new tiles ({span(L) / 256:.0f} m/px)", flush=True)


def compose(h: str) -> None:
    dem = Dem(h)
    for L in range(WAC_LEVELS + 2):
        n = 2 ** L
        todo = [(r, c) for r in range(n) for c in range(n)
                if in_cap(L, r, c) and (L <= WAC_LEVELS or in_nac(L, r, c)) and not (TILES / f"tp_{h}/img/{L}/{r}_{c}.jpg").exists()]

        def run(rc):
            r, c = rc
            img = build_tile(h, L, r, c, dem)
            if img is None:
                return 0
            save_jpg(img, TILES / f"tp_{h}/img/{L}/{r}_{c}.jpg", 90)
            return 1

        with ThreadPoolExecutor(6) as ex:
            done = 0
            for k, d in enumerate(ex.map(run, todo)):
                done += d
                if (k + 1) % 400 == 0:
                    print(f"  tp_{h} L{L}: {k + 1}/{len(todo)}", flush=True)
        print(f"tp_{h} img L{L}: {done}/{len(todo)} tiles ({span(L) / 256:.1f} m/px)", flush=True)


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    for h in ("s", "n"):
        if what in ("heights", "all"):
            heights(h)
        if what in ("wacraw", "all"):
            wacraw(h)
        if what in ("compose", "all"):
            compose(h)
