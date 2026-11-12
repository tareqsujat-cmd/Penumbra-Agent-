import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { parseSse } from "../../src/api/assistant";
import { Markdown, parseBlocks } from "../../src/features/assistant/Markdown";
import { buildParams, buildSnapshot } from "../../src/features/assistant/snapshot";
import { getState, type AppState } from "../../src/state/store";
import type { SiteData } from "../../src/types";

describe("assistant SSE parser", () => {
  it("returns complete events and keeps the unfinished remainder", () => {
    const { events, rest } = parseSse('data: {"type":"text","text":"Hel"}\n\ndata: {"type":"text","text":"lo"}\n\ndata: {"type":"do');
    expect(events).toEqual([{ type: "text", text: "Hel" }, { type: "text", text: "lo" }]);
    expect(rest).toBe('data: {"type":"do');
    expect(parseSse(rest + 'ne"}\n\n').events).toEqual([{ type: "done" }]);
  });
  it("skips malformed lines", () => {
    expect(parseSse("data: {oops\n\n").events).toEqual([]);
  });
});

describe("assistant markdown", () => {
  it("splits paragraphs and lists", () => {
    expect(parseBlocks("Intro line\nsame para\n\n- one\n- two\n\n1. a\n2. b")).toEqual([
      { kind: "p", text: "Intro line same para" },
      { kind: "ul", items: ["one", "two"] },
      { kind: "ol", items: ["a", "b"] },
    ]);
  });
  it("renders bold as <strong> and never raw HTML", () => {
    const { container } = render(<Markdown text={'Use **Find robust aim** <img src=x onerror="alert(1)">'} />);
    expect(container.querySelector("strong")?.textContent).toBe("Find robust aim");
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("assistant snapshot", () => {
  const site = { id: "cr1", name: "Connecting Ridge", note: "ridge", terrain: { center_xy: [-12000, -3000] } } as unknown as SiteData;
  const base = (): AppState => ({ ...getState(), mode: "planner", aim: { x: 120, y: 0 }, aimKind: "brightest" });

  it("describes the screen, settings and only finite results", () => {
    const s = { ...base(), uncertainty: { ...base().uncertainty, enabled: true, model: "circular" as const, radius: 100 }, percentile: 10 as const };
    const snap = buildSnapshot(s, site, {
      risk: { nominal: 88.04, pq: 71.26, p: { 50: 84, 20: 77, 10: 71.26, 5: NaN }, earthPq: 50, samples: [], histogram: [], nGridPoints: 2000, elapsedMs: 3, loading: false },
      vis: { summary: { sunlightPct: 90.2, earthPct: 55, dsnPct: 40, longestDarkH: 31.6, darkStartsInH: null, enduranceDays: null }, loading: false },
    });
    expect(snap.screen).toBe("02 Mission");
    expect(snap.site).toMatchObject({ id: "cr1", name: "Connecting Ridge" });
    expect(snap.landingUncertainty).toEqual({ model: "circular", radiusM: 100 });
    expect(snap.robustnessLevel).toBe("P10");
    const results = snap.results as Record<string, any>;
    expect(results.nominalSunlightPct2027).toBe(88);
    expect(results.worstLikelySunlightPct_P10).toBe(71.3);
    expect(results.percentilesSunlightPct.P05).toBeUndefined();
    expect(results.missionWindow.longestDarknessH).toBe(32);
    expect(results.missionWindow.firstDarknessStartsAfterH).toBe("no darkness in the window");
    expect(JSON.stringify(snap)).not.toContain("NaN");
  });

  it("sends machine-readable settings for the analysis tools", () => {
    const p = buildParams({ ...base(), uncertainty: { ...base().uncertainty, model: "gaussian" as const, sigmaE: 45, sigmaN: 70 } });
    expect(p).toMatchObject({ site: getState().siteId, aim: { x: 120, y: 0 }, aimKind: "brightest", percentile: getState().percentile });
    expect(p.model).toMatchObject({ kind: "gaussian", sigmaE: 45, sigmaN: 70 });
    expect((p.vehicles as { id: string }[]).map((v) => v.id)).toContain("viper");
    expect(JSON.stringify(p)).not.toContain("sources"); // only the fields the backend validates
  });

  it("says when no site is selected on the globe", () => {
    const snap = buildSnapshot({ ...base(), mode: "globe", globeSite: null }, site, { risk: null, vis: null });
    expect(snap.screen).toBe("01 Explore");
    expect(snap.site).toBeUndefined();
  });
});
