"""Precompute the cached science products so the demo is interactive from the first click (and works offline).

    python scripts/precompute.py [site ...] [--year 2027] [--clones K]

For each site: the local performance grid's skylines (5 m + LOLA terrain, 720 azimuths, 2 m mast), the hourly
Sun/Earth/DSN geometry for the year, and the annual metric fields. --clones K also builds skylines for the first K
PGDA 78 terrain-error clones of the hero sites (for the terrain-uncertainty analysis).
"""
from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.config import DEFAULT_YEAR  # noqa: E402
from backend.app.services import products as P  # noqa: E402
from backend.app.services import sites as S  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("sites", nargs="*", default=list(S.SITES))
    ap.add_argument("--year", type=int, default=DEFAULT_YEAR)
    ap.add_argument("--clones", type=int, default=0)
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    for sid in a.sites:
        t = time.perf_counter()
        hg = P.horizon_grid(sid)
        P.geometry(sid, a.year)
        m = P.grid_metric_fields(sid, a.year)
        print(f"{sid}: {hg['X'].size} grid points, horizons {float(hg['seconds']):.1f} s; "
              f"sunlight max {m['sun'].max():.1f}% ({time.perf_counter() - t:.1f} s total)", flush=True)
        if a.clones and S.get(sid).clones:
            for k in range(1, a.clones + 1):
                P.horizon_grid(sid, clone=k)
                print(f"  {sid} clone {k:04d} done", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
