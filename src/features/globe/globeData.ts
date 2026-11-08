/** Globe data: Moon/Earth textures, LOLA global heights, and hourly 2027 Sun/Earth geometry (SPICE, MOON_ME). */
import * as THREE from "three";
import globeJson from "../../data/generated/globe.json";
import { loadImage } from "../../utils/color";

interface GlobeJson {
  moon: { albedo: string; normal: string; height: string; hmin: number; hmax: number };
  earth_texture: string;
  ephem: { start: string; step_h: number; n: number; sun: string; earth_km: string; earth_quat: string; source: string };
  radius_km: number;
  dem: { source: string };
  albedo_source: string;
  earth_source: string;
}

export const G = globeJson as GlobeJson;
export const R_KM = G.radius_km;
export const HOURS = G.ephem.n;

function f32(b64: string): Float32Array {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Float32Array(u8.buffer);
}

const SUN = f32(G.ephem.sun);
const EARTH = f32(G.ephem.earth_km);
const QUAT = f32(G.ephem.earth_quat);

export function sunDir(i: number, out = new THREE.Vector3()): THREE.Vector3 {
  const k = Math.min(Math.max(i, 0), HOURS - 1) * 3;
  return out.set(SUN[k], SUN[k + 1], SUN[k + 2]);
}
export function earthPos(i: number, out = new THREE.Vector3()): THREE.Vector3 {
  const k = Math.min(Math.max(i, 0), HOURS - 1) * 3;
  return out.set(EARTH[k], EARTH[k + 1], EARTH[k + 2]);
}
export function earthQuat(i: number, out = new THREE.Quaternion()): THREE.Quaternion {
  const k = Math.min(Math.max(i, 0), HOURS - 1) * 4;
  return out.set(QUAT[k], QUAT[k + 1], QUAT[k + 2], QUAT[k + 3]);
}

/** Moon-fixed (MOON_ME) position; z = north pole, x = lon 0 (towards Earth on average). */
export function llToVec(latDeg: number, lonDeg: number, r: number, out = new THREE.Vector3()): THREE.Vector3 {
  const la = (latDeg * Math.PI) / 180;
  const lo = (lonDeg * Math.PI) / 180;
  return out.set(r * Math.cos(la) * Math.cos(lo), r * Math.cos(la) * Math.sin(lo), r * Math.sin(la));
}
export function vecToLL(v: THREE.Vector3): [number, number] {
  const r = v.length();
  return [(Math.asin(v.z / r) * 180) / Math.PI, (Math.atan2(v.y, v.x) * 180) / Math.PI];
}

export interface HeightMap {
  h: Float32Array;
  w: number;
  hgt: number;
}

export async function loadHeights(): Promise<HeightMap> {
  const im = await loadImage(G.moon.height);
  const c = document.createElement("canvas");
  c.width = im.width;
  c.height = im.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(im, 0, 0);
  const d = ctx.getImageData(0, 0, im.width, im.height).data;
  const n = im.width * im.height;
  const h = new Float32Array(n);
  for (let k = 0; k < n; k++) h[k] = G.moon.hmin + ((d[k * 4] * 256 + d[k * 4 + 1]) / 65535) * (G.moon.hmax - G.moon.hmin);
  return { h, w: im.width, hgt: im.height };
}

/** Height (m) at lat/lon, bilinear, lon -180..180 across the width, north row first. */
export function heightAt(m: HeightMap, latDeg: number, lonDeg: number): number {
  const x = ((((lonDeg + 180) % 360) + 360) % 360) / 360 * m.w - 0.5;
  const y = (90 - latDeg) / 180 * m.hgt - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.min(Math.max(Math.floor(y), 0), m.hgt - 2);
  const tx = x - x0;
  const ty = Math.min(Math.max(y - y0, 0), 1);
  const xa = ((x0 % m.w) + m.w) % m.w;
  const xb = (xa + 1) % m.w;
  const g = (xx: number, yy: number) => m.h[yy * m.w + xx];
  return g(xa, y0) * (1 - tx) * (1 - ty) + g(xb, y0) * tx * (1 - ty) + g(xa, y0 + 1) * (1 - tx) * ty + g(xb, y0 + 1) * tx * ty;
}

/** Slope (deg) map from the relief normal map (~5 km baseline). */
export async function loadSlopes(): Promise<{ s: Float32Array; w: number; hgt: number }> {
  const im = await loadImage(G.moon.normal);
  const c = document.createElement("canvas");
  c.width = im.width;
  c.height = im.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(im, 0, 0);
  const d = ctx.getImageData(0, 0, im.width, im.height).data;
  const s = new Float32Array(im.width * im.height);
  for (let k = 0; k < s.length; k++) s[k] = (Math.acos(Math.min(1, Math.max(-1, (d[k * 4 + 2] / 255) * 2 - 1))) * 180) / Math.PI;
  return { s, w: im.width, hgt: im.height };
}

export function slopeAt(m: { s: Float32Array; w: number; hgt: number }, latDeg: number, lonDeg: number): number {
  const x = Math.min(m.w - 1, Math.max(0, Math.floor(((((lonDeg + 180) % 360) + 360) % 360) / 360 * m.w)));
  const y = Math.min(m.hgt - 1, Math.max(0, Math.floor((90 - latDeg) / 180 * m.hgt)));
  return m.s[y * m.w + x];
}

/** Hour of 2027 near `aroundIdx` where the nearside shows a gibbous phase (for a flattering first view). */
export function gibbousHour(aroundIdx: number): number {
  const s = new THREE.Vector3();
  const e = new THREE.Vector3();
  let best = aroundIdx;
  let bestErr = 1e9;
  for (let i = Math.max(0, aroundIdx - 360); i < Math.min(HOURS, aroundIdx + 360); i += 3) {
    const ang = (sunDir(i, s).angleTo(earthPos(i, e).normalize()) * 180) / Math.PI;
    const err = Math.abs(ang - 55);
    if (err < bestErr) {
      bestErr = err;
      best = i;
    }
  }
  return best;
}
