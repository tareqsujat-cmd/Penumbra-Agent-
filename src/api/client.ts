/** Penumbra API client (FastAPI backend, same origin; Vite proxies /api in development). Implements `PenumbraApi`.
 *  Every number the UI shows comes from these calls; there is no client-side fallback science (Instructions §37). */
import type {
  CompareResult,
  LandingRiskRequest,
  LandingRiskResult,
  PenumbraApi,
  Percentile,
  ProvenanceData,
  RobustAimResult,
  SiteData,
  SiteId,
  SiteSummary,
  UncertaintyModel,
  ValidationData,
  Vehicle,
  VisibilityRequest,
  VisibilitySeries,
} from "../types";

export class ApiError extends Error {
  constructor(public code: string, message: string, public detail: Record<string, unknown> = {}) {
    super(message);
  }
}

async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("BACKEND_UNREACHABLE", "The Penumbra backend is not reachable. Start it with: python tasks.py dev");
  }
  const json = await r.json().catch(() => null);
  if (!r.ok) {
    const err = json?.error;
    throw new ApiError(err?.code ?? `HTTP_${r.status}`, err?.message ?? r.statusText, err?.detail ?? {});
  }
  return json as T;
}

// ---------------------------------------------------------------------------------------------- sites
const SITES = new Map<SiteId, SiteData>();
const pending = new Map<SiteId, Promise<SiteData>>();

export function loadSite(id: SiteId): Promise<SiteData> {
  const hit = SITES.get(id);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(id);
  if (!p) {
    p = request<SiteData>(`/api/sites/${id}`).then((s) => {
      SITES.set(id, s);
      pending.delete(id);
      return s;
    });
    p.catch(() => pending.delete(id));
    pending.set(id, p);
  }
  return p;
}

/** A site bundle that has already been loaded (the app loads before rendering a site). */
export function siteSync(id: SiteId): SiteData {
  const s = SITES.get(id);
  if (!s) throw new ApiError("DATASET_MISSING", `site "${id}" has not been loaded yet`);
  return s;
}

export function siteLoaded(id: SiteId): boolean {
  return SITES.has(id);
}

export interface RegionGrid {
  px: number;
  res: number;
  x0: number;
  y0: number;
  hmin: number;
  hmax: number;
  height_png: string;
  source: string;
}
let REGION: Promise<RegionGrid> | null = null;

/** LOLA LDEM_75S_240M sampled every 960 m over the +-200 km planner region (terrain for the 3-D view). */
export function loadRegion(): Promise<RegionGrid> {
  if (!REGION) {
    REGION = request<RegionGrid>("/api/region");
    REGION.catch(() => (REGION = null));
  }
  return REGION;
}

let SITE_LIST: SiteSummary[] = [];

/** The site registry (names, centres), loaded once at start-up. */
export async function loadSiteList(): Promise<SiteSummary[]> {
  if (!SITE_LIST.length) SITE_LIST = await request<SiteSummary[]>("/api/sites");
  return SITE_LIST;
}

export function siteListSync(): SiteSummary[] {
  return SITE_LIST;
}

// ---------------------------------------------------------------------------------------------- mapping
const model = (m: UncertaintyModel) =>
  m.kind === "circular" ? { kind: "circular", radius: m.radius } : { kind: "gaussian", sigmaE: m.sigmaE, sigmaN: m.sigmaN, rotDeg: m.rotDeg, conf: m.conf };

const vehicle = (v: Vehicle) => ({ panels: v.panels, batteryWh: v.batteryWh, baseLoadW: v.baseLoadW, hibernateW: v.hibernateW, reservePct: v.reservePct });

interface RiskJson {
  nominal: number;
  p: Record<string, number>;
  pq: number;
  mean: number;
  histogram: number[];
  samples: { x: number; y: number; v: number }[];
  n: number;
  earth_p?: Record<string, number>;
  earth_pq?: number;
  elapsed_ms: number;
}

const pmap = (p: Record<string, number>) => ({ 50: p["50"], 20: p["20"], 10: p["10"], 5: p["5"] }) as Record<Percentile, number>;

interface VisJson {
  start_idx: number;
  hours: number;
  sun_frac: number[];
  terrain_blocked: number[];
  earth: number[];
  dsn: number[];
  station: { goldstone: number[]; madrid: number[]; canberra: number[] };
  soc: number[];
  hibernating: number[];
  depleted_at: number | null;
  heading_deg: number;
  summary: { sunlight_pct: number; earth_pct: number; dsn_pct: number; longest_dark_h: number; dark_starts_in_h: number | null; endurance_days: number | null };
  skyline_deg: number[];
  daily_sun_pct: number[];
  elapsed_ms: number;
}

