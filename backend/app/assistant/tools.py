"""Analysis tools for the assistant (phase 2): Claude calls these to get real numbers from Penumbra's own science code.

Every tool runs the same functions as the API routes (services/analysis.py), so a number the assistant quotes is the
number the app would show for the same inputs. Inputs default to the person's current settings (MissionParams, sent by
the browser with each question); any argument overrides one setting, which is how "what if" questions are answered.

No future-annotations import here: the SDK builds each tool's JSON schema and validates its input from the real
annotations (pydantic.validate_call), so they must be evaluable objects.
"""
import asyncio
import json
import math
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal, Optional

from anthropic.lib.tools import ToolError, beta_async_tool
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from .. import config
from ..schemas import XY, Uncertainty, VehicleIn
from ..science import ephemeris as eph
from ..science.errors import DatasetMissing, KernelMissing, PenumbraError
from ..science.landing import Model
from ..science.power import Vehicle
from ..services import analysis as A
from ..services import sites as S

YEAR = config.DEFAULT_YEAR
TOOL_TIMEOUT_S = 90.0
MAX_ITERATIONS = 8  # model turns per question (each turn may call several tools)


# ---------------------------------------------------------------------------------------------- the person's settings
class VehicleOption(VehicleIn):
    id: str = Field(max_length=40)
    name: str = Field(max_length=80)
    basis: Literal["verified", "assumption"] = "assumption"


class MissionParams(BaseModel):
    """Machine-readable copy of the planner settings (the <app_state> block is the human-readable one)."""
    site: str = "cr1"
    aim: XY = XY(x=0.0, y=0.0)
    aimKind: Literal["brightest", "robust", "custom", "nominal"] = "nominal"
    landingIdx: int = Field((151 + 28) * 24 + 13, ge=0, le=8783)
    windowDays: int = Field(30, ge=1, le=365)
    model: Uncertainty = Uncertainty(kind="circular", radius=100.0)
    percentile: Literal[50, 20, 10, 5] = 10
    earthMarginDeg: float = Field(2.0, ge=0.0, le=10.0)
    dsnMaskDeg: float = Field(6.0, ge=0.0, le=30.0)
    mast: float = Field(2.0, ge=0.5, le=20.0)
    vehicleId: str = "viper"
    vehicles: list[VehicleOption] = Field(default_factory=list, max_length=10)


# ---------------------------------------------------------------------------------------------- argument types
SiteArg = Annotated[Optional[str], Field(description="Site id: cr1, shk, mal, mou or nob (names also accepted). Default: the current site.")]
AimArg = Annotated[Optional[Literal["current", "brightest", "robust", "custom"]],
                   Field(description="Which aim point: the person's current aim (default; on another site it means the brightest point), "
                                     "the brightest point, the robust aim, or a custom grid offset given by aim_x_m / aim_y_m.")]
OffsetArg = Annotated[Optional[float], Field(ge=-700, le=700)]
DateArg = Annotated[Optional[str], Field(description="Landing date in 2027, 'YYYY-MM-DD' (keeps the current landing hour) or 'YYYY-MM-DDTHH'. Default: the current landing date.")]
WindowArg = Annotated[Optional[int], Field(ge=1, le=180)]
ModelArg = Optional[Literal["circular", "gaussian"]]
RadiusArg = Annotated[Optional[float], Field(ge=25, le=400)]
SigmaArg = Annotated[Optional[float], Field(ge=10, le=200)]
RotArg = Annotated[Optional[float], Field(ge=0, le=180)]
PercentileArg = Optional[Literal[50, 20, 10, 5]]
PeriodArg = Optional[Literal["year", "mission_window"]]
MarginArg = Annotated[Optional[float], Field(ge=0, le=10)]
MaskArg = Annotated[Optional[float], Field(ge=0, le=30, description="DSN elevation mask in degrees: 6 (downlink) or 10.1 (uplink).")]


# ---------------------------------------------------------------------------------------------- helpers
def r(v, d: int = 1):
    """Round for the model; NaN/None become None."""
    if v is None:
        return None
    v = float(v)
    return None if math.isnan(v) or math.isinf(v) else round(v, d)


def fmt_offset(x: float, y: float) -> str:
    """Same wording as the UI (src/utils/format.ts fmtOffset)."""
    d = math.hypot(x, y)
    if d < 1:
        return "at the site reference point"
    ang = (math.degrees(math.atan2(x, y)) + 360) % 360
    dirs = ["grid-north", "grid-north-east", "grid-east", "grid-south-east", "grid-south", "grid-south-west", "grid-west", "grid-north-west"]
    return f"{round(d)} m {dirs[round(ang / 45) % 8]}"


def plabel(q: int) -> str:
    """Robustness level as the app labels it (P50, P20, P10, P05)."""
    return f"P{q:02d}"


