"""Penumbra API + static app server.

    uvicorn backend.app.main:app --port 4173       (or: python tasks.py dev)

Serves /api/* (Instructions §35), the built frontend (dist/) and the Moon imagery tiles (tiles/, built on demand by
serve.py's tile builders and cached). Everything the judged flow needs is local (§36).
"""
from __future__ import annotations

import asyncio
import email.utils
import json
import logging
import os
import sys
import time
import traceback
import uuid
from pathlib import Path

import numpy as np
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from . import config
from .assistant import agent as AG
from .schemas import CompareRequest, EnduranceRequest, RiskRequest, RobustRequest, VisibilityRequest
from .science import coordinates as C
from .science import dsn as D
from .science import ephemeris as eph
from .science.errors import OutOfCoverage, PenumbraError
from .science.landing import Model
from .science.power import Vehicle
from .services import analysis as A
from .services import bundle as B
from .services import products as P
from .services import provenance as PV
from .services import sites as S
from .services import validation as VS

logging.basicConfig(level=os.environ.get("PENUMBRA_LOG", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("penumbra.api")
TIMEOUT_S = float(os.environ.get("PENUMBRA_TIMEOUT", "90"))

app = FastAPI(title="Penumbra API", version="1.0.0",
              description="Terrain-aware lunar illumination, Earth/DSN visibility and robust landing-aim analysis.")


# ---------------------------------------------------------------------------------------------- errors
def _err(status: int, code: str, message: str, detail: dict | None = None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "detail": detail or {}}})


@app.exception_handler(PenumbraError)
async def penumbra_error(_: Request, e: PenumbraError):
    log.warning("%s: %s %s", e.code, e.message, e.detail)
    return _err(e.status, e.code, e.message, e.detail)


@app.exception_handler(RequestValidationError)
async def invalid_request(_: Request, e: RequestValidationError):
    errs = [{"loc": list(x.get("loc", [])), "msg": x.get("msg", "")} for x in e.errors()]
    code = "INVALID_UNCERTAINTY" if any("model" in map(str, x["loc"]) for x in errs) else "INVALID_REQUEST"
    return _err(422, code, "request failed validation", {"errors": errs})


@app.exception_handler(Exception)
async def compute_failed(_: Request, e: Exception):
    trace = uuid.uuid4().hex[:8]
    log.error("COMPUTE_FAILED trace=%s: %s\n%s", trace, e, traceback.format_exc())
    return _err(500, "COMPUTE_FAILED", "the computation failed; details are in the server log", {"trace_id": trace})


async def compute(fn, *args, **kw):
    """Run a blocking science call off the event loop with a timeout (never freezes the server)."""
    t0 = time.perf_counter()
    try:
        out = await asyncio.wait_for(run_in_threadpool(fn, *args, **kw), timeout=TIMEOUT_S)
    except asyncio.TimeoutError:
        raise PenumbraError(f"computation exceeded {TIMEOUT_S:.0f} s", timeout_s=TIMEOUT_S) from None
    log.info("%s %.0f ms", getattr(fn, "__name__", "compute"), (time.perf_counter() - t0) * 1000)
    return out


def _model(m) -> Model:
    mm = Model("circular", radius=m.radius) if m.kind == "circular" else Model("gaussian", sigma_e=m.sigmaE, sigma_n=m.sigmaN, rot_deg=m.rotDeg)
    mm.validate()
    return mm


def _vehicle(v) -> Vehicle:
    return Vehicle([(p.azOffsetDeg, p.watts) for p in v.panels], v.batteryWh, v.baseLoadW, v.hibernateW, v.reservePct)


def _window(req) -> tuple[int | None, int | None]:
    return (req.window.startIdx, req.window.hours) if req.window else (None, None)


# ---------------------------------------------------------------------------------------------- API
@app.get("/api/health")
def health():
    return {"status": "ok", "frame": eph.FRAME, "kernels": eph.kernel_list(), "year": config.DEFAULT_YEAR}


@app.get("/api/sites")
def list_sites():
    return [{"id": s.id, "name": s.name, "short": s.short, "lat": round(float(s.lat), 5), "lon": round(float(s.lon), 4),
             "tile": s.tile, "has_clones": s.clones, "field_kind": "computed", "source": s.centre_source}
            for s in S.SITES.values()]


@app.get("/api/sites/{site_id}")
async def get_site(site_id: str, year: int = config.DEFAULT_YEAR, earthMarginDeg: float = 2.0, dsnMaskDeg: float = 6.0):
    S.get(site_id)
    return await compute(B.bundle, site_id, year, round(earthMarginDeg, 2), round(dsnMaskDeg, 2))


@app.get("/api/sites/{site_id}/terrain")
async def site_terrain(site_id: str, layer: str = "height"):
    S.get(site_id)
    if layer not in ("height", "slope", "context"):
        raise OutOfCoverage(f"unknown terrain layer {layer!r}", layers=["height", "slope", "context"])
    if layer == "context":
        return await compute(B.context_block, site_id)
    t = await compute(B.terrain_block, site_id)
    keep = ("half", "px", "res", "center_xy", "source") + (("height_png", "hmin", "hmax") if layer == "height" else ("slope_png", "slope_max_deg"))
    return {k: t[k] for k in keep}


@app.get("/api/region")
async def region():
    return await compute(B.region_block)


