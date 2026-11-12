import { describe, expect, it } from "vitest";
import { bestDays, greeting, matchIntent, nextStepIndex, respond, TOUR_STEPS, type GuideApi, type GuideCtx } from "../../src/features/assistant/guide/engine";
import { extractEntities, reaction } from "../../src/features/assistant/guide/nlu";
import { explainAccuracy, explainDate, explainLevel, verdict } from "../../src/features/assistant/guide/plain";
import { detectEvents, nudge } from "../../src/features/assistant/guide/watch";
import { getState, type AppState } from "../../src/state/store";
import type { CompareResult, LandingRiskResult, SiteData, VisibilitySeries } from "../../src/types";

const site = { id: "cr1", name: "Connecting Ridge" } as unknown as SiteData;
const risk = (nominal: number, p10: number): LandingRiskResult & { loading: boolean } => ({
  nominal, pq: p10, p: { 50: nominal - 2, 20: nominal - 5, 10: p10, 5: p10 - 4 }, earthPq: 50, samples: [], histogram: [], nGridPoints: 2000, elapsedMs: 1, loading: false,
});
const vis = (over: Partial<VisibilitySeries["summary"]> = {}) => ({ loading: false, summary: { sunlightPct: 90, earthPct: 48, dsnPct: 40, longestDarkH: 32, darkStartsInH: 70, enduranceDays: 14.3, ...over } });
const state = (over: Partial<AppState> = {}): AppState => ({
  ...getState(), mode: "planner", siteId: "cr1", aim: { x: 0, y: 0 }, aimKind: "brightest", percentile: 10, windowDays: 30, landingIdx: 4309,
  uncertainty: { ...getState().uncertainty, enabled: false, model: "circular", radius: 100 }, robust: { status: "idle", stage: 0, result: null, revealed: false },
  view: "map", dialog: null, progress: { sky: false, compare: false, export: false }, ...over,
});
const ctx = (s: AppState, m: GuideCtx["m"] = { risk: null, vis: null }): GuideCtx => ({ s, site, m });
const noApi = {} as GuideApi;
const JUL15 = 181 + 14;

describe("guide: understanding typed text", () => {
  it("finds sites, dates, distances, levels and windows", () => {
    expect(extractEntities("switch to Shackleton").site).toBe("shk");
    expect(extractEntities("what about shakleton?").site).toBe("shk"); // typo
    expect(extractEntities("what if I land on 15 July").day).toBe(JUL15);
    expect(extractEntities("July 15th please").day).toBe(JUL15);
    expect(extractEntities("land on 2027-07-15").day).toBe(JUL15);
    expect(extractEntities("set accuracy to ±400 m").radius).toBe(400);
    expect(extractEntities("use P05").percentile).toBe(5);
    expect(extractEntities("a 90 day mission").windowDays).toBe(90);
    expect(extractEntities("go to the compare page").mode).toBe("compare");
  });

  it("recognises short replies", () => {
    expect(reaction("yes")).toBe("affirm");
    expect(reaction("OK, do it")).toBe("affirm");
    expect(reaction("no thanks")).toBe("deny");
    expect(reaction("show me")).toBe("showme");
    expect(reaction("thanks!")).toBe("thanks");
    expect(reaction("next")).toBe("next");
    expect(reaction("yes but what does P10 mean for my mission exactly")).toBeNull();
  });

  it.each([
    ["Switch to Shackleton", { kind: "command", e: { site: "shk" } }],
    ["what if I land on 15 July?", { kind: "whatifDate", day: JUL15 }],
    ["and Malapert?", { kind: "whatifSite", site: "mal" }],
    ["set accuracy to 400 m", { kind: "command", e: { radius: 400 } }],
    ["400 m?", { kind: "whatifRadius", radius: 400 }],
    ["help me choose a site", { kind: "siteHelper" }],
    ["help me pick a landing date", { kind: "dateHelper" }],
    ["can you recommend a date", { kind: "dateHelper" }],
    ["explain my choices", { kind: "choices" }],
    ["what does my landing date mean?", { kind: "choice", id: "date" }],
    ["show me the calendar", { kind: "spot", id: "calendar" }],
    ["where is the landing date", { kind: "spot", id: "date" }],
    ["What does P10 mean?", { kind: "term", id: "percentile" }],
    ["How do I change the landing date?", { kind: "howto", id: "date" }],
    ["walk me through planning a landing", { kind: "tour", step: 0 }],
    ["can I trust these numbers", { kind: "trust" }],
  ])("%s", (q, want) => {
    expect(matchIntent(q)).toEqual(want);
  });

  it("returns null for things it cannot do", () => {
    expect(matchIntent("write me a poem about cats")).toBeNull();
  });
});

