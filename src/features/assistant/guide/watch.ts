/** Proactive guidance: notices what the person just changed in the app and explains it in plain words, then suggests
 *  the next step. detectEvents is pure (tested); the panel calls it on every store change. */
import type { AppState } from "../../../state/store";
import { explainChoice, type ChoiceId } from "./plain";
import { pct, siteName, type GuideCtx } from "./util";
import type { GuideReply } from "./engine";
import { nextStepReply } from "./engine";

export type GuideEvent =
  | { kind: "choice"; id: ChoiceId }
  | { kind: "robustDone" }
  | { kind: "skyline" }
  | { kind: "section"; mode: AppState["mode"] }
  | { kind: "exportOpened" };

/** What changed between two states, in the order it should be explained. */
export function detectEvents(prev: AppState, cur: AppState): GuideEvent[] {
  const ev: GuideEvent[] = [];
  if (cur.mode !== prev.mode) ev.push({ kind: "section", mode: cur.mode });
  if (cur.siteId !== prev.siteId) ev.push({ kind: "choice", id: "site" });
  if (cur.landingIdx !== prev.landingIdx && cur.siteId === prev.siteId) ev.push({ kind: "choice", id: "date" });
  if (cur.windowDays !== prev.windowDays) ev.push({ kind: "choice", id: "window" });
  const pu = prev.uncertainty;
  const cu = cur.uncertainty;
  if (pu.enabled !== cu.enabled || (cu.enabled && (pu.model !== cu.model || pu.radius !== cu.radius || pu.sigmaE !== cu.sigmaE || pu.sigmaN !== cu.sigmaN)))
    ev.push({ kind: "choice", id: "accuracy" });
  if (cur.percentile !== prev.percentile) ev.push({ kind: "choice", id: "level" });
  if (cur.robust.status === "done" && prev.robust.status !== "done") ev.push({ kind: "robustDone" });
  if (cur.aimKind !== prev.aimKind && cur.siteId === prev.siteId && cur.aimKind !== "brightest") ev.push({ kind: "choice", id: "aim" });
  if (cur.vehicleId !== prev.vehicleId) ev.push({ kind: "choice", id: "vehicle" });
  if (cur.view === "sky" && prev.view !== "sky" && cur.mode === "planner") ev.push({ kind: "skyline" });
  if (cur.dialog === "export" && prev.dialog !== "export") ev.push({ kind: "exportOpened" });
  return ev;
}

/** Choices whose explanation includes numbers that arrive a moment after the change (wait for them). */
export function needsFreshNumbers(e: GuideEvent): boolean {
  return e.kind === "choice" && ["site", "date", "accuracy", "level", "vehicle", "window"].includes(e.id);
}

const SECTION_HELLO: Partial<Record<AppState["mode"], string>> = {
  planner: "You're in **Mission**, the full planner. The bar along the top lists the steps in order; your key numbers are on the right.",
  simple: "You're in the **Briefing**: a plain-language summary of one site and date.",
  compare: "You're in **Compare**: every site is scored the same way, so you can see which keeps the most light for your date.",
};

/** Plain-language explanation of what just changed (null = nothing worth saying). */
export function explainEvents(events: GuideEvent[], c: GuideCtx): string | null {
  const parts: string[] = [];
  for (const e of events) {
    if (e.kind === "choice") parts.push(explainChoice(e.id, c));
    else if (e.kind === "robustDone" && c.s.robust.result) {
      const r = c.s.robust.result;
      const gain = r.robust.pq - r.bestNominal.pq;
      parts.push(
        `**Robust aim found.** On a bad day, the robust aim keeps **${pct(r.robust.pq)}** sunlight versus **${pct(r.bestNominal.pq)}** at the brightest point` +
          (gain > 0.5 ? `, so it's the safer target (${gain.toFixed(1)} points better).` : ". They're about the same here, so the brightest point is fine."),
      );
    } else if (e.kind === "skyline")
      parts.push("**This is the skyline** seen from your landing spot: the real hills around you, with the Sun and Earth moving along it. When the Sun dips behind a hill, your lander is in shadow. That's why some places and dates are darker than others.");
    else if (e.kind === "exportOpened") parts.push("**Export** saves your whole decision (site, date, aim, results and data sources) as a file you can share.");
    else if (e.kind === "section" && SECTION_HELLO[e.mode] && events.length === 1) parts.push(SECTION_HELLO[e.mode]!);
  }
  return parts.length ? parts.join("\n\n") : null;
}

/** The guide's reply to what just happened: the explanation, then the next step (null = nothing worth saying). */
export function nudge(events: GuideEvent[], c: GuideCtx): GuideReply | null {
  const text = explainEvents(events, c);
  if (!text) return null;
  // after explaining, point to what comes next in the mission sequence
  const tail = c.s.mode === "planner" && !events.some((e) => e.kind === "exportOpened") ? nextStepReply(c, true) : null;
  return {
    text: text + (tail ? `\n\n${tail.text}` : ""),
    proposals: tail?.proposals,
    chips: tail?.chips ?? [{ label: `What does this mean for ${siteName(c)}?`, intent: { kind: "choices" } }],
    spot: tail?.spot,
    proactive: true,
  };
}
