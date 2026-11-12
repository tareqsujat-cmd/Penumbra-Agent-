import { beforeEach, describe, expect, it } from "vitest";
import { applyProposal } from "../../src/features/assistant/applyProposal";
import { toHistory, type HistoryMsg } from "../../src/features/assistant/history";
import { getState, setState } from "../../src/state/store";

const card = { id: "p1", summary: "Go to Compare", lines: ["Go to 04 Compare"], changes: { mode: "compare" as const } };

describe("assistant history notes", () => {
  it("tells the assistant what happened to each proposal", () => {
    const msgs: HistoryMsg[] = [
      { role: "user", content: "take me to compare" },
      { role: "assistant", content: "Here you go.", proposals: [{ ...card, status: "applied" }] },
      { role: "assistant", content: "", proposals: [{ ...card, id: "p2", status: "dismissed" }] },
      { role: "assistant", content: "half", pending: true },
    ];
    const h = toHistory(msgs);
    expect(h).toHaveLength(3);
    expect(h[1].content).toBe('Here you go.\n\n[The person applied this change: "Go to Compare" (Go to 04 Compare)]');
    expect(h[2].content).toMatch(/^\[The person dismissed this proposal/);
  });
});

describe("applying a proposal", () => {
  beforeEach(() => {
    setState({ mode: "planner", windowDays: 30, landingIdx: 4309, percentile: 10, dialog: null, vehicleId: "viper",
      uncertainty: { ...getState().uncertainty, enabled: false, model: "circular", radius: 100 },
      robust: { status: "done", stage: 3, result: null, revealed: true }, progress: { sky: false, compare: false, export: false } });
  });

  it("applies settings in order and clears a stale robust-aim result", async () => {
    await applyProposal({ mode: "compare", windowDays: 90, landingIdx: 99999, uncertainty: { enabled: true, radius: 400 }, percentile: 5,
      earthMarginDeg: 3, dsnMaskDeg: 10.1, vehicleId: "novac", compareIds: ["cr1", "mal"], dialog: "export" });
    const s = getState();
    expect(s.mode).toBe("compare");
    expect(s.windowDays).toBe(90);
    expect(s.landingIdx).toBe((365 - 90) * 24 + 23); // clamped so the window stays inside 2027
    expect(s.uncertainty).toMatchObject({ enabled: true, model: "circular", radius: 400 });
    expect(s.percentile).toBe(5);
    expect(s.robust.status).toBe("idle");
    expect([s.earthMarginDeg, s.dsnMaskDeg, s.vehicleId]).toEqual([3, 10.1, "novac"]);
    expect(s.compareIds).toEqual(["cr1", "mal"]);
    expect(s.dialog).toBe("export");
    expect(s.progress.export).toBe(true);
  });

  it("refuses an unknown vehicle", async () => {
    await expect(applyProposal({ vehicleId: "rocket" })).rejects.toThrow(/Unknown vehicle/);
    expect(getState().vehicleId).toBe("viper");
  });
});
