/**
 * Site-local 3-D frame for the terrain view.
 * Polar stereographic (m) → lat/lon → Moon-fixed XYZ on the 1737.4 km sphere → site east/up/north.
 * three.js world axes: x = east, y = up, z = −north (so −Z looks north). Curvature is exact.
 */
import * as THREE from "three";

export const R_MOON = 1737400;

export function stereoToLatLon(x: number, y: number): [number, number] {
  const rho = Math.hypot(x, y);
  return [2 * Math.atan(rho / (2 * R_MOON)) - Math.PI / 2, Math.atan2(x, y)];
}

export function latLonToStereo(lat: number, lon: number): [number, number] {
  const rho = 2 * R_MOON * Math.tan(Math.PI / 4 + lat / 2);
  return [rho * Math.sin(lon), rho * Math.cos(lon)];
}

export interface SiteFrame {
  origin: THREE.Vector3;
  east: THREE.Vector3;
  north: THREE.Vector3;
  up: THREE.Vector3;
  h0: number;
  ve: number;
}

function xyz(lat: number, lon: number, r: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(r * Math.cos(lat) * Math.cos(lon), r * Math.cos(lat) * Math.sin(lon), r * Math.sin(lat));
}

export function makeFrame(latDeg: number, lonDeg: number, h0: number, ve = 1): SiteFrame {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const up = xyz(lat, lon, 1);
  const east = new THREE.Vector3(-Math.sin(lon), Math.cos(lon), 0);
  const north = new THREE.Vector3().crossVectors(up, east);
  return { origin: xyz(lat, lon, R_MOON + h0), east, north, up, h0, ve };
}

const tmp = new THREE.Vector3();

/** Stereographic metres + height → world position. Heights are exaggerated about the site height. */
export function toWorld(f: SiteFrame, sx: number, sy: number, h: number, out = new THREE.Vector3()): THREE.Vector3 {
  const [lat, lon] = stereoToLatLon(sx, sy);
  xyz(lat, lon, R_MOON + f.h0 + (h - f.h0) * f.ve, tmp).sub(f.origin);
  return out.set(tmp.dot(f.east), tmp.dot(f.up), -tmp.dot(f.north));
}

/** World position → stereographic metres and height above the reference sphere (undoing exaggeration). */
export function fromWorld(f: SiteFrame, p: THREE.Vector3): { sx: number; sy: number; h: number; lat: number; lon: number } {
  const q = new THREE.Vector3().copy(f.origin).addScaledVector(f.east, p.x).addScaledVector(f.up, p.y).addScaledVector(f.north, -p.z);
  const r = q.length();
  const lat = Math.asin(q.z / r);
  const lon = Math.atan2(q.y, q.x);
  const [sx, sy] = latLonToStereo(lat, lon);
  return { sx, sy, h: f.h0 + (r - R_MOON - f.h0) / f.ve, lat: (lat * 180) / Math.PI, lon: ((((lon * 180) / Math.PI) % 360) + 360) % 360 };
}

/** Local az/el (deg) at the site → world unit direction. */
export function azElToWorld(azDeg: number, elDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  return out.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
}
