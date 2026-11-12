import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { Markdown } from "../../src/features/assistant/Markdown";
import { TERM_LINKS } from "../../src/features/assistant/guide/content";
import { findTarget } from "../../src/features/assistant/guide/whatsthis";
import { activityFor, respond, type GuideApi } from "../../src/features/assistant/guide/engine";
import { reaction } from "../../src/features/assistant/guide/nlu";
import { explainMore } from "../../src/features/assistant/guide/plain";
import { captureUndo, restoreUndo } from "../../src/features/assistant/applyProposal";
import { getState, setState } from "../../src/state/store";
import type { SiteData } from "../../src/types";

const ctx = () => ({ s: { ...getState(), mode: "planner" as const, siteId: "cr1" as const }, site: { id: "cr1", name: "Connecting Ridge" } as unknown as SiteData, m: { risk: null, vis: null } });

describe("tap-to-explain words", () => {
  it("turns technical words into buttons, once per message", () => {
    const seen: string[] = [];
    const { container } = render(<Markdown text={"On a bad day (P10) the robust aim keeps more. P10 again, and the DSN."} terms={TERM_LINKS} onTerm={(id) => seen.push(id)} />);
    const buttons = Array.from(container.querySelectorAll("button.pn-asst__term")).map((b) => b.textContent);
    expect(buttons).toEqual(["P10", "robust aim", "DSN"]);
    fireEvent.click(container.querySelector("button.pn-asst__term")!);
    expect(seen).toEqual(["percentile"]);
    expect(container.textContent).toBe("On a bad day (P10) the robust aim keeps more. P10 again, and the DSN.");
  });

  it("does not link inside longer words", () => {
    const { container } = render(<Markdown text={"P100 and DSNX are not terms"} terms={TERM_LINKS} onTerm={() => undefined} />);
    expect(container.querySelectorAll("button").length).toBe(0);
  });
});

describe("What's this?", () => {
  it("recognises screen parts and explains them in plain words", () => {
    document.body.innerHTML = `
      <div class="pn-insp__kpis"><div class="pn-kpi"><div class="pn-kpi__label">Nominal outcome</div><div class="pn-kpi__value">88%</div></div></div>
      <section class="pn-cal"><svg class="pn-cal__rows"><text id="t">SUN</text></svg></section>
      <button class="pn-hdr__export">Export</button>
      <div id="nothing"></div>`;
    const kpi = findTarget(document.querySelector(".pn-kpi__value"))!;
    expect(kpi.target.explain(ctx(), kpi.el).text).toMatch(/^\*\*This is the sunlight if you land exactly on target\*\*/);
    const cal = findTarget(document.getElementById("t"))!;
    expect(cal.target.explain(ctx(), cal.el).text).toContain("**POWER:** the battery level");
    expect(findTarget(document.querySelector(".pn-hdr__export"))!.target.explain(ctx(), document.body).text).toContain("**Export** saves your whole decision");
    expect(findTarget(document.getElementById("nothing"))).toBeNull();
  });
});

describe("Undo", () => {
  it("puts every setting back exactly", async () => {
    setState({ landingIdx: 4309, percentile: 10, windowDays: 30, dialog: null, uncertainty: { ...getState().uncertainty, enabled: false, radius: 100 } });
    const before = captureUndo();
    setState({ landingIdx: 1000, percentile: 5, windowDays: 90, dialog: "export", uncertainty: { ...getState().uncertainty, enabled: true, radius: 400 } });
    await restoreUndo(before);
    const s = getState();
    expect([s.landingIdx, s.percentile, s.windowDays, s.dialog, s.uncertainty.enabled, s.uncertainty.radius]).toEqual([4309, 10, 30, null, false, 100]);
  });
});

describe("going deeper and keeping people informed", () => {
  it("understands 'tell me more' and has deeper explanations", async () => {
    expect(reaction("tell me more")).toBe("more");
    expect(reaction("more please")).toBe("more");
    expect(explainMore("level")).toContain("They are percentiles");
    const r = await respond({ kind: "choice", id: "date" }, ctx(), {} as GuideApi);
    expect(r.chips?.[0]).toEqual({ label: "Tell me more", intent: { kind: "more", id: "date" } });
  });

  it("says what it is working on", () => {
    expect(activityFor({ kind: "dateHelper", window: 30, priority: "sun" })).toBe("Looking at every landing day in 2027…");
    expect(activityFor({ kind: "dateHelper" })).toBeUndefined(); // just a question: no waiting
    expect(activityFor({ kind: "whatifSite", site: "shk" })).toBe("Comparing the two sites for your date…");
  });

  it("greets by name and offers point-and-explain", async () => {
    const g = await respond({ kind: "greet" }, ctx(), {} as GuideApi);
    expect(g.text.startsWith("Hi, I'm **Armstrong**, your guide to Penumbra.")).toBe(true);
    expect(g.chips?.map((c) => c.intent.kind)).toContain("whatsthis");
  });
});
