/** Display helpers over data returned by the API (no science here: the numbers come from the backend). */
import type { Ephemeris, Field, SiteData, XY } from "../types";

export const HOURS_2027 = 8760;

const ephemCache = new Map<string, Ephemeris>();

/** Hourly Sun/Earth az/el at the site centre, packed by the API as uint16 (az*100, (el+90)*100). */
export function decodeEphem(site: SiteData): Ephemeris {
  const key = `${site.id}:${site.ephem.start}:${site.ephem.n}`;
  const hit = ephemCache.get(key);
  if (hit) return hit;
  const bin = atob(site.ephem.b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const u16 = new Uint16Array(bytes.buffer);
  const n = site.ephem.n;
  const e: Ephemeris = {
    n,
    startMs: Date.parse(site.ephem.start.replace("Z", ":00Z")),
    sunAz: new Float32Array(n),
    sunEl: new Float32Array(n),
    earthAz: new Float32Array(n),
    earthEl: new Float32Array(n),
  };
  for (let i = 0; i < n; i++) {
    e.sunAz[i] = u16[i * 4] / 100;
    e.sunEl[i] = u16[i * 4 + 1] / 100 - 90;
    e.earthAz[i] = u16[i * 4 + 2] / 100;
    e.earthEl[i] = u16[i * 4 + 3] / 100 - 90;
  }
  ephemCache.set(key, e);
  return e;
}

/** Skyline elevation (deg) at azimuth (deg), linear between 0.5° bins. */
export function skylineAt(deg: number[], az: number): number {
  const n = deg.length;
  const f = (((az % 360) + 360) % 360) / (360 / n);
  const i = Math.floor(f);
  const t = f - i;
  return deg[i % n] * (1 - t) + deg[(i + 1) % n] * t;
}

export function fieldExtent(f: Field): [number, number, number, number] {
  return [f.x0 - f.dx / 2, f.y0 - f.dx / 2, f.x0 + (f.nx - 0.5) * f.dx, f.y0 + (f.ny - 0.5) * f.dx];
}

export function inField(f: Field, p: XY): boolean {
  const [x0, y0, x1, y1] = fieldExtent(f);
  return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
}

/** Bilinear lookup in a computed field (for hover read-outs; the analyses themselves run on the server). */
export function bilinear(grid: number[][], f: Field, x: number, y: number): number {
  const gx = Math.min(Math.max((x - f.x0) / f.dx, 0), f.nx - 1);
  const gy = Math.min(Math.max((y - f.y0) / f.dx, 0), f.ny - 1);
  const i = Math.min(Math.floor(gx), f.nx - 2);
  const j = Math.min(Math.floor(gy), f.ny - 2);
  const tx = gx - i;
  const ty = gy - j;
  return grid[j][i] * (1 - tx) * (1 - ty) + grid[j][i + 1] * tx * (1 - ty) + grid[j + 1][i] * (1 - tx) * ty + grid[j + 1][i + 1] * tx * ty;
}

export function brightest(f: Field): XY & { value: number } {
  let best = { x: 0, y: 0, value: -1 };
  for (let j = 0; j < f.ny; j++)
    for (let i = 0; i < f.nx; i++) if (f.sun[j][i] > best.value) best = { x: f.x0 + i * f.dx, y: f.y0 + j * f.dx, value: f.sun[j][i] };
  return best;
}

/** Map offset from the site centre → latitude/east longitude (display only; same formula as backend coordinates.py). */
export function offsetToLatLon(site: SiteData, p: XY): [number, number] {
  const R = 1737400;
  const x = site.terrain.center_xy[0] + p.x;
  const y = site.terrain.center_xy[1] + p.y;
  const lat = ((2 * Math.atan(Math.hypot(x, y) / (2 * R)) - Math.PI / 2) * 180) / Math.PI;
  const lon = ((((Math.atan2(x, y) * 180) / Math.PI) % 360) + 360) % 360;
  return [lat, lon];
}
