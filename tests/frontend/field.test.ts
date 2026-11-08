import { describe, expect, it } from "vitest";
import { bilinear, brightest, decodeEphem, fieldExtent, inField, skylineAt } from "../../src/utils/field";
import { fmtHours, fmtOffset } from "../../src/utils/format";
import type { Field, SiteData } from "../../src/types";

const field: Field = { kind: "computed", source: "test", x0: -20, y0: -20, dx: 10, nx: 5, ny: 5, sun: [], earth: [] };
for (let j = 0; j < 5; j++) {
  field.sun.push([0, 1, 2, 3, 4].map((i) => 10 * i + j)); // planar: exact under bilinear interpolation
  field.earth.push([0, 0, 0, 0, 0]);
}

describe("field helpers", () => {
  it("bilinear is exact on a planar field", () => {
    expect(bilinear(field.sun, field, 5, 0)).toBeCloseTo(25 + 2, 9); // x=5 -> i=2.5 -> 25, y=0 -> j=2
  });
  it("inField uses the cell edges", () => {
    const [x0, , x1] = fieldExtent(field);
    expect(x0).toBe(-25);
    expect(x1).toBe(25);
    expect(inField(field, { x: 24, y: 0 })).toBe(true);
    expect(inField(field, { x: 26, y: 0 })).toBe(false);
  });
  it("brightest finds the maximum cell", () => {
    expect(brightest(field)).toEqual({ x: 20, y: 20, value: 44 });
  });
  it("skyline interpolates and wraps at 360 deg", () => {
    const deg = Array.from({ length: 720 }, (_, k) => k / 100);
    expect(skylineAt(deg, 1.25)).toBeCloseTo(0.025, 9);
    expect(skylineAt(deg, 359.75)).toBeCloseTo(7.19 * 0.5 + 0 * 0.5, 9);
  });
});

describe("ephemeris decoding", () => {
  it("round-trips the uint16 packing used by the API", () => {
    const n = 3;
    const u16 = new Uint16Array(n * 4);
    for (let i = 0; i < n; i++) {
      u16[i * 4] = Math.round(123.45 * 100);
      u16[i * 4 + 1] = Math.round((1.5 + 90) * 100);
      u16[i * 4 + 2] = Math.round(10.0 * 100);
      u16[i * 4 + 3] = Math.round((-2.25 + 90) * 100);
    }
    let bin = "";
    new Uint8Array(u16.buffer).forEach((b) => (bin += String.fromCharCode(b)));
    const site = { id: "cr1", ephem: { start: "2027-01-01T00:00Z", step_h: 1, n, b64: btoa(bin), source: "" } } as unknown as SiteData;
    const e = decodeEphem(site);
    expect(e.sunAz[2]).toBeCloseTo(123.45, 5);
    expect(e.sunEl[0]).toBeCloseTo(1.5, 5);
    expect(e.earthEl[1]).toBeCloseTo(-2.25, 5);
    expect(e.startMs).toBe(Date.UTC(2027, 0, 1));
  });
});

describe("formatting", () => {
  it("labels map offsets as grid directions (map axes are not compass axes at the pole)", () => {
    expect(fmtOffset(0, 0)).toBe("at the site reference point");
    expect(fmtOffset(-100, -100)).toBe("141 m grid-south-west");
  });
  it("switches hours to days above 48 h", () => {
    expect(fmtHours(32)).toBe("32 h");
    expect(fmtHours(72)).toBe("3.0 d");
  });
});
