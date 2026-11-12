/** Applies an approved assistant proposal (backend/app/assistant/tools.py propose_app_changes) through the same
 *  functions the controls use, in a fixed order. Runs only after the person clicks Apply. */
import { getState, setState, type Mode } from "../../state/store";
import { goTo, selectSite } from "../../app/Header";
import { findRobustAim, resetRobust } from "../mission/RobustAim";
import { siteSync } from "../../api/client";
import { brightest, inField } from "../../utils/field";
import type { Percentile, SiteId, UncertaintyModel } from "../../types";

export interface ProposalChanges {
  mode?: Mode;
  view?: "map" | "sky";
  site?: SiteId;
  windowDays?: 14 | 30 | 90;
  landingIdx?: number;
  uncertainty?: { enabled: boolean; model?: "circular" | "gaussian"; radius?: number; sigmaE?: number; sigmaN?: number; rotDeg?: number };
  percentile?: Percentile;
  aim?: { kind: "brightest" | "robust" | "custom"; x?: number; y?: number };
  runRobustAim?: boolean;
  earthMarginDeg?: number;
  dsnMaskDeg?: 6 | 10.1;
  vehicleId?: string;
  compareIds?: SiteId[];
  dialog?: "export" | "data" | "vehicle";
}

export interface Proposal {
  id: string;
  summary: string;
  lines: string[];
  changes: ProposalChanges;
}

function currentModel(): UncertaintyModel {
  const u = getState().uncertainty;
  return u.model === "circular" ? { kind: "circular", radius: u.radius } : { kind: "gaussian", sigmaE: u.sigmaE, sigmaN: u.sigmaN, rotDeg: u.rotDeg, conf: u.conf };
}

/** Throws with a readable message if something cannot be applied; earlier steps stay applied. */
export async function applyProposal(c: ProposalChanges): Promise<void> {
  if (c.site && c.site !== getState().siteId) {
    await selectSite(c.site);
    if (getState().siteId !== c.site) throw new Error("The site could not be loaded.");
  }
  if (c.mode) goTo(c.mode);
  if (c.view) setState((s) => ({ view: c.view!, progress: c.view === "sky" ? { ...s.progress, sky: true } : s.progress }));
  if (c.windowDays) setState({ windowDays: c.windowDays });
  if (c.landingIdx !== undefined) {
    const max = (365 - getState().windowDays) * 24 + 23;
    const idx = Math.min(Math.max(c.landingIdx, 0), max);
    setState({ landingIdx: idx, cursorIdx: idx });
  }
  let resetSearch = false;
  if (c.uncertainty) {
    const u = c.uncertainty;
    setState((s) => ({
      uncertainty: {
        ...s.uncertainty,
        enabled: u.enabled,
        ...(u.model ? { model: u.model } : {}),
        ...(u.radius !== undefined ? { radius: u.radius } : {}),
        ...(u.sigmaE !== undefined ? { sigmaE: u.sigmaE } : {}),
        ...(u.sigmaN !== undefined ? { sigmaN: u.sigmaN } : {}),
        ...(u.rotDeg !== undefined ? { rotDeg: u.rotDeg } : {}),
      },
    }));
    resetSearch = true;
  }
  if (c.percentile) {
    setState({ percentile: c.percentile });
    resetSearch = true;
  }
  if (resetSearch) resetRobust(); // a previous robust-aim result no longer matches the settings
  if (c.earthMarginDeg !== undefined) setState({ earthMarginDeg: c.earthMarginDeg });
  if (c.dsnMaskDeg !== undefined) setState({ dsnMaskDeg: c.dsnMaskDeg });
  if (c.vehicleId) {
    if (!getState().vehicles.some((v) => v.id === c.vehicleId)) throw new Error(`Unknown vehicle scenario "${c.vehicleId}".`);
    setState({ vehicleId: c.vehicleId });
  }
  if (c.compareIds && c.compareIds.length >= 2) setState({ compareIds: c.compareIds });

  if (c.aim) {
    const site = siteSync(getState().siteId);
    if (c.aim.kind === "brightest") {
      const b = brightest(site.field);
      setState({ aim: { x: b.x, y: b.y }, aimKind: "brightest" });
    } else if (c.aim.kind === "custom") {
      const p = { x: c.aim.x ?? 0, y: c.aim.y ?? 0 };
      if (!inField(site.field, p)) throw new Error(`That aim is outside ${site.name}'s high-resolution landing grid.`);
      setState({ aim: p, aimKind: "custom" });
    } else {
      await findRobustAim(site.id, currentModel(), getState().percentile);
      const r = getState().robust.result;
      if (!r) throw new Error("The robust-aim search did not return a result.");
      setState({ aim: { x: r.robust.x, y: r.robust.y }, aimKind: "robust" });
    }
  } else if (c.runRobustAim) {
    const s = getState();
    if (s.robust.status !== "running") await findRobustAim(s.siteId, currentModel(), s.percentile);
  }
  if (c.dialog) setState((s) => ({ dialog: c.dialog!, progress: c.dialog === "export" ? { ...s.progress, export: true } : s.progress }));
}

/** Everything a proposal can change, saved before applying it so the person can undo with one click. */
export type UndoSnapshot = Pick<
  ReturnType<typeof getState>,
  | "siteId" | "mode" | "view" | "landingIdx" | "cursorIdx" | "windowDays" | "uncertainty" | "percentile" | "aim" | "aimKind"
  | "robust" | "heatMetric" | "earthMarginDeg" | "dsnMaskDeg" | "vehicleId" | "compareIds" | "dialog"
>;

export function captureUndo(): UndoSnapshot {
  const s = getState();
  return {
    siteId: s.siteId, mode: s.mode, view: s.view, landingIdx: s.landingIdx, cursorIdx: s.cursorIdx, windowDays: s.windowDays,
    uncertainty: { ...s.uncertainty }, percentile: s.percentile, aim: { ...s.aim }, aimKind: s.aimKind, robust: s.robust,
    heatMetric: s.heatMetric, earthMarginDeg: s.earthMarginDeg, dsnMaskDeg: s.dsnMaskDeg, vehicleId: s.vehicleId,
    compareIds: [...s.compareIds], dialog: s.dialog,
  };
}

/** Put the app back exactly as it was before a proposal was applied. */
export async function restoreUndo(u: UndoSnapshot): Promise<void> {
  if (u.siteId !== getState().siteId) {
    await selectSite(u.siteId);
    if (getState().siteId !== u.siteId) throw new Error("The previous site could not be loaded.");
  }
  setState({ ...u });
}