def idx_to_str(idx: int) -> str:
    d = datetime(YEAR, 1, 1, tzinfo=timezone.utc) + timedelta(hours=idx)
    return d.strftime("%d %b %Y, %H:00 UTC").lstrip("0")


def json_result(obj: dict) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


async def run(fn, *args, **kw):
    """Blocking science call off the event loop, with the API's timeout and errors the model can act on."""
    try:
        return await asyncio.wait_for(run_in_threadpool(fn, *args, **kw), timeout=TOOL_TIMEOUT_S)
    except asyncio.TimeoutError:
        raise ToolError(f"The computation took longer than {TOOL_TIMEOUT_S:.0f} s and was stopped.") from None
    except (DatasetMissing, KernelMissing) as e:
        raise ToolError(f"{e.code}: {e.message}. The NASA/JPL data for this is not installed on the server "
                        "(python tasks.py data), so this cannot be computed right now.") from None
    except PenumbraError as e:
        raise ToolError(f"{e.code}: {e.message} {json.dumps(e.detail, default=str) if e.detail else ''}".strip()) from None


class Ctx:
    """Resolves tool arguments against the person's current settings."""

    def __init__(self, p: MissionParams):
        self.p = p

    def site(self, site: Optional[str]) -> str:
        if not site:
            return self.p.site
        key = site.strip().lower()
        for s in S.SITES.values():
            if key in (s.id, s.short.lower(), s.name.lower()) or key in s.name.lower():
                return s.id
        raise ToolError(f"Unknown site {site!r}. Sites: " + ", ".join(f"{s.id} ({s.name})" for s in S.SITES.values()))

    def landing_idx(self, date: Optional[str], window_days: int) -> int:
        if date:
            try:
                if "T" in date:
                    d = datetime.fromisoformat(date.replace("Z", "") + ("" if ":" in date else ":00"))
                else:
                    d0 = datetime.fromisoformat(date)
                    d = d0.replace(hour=self.p.landingIdx % 24)
            except ValueError:
                raise ToolError(f"Could not read the date {date!r}; use YYYY-MM-DD.") from None
            if d.year != YEAR:
                raise ToolError(f"Penumbra's precomputed geometry covers {YEAR} only; pick a date in {YEAR}.")
            idx = int((d.replace(tzinfo=timezone.utc) - datetime(YEAR, 1, 1, tzinfo=timezone.utc)).total_seconds() // 3600)
        else:
            idx = self.p.landingIdx
        last = eph.hours_in_year(YEAR) - window_days * 24
        if idx > last:
            raise ToolError(f"A {window_days}-day window starting then runs past the end of {YEAR}; the latest landing is {idx_to_str(last)}.")
        return idx

    def window(self, days: Optional[int]) -> int:
        return days or self.p.windowDays

    def model(self, kind, radius, sigma_e, sigma_n, rot) -> tuple[Model, dict]:
        m = self.p.model
        kind = kind or m.kind
        if kind == "circular":
            rad = radius if radius is not None else m.radius
            out, desc = Model("circular", radius=rad), {"model": "circular", "radius_m": rad}
        else:
            se = sigma_e if sigma_e is not None else m.sigmaE
            sn = sigma_n if sigma_n is not None else m.sigmaN
            ro = rot if rot is not None else m.rotDeg
            out, desc = Model("gaussian", sigma_e=se, sigma_n=sn, rot_deg=ro), {"model": "elliptical Gaussian", "sigma_east_m": se, "sigma_north_m": sn, "rotation_deg": ro}
        try:
            out.validate()
        except PenumbraError as e:
            raise ToolError(f"{e.code}: {e.message}") from None
        return out, desc

    def vehicle(self, vehicle_id: Optional[str]) -> tuple[Vehicle, str]:
        vid = vehicle_id or self.p.vehicleId
        v = next((v for v in self.p.vehicles if v.id == vid or v.name.lower() == vid.lower()), None)
        if v is None:
            if not self.p.vehicles:
                raise ToolError("No vehicle scenario was sent with the question; energy results are unavailable.")
            raise ToolError(f"Unknown vehicle {vid!r}. Vehicles: " + ", ".join(f"{v.id} ({v.name})" for v in self.p.vehicles))
        name = f"{v.name} ({'sourced preset' if v.basis == 'verified' else 'assumption-based'})"
        return Vehicle([(q.azOffsetDeg, q.watts) for q in v.panels], v.batteryWh, v.baseLoadW, v.hibernateW, v.reservePct), name

    async def aim(self, site: str, aim, x, y, model: Model, q: int) -> tuple[float, float, str]:
        if x is not None or y is not None or aim == "custom":
            if x is None or y is None:
                raise ToolError("A custom aim needs both aim_x_m and aim_y_m (grid offsets from the site reference point).")
            return float(x), float(y), "custom point"
        if (aim in (None, "current")) and site == self.p.site:
            return self.p.aim.x, self.p.aim.y, {"brightest": "brightest point", "robust": "robust aim", "custom": "custom point", "nominal": "site reference point"}[self.p.aimKind]
        ra = await run(A.robust, site, model, q, YEAR, earth_margin=self.p.earthMarginDeg, dsn_mask=self.p.dsnMaskDeg)
        b = ra["robust"] if aim == "robust" else ra["best_nominal"]
        return b["x"], b["y"], "robust aim" if aim == "robust" else "brightest point"


# ---------------------------------------------------------------------------------------------- the tools
TOOL_LABELS = {
    "propose_app_changes": "Preparing a change for you to approve",
    "get_site_info": "Looking up site facts",
    "get_mission_outlook": "Computing sunlight, Earth, DSN and battery after landing",
    "get_landing_risk": "Simulating 2,000 touchdowns",
    "find_robust_aim": "Searching every candidate aim",
    "compare_sites": "Comparing sites",
    "find_best_landing_dates": "Scanning landing dates in 2027",
}


SECTION_NAMES = {"globe": "01 Explore", "planner": "02 Mission", "simple": "03 Briefing", "compare": "04 Compare",
                 "science": "05 Science", "report": "06 Research", "about": "07 System"}
DIALOG_NAMES = {"export": "Export decision summary", "data": "Data and provenance", "vehicle": "Power scenario (edit vehicle)"}


def make_tools(p: MissionParams, proposals: Optional[list] = None) -> list:
    """The analysis tools, plus propose_app_changes when `proposals` is given (phase 3: each accepted proposal is
    appended there and streamed to the browser as an approval card; nothing changes until the person clicks Apply)."""
    ctx = Ctx(p)

    @beta_async_tool(eager_input_streaming=True)
    async def get_site_info(site: SiteArg = None) -> str:
        """Facts about one landing site, or all five when no site is given: name, location, terrain tile, grid spacing,
        notes and published reference points. No computation.

        Args:
            site: Site id or name; omit for all five sites.
        """
        ids = [ctx.site(site)] if site else list(S.SITES)
        out = []
        for sid in ids:
            s = S.get(sid)
            out.append({"id": s.id, "name": s.name, "lat": r(s.lat, 4), "lon_east": r(s.lon, 3), "terrain": f"NASA PGDA 78 {s.tile}, 5 m",
                        "performance_grid_spacing_m": s.grid_dx, "grid_half_width_m": S.GRID_HALF, "note": s.note,
                        "centre_source": s.centre_source, "reference_points": [{"label": k[0], "lat": k[1], "lon_east": k[2]} for k in s.known]})
        return json_result({"sites": out})

    @beta_async_tool(eager_input_streaming=True)
    async def get_mission_outlook(site: SiteArg = None, aim: AimArg = None, aim_x_m: OffsetArg = None, aim_y_m: OffsetArg = None,
                                  landing_date: DateArg = None, window_days: WindowArg = None, earth_margin_deg: MarginArg = None,
                                  dsn_mask_deg: MaskArg = None, vehicle_id: Optional[str] = None) -> str:
        """What happens after landing at one aim point: sunlight %, Earth visibility %, DSN geometric opportunity %,
        longest darkness, when the first darkness starts, the energy endurance estimate, and daily sunlight for each day
        of the mission window. Use for "what if I land on another date / at another point / with another vehicle".

        Args:
            site: Site id or name. Default: current site.
            aim: Aim point choice. Default: the current aim.
            aim_x_m: Custom aim, grid-east offset in metres from the site reference point.
            aim_y_m: Custom aim, grid-north offset in metres from the site reference point.
            landing_date: Landing date in 2027. Default: current landing date.
            window_days: Days after landing to analyse (1-180). Default: current mission window.
            earth_margin_deg: Earth visibility margin above the skyline, degrees. Default: current setting.
            dsn_mask_deg: DSN station elevation mask, 6 (downlink) or 10.1 (uplink). Default: current setting.
            vehicle_id: Vehicle scenario id or name. Default: current vehicle.
        """
        sid = ctx.site(site)
        wd = ctx.window(window_days)
        start = ctx.landing_idx(landing_date, wd)
        model, _ = ctx.model(None, None, None, None, None)
        ax, ay, aim_label = await ctx.aim(sid, aim, aim_x_m, aim_y_m, model, p.percentile)
        veh, veh_name = ctx.vehicle(vehicle_id)
        em = p.earthMarginDeg if earth_margin_deg is None else earth_margin_deg
        dm = p.dsnMaskDeg if dsn_mask_deg is None else dsn_mask_deg
        v = await run(A.visibility, sid, ax, ay, YEAR, start, wd * 24, em, dm, veh, None, p.mast)
        s = v["summary"]
        frac = v["sun_frac"]
        daily = [r(100 * sum(frac[i:i + 24]) / len(frac[i:i + 24]), 0) for i in range(0, len(frac), 24)]
        return json_result({
            "inputs": {"site": S.get(sid).name, "aim": f"{aim_label}, {fmt_offset(ax, ay)} of the site reference point",
                       "landing": idx_to_str(start), "window_days": v["hours"] // 24, "earth_margin_deg": em, "dsn_mask_deg": dm,
                       "vehicle": veh_name, "mast_m": p.mast},
            "sunlight_pct": r(s["sunlight_pct"]), "earth_visible_pct": r(s["earth_pct"]), "dsn_opportunity_pct": r(s["dsn_pct"]),
            "longest_darkness_h": s["longest_dark_h"],
            "first_darkness_starts_after_h": s["dark_starts_in_h"] if s["dark_starts_in_h"] is not None else "no darkness in the window",
            "energy_endurance_days": r(s["endurance_days"]) if s["endurance_days"] is not None else f"more than {v['hours'] // 24} (battery never depleted)",
            "daily_sunlight_pct": daily,
        })

    @beta_async_tool(eager_input_streaming=True)
    async def get_landing_risk(site: SiteArg = None, aim: AimArg = None, aim_x_m: OffsetArg = None, aim_y_m: OffsetArg = None,
                               uncertainty_model: ModelArg = None, radius_m: RadiusArg = None, sigma_east_m: SigmaArg = None,
                               sigma_north_m: SigmaArg = None, rotation_deg: RotArg = None, percentile: PercentileArg = None,
                               period: PeriodArg = None, landing_date: DateArg = None, window_days: WindowArg = None) -> str:
        """Landing-position risk at one aim: sunlight exactly at the aim (nominal) and across 2,000 simulated touchdowns
        (P50, P20, P10, P05), plus Earth visibility at the chosen percentile. Use for "how much light do I lose if I miss",
        or "what if my landing accuracy is +/-400 m".

        Args:
            site: Site id or name. Default: current site.
            aim: Aim point choice. Default: the current aim.
            aim_x_m: Custom aim, grid-east offset in metres from the site reference point.
            aim_y_m: Custom aim, grid-north offset in metres from the site reference point.
            uncertainty_model: circular or gaussian. Default: current model.
            radius_m: Circular landing radius, 25-400 m.
            sigma_east_m: Gaussian sigma east, 10-200 m.
            sigma_north_m: Gaussian sigma north, 10-200 m.
            rotation_deg: Gaussian ellipse rotation, 0-180 degrees.
            percentile: Robustness level 50, 20, 10 or 5. Default: current level.
            period: "year" = all of 2027, as in the mission card (default); "mission_window" = the days after landing.
            landing_date: Start of the mission window when period is mission_window.
            window_days: Length of the mission window when period is mission_window.
        """
        sid = ctx.site(site)
        q = percentile or p.percentile
        model, mdesc = ctx.model(uncertainty_model, radius_m, sigma_east_m, sigma_north_m, rotation_deg)
        start = hours = None
        if period == "mission_window":
            wd = ctx.window(window_days)
            start, hours = ctx.landing_idx(landing_date, wd), wd * 24
        ax, ay, aim_label = await ctx.aim(sid, aim, aim_x_m, aim_y_m, model, q)
        rk = await run(A.risk, sid, (ax, ay), model, q, YEAR, earth_margin=p.earthMarginDeg, dsn_mask=p.dsnMaskDeg, start=start, hours=hours)
        return json_result({
            "inputs": {"site": S.get(sid).name, "aim": f"{aim_label}, {fmt_offset(ax, ay)} of the site reference point",
                       "landing_uncertainty": mdesc, "robustness_level": plabel(q),
                       "period": "all of 2027" if start is None else f"{hours // 24} days from {idx_to_str(start)}"},
            "nominal_sunlight_pct": r(rk["nominal"]),
            "sunlight_pct_by_percentile": {plabel(k): r(v) for k, v in sorted(rk["p"].items(), reverse=True)},
            "loss_if_you_miss_pp": r(rk["nominal"] - rk["pq"]),
            "mean_sunlight_pct": r(rk["mean"]),
            f"earth_visible_pct_{plabel(q)}": r(rk.get("earth_pq")),
            "touchdowns_on_grid": rk["n"], "share_of_zone_on_grid": r(rk["inside_fraction"], 3),
        })

    @beta_async_tool(eager_input_streaming=True)
    async def find_robust_aim(site: SiteArg = None, uncertainty_model: ModelArg = None, radius_m: RadiusArg = None,
                              sigma_east_m: SigmaArg = None, sigma_north_m: SigmaArg = None, rotation_deg: RotArg = None,
                              percentile: PercentileArg = None, period: PeriodArg = None, landing_date: DateArg = None,
                              window_days: WindowArg = None,
                              max_slope_deg: Annotated[Optional[float], Field(ge=1, le=45)] = None) -> str:
        """Search every candidate aim at a site and compare the brightest point (best nominal sunlight) with the robust aim
        (best sunlight at the chosen percentile across simulated touchdowns). Same search as the app's Find robust aim.

        Args:
            site: Site id or name. Default: current site.
            uncertainty_model: circular or gaussian. Default: current model.
            radius_m: Circular landing radius, 25-400 m.
            sigma_east_m: Gaussian sigma east, 10-200 m.
            sigma_north_m: Gaussian sigma north, 10-200 m.
            rotation_deg: Gaussian ellipse rotation, 0-180 degrees.
            percentile: Robustness level 50, 20, 10 or 5. Default: current level.
            period: "year" = all of 2027 (default, as in the app); "mission_window" = the days after landing.
            landing_date: Start of the mission window when period is mission_window.
            window_days: Length of the mission window when period is mission_window.
            max_slope_deg: Optional: only aims whose PGDA 78 slope is at most this (a user assumption).
        """
        sid = ctx.site(site)
        q = percentile or p.percentile
        model, mdesc = ctx.model(uncertainty_model, radius_m, sigma_east_m, sigma_north_m, rotation_deg)
        start = hours = None
        if period == "mission_window":
            wd = ctx.window(window_days)
            start, hours = ctx.landing_idx(landing_date, wd), wd * 24
        ra = await run(A.robust, sid, model, q, YEAR, earth_margin=p.earthMarginDeg, dsn_mask=p.dsnMaskDeg, start=start, hours=hours,
                       slope_max=max_slope_deg)
        b, rb = ra["best_nominal"], ra["robust"]
        return json_result({
            "inputs": {"site": S.get(sid).name, "landing_uncertainty": mdesc, "robustness_level": plabel(q),
                       "period": "all of 2027" if start is None else f"{hours // 24} days from {idx_to_str(start)}",
                       "max_slope_deg": max_slope_deg},
            "brightest_point": {"position": fmt_offset(b["x"], b["y"]) + " of the site reference point", "nominal_sunlight_pct": r(b["value"]),
                                f"{plabel(q)}_sunlight_pct": r(b["pq"])},
            "robust_aim": {"position": fmt_offset(rb["x"], rb["y"]) + " of the site reference point",
                           "offset_from_brightest": fmt_offset(rb["x"] - b["x"], rb["y"] - b["y"]),
                           "nominal_sunlight_pct": r(rb["value"]), f"{plabel(q)}_sunlight_pct": r(rb["pq"])},
            f"{plabel(q)}_gain_pp": r(rb["pq"] - b["pq"]), "nominal_cost_pp": r(b["value"] - rb["value"]),
            "candidate_aims_searched": ra["candidates"],
        })

    @beta_async_tool(eager_input_streaming=True)
    async def compare_sites(sites: Annotated[Optional[list[str]], Field(max_length=5)] = None, landing_date: DateArg = None,
                            window_days: WindowArg = None, uncertainty_model: ModelArg = None, radius_m: RadiusArg = None,
                            sigma_east_m: SigmaArg = None, sigma_north_m: SigmaArg = None, rotation_deg: RotArg = None,
                            percentile: PercentileArg = None) -> str:
        """Rank sites for one mission: each site is scored at its own robust aim over the same window after the landing
        date (same method as the app's Compare page). Returns P50/P20/P10/P05 sunlight, longest darkness, Earth and DSN %,
        and each site's best landing day in 2027.

        Args:
            sites: Two to five site ids or names. Default: all five sites.
            landing_date: Landing date in 2027. Default: current landing date.
            window_days: Days after landing (1-180). Default: current mission window.
            uncertainty_model: circular or gaussian. Default: current model.
            radius_m: Circular landing radius, 25-400 m.
            sigma_east_m: Gaussian sigma east, 10-200 m.
            sigma_north_m: Gaussian sigma north, 10-200 m.
            rotation_deg: Gaussian ellipse rotation, 0-180 degrees.
            percentile: Robustness level used for the robust aims and the ranking. Default: current level.
        """
        ids = list(dict.fromkeys(ctx.site(s) for s in sites)) if sites else list(S.SITES)
        if len(ids) < 2:
            raise ToolError("Give at least two different sites to compare.")
        q = percentile or p.percentile
        wd = ctx.window(window_days)
        start = ctx.landing_idx(landing_date, wd)
        model, mdesc = ctx.model(uncertainty_model, radius_m, sigma_east_m, sigma_north_m, rotation_deg)
        veh, veh_name = ctx.vehicle(None)
        c = await run(A.compare, ids, model, q, YEAR, start, wd, veh, earth_margin=p.earthMarginDeg, dsn_mask=p.dsnMaskDeg)
        rows = [{"site": x["name"], "rank": c["ranking"].index(x["site"]) + 1,
                 "brightest_point_nominal_pct": r(x["brightest"]), "robust_aim_offset": fmt_offset(x["robustAt"]["x"], x["robustAt"]["y"]),
                 "P50_pct": r(x["p50"]), "P20_pct": r(x["p20"]), "P10_pct": r(x["p10"]), "P05_pct": r(x["p05"]),
                 "window_sunlight_pct": r(x["windowSunPct"]), "longest_darkness_h": x["longestDarkH"],
                 "earth_visible_pct": r(x["earthPct"]), "dsn_opportunity_pct": r(x["dsnPct"]),
                 "best_landing_day": idx_to_str(x["bestLandingIdx"]).split(",")[0], "best_landing_day_window_sunlight_pct": r(x["bestLandingSunPct"])}
                for x in c["rows"]]
        rows.sort(key=lambda x: x["rank"])
        return json_result({"inputs": {"landing": idx_to_str(start), "window_days": c["window"]["hours"] // 24, "landing_uncertainty": mdesc,
                                       "robustness_level": plabel(q), "vehicle": veh_name},
                            "ranked_by": c["rankedBy"], "sites": rows})

    @beta_async_tool(eager_input_streaming=True)
    async def find_best_landing_dates(site: SiteArg = None, aim: AimArg = None, aim_x_m: OffsetArg = None, aim_y_m: OffsetArg = None,
                                      window_days: WindowArg = None, vehicle_id: Optional[str] = None,
                                      count: Annotated[int, Field(ge=1, le=10)] = 5) -> str:
        """Scan every landing day of 2027 at one aim: the days whose mission window gets the most sunlight, each with
        the energy endurance estimate for the vehicle, and how the current landing date compares.

        Args:
            site: Site id or name. Default: current site.
            aim: Aim point choice. Default: the current aim.
            aim_x_m: Custom aim, grid-east offset in metres from the site reference point.
            aim_y_m: Custom aim, grid-north offset in metres from the site reference point.
            window_days: Days after landing to score (1-180). Default: current mission window.
            vehicle_id: Vehicle scenario id or name. Default: current vehicle.
            count: How many top dates to return (1-10). Dates are at least 5 days apart; equally sunny dates are ranked by
                battery endurance.
        """
        sid = ctx.site(site)
        wd = ctx.window(window_days)
        model, _ = ctx.model(None, None, None, None, None)
        ax, ay, aim_label = await ctx.aim(sid, aim, aim_x_m, aim_y_m, model, p.percentile)
        veh, veh_name = ctx.vehicle(vehicle_id)
        v = await run(A.visibility, sid, ax, ay, YEAR, 0, 24, p.earthMarginDeg, p.dsnMaskDeg, veh, None, p.mast)
        daily = v["daily_sun_pct"]
        n_days = len(daily) - wd + 1
        if n_days < 1:
            raise ToolError("The window is longer than the year.")
        score = [sum(daily[d:d + wd]) / wd for d in range(n_days)]
        endu = await run(A.endurance_by_landing_day, sid, ax, ay, YEAR, wd, veh, 1, p.mast)
        e_by_day = dict(zip(endu["days"], endu["endurance_days"]))
        # equally sunny windows are common in summer: prefer the one where the battery lasts longer
        endu_key = lambda d: float("inf") if e_by_day.get(d) is None else e_by_day[d]  # noqa: E731
        order = sorted(range(n_days), key=lambda d: (-round(score[d], 1), -endu_key(d), d))
        top = round(score[order[0]], 1)
        picked: list[int] = []
        for d in order:
            if all(abs(d - k) >= 5 for k in picked):
                picked.append(d)
            if len(picked) == count:
                break
        cur_day = min(p.landingIdx // 24, n_days - 1)
        rank = 1 + sum(1 for s in score if s > score[cur_day])
        ed = lambda d: r(e_by_day.get(d)) if e_by_day.get(d) is not None else f"more than {wd} (not depleted)"  # noqa: E731
        return json_result({
            "inputs": {"site": S.get(sid).name, "aim": f"{aim_label}, {fmt_offset(ax, ay)} of the site reference point",
                       "window_days": wd, "vehicle": veh_name, "note": "landing at the start of each day; heading: aft panel toward the Sun"},
            "best_dates": [{"date": idx_to_str(d * 24).split(",")[0], "window_sunlight_pct": r(score[d]), "energy_endurance_days": ed(d)} for d in picked],
            "days_with_the_top_sunlight": sum(1 for d in range(n_days) if round(score[d], 1) == top),
            "ranking_rule": "highest window sunlight; ties broken by longer battery endurance",
            "current_landing_date": {"date": idx_to_str(cur_day * 24).split(",")[0], "window_sunlight_pct": r(score[cur_day]),
                                     "energy_endurance_days": ed(cur_day), "rank_among_days": f"{rank} of {n_days}"},
        })

    @beta_async_tool(eager_input_streaming=True)
    async def propose_app_changes(
        summary: Annotated[str, Field(min_length=3, max_length=160, description="One short sentence the person sees as the card title, e.g. 'Switch to Shackleton rim with a ±400 m landing zone'.")],
        section: Optional[Literal["globe", "planner", "simple", "compare", "science", "report", "about"]] = None,
        planner_view: Optional[Literal["map", "sky"]] = None,
        site: SiteArg = None,
        landing_date: DateArg = None,
        window_days: Optional[Literal[14, 30, 90]] = None,
        landing_uncertainty_on: Optional[bool] = None,
        uncertainty_model: ModelArg = None,
        radius_m: RadiusArg = None,
        sigma_east_m: SigmaArg = None,
        sigma_north_m: SigmaArg = None,
        rotation_deg: RotArg = None,
        percentile: PercentileArg = None,
        aim: Optional[Literal["brightest", "robust", "custom"]] = None,
        aim_x_m: OffsetArg = None,
        aim_y_m: OffsetArg = None,
        run_robust_aim: Optional[bool] = None,
        earth_margin_deg: MarginArg = None,
        dsn_mask_deg: MaskArg = None,
        vehicle_id: Optional[str] = None,
        compare_sites: Annotated[Optional[list[str]], Field(max_length=5)] = None,
        open_dialog: Optional[Literal["export", "data", "vehicle"]] = None,
    ) -> str:
        """Propose changes to the person's app settings or view. The app shows them as a card with Apply and Dismiss
        buttons; nothing changes until the person clicks Apply. Use when the person asks you to set something up, go
        somewhere, or after they accept your suggestion. Group what belongs together into one proposal; give only the
        fields that change.

        Args:
            summary: Card title: one short sentence describing the change.
            section: Go to a section: globe (01 Explore), planner (02 Mission), simple (03 Briefing), compare (04 Compare), science, report, about.
            planner_view: In Mission, show the landing map or the skyline (sky).
            site: Switch site (id or name). Switching resets the aim to that site's brightest point.
            landing_date: New landing date in 2027 (YYYY-MM-DD or YYYY-MM-DDTHH).
            window_days: Mission window after landing: 14, 30 or 90 days (the app offers only these).
            landing_uncertainty_on: Turn the landing-uncertainty model on or off (changing any of its values turns it on).
            uncertainty_model: circular or gaussian.
            radius_m: Circular landing radius, 25-400 m (the app's slider moves in 25 m steps).
            sigma_east_m: Gaussian sigma east, 10-200 m.
            sigma_north_m: Gaussian sigma north, 10-200 m.
            rotation_deg: Gaussian ellipse rotation, 0-180 degrees.
            percentile: Robustness level 50, 20, 10 or 5.
            aim: Command an aim: brightest point, robust aim (runs the search first), or custom (needs aim_x_m and aim_y_m).
            aim_x_m: Custom aim, grid-east offset in metres from the site reference point.
            aim_y_m: Custom aim, grid-north offset in metres from the site reference point.
            run_robust_aim: Run Find robust aim (shows brightest vs robust in the mission card without moving the aim).
            earth_margin_deg: Earth visibility margin, 0-5 degrees in 0.5 steps.
            dsn_mask_deg: DSN elevation mask: 6 (downlink) or 10.1 (uplink).
            vehicle_id: Vehicle scenario id or name.
            compare_sites: Sites to show on the Compare page (2-5).
            open_dialog: Open a dialog: export (decision summary), data (provenance) or vehicle (edit power scenario).
        """
        if proposals is None:
            raise ToolError("Proposals are not available in this session.")
        ch: dict = {}
        lines: list[str] = []
        sid = ctx.site(site) if site else None
        if section:
            ch["mode"] = section
            lines.append(f"Go to {SECTION_NAMES[section]}")
        if planner_view:
            ch["view"] = planner_view
            lines.append(f"Show the {'skyline' if planner_view == 'sky' else 'landing map'}")
        if sid and sid != p.site:
            ch["site"] = sid
            lines.append(f"Site: {S.get(p.site).name} → {S.get(sid).name} (aim resets to its brightest point)")
        wd = window_days or (p.windowDays if p.windowDays in (14, 30, 90) else 30)
        if window_days and window_days != p.windowDays:
            ch["windowDays"] = window_days
            lines.append(f"Mission window: {p.windowDays} → {window_days} days")
        if landing_date:
            idx = ctx.landing_idx(landing_date, wd)
            if idx != p.landingIdx:
                ch["landingIdx"] = idx
                lines.append(f"Landing date: {idx_to_str(p.landingIdx)} → {idx_to_str(idx)}")
        unc_fields = (uncertainty_model, radius_m, sigma_east_m, sigma_north_m, rotation_deg)
        if landing_uncertainty_on is not None or any(v is not None for v in unc_fields):
            on = landing_uncertainty_on if landing_uncertainty_on is not None else True
            u: dict = {"enabled": on}
            if any(v is not None for v in unc_fields):
                _, desc = ctx.model(*unc_fields)
                kind = "circular" if desc["model"] == "circular" else "gaussian"
                u["model"] = kind
                if kind == "circular":
                    u["radius"] = min(400, max(25, round(desc["radius_m"] / 25) * 25))
                    lines.append(f"Landing uncertainty: circular ±{u['radius']:g} m")
                else:
                    u.update(sigmaE=desc["sigma_east_m"], sigmaN=desc["sigma_north_m"], rotDeg=desc["rotation_deg"])
                    lines.append(f"Landing uncertainty: Gaussian σ {u['sigmaE']:g} × {u['sigmaN']:g} m, rotated {u['rotDeg']:g}°")
            elif not on:
                lines.append("Landing uncertainty: off")
            else:
                lines.append("Landing uncertainty: on")
            ch["uncertainty"] = u
        if percentile and percentile != p.percentile:
            ch["percentile"] = percentile
            lines.append(f"Robustness level: {plabel(p.percentile)} → {plabel(percentile)}")
        if aim or aim_x_m is not None or aim_y_m is not None:
            kind = aim or "custom"
            if kind == "custom":
                if aim_x_m is None or aim_y_m is None:
                    raise ToolError("A custom aim needs both aim_x_m and aim_y_m.")
                ch["aim"] = {"kind": "custom", "x": float(aim_x_m), "y": float(aim_y_m)}
                lines.append(f"Aim: custom point {fmt_offset(aim_x_m, aim_y_m)} of the site reference point")
            else:
                ch["aim"] = {"kind": kind}
                lines.append("Aim: brightest point" if kind == "brightest" else "Run Find robust aim, then command the robust aim")
        if run_robust_aim and ch.get("aim", {}).get("kind") != "robust":
            ch["runRobustAim"] = True
            lines.append("Run Find robust aim")
        if earth_margin_deg is not None:
            em = min(5.0, round(earth_margin_deg * 2) / 2)
            if em != p.earthMarginDeg:
                ch["earthMarginDeg"] = em
                lines.append(f"Earth visibility margin: {p.earthMarginDeg:g}° → {em:g}°")
        if dsn_mask_deg is not None:
            dm = 6 if abs(dsn_mask_deg - 6) < abs(dsn_mask_deg - 10.1) else 10.1
            if dm != p.dsnMaskDeg:
                ch["dsnMaskDeg"] = dm
                lines.append(f"DSN elevation mask: {p.dsnMaskDeg:g}° → {dm:g}°")
        if vehicle_id:
            _, vname = ctx.vehicle(vehicle_id)
            vid = next(v.id for v in p.vehicles if v.id == vehicle_id or v.name.lower() == vehicle_id.lower())
            if vid != p.vehicleId:
                ch["vehicleId"] = vid
                lines.append(f"Vehicle: {vname}")
        if compare_sites:
            ids = list(dict.fromkeys(ctx.site(s) for s in compare_sites))
            if len(ids) < 2:
                raise ToolError("Compare needs at least two different sites.")
            ch["compareIds"] = ids
            lines.append("Compare: " + ", ".join(S.get(i).name for i in ids))
        if open_dialog:
            ch["dialog"] = open_dialog
            lines.append(f"Open: {DIALOG_NAMES[open_dialog]}")
        if not ch:
            raise ToolError("Nothing would change: every value given is already the current setting.")
        proposal = {"id": f"p{len(proposals) + 1}", "summary": summary.strip(), "lines": lines, "changes": ch}
        proposals.append(proposal)
        return json_result({"status": "shown to the person as a card with Apply / Dismiss; NOT applied yet",
                            "card": {"title": proposal["summary"], "changes": lines}})

    tools = [get_site_info, get_mission_outlook, get_landing_risk, find_robust_aim, compare_sites, find_best_landing_dates]
    return ([propose_app_changes] + tools) if proposals is not None else tools
