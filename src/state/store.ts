/** One app-wide store (Open MCT pattern: a single time state that every view subscribes to). */
import { useSyncExternalStore } from "react";
import type { Percentile, RobustAimResult, SiteId, Vehicle, XY } from "../types";
import { vehiclePresets } from "../data/vehicles";

export type View = "map" | "sky" | "compare" | "science";
export type Mode = "globe" | "planner" | "simple" | "compare" | "science" | "report" | "about";

export interface AppState {
  mode: Mode;
  /** mission sequence: steps the user has visited (drives the planner's progress rail) */
  progress: { sky: boolean; compare: boolean; export: boolean };
  mapMode: "3d" | "2d";
  globeSite: SiteId | null;
  view: View;
  siteId: SiteId;
  siteLoading: string | null;
  landingIdx: number;
  cursorIdx: number;
  windowDays: 14 | 30 | 90;
  aim: XY;
  aimKind: "brightest" | "robust" | "custom" | "nominal";
  uncertainty: {
    enabled: boolean;
    model: "circular" | "gaussian";
    radius: number;
    sigmaE: number;
    sigmaN: number;
    rotDeg: number;
    conf: number;
  };
  percentile: Percentile;
  mastM: number;
  earthMarginDeg: number;
  dsnMaskDeg: 6 | 10.1;
  vehicles: Vehicle[];
  vehicleId: string;
  headingDeg: number;
  headingAuto: boolean;
  layers: { relief: boolean; slope: boolean; heat: boolean; samples: boolean; known: boolean; ellipse: boolean };
  heatMetric: "nominal" | "robust";
  robust: { status: "idle" | "running" | "done"; stage: number; result: RobustAimResult | null; revealed: boolean };
  compareIds: SiteId[];
  playing: boolean;
  playSpeed: 1 | 6 | 24;
  skyMode: "dome" | "panorama";
  verticalExaggeration: 1 | 5 | 10;
  dialog: null | "data" | "export" | "vehicle";
  toast: string | null;
  /** the assistant side panel */
  assistantOpen: boolean;
  /** something the assistant panel should start with when it opens (e.g. the walkthrough, from the welcome bubble) */
  assistantStart: null | "tour";
}

/** 2027-06-29 13:00 UTC (hour index in the 2027 ephemeris). */
const DEFAULT_LANDING = (151 + 28) * 24 + 13;

/** Permalink: ?mode=planner|simple|globe&site=cr1&view=map|sky|compare|science&landing=<hour of 2027> */
function fromUrl(): Partial<AppState> {
  if (typeof window === "undefined") return {};
  const q = new URLSearchParams(window.location.search);
  const out: Partial<AppState> = {};
  const mode = q.get("mode");
  if (mode === "planner" || mode === "simple" || mode === "globe" || mode === "compare" || mode === "science" || mode === "report" || mode === "about") out.mode = mode;
  const site = q.get("site");
  if (site && ["cr1", "shk", "mal", "mou", "nob"].includes(site)) out.siteId = site as SiteId;
  const view = q.get("view");
  if (view === "map" || view === "sky") out.view = view;
  // compare and science used to be planner tabs; they are top-level sections now
  if ((view === "compare" || view === "science") && (!mode || mode === "planner")) out.mode = view;
  const landing = q.has("landing") ? Number(q.get("landing")) : NaN;
  if (Number.isInteger(landing) && landing >= 0 && landing < 8760 - 24 * 30) {
    out.landingIdx = landing;
    out.cursorIdx = landing;
  }
  return out;
}

let state: AppState = {
  mode: "globe",
  progress: { sky: false, compare: false, export: false },
  mapMode: "3d",
  globeSite: null,
  view: "map",
  siteId: "cr1",
  siteLoading: null,
  landingIdx: DEFAULT_LANDING,
  cursorIdx: DEFAULT_LANDING + 30,
  windowDays: 30,
  aim: { x: 0, y: 0 }, // replaced at start-up by the brightest point of the site's computed field
  aimKind: "nominal",
  uncertainty: { enabled: false, model: "circular", radius: 100, sigmaE: 45, sigmaN: 70, rotDeg: 30, conf: 0.95 },
  percentile: 10,
  mastM: 2,
  earthMarginDeg: 2,
  dsnMaskDeg: 6,
  vehicles: vehiclePresets(),
  vehicleId: "viper",
  headingDeg: 0,
  headingAuto: true,
  layers: { relief: true, slope: false, heat: true, samples: true, known: true, ellipse: true },
  heatMetric: "nominal",
  robust: { status: "idle", stage: 0, result: null, revealed: false },
  compareIds: ["cr1", "shk", "mal"],
  playing: false,
  playSpeed: 6,
  skyMode: "dome",
  verticalExaggeration: 10,
  dialog: null,
  toast: null,
  assistantOpen: false,
  assistantStart: null,
  ...fromUrl(),
};

const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}

/** Listen to every state change outside React (used by the assistant's built-in guide); returns an unsubscribe. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useApp<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(state),
  );
}

export function currentVehicle(s: AppState): Vehicle {
  return s.vehicles.find((v) => v.id === s.vehicleId) ?? s.vehicles[0];
}

export function hourToDate(idx: number): Date {
  return new Date(Date.UTC(2027, 0, 1) + idx * 3600000);
}
