import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { api, ApiError } from "../../src/api/client";
import { useApiCall } from "../../src/hooks/useMission";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ValidationPanel } from "../../src/features/validation/ValidationPanel";

function mockFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown }) {
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const { status = 200, body } = handler(url, init);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

afterEach(() => vi.unstubAllGlobals());

describe("API client", () => {
  it("maps landing-risk responses to the UI contract", async () => {
    mockFetch(() => ({
      body: { nominal: 87.8, p: { "50": 77.5, "20": 70, "10": 63.7, "5": 58 }, pq: 63.7, mean: 75, histogram: [1, 2], samples: [{ x: 1, y: 2, v: 80 }], n: 2000, earth_pq: 40, elapsed_ms: 12 },
    }));
    const r = await api.landingRisk({ site: "cr1", aim: { x: 0, y: 0 }, model: { kind: "circular", radius: 100 }, enabled: true, percentile: 10, seed: 7 });
    expect(r.p[10]).toBe(63.7);
    expect(r.p[50]).toBe(77.5);
    expect(r.nGridPoints).toBe(2000);
    expect(r.earthPq).toBe(40);
  });

  it("sends the uncertainty model in the backend's shape", async () => {
    const f = mockFetch(() => ({ body: { nominal: 1, p: { "50": 1, "20": 1, "10": 1, "5": 1 }, pq: 1, mean: 1, histogram: [], samples: [], n: 2000, elapsed_ms: 1 } }));
    await api.landingRisk({ site: "shk", aim: { x: 5, y: 6 }, model: { kind: "gaussian", sigmaE: 60, sigmaN: 40, rotDeg: 20, conf: 0.95 }, enabled: true, percentile: 20, seed: 7 });
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ site: "shk", aim: { x: 5, y: 6 }, percentile: 20, model: { kind: "gaussian", sigmaE: 60, sigmaN: 40, rotDeg: 20 } });
  });

  it("turns backend errors into ApiError with the documented code", async () => {
    mockFetch(() => ({ status: 422, body: { error: { code: "OUT_OF_COVERAGE", message: "high-resolution terrain is unavailable here", detail: { aim: [3000, 0] } } } }));
    await expect(api.landingRisk({ site: "cr1", aim: { x: 3000, y: 0 }, model: { kind: "circular", radius: 100 }, enabled: true, percentile: 10, seed: 7 })).rejects.toMatchObject({
      code: "OUT_OF_COVERAGE",
    });
  });

  it("reports an unreachable backend instead of inventing numbers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const e = await api.validation().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe("BACKEND_UNREACHABLE");
  });
});

describe("useApiCall", () => {
  it("de-duplicates identical requests and keeps the last result while a new key loads", async () => {
    let resolveSecond: (v: number) => void = () => undefined;
    const fn1 = vi.fn(async () => 1);
    const { result, rerender } = renderHook(({ k, fn }) => useApiCall(k, fn), { initialProps: { k: "a-test", fn: fn1 } });
    renderHook(() => useApiCall("a-test", fn1));
    await waitFor(() => expect(result.current.data).toBe(1));
    expect(fn1).toHaveBeenCalledTimes(1);
    const fn2 = vi.fn(() => new Promise<number>((r) => (resolveSecond = r)));
    rerender({ k: "b-test", fn: fn2 });
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBe(1); // stale value stays on screen
    await act(async () => resolveSecond(2));
    await waitFor(() => expect(result.current.data).toBe(2));
  });
});

const VALIDATION = (pass: boolean) => ({
  v1_pgda69: { pass, method: "m", source: "s", points: [{ name: "p", x: 0, y: 0, terrain: "LOLA", ours_sun: 20, pgda_sun: 21, ours_earth: 30, pgda_earth: 30 }], mae_sun: pass ? 1.2 : 2.6, mae_earth: 0.5, tolerance_pp: 2 },
  v2_glaser2018: {
    pass: true,
    method: "m",
    source: "s",
    points: [{ point: "C1", lat: -89.4, lon: 222, height_m: 2, table: "Table 2", published: 88, ours: 86, diff: -2, published_visibility: 92, ours_visibility: 91, pub_shadow_h: 112, ours_shadow_h: 115, within_tol: true, shadow_within_tol: true, terrain: "5 m", ours_at_5m_surface: null }],
    n_within: 1,
    n: 1,
    tolerance_pp: 3,
  },
  v4_spice_horizons: { pass: true, method: "m", source: "s", cases: [{ site: "cr1", target: "SUN", hours: 8760, max_arcsec: 0.01, mean_arcsec: 0.01, pass: true }], tolerance_arcsec: 10 },
  computed_utc: "2026-10-01T00:00:00Z",
  terrain_version: "v",
  tests: null,
});

describe("Validation panel", () => {
  it("shows a failing case as failing", async () => {
    mockFetch(() => ({ body: VALIDATION(false) }));
    render(
      <Tooltip.Provider>
        <ValidationPanel />
      </Tooltip.Provider>,
    );
    expect(await screen.findByText(/Target ≤ 2 pp · not met/)).toBeTruthy();
    expect(screen.getByText("2.60")).toBeTruthy();
  });
});
