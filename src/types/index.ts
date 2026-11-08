/** Data and API contracts shared with the FastAPI backend (backend/app). `src/api/client.ts` implements
 *  `PenumbraApi` (Instructions §35). */

export type Provenance = "verified" | "computed" | "assumption";
export type SiteId = "cr1" | "shk" | "mal" | "mou" | "nob";

export interface Field {
  kind: "computed";
  source: string;
  year?: number;
  earth_margin_deg?: number;
  dsn_mask_deg?: number;
  mast_m?: number;
  x0: number;
  y0: number;
  dx: number;
  nx: number;
  ny: number;
  /** rows ordered by ascending y (south→north in grid coordinates) */
  sun: number[][];
  earth: number[][];
  dsn?: number[][];
  dark_h?: number[][];
}

export interface SiteData {
  id: SiteId;
  name: string;
  short: string;
  lat: number;
  lon: number;
  tile: string;
  note: string;
  terrain: {
    half: number;
    px: number;
    res: number;
    hmin: number;
    hmax: number;
    height_png: string;
    slope_png: string;
    slope_max_deg: number;
    center_xy: [number, number];
    source?: string;
  };
  context: { half: number; px: number; res: number; hmin: number; hmax: number; height_png: string; center_offset: [number, number]; source: string };
  field: Field;
  ephem: { start: string; step_h: number; n: number; b64: string; source: string };
  skyline: { kind: "computed"; deg: number[]; at?: [number, number]; source: string };
  ephem_note: string;
  known_points?: { label: string; xy: [number, number]; source?: string }[];
  neighbours?: { id: SiteId; name: string; xy: [number, number] }[];
  pole_xy?: [number, number];
  centre_source?: string;
  has_clones?: boolean;
}

export interface SiteSummary {
  id: SiteId;
  name: string;
  short: string;
  lat: number;
  lon: number;
  tile: string;
  has_clones: boolean;
  field_kind: string;
  source: string;
}

export interface XY {
  x: number;
  y: number;
}

export type UncertaintyModel =
  | { kind: "circular"; radius: number }
  | { kind: "gaussian"; sigmaE: number; sigmaN: number; rotDeg: number; conf: number };

export type Percentile = 50 | 20 | 10 | 5;

export interface LandingRiskRequest {
  site: SiteId;
  aim: XY;
  model: UncertaintyModel;
  enabled: boolean;
  percentile: Percentile;
  seed: number;
}

export interface LandingRiskResult {
  nominal: number;
  pq: number;
  p: Record<Percentile, number>;
  earthPq: number;
  samples: { x: number; y: number; v: number }[];
  histogram: number[];
  nGridPoints: number;
  elapsedMs: number;
}

export interface RobustAimResult {
  bestNominal: XY & { value: number; pq: number };
  robust: XY & { value: number; pq: number };
  score: number[][];
  candidates: number;
  elapsedMs: number;
}

export interface Ephemeris {
  n: number;
  startMs: number;
  sunAz: Float32Array;
  sunEl: Float32Array;
  earthAz: Float32Array;
  earthEl: Float32Array;
}

export interface Vehicle {
  id: string;
  name: string;
  basis: "verified" | "assumption";
  panels: { azOffsetDeg: number; watts: number }[];
  batteryWh: number;
  baseLoadW: number;
  hibernateW: number;
  reservePct: number;
  notes: string;
  sources: { label: string; value: string; prov: Provenance }[];
}

export interface VisibilityRequest {
  site: SiteId;
  aim: XY;
  startIdx: number;
  hours: number;
  earthMarginDeg: number;
  dsnMaskDeg: number;
  vehicle: Vehicle;
  headingDeg: number;
  /** point the aft panel at the Sun at landing instead of using headingDeg */
  autoHeading?: boolean;
  mast?: number;
}

