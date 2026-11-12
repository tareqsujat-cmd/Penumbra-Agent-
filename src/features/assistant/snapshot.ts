/** What the assistant sees: a compact, human-readable snapshot of the screen when a question is sent.
 *  Every number comes from the store or from backend results already on screen (no client-side science). */
import type { AppState } from "../../state/store";
import type { LandingRiskResult, SiteData, VisibilitySeries } from "../../types";
import { SECTIONS } from "../../app/Header";
import { fmtDate, fmtOffset } from "../../utils/format";
import { offsetToLatLon } from "../../utils/field";

/** Latest mission-card numbers, written by <LiveMetrics> while Mission or Briefing is on screen. */
export interface LiveMetrics {
  risk: (LandingRiskResult & { loading: boolean }) | null;
  /** early72: mean sunlight (%) over the first 72 h after landing, as on the Briefing page */
  vis: { summary: VisibilitySeries["summary"]; loading: boolean; early72?: number } | null;
}

const live: LiveMetrics = { risk: null, vis: null };

export function setLiveMetrics(m: LiveMetrics) {
  live.risk = m.risk;
  live.vis = m.vis;
}

export function clearLiveMetrics() {
  live.risk = null;
  live.vis = null;
}

export function getLiveMetrics(): LiveMetrics {
  return live;
}

/** Machine-readable settings for the backend's analysis tools (backend/app/assistant/tools.py MissionParams). */
export function buildParams(s: AppState): Record<string, unknown> {
  const u = s.uncertainty;
  return {
    site: s.siteId,
    aim: { x: s.aim.x, y: s.aim.y },
    aimKind: s.aimKind,
    landingIdx: s.landingIdx,
    windowDays: s.windowDays,
    model: { kind: u.model === "circular" ? "circular" : "gaussian", radius: u.radius, sigmaE: u.sigmaE, sigmaN: u.sigmaN, rotDeg: u.rotDeg, conf: u.conf },
    percentile: s.percentile,
    earthMarginDeg: s.earthMarginDeg,
    dsnMaskDeg: s.dsnMaskDeg,
    mast: s.mastM,
    vehicleId: s.vehicleId,
    vehicles: s.vehicles.map((v) => ({ id: v.id, name: v.name, basis: v.basis, panels: v.panels, batteryWh: v.batteryWh, baseLoadW: v.baseLoadW, hibernateW: v.hibernateW, reservePct: v.reservePct })),
  };
}

const AIM_KIND = { brightest: "brightest point", robust: "robust aim", custom: "custom point", nominal: "site reference point" } as const;

/** Round to `d` decimals; NaN / Infinity become undefined so they drop out of the JSON. */
function r(v: number | null | undefined, d = 1): number | undefined {
  return v == null || !Number.isFinite(v) ? undefined : Math.round(v * 10 ** d) / 10 ** d;
}

export function buildSnapshot(s: AppState, site: SiteData | null, m: LiveMetrics = live): Record<string, unknown> {
  const section = SECTIONS.find((x) => x.mode === s.mode);
  const out: Record<string, unknown> = {
    screen: section ? `${section.n} ${section.label}` : s.mode,
  };
  if (s.mode === "planner") out.plannerView = s.view === "sky" ? `Skyline (${s.skyMode === "dome" ? "3-D sky dome" : "2-D panorama"})` : `Landing map (${s.mapMode === "3d" ? "3-D terrain" : "2-D plan"})`;
  if (s.dialog) out.openDialog = { data: "Data and provenance", export: "Export decision summary", vehicle: "Power scenario" }[s.dialog];
  if (s.mode === "globe" && !s.globeSite) {
    out.note = "Explore globe; no south-pole site is selected yet.";
    return out;
  }

  if (site) {
    const [lat, lon] = offsetToLatLon(site, s.aim);
    out.site = { id: site.id, name: site.name, note: site.note };
    out.aim = { kind: AIM_KIND[s.aimKind], position: fmtOffset(s.aim.x, s.aim.y), lat: r(lat, 4), lonEast: r(lon, 3) };
  }
  out.landingDate = fmtDate(s.landingIdx);
  out.missionWindowDays = s.windowDays;
  const u = s.uncertainty;
  out.landingUncertainty = !u.enabled
    ? "off"
    : u.model === "circular"
      ? { model: "circular", radiusM: u.radius }
      : { model: "elliptical Gaussian", sigmaEastM: u.sigmaE, sigmaNorthM: u.sigmaN, rotationDeg: u.rotDeg, confidenceEllipsePct: Math.round(u.conf * 100) };
  out.robustnessLevel = `P${s.percentile}`;
  const v = s.vehicles.find((x) => x.id === s.vehicleId) ?? s.vehicles[0];
  out.settings = {
    mastM: s.mastM,
    earthMarginDeg: s.earthMarginDeg,
    dsnMaskDeg: s.dsnMaskDeg,
    vehicle: v ? `${v.name} (${v.basis === "verified" ? "sourced preset" : "assumption-based"})` : undefined,
  };
  if (s.mode === "planner") {
    out.missionSequenceDone = {
      uncertainty: u.enabled,
      robustAim: s.robust.status === "done",
      skyline: s.progress.sky || s.view === "sky",
      compare: s.progress.compare,
      export: s.progress.export,
    };
  }
  if (s.mode === "compare") out.sitesBeingCompared = s.compareIds;

  const results: Record<string, unknown> = {};
  if (m.risk) {
    if (m.risk.loading) results.landingRisk = "computing";
    else {
      results.nominalSunlightPct2027 = r(m.risk.nominal);
      if (u.enabled) {
        results[`worstLikelySunlightPct_P${s.percentile}`] = r(m.risk.pq);
        results.percentilesSunlightPct = { P50: r(m.risk.p[50]), P20: r(m.risk.p[20]), P10: r(m.risk.p[10]), P05: r(m.risk.p[5]) };
        if (m.risk.nGridPoints) results.simulatedTouchdowns = m.risk.nGridPoints;
      }
    }
  }
  const rb = s.robust;
  if (rb.status === "running") results.robustAimSearch = "running";
  else if (rb.status === "done" && rb.result) {
    const x = rb.result;
    results.robustAimSearch = {
      level: `P${s.percentile}`,
      brightestPoint: { nominalPct: r(x.bestNominal.value), worstLikelyPct: r(x.bestNominal.pq) },
      robustAim: { nominalPct: r(x.robust.value), worstLikelyPct: r(x.robust.pq), position: fmtOffset(x.robust.x - x.bestNominal.x, x.robust.y - x.bestNominal.y) + " of the brightest point" },
      candidatesSearched: x.candidates,
      commanded: s.aimKind === "robust",
    };
  }
  if (m.vis) {
    if (m.vis.loading && !Number.isFinite(m.vis.summary.sunlightPct)) results.missionWindow = "computing";
    else {
      const w = m.vis.summary;
      results.missionWindow = {
        days: s.windowDays,
        sunlightPct: r(w.sunlightPct),
        earthVisiblePct: r(w.earthPct),
        dsnOpportunityPct: r(w.dsnPct),
        longestDarknessH: r(w.longestDarkH, 0),
        firstDarknessStartsAfterH: w.darkStartsInH == null ? "no darkness in the window" : r(w.darkStartsInH, 0),
        energyEnduranceDays: w.enduranceDays == null ? `more than ${s.windowDays} (battery never depleted in the window)` : r(w.enduranceDays),
      };
    }
  }
  if (Object.keys(results).length) out.results = results;
  return out;
}