describe("guide: plain-language explanations of choices", () => {
  it("explains the landing date with the mission's numbers", () => {
    const t = explainDate(ctx(state(), { risk: risk(88, 64), vis: vis() }));
    expect(t).toContain("**Landing date: 29 Jun 2027.**");
    expect(t).toContain("sunlight for about **27 of your first 30 days**");
    expect(t).toContain("The first darkness starts after about 2.9 days");
    expect(t).toContain("lasts **32 hours**");
  });

  it("explains landing accuracy with an analogy, off and on", () => {
    expect(explainAccuracy(ctx(state()))).toMatch(/not set \(switched off\).*throwing a dart/s);
    const on = state({ uncertainty: { ...state().uncertainty, enabled: true, radius: 100 } });
    const t = explainAccuracy(ctx(on, { risk: risk(88, 64), vis: null }));
    expect(t).toContain("within **100 m** of your aim, about the length of a football pitch");
    expect(t).toContain("how precisely you land **matters a lot**");
  });

  it("explains the caution level and sums up", () => {
    const on = state({ uncertainty: { ...state().uncertainty, enabled: true } });
    expect(explainLevel(ctx(on, { risk: risk(88, 64), vis: null }))).toContain("**9 in 10** get at least the number shown");
    expect(verdict(ctx(on, { risk: risk(88, 64), vis: vis() }))).toBe(
      "**In short:** a well-lit spot (sunlight 88% of the year); missing your target could cost a lot of light, and the battery would run out after about 14.3 days.",
    );
  });
});

describe("guide: greeting, walkthrough and next step", () => {
  it("greets with context and a suggested first move", () => {
    const g = greeting(state(), "Connecting Ridge");
    expect(g.text).toContain("You're in **Mission**, looking at **Connecting Ridge**");
    expect(g.chips?.find((c) => c.primary)?.intent).toEqual({ kind: "tour", step: 0 });
  });

  it("walks through seven steps with progress, cards and auto-advance checks", async () => {
    const r0 = await respond({ kind: "tour", step: 0 }, ctx(state()), noApi);
    expect(r0.progress).toEqual({ step: 1, total: 7, title: "Choose a site" });
    expect(r0.tour).toBe(0);
    expect(r0.chips?.[0]).toMatchObject({ label: "Keep Connecting Ridge", primary: true });
    const r2 = await respond({ kind: "tour", step: 2 }, ctx(state()), noApi);
    expect(r2.proposals?.[0].changes.uncertainty).toEqual({ enabled: true, model: "circular", radius: 100 });
    expect(r2.spot).toBe("uncertainty");
    const end = await respond({ kind: "tour", step: 7 }, ctx(state()), noApi);
    expect(end.tour).toBeNull();
    const a = state();
    expect(TOUR_STEPS[1].done(a, { ...a, landingIdx: a.landingIdx + 24 })).toBe(true);
    expect(TOUR_STEPS[2].done(a, { ...a, uncertainty: { ...a.uncertainty, enabled: true } })).toBe(true);
    expect(nextStepIndex(a)).toBe(2);
    expect(nextStepIndex({ ...a, uncertainty: { ...a.uncertainty, enabled: true } })).toBe(3);
  });

  it("explains results verdict first", async () => {
    const on = state({ uncertainty: { ...state().uncertainty, enabled: true } });
    const r = await respond({ kind: "explain" }, ctx(on, { risk: risk(88, 64), vis: vis() }), noApi);
    expect(r.text.startsWith("**In short:**")).toBe(true);
    expect(r.text).toContain("**On a bad day (P10): 64%.**");
    expect(r.proposals?.[0].changes).toEqual({ mode: "planner", runRobustAim: true });
  });
});

const row = (id: string, name: string, p10: number, dsn: number, dark: number) =>
  ({ site: id, name, p10, p50: p10, p20: p10, p05: p10, longestDarkH: dark, earthPct: dsn + 5, dsnPct: dsn, windowSunPct: p10 }) as unknown;
const fiveSites = {
  compare: async () =>
    ({
      rows: [row("cr1", "Connecting Ridge", 70, 40, 30), row("shk", "Shackleton rim", 80, 30, 60), row("mal", "Malapert massif", 40, 90, 120), row("mou", "Mons Mouton / Leibnitz β", 50, 50, 20), row("nob", "Nobile rim 1", 30, 20, 200)],
      ranking: ["shk", "cr1", "mou", "mal", "nob"], rankedBy: "", window: { startIdx: 0, hours: 720 },
    }) as unknown as CompareResult,
} as unknown as GuideApi;

