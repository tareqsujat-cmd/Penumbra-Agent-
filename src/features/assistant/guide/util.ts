/** Small helpers shared by the built-in guide's modules. */
import type { AppState } from "../../../state/store";
import type { Percentile, SiteId, UncertaintyModel } from "../../../types";
import type { Proposal, ProposalChanges } from "../applyProposal";
import type { LiveMetrics } from "../snapshot";
import type { SiteData } from "../../../types";

export const SITE_NAMES: Record<SiteId, string> = {
  cr1: "Connecting Ridge",
  shk: "Shackleton rim",
  mal: "Malapert massif",
  mou: "Mons Mouton / Leibnitz β",
  nob: "Nobile rim 1",
};
export const ALL_SITES: SiteId[] = ["cr1", "shk", "mal", "mou", "nob"];

export const pct = (v: number, d = 0) => `${v.toFixed(d)}%`;
export const pts = (v: number) => `${Math.abs(v).toFixed(1)} points`;
export const P = (q: Percentile) => (q === 5 ? "P05" : `P${q}`);
export const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** "32 hours", "about 3 days" — everyday units */
export function duration(h: number): string {
  if (h < 1) return "less than an hour";
  if (h < 48) return `${Math.round(h)} hour${Math.round(h) === 1 ? "" : "s"}`;
  const d = h / 24;
  return `about ${d < 10 ? d.toFixed(1).replace(/\.0$/, "") : Math.round(d)} days`;
}

export interface GuideCtx {
  s: AppState;
  site: SiteData | null;
  m: LiveMetrics;
}

export function siteName(c: GuideCtx): string {
  return c.site?.name ?? SITE_NAMES[c.s.siteId];
}

export function model(s: AppState): UncertaintyModel {
  const u = s.uncertainty;
  return u.model === "circular" ? { kind: "circular", radius: u.radius } : { kind: "gaussian", sigmaE: u.sigmaE, sigmaN: u.sigmaN, rotDeg: u.rotDeg, conf: u.conf };
}

export function zone(s: AppState): string {
  const u = s.uncertainty;
  return u.model === "circular" ? `±${u.radius} m` : `an oval about ${u.sigmaE} × ${u.sigmaN} m`;
}

export function vehicleOf(s: AppState) {
  return s.vehicles.find((v) => v.id === s.vehicleId) ?? s.vehicles[0];
}

let seq = 0;
export function proposal(summary: string, lines: string[], changes: ProposalChanges): Proposal {
  seq += 1;
  return { id: `g${seq}`, summary, lines, changes };
}

export const uncertaintyOn = (radius = 100): Proposal =>
  proposal(`Turn on a ±${radius} m landing zone`, [`Landing uncertainty: circular ±${radius} m`, "Go to 02 Mission"], {
    mode: "planner",
    uncertainty: { enabled: true, model: "circular", radius },
  });

/** Snap a radius to the app's slider (25-400 m in 25 m steps). */
export const snapRadius = (r: number) => Math.min(400, Math.max(25, Math.round(r / 25) * 25));

/** Results are ready on screen (mission card numbers computed). */
export function riskReady(m: LiveMetrics): boolean {
  return !!m.risk && !m.risk.loading && ok(m.risk.nominal);
}
export function visReady(m: LiveMetrics): boolean {
  return !!m.vis && !m.vis.loading && ok(m.vis.summary.sunlightPct);
}

/** The guide's name, shown in the panel and greeting. */
export const GUIDE_NAME = "Armstrong";
