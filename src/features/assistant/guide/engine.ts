/** Built-in guide (no AI): turns a request into an answer, using only numbers the app has computed (the mission
 *  card's results, or calls to the same backend API the views use). Answers lead with a plain-language verdict and
 *  can carry Apply cards (proposals), follow-up buttons (chips), a "Show me where" spotlight and walkthrough progress. */
import type { AppState } from "../../../state/store";
import type { CompareResult, CompareRow, LandingRiskRequest, LandingRiskResult, Percentile, SiteId, Vehicle, VisibilityRequest, VisibilitySeries } from "../../../types";
import { fmtDate } from "../../../utils/format";
import type { Proposal, ProposalChanges } from "../applyProposal";
import { HOWTO, LIMITATIONS, SCREENS, TERMS, TRUST, type HowId, type TermId } from "./content";
import { extractEntities, hasEntities, isCommand, isWhatIf, normalise, type Entities } from "./nlu";
import { explainAllChoices, explainChoice, explainMore, IN_N, SITE_PLAIN, verdict, type ChoiceId } from "./plain";
import type { SpotId } from "./spotlight";
import { ALL_SITES, duration, GUIDE_NAME, ok, P, pct, proposal, riskReady, SITE_NAMES, siteName, snapRadius, uncertaintyOn, vehicleOf, visReady, zone, type GuideCtx } from "./util";

export type { GuideCtx } from "./util";

export type SitePriority = "sun" | "contact" | "nights" | "balance";
export type DatePriority = "sun" | "battery" | "contact";

export type Intent =
  | { kind: "greet" }
  | { kind: "menu" }
  | { kind: "screen" }
  | { kind: "explain" }
  | { kind: "choices" }
  | { kind: "choice"; id: ChoiceId }
  | { kind: "next" }
  | { kind: "tour"; step: number }
  | { kind: "stopTour" }
  | { kind: "terms" }
  | { kind: "term"; id: TermId }
  | { kind: "howtos" }
  | { kind: "howto"; id: HowId }
  | { kind: "whatifs" }
  | { kind: "whatif"; id: "accuracy" | "levels" | "sites" | "dates" }
  | { kind: "whatifDate"; day: number }
  | { kind: "whatifSite"; site: SiteId }
  | { kind: "whatifRadius"; radius: number }
  | { kind: "siteHelper"; priority?: SitePriority; radius?: number; q?: Percentile }
  | { kind: "dateHelper"; window?: 14 | 30 | 90; priority?: DatePriority }
  | { kind: "command"; e: Entities }
  | { kind: "spot"; id: SpotId }
  | { kind: "limits" }
  | { kind: "trust" }
  | { kind: "thanks" }
  | { kind: "more"; id: ChoiceId }
  | { kind: "whatsthis" };

export interface Chip {
  label: string;
  intent: Intent;
  /** the suggested choice (highlighted; "yes" / "ok" picks it) */
  primary?: boolean;
}

export interface GuideReply {
  text: string;
  proposals?: Proposal[];
  chips?: Chip[];
  /** "Show me where" target */
  spot?: SpotId;
  /** walkthrough progress bar */
  progress?: { step: number; total: number; title: string };
  /** walkthrough state: a step number starts/continues it, null ends it, undefined leaves it alone */
  tour?: number | null;
  /** posted by the guide on its own (after a change in the app) */
  proactive?: boolean;
}

/** The subset of the API client the guide uses (injected so it can be tested). */
export interface GuideApi {
  landingRisk(req: LandingRiskRequest): Promise<LandingRiskResult>;
  visibility(req: VisibilityRequest): Promise<VisibilitySeries>;
  compare(sites: SiteId[], req: Omit<LandingRiskRequest, "site" | "aim">, vis: Omit<VisibilityRequest, "site" | "aim">): Promise<CompareResult>;
  /** energy endurance (days, null = never depleted) for every landing day; optional tie-break for best dates */
  endurance?(site: SiteId, aim: { x: number; y: number }, vehicle: Vehicle, windowDays: number): Promise<{ days: number[]; endurance_days: (number | null)[] }>;
}

/** Intents that call the backend (the panel shows "Working it out…" for these). */
export function isComputed(i: Intent, mode: AppState["mode"]): boolean {
  if (i.kind === "whatif") return i.id !== "levels";
  if (i.kind === "whatifDate" || i.kind === "whatifSite" || i.kind === "whatifRadius") return true;
  if (i.kind === "siteHelper") return !!(i.priority && i.radius && i.q);
  if (i.kind === "dateHelper") return !!(i.window && i.priority);
  return i.kind === "explain" && mode === "compare";
}