describe("guide: decision helpers", () => {
  it("asks three questions, then recommends a site with reasons and a card", async () => {
    const q1 = await respond({ kind: "siteHelper" }, ctx(state()), noApi);
    expect(q1.text).toContain("What matters most");
    const q2 = await respond(q1.chips![0].intent, ctx(state()), noApi);
    expect(q2.text).toContain("How precisely can your lander touch down?");
    const q3 = await respond(q2.chips!.find((c) => c.primary)!.intent, ctx(state()), noApi);
    expect(q3.text).toContain("How careful should the plan be?");
    const pick = await respond(q3.chips!.find((c) => c.primary)!.intent, ctx(state()), fiveSites);
    expect(pick.text).toMatch(/^\*\*My pick: Shackleton rim\.\*\*/);
    expect(pick.text).toContain("80%, versus 70% at Connecting Ridge, the runner-up");
    expect(pick.proposals?.[0].changes).toMatchObject({ site: "shk", percentile: 10, uncertainty: { enabled: true, radius: 100 } });
  });

  it("weighs what matters: contact picks the best-connected site", async () => {
    const r = await respond({ kind: "siteHelper", priority: "contact", radius: 100, q: 10 }, ctx(state()), fiveSites);
    expect(r.text).toMatch(/^\*\*My pick: Malapert massif\.\*\*/);
    expect(r.text).toContain("Trade-off");
  });

  it("recommends a landing date for the battery", async () => {
    const daily = new Float32Array(365).fill(80);
    const api = {
      visibility: async () => ({ dailySun: daily, summary: { sunlightPct: 80, earthPct: 50, dsnPct: 40, longestDarkH: 20, darkStartsInH: 10, enduranceDays: null } }) as unknown as VisibilitySeries,
      endurance: async () => ({ days: [...Array(336).keys()], endurance_days: [...Array(336).keys()].map((d) => (d === 100 ? null : 9)) }),
    } as unknown as GuideApi;
    const q1 = await respond({ kind: "dateHelper" }, ctx(state()), api);
    expect(q1.text).toContain("How long does your mission need to last");
    const r = await respond({ kind: "dateHelper", window: 30, priority: "battery" }, ctx(state()), api);
    expect(r.text).toMatch(/^\*\*My pick: land on 11 Apr 2027\.\*\*/);
    expect(r.text).toContain("**Battery (VIPER-class rover):** lasts all 30 days");
    expect(r.proposals?.[0].changes.landingIdx).toBe(100 * 24 + 13);
  });
});

describe("guide: what-ifs and commands", () => {
  it("compares another landing date with the current one", async () => {
    const api = {
      visibility: async (req: { startIdx: number }) => ({ summary: req.startIdx === JUL15 * 24 + 13 ? { sunlightPct: 100, earthPct: 60, dsnPct: 50, longestDarkH: 0, darkStartsInH: null, enduranceDays: null } : vis().summary }) as unknown as VisibilitySeries,
    } as unknown as GuideApi;
    const r = await respond({ kind: "whatifDate", day: JUL15 }, ctx(state(), { risk: risk(88, 64), vis: vis() }), api);
    expect(r.text).toContain("**In short:** landing on **15 Jul 2027** is sunnier than your current date (29 Jun 2027) and the battery would last the whole mission.");
    expect(r.proposals?.[0].changes.landingIdx).toBe(JUL15 * 24 + 13);
  });

  it("turns a typed command into a card, and refuses impossible dates", async () => {
    const r = await respond({ kind: "command", e: { site: "mal", radius: 390, percentile: 5 } }, ctx(state()), noApi);
    expect(r.proposals?.[0].changes).toEqual({ site: "mal", uncertainty: { enabled: true, model: "circular", radius: 400 }, percentile: 5 });
    const late = await respond({ kind: "command", e: { day: 360 } }, ctx(state()), noApi);
    expect(late.proposals).toBeUndefined();
    expect(late.text).toContain("leaves no room for a 30-day mission");
  });
});

describe("guide: proactive tips", () => {
  it("notices changes and explains them, then suggests the next step", () => {
    const a = state();
    const b = { ...a, uncertainty: { ...a.uncertainty, enabled: true } };
    expect(detectEvents(a, b)).toEqual([{ kind: "choice", id: "accuracy" }]);
    expect(detectEvents(a, { ...a, landingIdx: a.landingIdx + 24 })).toEqual([{ kind: "choice", id: "date" }]);
    expect(detectEvents(a, { ...a, view: "sky" })).toEqual([{ kind: "skyline" }]);
    const n = nudge([{ kind: "choice", id: "accuracy" }], ctx(b, { risk: risk(88, 64), vis: vis() }));
    expect(n?.proactive).toBe(true);
    expect(n?.text).toContain("**Landing accuracy: ±100 m.**");
    expect(n?.text).toContain("**Next step: find a safer target.**");
    expect(n?.proposals?.[0].changes).toEqual({ mode: "planner", aim: { kind: "robust" } });
  });
});

describe("guide: best dates", () => {
  it("ranks equally sunny days by battery endurance, then by date", () => {
    expect(bestDays([5, 5, 5, 1], 1, 3, 1, (d) => [1, 9, 3, 0][d]).map((x) => x.day)).toEqual([1, 2, 0]);
    expect(bestDays([1, 9, 9, 1, 1, 1, 1, 1, 8, 1], 1, 3, 3).map((d) => d.day)).toEqual([1, 8, 4]);
  });
});
