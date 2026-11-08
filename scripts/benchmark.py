"""Measure the timings reported in docs/PERFORMANCE.md (Instructions §12, §44). Needs the server for the HTTP and
browser timings (python tasks.py dev).

    python scripts/benchmark.py
"""
from __future__ import annotations

import json
import os
import platform
import statistics
import sys
import time
from pathlib import Path

import httpx
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.app.science.horizon import horizons  # noqa: E402
from backend.app.science.visibility import grid_metrics  # noqa: E402
from backend.app.services import analysis as A  # noqa: E402
from backend.app.services import products as P  # noqa: E402
from backend.app.services import sites as S  # noqa: E402
from backend.app.science.landing import Model  # noqa: E402

BASE = os.environ.get("PENUMBRA_URL", "http://127.0.0.1:4173")
VIPER = {"panels": [{"azOffsetDeg": 90, "watts": 320}, {"azOffsetDeg": 180, "watts": 320}, {"azOffsetDeg": 270, "watts": 320}],
         "batteryWh": 5420, "baseLoadW": 250, "hibernateW": 100, "reservePct": 20}


def timeit(fn, n=5):
    fn()  # warm-up (JIT, caches)
    ts = []
    for _ in range(n):
        t = time.perf_counter()
        fn()
        ts.append((time.perf_counter() - t) * 1000)
    return round(statistics.median(ts), 1)


def main() -> None:
    out: dict = {"machine": f"{platform.processor() or platform.machine()}, {os.cpu_count()} logical CPUs, {platform.system()} {platform.release()}"}
    st = S.stack("cr1")
    cx, cy = S.get("cr1").xy
    out["one_horizon_ms"] = timeit(lambda: horizons(st, [cx - 260], [cy - 210], 2.0))
    X = cx + (np.arange(256) % 16) * 10.0
    Y = cy + (np.arange(256) // 16) * 10.0
    out["horizons_256_points_ms"] = timeit(lambda: horizons(st, X, Y, 2.0), 3)
    out["site_grids_s"] = {sid: round(float(P.horizon_grid(sid)["seconds"]), 1) for sid in S.SITES}
    out["site_grid_points"] = {sid: int(P.horizon_grid(sid)["X"].size) for sid in S.SITES}
    hg = P.horizon_grid("cr1")
    g = P.geometry("cr1", 2027)
    up, e, n = P.bases(hg["X"], hg["Y"])
    dsn_any = g["dsn_goldstone"] >= 6.0
    out["annual_metrics_cr1_grid_ms"] = timeit(lambda: grid_metrics(hg["H"], up, e, n, g["sun_d"], g["sun_rho"], g["earth_d"], g["earth_rho"], 2.0, dsn_any, 0, 8760, False), 3)
    out["window_metrics_30d_cr1_grid_ms"] = timeit(lambda: grid_metrics(hg["H"], up, e, n, g["sun_d"], g["sun_rho"], g["earth_d"], g["earth_rho"], 2.0, dsn_any, 4300, 4300 + 720, False))
    m = Model("circular", radius=100)
    out["robust_aim_cr1_ms"] = timeit(lambda: A.robust("cr1", m, 10, 2027))
    out["landing_risk_ms"] = timeit(lambda: A.risk("cr1", (-260.0, -210.0), m, 10, 2027))
    c = httpx.Client(base_url=BASE, timeout=120)
    try:
        c.get("/api/health")
        http = {}
        http["GET /api/sites/cr1 (cached bundle)"] = timeit(lambda: c.get("/api/sites/cr1"), 3)
        http["POST /api/landing-risk"] = timeit(lambda: c.post("/api/landing-risk", json={"site": "cr1", "aim": {"x": -260, "y": -210}, "model": {"kind": "circular", "radius": 100}}))
        http["POST /api/robust-aim"] = timeit(lambda: c.post("/api/robust-aim", json={"site": "cr1", "aim": {"x": 0, "y": 0}, "model": {"kind": "circular", "radius": 100}}))
        k = [4300]

        def slider():  # a new landing date each call, so nothing is cached
            k[0] += 24
            c.post("/api/visibility", json={"site": "cr1", "aim": {"x": -260, "y": -210}, "startIdx": k[0], "hours": 720, "vehicle": VIPER})

        http["POST /api/visibility (new date, 30 d)"] = timeit(slider)
        http["POST /api/compare (3 sites, new date)"] = timeit(lambda: (k.__setitem__(0, k[0] + 24), c.post("/api/compare", json={"sites": ["cr1", "shk", "mal"], "model": {"kind": "circular", "radius": 100}, "startIdx": k[0], "vehicle": VIPER})), 3)
        out["http_ms"] = http
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
            pg = b.new_page(viewport={"width": 1920, "height": 1080})
            t = time.perf_counter()
            pg.goto(BASE + "/?mode=planner&site=cr1")
            pg.wait_for_selector(".pn-insp__kpis", timeout=120000)
            out["app_ready_ms"] = round((time.perf_counter() - t) * 1000)
            t = time.perf_counter()
            pg.wait_for_selector(".pn-t3d canvas", timeout=120000)
            out["first_terrain_paint_ms_after_ready"] = round((time.perf_counter() - t) * 1000)
            b.close()
    except httpx.HTTPError:
        out["http_ms"] = "server not running"
    (ROOT / "docs").mkdir(exist_ok=True)
    (ROOT / "docs/performance.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