@app.get("/api/sites/{site_id}/horizon")
async def site_horizon(site_id: str, x: float = 0.0, y: float = 0.0, mast: float = 2.0):
    S.get(site_id)
    if not 0.0 <= mast <= 20.0:
        raise OutOfCoverage("mast height must be 0-20 m", mast=mast)
    t0 = time.perf_counter()
    hz = await compute(A.aim_horizon, site_id, x, y, mast)
    cx, cy = S.get(site_id).xy
    lat, lon = C.ps_to_ll(cx + x, cy + y)
    return {"azimuth_deg": (np.arange(720) * 0.5).tolist(), "horizon_elevation_deg": [round(float(v), 4) for v in hz],
            "x": x, "y": y, "lat": round(float(lat), 6), "lon": round(float(lon), 5), "mast_m": mast,
            "dem_versions": P.TERRAIN_VERSION, "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1)}


@app.post("/api/visibility")
async def visibility(req: VisibilityRequest):
    S.get(req.site)
    return await compute(A.visibility, req.site, req.aim.x, req.aim.y, req.year, req.startIdx, req.hours,
                         req.earthMarginDeg, req.dsnMaskDeg, _vehicle(req.vehicle),
                         None if req.autoHeading else req.headingDeg, req.mast)


@app.post("/api/endurance")
async def endurance(req: EnduranceRequest):
    S.get(req.site)
    return await compute(A.endurance_by_landing_day, req.site, req.aim.x, req.aim.y, req.year, req.windowDays,
                         _vehicle(req.vehicle), req.stepDays, req.mast)


@app.post("/api/landing-risk")
async def landing_risk(req: RiskRequest):
    S.get(req.site)
    model = _model(req.model)
    start, hours = _window(req)
    out = await compute(A.risk, req.site, (req.aim.x, req.aim.y), model, req.percentile, req.year, req.n, req.seed,
                        req.earthMarginDeg, req.dsnMaskDeg, start, hours)
    out["percentile"] = req.percentile
    return out


@app.post("/api/robust-aim")
async def robust_aim(req: RobustRequest):
    S.get(req.site)
    model = _model(req.model)
    start, hours = _window(req)
    out = await compute(A.robust, req.site, model, req.percentile, req.year, req.searchRadius, req.n, req.seed,
                        req.earthMarginDeg, req.dsnMaskDeg, start, hours, req.slopeMaxDeg)
    sc = out.pop("score")
    out["score"] = [[None if np.isnan(v) else round(float(v), 2) for v in row] for row in sc]
    out["percentile"] = req.percentile
    return out


@app.post("/api/compare")
async def compare(req: CompareRequest):
    for s in req.sites:
        S.get(s)
    return await compute(A.compare, list(req.sites), _model(req.model), req.percentile, req.year, req.startIdx,
                         req.windowDays, _vehicle(req.vehicle), req.searchRadius, req.earthMarginDeg, req.dsnMaskDeg)


@app.get("/api/validation")
async def validation(refresh: bool = False):
    return await compute(VS.results, refresh)


@app.get("/api/provenance")
def provenance():
    return PV.provenance()


@app.get("/api/sky")
async def sky(year: int = config.DEFAULT_YEAR):
    """Bright-star catalogue (J2000) and the J2000 -> MOON_ME rotation through the year, for the 3-D skies."""
    from .science import stars
    return await compute(_sky_cached, year)


_SKY: dict[int, dict] = {}


def _sky_cached(year: int) -> dict:
    from .science import stars
    if year not in _SKY:
        _SKY[year] = stars.sky(year)
    return _SKY[year]


@app.get("/api/dsn")
def dsn_info():
    return {"stations": {k: v for k, v in eph.STATIONS.items()}, "masks_deg": D.MASKS, "caveat": D.CAVEAT}


# ---------------------------------------------------------------------------------------------- assistant
@app.get("/api/assistant/status")
def assistant_status():
    return AG.status()


@app.post("/api/assistant")
async def assistant(req: AG.AssistantRequest):
    """Server-sent events: one JSON object per `data:` line (text deltas, then done / notice / error)."""
    st = AG.status()
    if not st["available"]:
        return _err(503, "ASSISTANT_UNAVAILABLE", st["reason"])

    async def events():
        async for ev in AG.stream_reply(req):
            yield f"data: {json.dumps(ev)}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------------------------- tiles + static app
sys.path.insert(0, str(config.ROOT))
import serve as _tiles  # noqa: E402  (tile builders: USGS WMS / Moon Trek, cached under tiles/)


@app.get("/tiles/{path:path}")
async def tiles(path: str, request: Request):
    full = "/tiles/" + path
    m = _tiles.GEO_RE.match(full)
    if m:
        ok = await run_in_threadpool(_tiles.ensure_geo, m.group(1), *map(int, m.groups()[1:]))
        if not ok:
            return Response(status_code=404)
    m = _tiles.POLAR_RE.match(full)
    if m:
        ok = await run_in_threadpool(_tiles.ensure_polar, m.group(1), *map(int, m.groups()[1:]))
        if not ok:
            return Response(status_code=404)
    f = (config.TILES / path).resolve()
    if not str(f).startswith(str(config.TILES.resolve())) or not f.is_file():
        return Response(status_code=404)
    mtime = f.stat().st_mtime
    ims = request.headers.get("if-modified-since")
    if ims:
        try:
            if int(mtime) <= int(email.utils.parsedate_to_datetime(ims).timestamp()):
                return Response(status_code=304, headers={"Cache-Control": "no-cache"})
        except (TypeError, ValueError):
            pass
    return FileResponse(f, headers={"Cache-Control": "no-cache", "Last-Modified": email.utils.formatdate(mtime, usegmt=True)},
                        media_type="application/octet-stream" if f.suffix == ".bin" else None)


if config.DIST.exists():
    app.mount("/", StaticFiles(directory=str(config.DIST), html=True), name="app")