/** What the panel says while an answer is being worked out (specific, so people know what's happening). */
export function activityFor(i: Intent): string | undefined {
  switch (i.kind) {
    case "whatifDate":
      return "Checking that landing date…";
    case "whatifSite":
      return "Comparing the two sites for your date…";
    case "whatifRadius":
      return "Imagining 2,000 landings with that accuracy…";
    case "siteHelper":
      return i.priority && i.radius && i.q ? "Comparing all five sites for you…" : undefined;
    case "dateHelper":
      return i.window && i.priority ? "Looking at every landing day in 2027…" : undefined;
    case "whatif":
      return i.id === "accuracy" ? "Imagining landings with different accuracies…" : i.id === "sites" ? "Comparing all five sites for your date…" : i.id === "dates" ? "Looking at every landing day in 2027…" : undefined;
    case "explain":
    case "choices":
    case "choice":
      return "Getting your numbers…";
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------------------------- shared bits
export const BACK: Chip = { label: "Other topics", intent: { kind: "menu" } };
const SECTION_NAME: Record<AppState["mode"], string> = { globe: "Explore", planner: "Mission", simple: "Briefing", compare: "Compare", science: "Science", report: "Research", about: "System" };
const showMe = (id: SpotId): Chip => ({ label: "Show me where", intent: { kind: "spot", id } });
const hourOf = (s: AppState) => s.landingIdx % 24;
const lastLandingDay = (windowDays: number) => 365 - windowDays;
const visFor = (s: AppState, startIdx: number, hours: number) => ({
  site: s.siteId, aim: s.aim, startIdx, hours, earthMarginDeg: s.earthMarginDeg, dsnMaskDeg: s.dsnMaskDeg, vehicle: vehicleOf(s), headingDeg: s.headingDeg, autoHeading: s.headingAuto, mast: s.mastM,
});
const battery = (e: number | null, windowDays: number) => (e == null ? `lasts all ${windowDays} days` : `runs out after about ${e.toFixed(1)} days`);

export function greeting(s: AppState, siteLabel: string): GuideReply {
  const where = s.mode === "planner" || s.mode === "simple" || s.mode === "compare" ? `, looking at **${siteLabel}** with a landing on **${fmtDate(s.landingIdx, false)}**` : "";
  return {
    text: `Hi, I'm **${GUIDE_NAME}**, your guide to Penumbra. You're in **${SECTION_NAME[s.mode]}**${where}.\n\nNo space background needed: I'll explain everything in plain words. I can walk you through planning a landing, explain anything you point at, or help you pick a site and a date. New here? Start with the walkthrough; it takes a couple of minutes.`,
    chips: [
      { label: "Walk me through it", intent: { kind: "tour", step: 0 }, primary: true },
      { label: "Point at something to explain it", intent: { kind: "whatsthis" } },
      { label: "Explain my choices", intent: { kind: "choices" } },
      { label: "Help me choose a site", intent: { kind: "siteHelper" } },
      { label: "Help me pick a landing date", intent: { kind: "dateHelper" } },
      { label: "More topics", intent: { kind: "menu" } },
    ],
  };
}

export function menuChips(s: AppState): Chip[] {
  const hasResults = s.mode === "planner" || s.mode === "simple" || s.mode === "compare";
  return [
    { label: "Walk me through planning a landing", intent: { kind: "tour", step: 0 }, primary: true },
    { label: "Explain my choices", intent: { kind: "choices" } },
    { label: "Point at something to explain it", intent: { kind: "whatsthis" } },
    ...(hasResults ? [{ label: "Explain my results", intent: { kind: "explain" } } as Chip] : []),
    { label: "What should I do next?", intent: { kind: "next" } },
    { label: "Help me choose a site", intent: { kind: "siteHelper" } },
    { label: "Help me pick a landing date", intent: { kind: "dateHelper" } },
    { label: "Quick comparisons", intent: { kind: "whatifs" } },
    { label: "What does … mean?", intent: { kind: "terms" } },
    { label: "How do I …?", intent: { kind: "howtos" } },
    { label: "Can I trust the numbers?", intent: { kind: "trust" } },
  ];
}

// ---------------------------------------------------------------------------------------------- explain results
function explainMission(c: GuideCtx): GuideReply {
  const { s, m } = c;
  const q = s.percentile;
  if (!riskReady(m)) return { text: "Your numbers are still being worked out. Ask me again in a moment.", chips: [BACK] };
  const lines: string[] = [];
  const proposals: Proposal[] = [];
  const chips: Chip[] = [];
  const v = verdict(c);
  if (v) lines.push(v, "");
  lines.push(`Here's what your numbers mean at **${siteName(c)}**, landing **${fmtDate(s.landingIdx)}**:`, "");
  lines.push(`- **If you land exactly on target: ${pct(m.risk!.nominal)} sunlight** over 2027, about ${Math.round(m.risk!.nominal)} of every 100 hours.`);
  if (s.uncertainty.enabled && ok(m.risk!.p[q])) {
    const pq = m.risk!.p[q];
    lines.push(`- **On a bad day (${P(q)}): ${pct(pq)}.** Real landings miss a little; ${IN_N[q]} of the possible landings in your ${zone(s)} zone get at least this much. Missing your target costs up to **${(m.risk!.nominal - pq).toFixed(1)} points**.`);
  } else {
    lines.push("- **Landing accuracy isn't set**, so this assumes a perfect landing. Turning it on shows what happens if you miss.");
    proposals.push(uncertaintyOn());
  }
  const r = s.robust.result;
  if (s.robust.status === "done" && r) {
    const gain = r.robust.pq - r.bestNominal.pq;
    lines.push(`- **Safer target (robust aim):** on a bad day it keeps ${pct(r.robust.pq, 1)} versus ${pct(r.bestNominal.pq, 1)} at the brightest point${gain > 0.5 ? `: ${gain.toFixed(1)} points better` : ": about the same"}.`);
    if (s.aimKind !== "robust" && gain > 0.5) proposals.push(proposal("Aim at the robust aim", ["Aim: move to the robust aim (the search runs again first)"], { aim: { kind: "robust" } }));
  } else if (s.uncertainty.enabled) {
    lines.push("- **Safer target:** not searched yet. Penumbra can look for a spot that stays sunny even if you miss.");
    proposals.push(proposal("Find the robust aim", ["Run Find robust aim and show brightest vs robust", "Go to 02 Mission"], { mode: "planner", runRobustAim: true }));
  }
  if (visReady(m)) {
    const w = m.vis!.summary;
    const veh = vehicleOf(s)?.name ?? "the vehicle";
    lines.push(`- **Your first ${s.windowDays} days:** sunlight ${pct(w.sunlightPct)} of the time; the longest darkness lasts ${duration(w.longestDarkH)}; Earth is in view ${pct(w.earthPct)} of the time, and NASA's big antennas (the Deep Space Network) can reach you ${pct(w.dsnPct)} of the time.`);
    lines.push(`- **Battery (${veh}):** ${battery(w.enduranceDays, s.windowDays)}.`);
    if (w.enduranceDays != null) chips.push({ label: "Help me pick a better date", intent: { kind: "dateHelper" }, primary: true });
  }
  lines.push("", "_Good to know: these are estimates from NASA terrain data; the landing zone is a model you choose, and the battery figure is simplified._");
  return { text: lines.join("\n"), proposals, chips: [...chips, { label: "Explain my choices", intent: { kind: "choices" } }, { label: "What should I do next?", intent: { kind: "next" }, primary: !chips.length }, BACK] };
}

function explainBriefing(c: GuideCtx): GuideReply {
  const { s, m } = c;
  if (!riskReady(m)) return { text: "The briefing is still being worked out. Ask me again in a moment.", chips: [BACK] };
  const lines = [verdict(c) ?? "", "", `**${siteName(c)}**, landing ${fmtDate(s.landingIdx, false)}, with a ${zone(s)} landing zone:`, ""];
  const e = m.vis?.early72;
  if (ok(e)) lines.push(`- **First 3 days after landing:** sunlight ${pct(e)} of the time, which counts as **${e >= 70 ? "good" : e >= 35 ? "moderate" : "poor"}** (good means 70% or more). The first days matter because the lander must charge up and start working.`);
  const p10 = m.risk!.p[10];
  if (ok(p10)) {
    const drop = m.risk!.nominal - p10;
    lines.push(`- **In 9 out of 10 possible landings: at least ${pct(p10)} sunlight** over 2027, versus ${pct(m.risk!.nominal)} for a perfect landing. Losing ${drop.toFixed(1)} points is a **${drop < 5 ? "low" : drop < 15 ? "moderate" : "high"}** risk from landing in the wrong spot.`);
  }
  const w = m.vis?.summary;
  if (w && ok(w.earthPct)) lines.push(`- **Earth in view** ${pct(w.earthPct)} of the time; **longest darkness** ${duration(w.longestDarkH)} in the first ${s.windowDays} days.`);
  const r = s.robust.result;
  if (r) lines.push(`- **Recommended target:** the robust aim, which keeps ${pct(r.robust.pq)} sunlight in 9 of 10 landings versus ${pct(r.bestNominal.pq)} at the brightest point.`);
  lines.push("", "For the battery and radio contact, open **02 Mission**.");
  return {
    text: lines.filter((l, i) => l || i > 0).join("\n").trim(),
    proposals: [proposal("Open the full planner", ["Go to 02 Mission"], { mode: "planner" })],
    chips: [{ label: "Explain my choices", intent: { kind: "choices" }, primary: true }, { label: "Help me pick a better date", intent: { kind: "dateHelper" } }, BACK],
  };
}

// ---------------------------------------------------------------------------------------------- walkthrough / next step
interface StepDef {
  title: string;
  why: (c: GuideCtx) => string;
  spot: SpotId;
  card?: (c: GuideCtx) => Proposal;
  extra?: (c: GuideCtx) => Chip[];
  /** completed since the step started (start = state when the step was shown) */
  done: (start: AppState, cur: AppState) => boolean;
}

export const TOUR_STEPS: StepDef[] = [
  {
    title: "Choose a site",
    why: (c) => `First, where to land. You're looking at **${siteName(c)}**: ${SITE_PLAIN[c.s.siteId]}\n\nKeep it, or pick another with **Site** at the top of the screen. Not sure? I can help you choose.`,
    spot: "site",
    extra: (c) => [{ label: `Keep ${siteName(c)}`, intent: { kind: "tour", step: 1 }, primary: true }, { label: "Help me choose a site", intent: { kind: "siteHelper" } }],
    done: (a, b) => a.siteId !== b.siteId,
  },
  {
    title: "Pick a landing date",
    why: (c) => `Next, when to land. At the south pole the Sun circles low along the horizon and keeps hiding behind hills, so the date decides how much sunshine you get after landing and when the first long night comes.\n\nYou're landing on **${fmtDate(c.s.landingIdx, false)}**. Change it with the **‹ ›** buttons at the top, or drag the calendar at the bottom.`,
    spot: "calendar",
    extra: () => [{ label: "Keep this date", intent: { kind: "tour", step: 2 }, primary: true }, { label: "Help me pick a date", intent: { kind: "dateHelper" } }],
    done: (a, b) => a.landingIdx !== b.landingIdx,
  },
  {
    title: "Allow for landing errors",
    why: () => "Real landers miss their target a little, like a dart landing around the bullseye. Turn on **landing uncertainty** so Penumbra checks what happens if you miss. ±100 m is a typical choice; NASA asks crewed landers for about 100 m.",
    spot: "uncertainty",
    card: () => uncertaintyOn(100),
    done: (_a, b) => b.uncertainty.enabled,
  },
  {
    title: "Find a safer target",
    why: () => "Now let Penumbra look for the **robust aim**: a spot that stays sunny even if you miss. It tries thousands of possible targets, imagines many landings around each, and keeps the one that does best on a bad day.",
    spot: "robustBtn",
    card: () => proposal("Find and aim at the robust aim", ["Run Find robust aim, then aim at the robust aim", "Go to 02 Mission"], { mode: "planner", aim: { kind: "robust" } }),
    done: (_a, b) => b.robust.status === "done",
  },
  {
    title: "Look at the skyline",
    why: () => "Look at the **skyline** from your landing spot: the real hills around you, with the Sun and Earth moving along them. It shows why a place is sunny or dark.",
    spot: "skylineTab",
    card: () => proposal("Show the skyline at my aim", ["Go to 02 Mission", "Show the skyline"], { mode: "planner", view: "sky" }),
    done: (_a, b) => b.view === "sky" || b.progress.sky,
  },
  {
    title: "Compare the sites",
    why: () => "See how your site ranks against the other four for the same date, each judged the same way.",
    spot: "compareNav",
    card: () => proposal("Compare all five sites", ["Go to 04 Compare", "Compare: all five sites"], { mode: "compare", compareIds: ALL_SITES }),
    done: (_a, b) => b.mode === "compare" || b.progress.compare,
  },
  {
    title: "Save your decision",
    why: () => "Finally, **export** your decision: site, date, target, results and data sources in one file you can share.",
    spot: "export",
    card: () => proposal("Open the export dialog", ["Open: Export decision summary"], { dialog: "export" }),
    done: (_a, b) => b.dialog === "export" || b.progress.export,
  },
];

export function tourStep(step: number, c: GuideCtx, prefix = ""): GuideReply {
  if (step >= TOUR_STEPS.length)
    return {
      text: `${prefix}**That's the whole plan. Well done!** You've chosen a site and date, allowed for landing errors, found a safer target, checked the skyline, compared sites and saved your decision.\n\nYou can now try other dates or sites and ask me to explain anything.`,
      chips: [{ label: "Explain my choices", intent: { kind: "choices" }, primary: true }, { label: "Help me pick a better date", intent: { kind: "dateHelper" } }, BACK],
      tour: null,
    };
  const d = TOUR_STEPS[step];
  return {
    text: `${prefix}${d.why(c)}`,
    proposals: d.card ? [d.card(c)] : [],
    spot: d.spot,
    progress: { step: step + 1, total: TOUR_STEPS.length, title: d.title },
    chips: [...(d.extra?.(c) ?? []), showMe(d.spot), { label: "Skip this step", intent: { kind: "tour", step: step + 1 } }, { label: "Stop the walkthrough", intent: { kind: "stopTour" } }],
    tour: step,
  };
}

/** The first mission-sequence step not done yet (site and date always count as done). */
export function nextStepIndex(s: AppState): number | null {
  for (let i = 2; i < TOUR_STEPS.length; i++) if (!TOUR_STEPS[i].done(s, s)) return i;
  return null;
}

export function nextStepReply(c: GuideCtx, short = false): GuideReply {
  const i = nextStepIndex(c.s);
  if (i === null)
    return {
      text: "You've done every step. Try other dates or accuracies to see how sensitive your choice is.",
      chips: [{ label: "Help me pick a better date", intent: { kind: "dateHelper" }, primary: true }, { label: "Try other landing accuracies", intent: { kind: "whatif", id: "accuracy" } }, BACK],
    };
  const d = TOUR_STEPS[i];
  const why = short ? d.why(c).split(/(?<=\.)\s/)[0] : d.why(c);
  return {
    text: `**Next step: ${d.title.toLowerCase()}.** ${why}`,
    proposals: d.card ? [d.card(c)] : [],
    spot: d.spot,
    chips: [{ label: "Explain my choices", intent: { kind: "choices" } }, { label: "Walk me through everything", intent: { kind: "tour", step: 0 } }, BACK],
  };
}

// ---------------------------------------------------------------------------------------------- quick comparisons (from the menu)
async function whatifAccuracy(c: GuideCtx, api: GuideApi): Promise<GuideReply> {
  const { s } = c;
  const q = s.percentile;
  const radii = [50, 100, 400];
  const res = await Promise.all(radii.map((radius) => api.landingRisk({ site: s.siteId, aim: s.aim, model: { kind: "circular", radius }, enabled: true, percentile: q, seed: 7 })));
  const nominal = res[0].nominal;
  const rows = radii.map((rad, i) => `- **±${rad} m:** ${P(q)} ${pct(res[i].p[q], 1)} (lose ${(nominal - res[i].p[q]).toFixed(1)} points)`);
  const spread = res[0].p[q] - res[2].p[q];
  const verdictText = spread < 5 ? "**In short:** at this spot, landing precision **doesn't matter much**." : spread < 15 ? "**In short:** landing precision **matters** here." : "**In short:** landing precision **matters a lot** here: the sunny area is small or surrounded by shadow, so a safer target (the robust aim) is worth it.";
  return {
    text: `${verdictText}\n\nSunlight on a bad day (${P(q)}: ${IN_N[q]} landings do at least this well) at your aim, for three landing accuracies. A perfect landing gets ${pct(nominal)}.\n\n${rows.join("\n")}`,
    proposals: s.uncertainty.enabled ? [] : [uncertaintyOn(100)],
    chips: [{ label: "Compare robustness levels", intent: { kind: "whatif", id: "levels" } }, { label: "What does landing accuracy mean?", intent: { kind: "choice", id: "accuracy" } }, BACK],
  };
}

function whatifLevels(c: GuideCtx): GuideReply {
  const { s, m } = c;
  if (!s.uncertainty.enabled) return { text: "Caution levels need landing accuracy to be set. Turn it on first, then ask again.", proposals: [uncertaintyOn(100)], chips: [BACK] };
  if (!riskReady(m) || !ok(m.risk!.p[10])) return { text: "Open **02 Mission** or **03 Briefing** and wait for the numbers, then ask again.", chips: [BACK] };
  const p = m.risk!.p;
  const levels: Percentile[] = [50, 20, 10, 5];
  const words: Record<Percentile, string> = { 50: "an ordinary day", 20: "a somewhat unlucky day", 10: "a bad day (sensible default)", 5: "a really bad day" };
  const rows = levels.map((l) => `- **${P(l)}**, planning for ${words[l]}: ${pct(p[l], 1)}. ${IN_N[l]} landings do at least this well.`);
  return {
    text: `How careful should the plan be? At your aim with a ${zone(s)} zone (a perfect landing gets ${pct(m.risk!.nominal)}):\n\n${rows.join("\n")}\n\nP10 is a sensible choice for planning; pick P05 if losing the mission to darkness is not an option. Change it under **Robustness level** in the mission card.`,
    spot: "level",
    chips: [showMe("level"), { label: "Try other landing accuracies", intent: { kind: "whatif", id: "accuracy" } }, BACK],
  };
}

async function whatifSites(c: GuideCtx, api: GuideApi): Promise<GuideReply> {
  const { s } = c;
  const q = s.percentile;
  const res = await compareAll(c, api, ALL_SITES, s.uncertainty.radius, q);
  const byId = new Map(res.rows.map((r) => [r.site, r]));
  const rows = res.ranking.map((id, i) => {
    const r = byId.get(id)!;
    return `${i + 1}. **${r.name}**: ${pct(pq(r, q))} sunlight on a bad day, longest darkness ${duration(r.longestDarkH)}, Earth in view ${pct(r.earthPct)}`;
  });
  const best = res.ranking[0];
  const proposals = [proposal("Open the Compare page with all five sites", ["Go to 04 Compare", "Compare: all five sites"], { mode: "compare", compareIds: ALL_SITES })];
  if (best !== s.siteId) proposals.push(proposal(`Switch to ${SITE_NAMES[best]}`, [`Site: ${SITE_NAMES[s.siteId]} → ${SITE_NAMES[best]} (aim resets to its brightest point)`, "Go to 02 Mission"], { site: best, mode: "planner" }));
  return {
    text: `**In short:** for a landing on ${fmtDate(s.landingIdx, false)}, **${SITE_NAMES[best]}** keeps the most sunlight on a bad day.\n\nAll five sites, ranked by sunlight in the first ${Math.round(res.window.hours / 24)} days at each site's safest target (${P(q)}, ±${s.uncertainty.radius} m landing zone):\n\n${rows.join("\n")}`,
    proposals,
    chips: [{ label: "Help me choose based on what matters to me", intent: { kind: "siteHelper" }, primary: true }, { label: "Help me pick a landing date", intent: { kind: "dateHelper" } }, BACK],
  };
}

/** Days of the year ranked by mean sunlight over the window starting that day (from the backend's daily values);
 *  equally sunny days (to 0.1 point) are ranked by `tie` (higher first, e.g. battery endurance), then by date. */
export function bestDays(daily: ArrayLike<number>, windowDays: number, count = 3, minGap = 5, tie?: (day: number) => number): { day: number; pct: number }[] {
  const n = daily.length - windowDays + 1;
  const score: number[] = [];
  for (let d = 0; d < n; d++) {
    let sum = 0;
    for (let k = 0; k < windowDays; k++) sum += daily[d + k];
    score.push(sum / windowDays);
  }
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const order = score.map((_, d) => d).sort((a, b) => r1(score[b]) - r1(score[a]) || (tie ? tie(b) - tie(a) : 0) || a - b);
  const out: { day: number; pct: number }[] = [];
  for (const d of order) {
    if (out.every((o) => Math.abs(o.day - d) >= minGap)) out.push({ day: d, pct: score[d] });
    if (out.length === count) break;
  }
  return out;
}

async function enduranceMap(c: GuideCtx, api: GuideApi, windowDays: number): Promise<Map<number, number | null> | null> {
  if (!api.endurance) return null;
  const en = await api.endurance(c.s.siteId, c.s.aim, vehicleOf(c.s), windowDays).catch(() => null);
  return en ? new Map(en.days.map((d, i) => [d, en.endurance_days[i]])) : null;
}

async function whatifDates(c: GuideCtx, api: GuideApi): Promise<GuideReply> {
  return dateHelper({ kind: "dateHelper", window: [14, 30, 90].includes(c.s.windowDays) ? (c.s.windowDays as 14 | 30 | 90) : 30, priority: "sun" }, c, api);
}

// ---------------------------------------------------------------------------------------------- typed what-ifs
async function whatifDate(day: number, c: GuideCtx, api: GuideApi): Promise<GuideReply> {
  const { s, m } = c;
  const wd = s.windowDays;
  if (day < 0 || day > lastLandingDay(wd))
    return { text: `I can only plan landings in 2027 that leave room for a ${wd}-day mission, so the latest date is ${fmtDate(lastLandingDay(wd) * 24, false)}.`, chips: [{ label: "Help me pick a landing date", intent: { kind: "dateHelper" } }, BACK] };
  const idx = day * 24 + hourOf(s);
  if (Math.floor(s.landingIdx / 24) === day) return { text: `You're already landing on ${fmtDate(idx, false)}.\n\n${explainChoice("date", c)}`, chips: [BACK] };
  const [nv, cv] = await Promise.all([api.visibility(visFor(s, idx, wd * 24)), visReady(m) ? Promise.resolve(null) : api.visibility(visFor(s, s.landingIdx, wd * 24))]);
  const a = nv.summary;
  const b = cv ? cv.summary : m.vis!.summary;
  const sunDays = (x: typeof a) => ((x.sunlightPct / 100) * wd).toFixed(1).replace(/\.0$/, "");
  const better = a.sunlightPct - b.sunlightPct;
  const word = Math.abs(better) < 2 ? "about as sunny as" : better > 0 ? "sunnier than" : "darker than";
  const batt = a.enduranceDays == null && b.enduranceDays != null ? " and the battery would last the whole mission" : a.enduranceDays != null && b.enduranceDays == null ? ", but the battery would run out" : "";
  return {
    text:
      `**In short:** landing on **${fmtDate(idx, false)}** is ${word} your current date (${fmtDate(s.landingIdx, false)})${batt}.\n\n` +
      `In the first ${wd} days after landing:\n\n` +
      `- **Sunshine:** about ${sunDays(a)} days' worth, versus ${sunDays(b)} now\n` +
      `- **Longest darkness:** ${duration(a.longestDarkH)}, versus ${duration(b.longestDarkH)} now\n` +
      `- **First darkness:** ${a.darkStartsInH == null ? "none in this period" : `after ${duration(a.darkStartsInH)}`}, versus ${b.darkStartsInH == null ? "none" : `after ${duration(b.darkStartsInH)}`} now\n` +
      `- **Battery (${vehicleOf(s)?.name ?? "vehicle"}):** ${battery(a.enduranceDays, wd)}, versus ${b.enduranceDays == null ? "lasting all the way" : `about ${b.enduranceDays.toFixed(1)} days`} now\n` +
      `- **Earth in view:** ${pct(a.earthPct)}, versus ${pct(b.earthPct)} now`,
    proposals: [proposal(`Land on ${fmtDate(idx, false)}`, [`Landing date: ${fmtDate(s.landingIdx)} → ${fmtDate(idx)}`], { landingIdx: idx })],
    chips: [{ label: "Help me pick the best date", intent: { kind: "dateHelper" } }, showMe("calendar"), BACK],
  };
}

async function compareAll(c: GuideCtx, api: GuideApi, sites: SiteId[], radius: number, q: Percentile, window?: number) {
  const { s } = c;
  const veh = vehicleOf(s);
  const wd = window ?? s.windowDays;
  return api.compare(sites, { model: { kind: "circular", radius }, enabled: true, percentile: q, seed: 7 }, {
    startIdx: s.landingIdx, hours: wd * 24, earthMarginDeg: s.earthMarginDeg, dsnMaskDeg: s.dsnMaskDeg, vehicle: veh, headingDeg: s.headingDeg, autoHeading: s.headingAuto,
  });
}

const pq = (r: CompareRow, q: Percentile) => (q === 50 ? r.p50 : q === 20 ? r.p20 : q === 10 ? r.p10 : r.p05);

async function whatifSite(site: SiteId, c: GuideCtx, api: GuideApi): Promise<GuideReply> {
  const { s } = c;
  if (site === s.siteId) return { text: `You're already at ${SITE_NAMES[site]}.\n\n${explainChoice("site", c)}`, chips: [{ label: "Help me choose a site", intent: { kind: "siteHelper" } }, BACK] };
  const q = s.percentile;
  const res = await compareAll(c, api, [s.siteId, site], s.uncertainty.radius, q);
  const cur = res.rows.find((r) => r.site === s.siteId)!;
  const oth = res.rows.find((r) => r.site === site)!;
  const d = pq(oth, q) - pq(cur, q);
  const word = Math.abs(d) < 2 ? "about as sunny as" : d > 0 ? "sunnier than" : "darker than";
  return {
    text:
      `**In short:** for a landing on ${fmtDate(s.landingIdx, false)}, **${oth.name}** is ${word} ${cur.name} on a bad day.\n\n${oth.name} is ${SITE_PLAIN[site]}\n\n` +
      `Each site at its safest target, first ${Math.round(res.window.hours / 24)} days, ${P(q)}, ±${s.uncertainty.radius} m landing zone:\n\n` +
      `- **Sunlight on a bad day:** ${pct(pq(oth, q))} at ${oth.name}, versus ${pct(pq(cur, q))} at ${cur.name}\n` +
      `- **Longest darkness:** ${duration(oth.longestDarkH)}, versus ${duration(cur.longestDarkH)}\n` +
      `- **Earth in view:** ${pct(oth.earthPct)}, versus ${pct(cur.earthPct)}\n` +
      `- **NASA's antennas can reach you:** ${pct(oth.dsnPct)} of the time, versus ${pct(cur.dsnPct)}`,
    proposals: [proposal(`Switch to ${oth.name}`, [`Site: ${cur.name} → ${oth.name} (aim resets to its brightest point)`, "Go to 02 Mission"], { site, mode: "planner" })],
    chips: [{ label: "Help me choose a site", intent: { kind: "siteHelper" } }, BACK],
  };
}

async function whatifRadius(radius: number, c: GuideCtx, api: GuideApi): Promise<GuideReply> {
  const { s, m } = c;
  const r = snapRadius(radius);
  const q = s.percentile;
  const res = await api.landingRisk({ site: s.siteId, aim: s.aim, model: { kind: "circular", radius: r }, enabled: true, percentile: q, seed: 7 });
  const now = s.uncertainty.enabled && riskReady(m) && ok(m.risk!.p[q]) ? `versus ${pct(m.risk!.p[q])} with your current ${zone(s)} zone` : `versus ${pct(res.nominal)} for a perfect landing`;
  const drop = res.nominal - res.p[q];
  return {
    text: `**In short:** with a **±${r} m** landing zone, on a bad day (${IN_N[q]} landings do better) you'd still get **${pct(res.p[q])}** sunlight at your aim, ${now}.\n\nThat's ${drop.toFixed(1)} points less than a perfect landing (${pct(res.nominal)}): ${drop < 5 ? "landing precision doesn't matter much here" : drop < 15 ? "landing precision matters here" : "landing precision matters a lot here"}.`,
    proposals: s.uncertainty.enabled && s.uncertainty.radius === r && s.uncertainty.model === "circular" ? [] : [proposal(`Use a ±${r} m landing zone`, [`Landing uncertainty: circular ±${r} m`], { uncertainty: { enabled: true, model: "circular", radius: r } })],
    chips: [{ label: "Try other landing accuracies", intent: { kind: "whatif", id: "accuracy" } }, BACK],
  };
}

// ---------------------------------------------------------------------------------------------- decision helpers
const SITE_PRIORITY_LABEL: Record<SitePriority, string> = { sun: "the most sunlight", contact: "staying in touch with Earth", nights: "getting through the long nights", balance: "a bit of everything" };

async function siteHelper(i: Extract<Intent, { kind: "siteHelper" }>, c: GuideCtx, api: GuideApi): Promise<GuideReply> {
  if (!i.priority)
    return {
      text: "Let's find the right site for you. **What matters most for your mission?**",
      chips: [
        { label: "The most sunlight", intent: { ...i, priority: "sun" }, primary: true },
        { label: "Staying in touch with Earth", intent: { ...i, priority: "contact" } },
        { label: "Getting through the long nights", intent: { ...i, priority: "nights" } },
        { label: "A bit of everything", intent: { ...i, priority: "balance" } },
      ],
    };
  if (!i.radius)
    return {
      text: "**How precisely can your lander touch down?** Landers never land exactly on target. If you're not sure, choose Typical.",
      chips: [
        { label: "Very precisely (within 50 m)", intent: { ...i, radius: 50 } },
        { label: "Typical (within 100 m)", intent: { ...i, radius: 100 }, primary: true },
        { label: "Not very precisely (within 400 m)", intent: { ...i, radius: 400 } },
        { label: "Not sure", intent: { ...i, radius: 100 } },
      ],
    };
  if (!i.q)
    return {
      text: "**How careful should the plan be?** Careful plans judge each site by its bad days, not its average.",
      chips: [
        { label: "Careful: plan for a bad day (recommended)", intent: { ...i, q: 10 }, primary: true },
        { label: "Very careful: plan for a really bad day", intent: { ...i, q: 5 } },
        { label: "Normal: plan for an ordinary day", intent: { ...i, q: 50 } },
      ],
    };
  const { s } = c;
  const res = await compareAll(c, api, ALL_SITES, i.radius, i.q);
  const score = (r: CompareRow) =>
    i.priority === "sun"
      ? pq(r, i.q!)
      : i.priority === "contact"
        ? r.dsnPct * 1000 + r.earthPct + pq(r, i.q!) / 1000
        : i.priority === "nights"
          ? -r.longestDarkH * 1000 + pq(r, i.q!)
          : 0.5 * pq(r, i.q!) + 25 * (r.earthPct / 100) + 25 * (1 - Math.min(r.longestDarkH, 240) / 240);
  const ranked = [...res.rows].sort((a, b) => score(b) - score(a));
  const [pick, second] = ranked;
  const why: string[] = [];
  const v = (r: CompareRow) => pct(pq(r, i.q!));
  if (i.priority === "sun" || i.priority === "balance") why.push(`- **Sunlight on a bad day:** ${v(pick)}, versus ${v(second)} at ${second.name}, the runner-up`);
  if (i.priority === "contact" || i.priority === "balance") why.push(`- **Radio contact:** NASA's antennas can reach it ${pct(pick.dsnPct)} of the time and Earth is in view ${pct(pick.earthPct)}, versus ${pct(second.dsnPct)} and ${pct(second.earthPct)} at ${second.name}`);
  if (i.priority === "nights" || i.priority === "balance") why.push(`- **Longest darkness:** ${duration(pick.longestDarkH)}, versus ${duration(second.longestDarkH)} at ${second.name}`);
  // be honest about what the pick gives up: compare it with the best site on each factor it wasn't chosen for
  const top = <K extends (r: CompareRow) => number>(f: K, low = false) => [...res.rows].sort((a, b) => (low ? f(a) - f(b) : f(b) - f(a)))[0];
  const sunBest = top((r) => pq(r, i.q!));
  const earthBest = top((r) => r.earthPct);
  const darkBest = top((r) => r.longestDarkH, true);
  const trades: string[] = [];
  if (i.priority !== "sun" && sunBest !== pick && pq(sunBest, i.q!) - pq(pick, i.q!) >= 10) trades.push(`it gets less sunlight on a bad day than ${sunBest.name} (${v(pick)} versus ${v(sunBest)})`);
  if (i.priority !== "contact" && earthBest !== pick && earthBest.earthPct - pick.earthPct >= 15) trades.push(`Earth is in view less often than at ${earthBest.name} (${pct(pick.earthPct)} versus ${pct(earthBest.earthPct)})`);
  if (i.priority !== "nights" && darkBest !== pick && pick.longestDarkH - darkBest.longestDarkH >= 24) trades.push(`its longest darkness is longer than at ${darkBest.name} (${duration(pick.longestDarkH)} versus ${duration(darkBest.longestDarkH)})`);
  const trade = trades.length ? `\n\n**Trade-off:** ${trades.slice(0, 2).join("; and ")}.` : "";
  const ranking = ranked.map((r, k) => `${k + 1}. ${r.name}`).join(" · ");
  const changes: ProposalChanges = { mode: "planner", uncertainty: { enabled: true, model: "circular", radius: i.radius }, percentile: i.q };
  const lines = [`Landing uncertainty: circular ±${i.radius} m`, `Robustness level: ${P(i.q)}`, "Go to 02 Mission"];
  if (pick.site !== s.siteId) {
    changes.site = pick.site;
    lines.unshift(`Site: ${SITE_NAMES[s.siteId]} → ${pick.name} (aim resets to its brightest point)`);
  }
  return {
    text:
      `**My pick: ${pick.name}.**${pick.site === s.siteId ? " That's the site you already have." : ""} It's ${SITE_PLAIN[pick.site]}\n\n` +
      `Why, for ${SITE_PRIORITY_LABEL[i.priority]}, with a landing on ${fmtDate(s.landingIdx, false)}, a ±${i.radius} m landing zone and planning for ${i.q === 50 ? "an ordinary day" : i.q === 5 ? "a really bad day" : "a bad day"}:\n\n${why.join("\n")}${trade}\n\nFull ranking: ${ranking}.`,
    proposals: [proposal(pick.site === s.siteId ? "Use these settings" : `Plan at ${pick.name}`, lines, changes)],
    chips: [
      { label: "Now help me pick a date", intent: { kind: "dateHelper" }, primary: true },
      { label: `Compare with ${second.name}`, intent: { kind: "whatifSite", site: second.site } },
      { label: "Start again", intent: { kind: "siteHelper" } },
    ],
  };
}

async function dateHelper(i: Extract<Intent, { kind: "dateHelper" }>, c: GuideCtx, api: GuideApi): Promise<GuideReply> {
  const { s } = c;
  if (!i.window)
    return {
      text: "Let's find a good landing date. **How long does your mission need to last after landing?**",
      chips: ([14, 30, 90] as const).map((w) => ({ label: `${w} days`, intent: { ...i, window: w }, primary: w === s.windowDays || (w === 30 && ![14, 30, 90].includes(s.windowDays)) })),
    };
  if (!i.priority)
    return {
      text: "**What matters most after landing?**",
      chips: [
        { label: "The most sunshine", intent: { ...i, priority: "sun" }, primary: true },
        { label: "The battery never running out", intent: { ...i, priority: "battery" } },
        { label: "Staying in touch with Earth", intent: { ...i, priority: "contact" } },
      ],
    };
  const wd = i.window;
  const [year, endu] = await Promise.all([api.visibility(visFor(s, s.landingIdx, 24)), enduranceMap(c, api, wd)]);
  const eKey = (d: number) => (endu ? (endu.get(d) ?? Infinity) : 0); // null = never depleted = best
  let picks: number[];
  if (i.priority === "battery") {
    const sunny = bestDays(year.dailySun, wd, 400, 1, eKey);
    const sun = new Map(sunny.map((x) => [x.day, x.pct]));
    const order = [...sun.keys()].sort((a, b) => eKey(b) - eKey(a) || sun.get(b)! - sun.get(a)! || a - b);
    picks = [];
    for (const d of order) if (picks.every((p) => Math.abs(p - d) >= 5) && picks.push(d) >= 3) break;
  } else if (i.priority === "sun") {
    picks = bestDays(year.dailySun, wd, 3, 5, endu ? eKey : undefined).map((x) => x.day);
  } else {
    const cands = bestDays(year.dailySun, wd, 8, 5, endu ? eKey : undefined).map((x) => x.day);
    const vs = await Promise.all(cands.map((d) => api.visibility(visFor(s, d * 24 + hourOf(s), wd * 24))));
    picks = cands.map((d, k) => ({ d, v: vs[k].summary })).sort((a, b) => b.v.dsnPct - a.v.dsnPct || b.v.sunlightPct - a.v.sunlightPct).slice(0, 3).map((x) => x.d);
  }
  const idx = (d: number) => d * 24 + hourOf(s);
  const [best, ...alts] = picks;
  const detail = (await api.visibility(visFor(s, idx(best), wd * 24))).summary;
  const e = endu?.get(best);
  const sunDays = ((detail.sunlightPct / 100) * wd).toFixed(1).replace(/\.0$/, "");
  const goal = i.priority === "battery" ? "the battery lasting" : i.priority === "contact" ? "staying in touch with Earth" : "sunshine";
  const altText = alts.length ? `\n\nOther good dates: ${alts.map((d) => `**${fmtDate(idx(d), false)}**${endu ? ` (battery ${battery(endu.get(d) ?? null, wd)})` : ""}`).join(", ")}.` : "";
  const changes: ProposalChanges = { landingIdx: idx(best) };
  const lines = [`Landing date: ${fmtDate(s.landingIdx)} → ${fmtDate(idx(best))}`];
  if (wd !== s.windowDays) {
    changes.windowDays = wd;
    lines.push(`Mission window: ${s.windowDays} → ${wd} days`);
  }
  if (s.mode !== "planner" && s.mode !== "simple") {
    changes.mode = "planner";
    lines.push("Go to 02 Mission");
  }
  return {
    text:
      `**My pick: land on ${fmtDate(idx(best), false)}.** It's the best date in 2027 for ${goal} at your current site and target.\n\n` +
      `In the first ${wd} days after landing:\n\n` +
      `- **Sunshine:** about ${sunDays} days' worth (${pct(detail.sunlightPct)} of the time)\n` +
      `- **Longest darkness:** ${duration(detail.longestDarkH)}${detail.darkStartsInH == null ? ", and none at all in this period" : `; the first starts after ${duration(detail.darkStartsInH)}`}\n` +
      (e !== undefined ? `- **Battery (${vehicleOf(s)?.name ?? "vehicle"}):** ${battery(e, wd)}\n` : "") +
      `- **Earth in view:** ${pct(detail.earthPct)}; NASA's antennas can reach you ${pct(detail.dsnPct)} of the time` +
      altText,
    proposals: Math.floor(s.landingIdx / 24) === best && wd === s.windowDays ? [] : [proposal(`Land on ${fmtDate(idx(best), false)}`, lines, changes)],
    chips: [{ label: "Explain the landing date", intent: { kind: "choice", id: "date" } }, showMe("calendar"), { label: "Start again", intent: { kind: "dateHelper" } }, BACK],
  };
}

// ---------------------------------------------------------------------------------------------- typed commands
function command(e: Entities, c: GuideCtx): GuideReply {
  const { s } = c;
  const ch: ProposalChanges = {};
  const lines: string[] = [];
  if (e.site && e.site !== s.siteId) {
    ch.site = e.site;
    lines.push(`Site: ${SITE_NAMES[s.siteId]} → ${SITE_NAMES[e.site]} (aim resets to its brightest point)`);
  }
  if (e.mode && e.mode !== s.mode) {
    ch.mode = e.mode;
    lines.push(`Go to ${SECTION_NAME[e.mode]}`);
  }
  if (e.view) {
    ch.view = e.view;
    if (s.mode !== "planner" && !ch.mode) ch.mode = "planner";
    lines.push(e.view === "sky" ? "Show the skyline" : "Show the landing map");
  }
  const wd = e.windowDays ?? s.windowDays;
  if (e.windowDays && e.windowDays !== s.windowDays) {
    ch.windowDays = e.windowDays;
    lines.push(`Mission window: ${s.windowDays} → ${e.windowDays} days`);
  }
  if (e.day !== undefined) {
    if (e.day > lastLandingDay(wd)) return { text: `That date leaves no room for a ${wd}-day mission in 2027; the latest landing is ${fmtDate(lastLandingDay(wd) * 24, false)}.`, chips: [BACK] };
    const idx = e.day * 24 + hourOf(s);
    if (idx !== s.landingIdx) {
      ch.landingIdx = idx;
      lines.push(`Landing date: ${fmtDate(s.landingIdx)} → ${fmtDate(idx)}`);
    }
  }
  if (e.radius) {
    const r = snapRadius(e.radius);
    ch.uncertainty = { enabled: true, model: "circular", radius: r };
    lines.push(`Landing uncertainty: circular ±${r} m`);
  } else if (e.uncertainty) {
    ch.uncertainty = { enabled: e.uncertainty === "on" };
    lines.push(`Landing uncertainty: ${e.uncertainty}`);
  }
  if (e.percentile && e.percentile !== s.percentile) {
    ch.percentile = e.percentile;
    lines.push(`Robustness level: ${P(s.percentile)} → ${P(e.percentile)}`);
  }
  if (e.vehicle) {
    const v = s.vehicles.find((x) => x.id === e.vehicle);
    if (v && v.id !== s.vehicleId) {
      ch.vehicleId = v.id;
      lines.push(`Vehicle: ${v.name}`);
    }
  }
  if (e.robust === "command") {
    ch.aim = { kind: "robust" };
    ch.mode = ch.mode ?? (s.mode === "planner" ? undefined : "planner");
    lines.push("Run Find robust aim, then aim at the robust aim");
  } else if (e.robust === "find") {
    ch.runRobustAim = true;
    if (s.mode !== "planner") ch.mode = "planner";
    lines.push("Run Find robust aim");
  }
  if (e.dialog) {
    ch.dialog = e.dialog;
    lines.push(`Open: ${e.dialog === "export" ? "Export decision summary" : e.dialog === "data" ? "Data and provenance" : "Power scenario"}`);
  }
  if (ch.mode === undefined) delete ch.mode;
  if (!lines.length) return { text: "That's already how things are set.", chips: [{ label: "Explain my choices", intent: { kind: "choices" } }, BACK] };
  return {
    text: "Sure. Here's that change; click **Apply** and I'll explain what it means for your mission.",
    proposals: [proposal(lines.length === 1 ? lines[0].split(" (")[0] : "Change my settings", lines, ch)],
    chips: [BACK],
  };
}

// ---------------------------------------------------------------------------------------------- dispatcher
export async function respond(intent: Intent, c: GuideCtx, api: GuideApi): Promise<GuideReply> {
  switch (intent.kind) {
    case "greet":
      return greeting(c.s, siteName(c));
    case "menu":
      return { text: "Here's what I can help with:", chips: menuChips(c.s) };
    case "screen":
      return { text: SCREENS[c.s.mode], chips: [{ label: "Walk me through it", intent: { kind: "tour", step: 0 }, primary: true }, { label: "Explain my choices", intent: { kind: "choices" } }, BACK] };
    case "explain":
      if (c.s.mode === "simple") return explainBriefing(c);
      if (c.s.mode === "compare") return whatifSites(c, api);
      if (c.s.mode === "planner") return explainMission(c);
      return { text: "Your results appear in **02 Mission** (the full planner) and **03 Briefing** (a plain summary). Open one and ask again.", proposals: [proposal("Open the mission planner", ["Go to 02 Mission"], { mode: "planner" })], chips: [BACK] };
    case "choices": {
      const notReady = !riskReady(c.m) && (c.s.mode === "planner" || c.s.mode === "simple");
      const body = explainAllChoices(c);
      return {
        text: `Here are your choices, in plain words.${notReady ? " (Some numbers are still being worked out; ask again in a moment for the full picture.)" : ""}\n\n${body}`,
        chips: [
          { label: "What should I do next?", intent: { kind: "next" }, primary: true },
          { label: "Point at something to explain it", intent: { kind: "whatsthis" } },
          { label: "Help me choose a site", intent: { kind: "siteHelper" } },
          { label: "Help me pick a landing date", intent: { kind: "dateHelper" } },
          BACK,
        ],
      };
    }
    case "choice":
      return { text: explainChoice(intent.id, c), chips: [{ label: "Tell me more", intent: { kind: "more", id: intent.id } }, { label: "Explain all my choices", intent: { kind: "choices" } }, { label: "What should I do next?", intent: { kind: "next" }, primary: true }, BACK] };
    case "more":
      return { text: explainMore(intent.id), chips: [{ label: "Explain my choices", intent: { kind: "choices" } }, { label: "What should I do next?", intent: { kind: "next" }, primary: true }, BACK] };
    case "whatsthis":
      return { text: "Tap anything on the screen (a number, the calendar, the map, a button) and I'll explain it. Press Esc or tap here to cancel." };
    case "next":
      return nextStepReply(c);
    case "tour":
      return tourStep(intent.step, c, intent.step === 0 ? "Great, let's plan a landing together, one step at a time. I'll explain each choice as we go, and you can let me do the clicking.\n\n" : "");
    case "stopTour":
      return { text: "OK, I've stopped the walkthrough. Pick it up again any time.", chips: [{ label: "Resume the walkthrough", intent: { kind: "tour", step: nextStepIndex(c.s) ?? 0 } }, BACK], tour: null };
    case "terms":
      return { text: "Which word should I explain?", chips: (Object.keys(TERMS) as TermId[]).map((id) => ({ label: TERMS[id].title, intent: { kind: "term", id } })) };
    case "term":
      return { text: `**${TERMS[intent.id].title}.** ${TERMS[intent.id].body}`, chips: [{ label: "Another word", intent: { kind: "terms" } }, BACK] };
    case "howtos":
      return { text: "What would you like to do?", chips: (Object.keys(HOWTO) as HowId[]).map((id) => ({ label: HOWTO[id].title, intent: { kind: "howto", id } })) };
    case "howto": {
      const spot: Partial<Record<HowId, SpotId>> = { site: "site", date: "calendar", uncertaintyOn: "uncertainty", robustAim: "robustBtn", skyline: "skylineTab", compare: "compareNav", exportIt: "export", data: "data", vehicle: "vehicle", settings: "vehicle" };
      const sp = spot[intent.id];
      return { text: `**${HOWTO[intent.id].title}.** ${HOWTO[intent.id].body}`, spot: sp, chips: [...(sp ? [showMe(sp)] : []), { label: "Something else", intent: { kind: "howtos" } }, BACK] };
    }
    case "whatifs":
      return {
        text: "Quick comparisons, worked out by Penumbra from your current settings:",
        chips: [
          { label: "Try other landing accuracies", intent: { kind: "whatif", id: "accuracy" } },
          { label: "Compare caution levels", intent: { kind: "whatif", id: "levels" } },
          { label: "Compare all sites for my date", intent: { kind: "whatif", id: "sites" } },
          { label: "Find the best landing dates", intent: { kind: "whatif", id: "dates" } },
          BACK,
        ],
      };
    case "whatif":
      if (intent.id === "accuracy") return whatifAccuracy(c, api);
      if (intent.id === "levels") return whatifLevels(c);
      if (intent.id === "sites") return whatifSites(c, api);
      return whatifDates(c, api);
    case "whatifDate":
      return whatifDate(intent.day, c, api);
    case "whatifSite":
      return whatifSite(intent.site, c, api);
    case "whatifRadius":
      return whatifRadius(intent.radius, c, api);
    case "siteHelper":
      return siteHelper(intent, c, api);
    case "dateHelper":
      return dateHelper(intent, c, api);
    case "command":
      return command(intent.e, c);
    case "spot":
      return { text: "Here it is.", spot: intent.id };
    case "limits":
      return { text: LIMITATIONS, chips: [{ label: "Can I trust the numbers?", intent: { kind: "trust" } }, BACK] };
    case "trust":
      return { text: TRUST, chips: [{ label: "What are the limits?", intent: { kind: "limits" } }, BACK] };
    case "thanks":
      return { text: "You're welcome! Anything else?", chips: [{ label: "What should I do next?", intent: { kind: "next" }, primary: true }, { label: "Explain my choices", intent: { kind: "choices" } }, BACK] };
  }
}

// ---------------------------------------------------------------------------------------------- typed questions
function bestEntry<T extends string>(text: string, entries: Record<T, { keys: string[] }>): T | null {
  let best: T | null = null;
  let score = 0;
  for (const id of Object.keys(entries) as T[]) {
    const sc = entries[id].keys.reduce((a, k) => (text.includes(k) ? a + k.length : a), 0);
    if (sc > score) [best, score] = [id, sc];
  }
  return best;
}

const SPOT_WORDS: [SpotId, RegExp][] = [
  ["robustBtn", /robust aim|find robust/],
  ["level", /robustness level|caution level|level/],
  ["uncertainty", /uncertainty|landing zone|accuracy|ellipse/],
  ["calendar", /calendar|timeline/],
  ["date", /landing date|date/],
  ["site", /site (menu|picker|button)|site/],
  ["skylineTab", /skyline|horizon/],
  ["vehicle", /vehicle|settings|battery|rover/],
  ["comparePicker", /compare picker/],
  ["compareNav", /compare/],
  ["export", /export|download/],
  ["data", /data|provenance|sources/],
  ["sequence", /sequence|steps/],
  ["kpis", /numbers|results/],
];

const CHOICE_WORDS: [ChoiceId, RegExp][] = [
  ["date", / (landing )?date | day | when /],
  ["site", / site | place | location /],
  ["accuracy", / accuracy | landing zone | uncertainty | precision /],
  ["level", / robustness | caution | level | p10 | p05 | p20 | p50 /],
  ["aim", / aim | target /],
  ["vehicle", / vehicle | rover | lander | battery /],
  ["window", / window | mission length /],
];

/** Map a typed message to a request; null when nothing matches (the panel then offers the topic list). */
export function matchIntent(raw: string): Intent | null {
  const t = normalise(raw);
  const has = (re: RegExp) => re.test(t);
  // "show me where the calendar is"
  if (has(/^ (show me|where is|where are|where can i find|wheres|highlight|point (to|at)) /)) {
    const rest = t.replace(/^ (show me|where is|where are|where can i find|wheres|highlight|point (to|at)) /, " ");
    const sp = SPOT_WORDS.find(([, re]) => re.test(rest));
    if (sp && !extractEntities(raw).day) return { kind: "spot", id: sp[0] };
  }
  if (has(/^ (whats this|what is this|what is that|whats that|explain this|explain that) $/)) return { kind: "whatsthis" };
  if (has(/walk me|walk through|tour|step by step|guide me|tutorial|get started|how do i (start|plan)|plan a landing|getting started|where do i start/)) return { kind: "tour", step: 0 };
  if (has(/ help me (choose|pick|find|decide)| recommend| suggest| which (site|date|day) should| what (site|date) should/))
    return has(/ (date|day|when)/) ? { kind: "dateHelper" } : { kind: "siteHelper" };
  if (has(/ (explain|describe|summari[sz]e)( all)? (my )?(choices|settings|setup|decisions|selections)| what (did|have) i (choose|chosen|pick|picked|set)| my choices | why (did|have) i /)) return { kind: "choices" };
  // "what does my landing date mean", "explain the site", "tell me about this site"
  if (has(/ (explain|tell me about|what does|what is|why|describe) .*(my|the|this|current) /)) {
    const ch = CHOICE_WORDS.find(([, re]) => re.test(t));
    if (ch && has(/ (my|this|current) /)) return { kind: "choice", id: ch[0] };
  }
  const term = bestEntry(t, TERMS);
  const how = bestEntry(t, HOWTO);
  if (term && has(/ what (does|is|are|do) | meaning | mean | define | definition | explain what /)) return { kind: "term", id: term };
  if (how && has(/ how (do|can|to|would) | where (is|do|can) | i want to | can i /)) return { kind: "howto", id: how };
  const e = extractEntities(raw);
  const words = t.trim().split(" ").length;
  if (hasEntities(e)) {
    if (isCommand(raw)) return { kind: "command", e };
    if (isWhatIf(raw) || words <= 4) {
      if (e.day !== undefined) return { kind: "whatifDate", day: e.day };
      if (e.site) return { kind: "whatifSite", site: e.site };
      if (e.radius) return { kind: "whatifRadius", radius: e.radius };
      if (e.percentile) return { kind: "whatif", id: "levels" };
    }
  }
  if (has(/ (best|good|better|sunniest) (landing )?(date|day)| when should i land| which (day|date)/)) return { kind: "whatif", id: "dates" };
  if (has(/ (which|best) site| compare (all )?(the )?sites| rank(ing)? (the )?sites/)) return { kind: "whatif", id: "sites" };
  if (has(/ what if| effect of| does (landing )?accuracy/) && has(/accura|radius|zone|miss/)) return { kind: "whatif", id: "accuracy" };
  if (has(/ (which|what) (robustness |caution )?level| compare (robustness |caution )?levels| which percentile/)) return { kind: "whatif", id: "levels" };
  if (has(/ explain| my results| my numbers| what do (these|my)| how (am i|is my) | is (this|it) (good|ok)/)) return { kind: "explain" };
  if (has(/ next| what now| what should i do/)) return { kind: "next" };
  if (has(/ trust| validat| reliab| how accurate (is|are) (penumbra|the (results|numbers))/)) return { kind: "trust" };
  if (has(/ limit| caveat| weakness| assumption/)) return { kind: "limits" };
  if (has(/ this (screen|page)| where am i| what can i do/)) return { kind: "screen" };
  if (term) return { kind: "term", id: term };
  if (how) return { kind: "howto", id: how };
  if (has(/ help | menu | topics | options /)) return { kind: "menu" };
  // last resort: a single misspelt word close to a site name
  if (words <= 2 && e.site) return { kind: "whatifSite", site: e.site };
  return null;
}