// ---------------------------------------------------------------------------------------------- API
export const api: PenumbraApi = {
  getSites: () => request<SiteSummary[]>("/api/sites"),
  getSite: (id) => loadSite(id),

  async landingRisk(req: LandingRiskRequest, signal?: AbortSignal): Promise<LandingRiskResult> {
    const j = await request<RiskJson>(
      "/api/landing-risk",
      { site: req.site, aim: req.aim, model: model(req.model), percentile: req.percentile, seed: req.seed },
      signal,
    );
    const p = pmap(j.p);
    return {
      nominal: j.nominal,
      pq: j.pq,
      p,
      earthPq: j.earth_pq ?? NaN,
      samples: j.samples,
      histogram: j.histogram,
      nGridPoints: j.n,
      elapsedMs: j.elapsed_ms,
    };
  },

  async robustAim(req: LandingRiskRequest & { searchRadius?: number }, signal?: AbortSignal): Promise<RobustAimResult> {
    const j = await request<{
      best_nominal: RobustAimResult["bestNominal"];
      robust: RobustAimResult["robust"];
      score: (number | null)[][];
      candidates: number;
      elapsed_ms: number;
    }>(
      "/api/robust-aim",
      { site: req.site, aim: req.aim, model: model(req.model), percentile: req.percentile, seed: req.seed, searchRadius: req.searchRadius ?? 450 },
      signal,
    );
    return { bestNominal: j.best_nominal, robust: j.robust, score: j.score.map((r) => r.map((v) => (v === null ? NaN : v))), candidates: j.candidates, elapsedMs: j.elapsed_ms };
  },

  async visibility(req: VisibilityRequest, signal?: AbortSignal): Promise<VisibilitySeries> {
    const j = await request<VisJson>(
      "/api/visibility",
      {
        site: req.site,
        aim: req.aim,
        startIdx: req.startIdx,
        hours: req.hours,
        earthMarginDeg: req.earthMarginDeg,
        dsnMaskDeg: req.dsnMaskDeg,
        vehicle: vehicle(req.vehicle),
        headingDeg: req.headingDeg,
        autoHeading: req.autoHeading ?? true,
        mast: req.mast ?? 2,
      },
      signal,
    );
    return {
      startIdx: j.start_idx,
      hours: j.hours,
      sunFrac: Float32Array.from(j.sun_frac),
      terrainBlocked: Uint8Array.from(j.terrain_blocked),
      earth: Uint8Array.from(j.earth),
      dsn: Uint8Array.from(j.dsn),
      station: { goldstone: Uint8Array.from(j.station.goldstone), madrid: Uint8Array.from(j.station.madrid), canberra: Uint8Array.from(j.station.canberra) },
      soc: Float32Array.from(j.soc),
      hibernating: Uint8Array.from(j.hibernating),
      depletedAt: j.depleted_at,
      headingDeg: j.heading_deg,
      skyline: j.skyline_deg,
      dailySun: Float32Array.from(j.daily_sun_pct),
      summary: {
        sunlightPct: j.summary.sunlight_pct,
        earthPct: j.summary.earth_pct,
        dsnPct: j.summary.dsn_pct,
        longestDarkH: j.summary.longest_dark_h,
        darkStartsInH: j.summary.dark_starts_in_h,
        enduranceDays: j.summary.endurance_days,
      },
      elapsedMs: j.elapsed_ms,
    };
  },

  compare: (sites, req, vis, signal) =>
    request<CompareResult>(
      "/api/compare",
      {
        sites,
        model: model(req.model),
        percentile: req.percentile,
        startIdx: vis.startIdx,
        windowDays: Math.max(1, Math.round(vis.hours / 24)),
        earthMarginDeg: vis.earthMarginDeg,
        dsnMaskDeg: vis.dsnMaskDeg,
        vehicle: vehicle(vis.vehicle),
      },
      signal,
    ),

  validation: () => request<ValidationData>("/api/validation"),
  provenance: () => request<ProvenanceData>("/api/provenance"),
};

export const horizonAt = (site: SiteId, x: number, y: number, mast = 2) =>
  request<{ azimuth_deg: number[]; horizon_elevation_deg: number[]; lat: number; lon: number }>(`/api/sites/${site}/horizon?x=${x}&y=${y}&mast=${mast}`);

/** Energy endurance estimate for every landing day of the year (fixed heading: aft panel toward the Sun at landing). */
export const enduranceByDay = (site: SiteId, aim: { x: number; y: number }, vehicleIn: Vehicle, windowDays = 90, stepDays = 1) =>
  request<{ days: number[]; endurance_days: (number | null)[]; window_days: number; elapsed_ms: number }>("/api/endurance", {
    site,
    aim,
    windowDays,
    stepDays,
    vehicle: vehicle(vehicleIn),
  });