export interface VisibilitySeries {
  startIdx: number;
  hours: number;
  sunFrac: Float32Array;
  terrainBlocked: Uint8Array;
  earth: Uint8Array;
  dsn: Uint8Array;
  station: { goldstone: Uint8Array; madrid: Uint8Array; canberra: Uint8Array };
  soc: Float32Array;
  hibernating: Uint8Array;
  depletedAt: number | null;
  headingDeg: number;
  /** terrain skyline at the aim (720 x 0.5 deg bins), computed by the backend */
  skyline: number[];
  /** daily mean sunlight (%) at the aim for every day of the year */
  dailySun: Float32Array;
  elapsedMs: number;
  summary: {
    sunlightPct: number;
    earthPct: number;
    dsnPct: number;
    longestDarkH: number;
    darkStartsInH: number | null;
    enduranceDays: number | null;
  };
}

export interface CompareRow {
  site: SiteId;
  name: string;
  brightest: number;
  brightestPq: number;
  robustAt: XY;
  robustNominal: number;
  p50: number;
  p20: number;
  p10: number;
  p05: number;
  longestDarkH: number;
  earthPct: number;
  dsnPct: number;
  windowSunPct: number;
  bestLandingIdx: number;
  bestLandingSunPct: number;
  fieldKind: "computed";
}

export interface CompareResult {
  rows: CompareRow[];
  ranking: SiteId[];
  rankedBy: string;
  window: { startIdx: number; hours: number };
}

export interface ProvenanceGroup {
  id: string;
  title: string;
  source: string;
  page: string;
  frame: string;
  resolution: string;
  version: string;
  usage: string;
  files: number;
  bytes: number;
  sha_first: string;
  file_list?: { path: string; sha256: string; bytes: number }[];
}

export interface ProvenanceData {
  verified_utc: string;
  last_processed_utc: string | null;
  frame: string;
  kernels: string[];
  terrain_version: string;
  groups: ProvenanceGroup[];
}

interface ValidationCase {
  pass: boolean;
  method: string;
  source: string;
  seconds?: number;
}

export interface ValidationData {
  v1_pgda69: ValidationCase & {
    points: { name: string; x: number; y: number; terrain: string; ours_sun: number; pgda_sun: number; ours_earth: number; pgda_earth: number }[];
    mae_sun: number;
    mae_earth: number;
    tolerance_pp: number;
  };
  v2_glaser2018: ValidationCase & {
    points: {
      point: string;
      lat: number;
      lon: number;
      height_m: number;
      table: string;
      published: number;
      ours: number;
      diff: number;
      published_visibility: number;
      ours_visibility: number;
      pub_shadow_h: number;
      ours_shadow_h: number;
      within_tol: boolean;
      shadow_within_tol: boolean;
      terrain: string;
      ours_at_5m_surface: number | null;
    }[];
    n_within: number;
    n: number;
    tolerance_pp: number;
  };
  v4_spice_horizons: ValidationCase & {
    cases: { site: string; target: string; hours: number; max_arcsec: number; mean_arcsec: number; pass: boolean }[];
    tolerance_arcsec: number;
  };
  computed_utc: string;
  terrain_version: string;
  tests: null | { generated_utc: string; suites: { name: string; passed: number; total: number }[] };
}

export interface PenumbraApi {
  getSites(): Promise<SiteSummary[]>;
  getSite(id: SiteId): Promise<SiteData>;
  landingRisk(req: LandingRiskRequest, signal?: AbortSignal): Promise<LandingRiskResult>;
  robustAim(req: LandingRiskRequest & { searchRadius?: number }, signal?: AbortSignal): Promise<RobustAimResult>;
  visibility(req: VisibilityRequest, signal?: AbortSignal): Promise<VisibilitySeries>;
  compare(
    sites: SiteId[],
    req: Omit<LandingRiskRequest, "site" | "aim">,
    vis: Omit<VisibilityRequest, "site" | "aim">,
    signal?: AbortSignal,
  ): Promise<CompareResult>;
  validation(): Promise<ValidationData>;
  provenance(): Promise<ProvenanceData>;
}
