import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, siteSync } from "../api/client";
import { currentVehicle, useApp } from "../state/store";
import { STRINGS } from "../i18n/strings";
import { bilinear, inField } from "../utils/field";
import type { LandingRiskResult, Percentile, SiteData, UncertaintyModel, VisibilitySeries } from "../types";

export function useStrings() {
  return { t: STRINGS.en };
}

export function useSite(): SiteData {
  const id = useApp((s) => s.siteId);
  return useMemo(() => siteSync(id), [id]);
}

export function useModel(): UncertaintyModel {
  const u = useApp((s) => s.uncertainty);
  return useMemo<UncertaintyModel>(
    () => (u.model === "circular" ? { kind: "circular", radius: u.radius } : { kind: "gaussian", sigmaE: u.sigmaE, sigmaN: u.sigmaN, rotDeg: u.rotDeg, conf: u.conf }),
    [u],
  );
}

// ---------------------------------------------------------------------------------------------- request cache
const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 300;

function remember(key: string, v: unknown) {
  cache.set(key, v);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
}

/** Debounced copy of a value (slider drags send one request when the hand stops, not one per pixel). */
export function useDebounced<T>(value: T, ms = 220): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export interface Async<T> {
  data: T | null;
  /** true while the current request is outstanding (data then holds the previous result, if any) */
  loading: boolean;
  error: ApiError | null;
}

/** Shared, de-duplicated API call keyed by its request; keeps the last result on screen while recomputing. */
export function useApiCall<T>(key: string | null, fn: () => Promise<T>): Async<T> {
  const [, force] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);
  const last = useRef<T | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!key || cache.has(key)) return;
    let alive = true;
    setError(null);
    let p = inflight.get(key) as Promise<T> | undefined;
    if (!p) {
      p = fnRef.current();
      inflight.set(key, p);
      p.then((v) => remember(key, v)).finally(() => inflight.delete(key)).catch(() => undefined);
    }
    p.then(
      () => alive && force((n) => n + 1),
      (e: unknown) => alive && setError(e instanceof ApiError ? e : new ApiError("COMPUTE_FAILED", String(e))),
    );
    return () => {
      alive = false;
    };
  }, [key]);
  const hit = key && cache.has(key) ? (cache.get(key) as T) : null;
  if (hit) last.current = hit;
  return { data: hit ?? last.current, loading: !!key && !hit && !error, error };
}

// ---------------------------------------------------------------------------------------------- landing risk
export type RiskState = LandingRiskResult & { loading: boolean; error: ApiError | null };

function nominalOnly(site: SiteData, x: number, y: number): LandingRiskResult {
  const f = site.field;
  const ok = inField(f, { x, y });
  const nominal = ok ? bilinear(f.sun, f, x, y) : NaN;
  const p = { 50: nominal, 20: nominal, 10: nominal, 5: nominal } as Record<Percentile, number>;
  return { nominal, pq: nominal, p, earthPq: ok ? bilinear(f.earth, f, x, y) : NaN, samples: [], histogram: [], nGridPoints: 1, elapsedMs: 0 };
}

const NO_RISK = (nominal: number): LandingRiskResult => ({
  nominal,
  pq: NaN,
  p: { 50: NaN, 20: NaN, 10: NaN, 5: NaN },
  earthPq: NaN,
  samples: [],
  histogram: [],
  nGridPoints: 0,
  elapsedMs: 0,
});

export function useRisk(): RiskState {
  const site = useSite();
  const aim = useDebounced(useApp((s) => s.aim), 120);
  const enabled = useApp((s) => s.uncertainty.enabled);
  const percentile = useApp((s) => s.percentile);
  const model = useDebounced(useModel());
  const key = enabled ? JSON.stringify(["risk", site.id, aim, model, percentile]) : null;
  const r = useApiCall(key, () => api.landingRisk({ site: site.id, aim, model, enabled, percentile, seed: 7 }));
  return useMemo(() => {
    if (!enabled) return { ...nominalOnly(site, aim.x, aim.y), loading: false, error: null };
    const base = r.data ?? NO_RISK(nominalOnly(site, aim.x, aim.y).nominal);
    return { ...base, pq: base.p[percentile] ?? base.pq, loading: r.loading, error: r.error };
  }, [enabled, site, aim, r.data, r.loading, r.error, percentile]);
}

// ---------------------------------------------------------------------------------------------- visibility
export type VisState = VisibilitySeries & { loading: boolean; error: ApiError | null };

function emptyVis(startIdx: number): VisibilitySeries {
  const z8 = new Uint8Array(0);
  return {
    startIdx,
    hours: 0,
    sunFrac: new Float32Array(0),
    terrainBlocked: z8,
    earth: z8,
    dsn: z8,
    station: { goldstone: z8, madrid: z8, canberra: z8 },
    soc: new Float32Array(0),
    hibernating: z8,
    depletedAt: null,
    headingDeg: 0,
    skyline: [],
    dailySun: new Float32Array(0),
    elapsedMs: 0,
    summary: { sunlightPct: NaN, earthPct: NaN, dsnPct: NaN, longestDarkH: NaN, darkStartsInH: null, enduranceDays: null },
  };
}

export function useVisibility(): VisState {
  const site = useSite();
  const aim = useDebounced(useApp((s) => s.aim), 120);
  const landingIdx = useDebounced(useApp((s) => s.landingIdx), 160);
  const windowDays = useApp((s) => s.windowDays);
  const earthMarginDeg = useDebounced(useApp((s) => s.earthMarginDeg));
  const dsnMaskDeg = useApp((s) => s.dsnMaskDeg);
  const mast = useApp((s) => s.mastM);
  const vehicle = useApp((s) => currentVehicle(s));
  const headingDeg = useDebounced(useApp((s) => s.headingDeg));
  const headingAuto = useApp((s) => s.headingAuto);
  const key = JSON.stringify(["vis", site.id, aim, landingIdx, windowDays, earthMarginDeg, dsnMaskDeg, mast, vehicle, headingAuto ? "auto" : headingDeg]);
  const r = useApiCall(key, () =>
    api.visibility({ site: site.id, aim, startIdx: landingIdx, hours: windowDays * 24, earthMarginDeg, dsnMaskDeg, vehicle, headingDeg, autoHeading: headingAuto, mast }),
  );
  return useMemo(() => ({ ...(r.data ?? emptyVis(landingIdx)), loading: r.loading, error: r.error }), [r.data, r.loading, r.error, landingIdx]);
}

/** Terrain skyline at the commanded aim (computed by the backend); the site's skyline at its brightest point is
 *  shown until the aim's skyline arrives. */
export function useSkyline(): { deg: number[]; loading: boolean } {
  const site = useSite();
  const vis = useVisibility();
  return useMemo(() => ({ deg: vis.skyline.length ? vis.skyline : site.skyline.deg, loading: vis.loading }), [vis.skyline, vis.loading, site]);
}
