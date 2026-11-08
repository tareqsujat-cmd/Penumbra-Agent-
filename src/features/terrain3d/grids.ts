/** Height grids (decoded from the bundled 16-bit PNGs) and terrain meshes built from them. */
import * as THREE from "three";
import { decodeHeights } from "../../utils/color";
import { toWorld, type SiteFrame } from "./frame";

export interface HeightGrid {
  h: Float32Array;
  n: number;
  /** stereographic x of column 0 and y of row 0 (row 0 is the northern / max-y edge) */
  x0: number;
  y0: number;
  res: number;
}

export async function loadGrid(png: string, hmin: number, hmax: number, x0: number, y0: number, res: number): Promise<HeightGrid> {
  const { h, n } = await decodeHeights(png, hmin, hmax);
  return { h, n, x0, y0, res };
}

export function gridCovers(g: HeightGrid, sx: number, sy: number, margin = 0): boolean {
  const c = (sx - g.x0) / g.res;
  const r = (g.y0 - sy) / g.res;
  return c >= margin && r >= margin && c <= g.n - 1 - margin && r <= g.n - 1 - margin;
}

export function sampleGrid(g: HeightGrid, sx: number, sy: number): number {
  const c = Math.min(Math.max((sx - g.x0) / g.res, 0), g.n - 1.001);
  const r = Math.min(Math.max((g.y0 - sy) / g.res, 0), g.n - 1.001);
  const i = Math.floor(c);
  const j = Math.floor(r);
  const tx = c - i;
  const ty = r - j;
  const n = g.n;
  return g.h[j * n + i] * (1 - tx) * (1 - ty) + g.h[j * n + i + 1] * tx * (1 - ty) + g.h[(j + 1) * n + i] * (1 - tx) * ty + g.h[(j + 1) * n + i + 1] * tx * ty;
}

/** Finest-first height lookup across nested grids. */
export function heightAt(grids: HeightGrid[], sx: number, sy: number): number {
  for (const g of grids) if (gridCovers(g, sx, sy)) return sampleGrid(g, sx, sy);
  return grids[grids.length - 1] ? sampleGrid(grids[grids.length - 1], sx, sy) : 0;
}

/**
 * Terrain mesh on the curved Moon. `hole` (stereo box) removes triangles that a finer mesh covers,
 * so nested levels do not z-fight.
 */
export function buildTerrain(g: HeightGrid, f: SiteFrame, step = 1, hole?: [number, number, number, number]): THREE.BufferGeometry {
  const m = Math.floor((g.n - 1) / step) + 1;
  const pos = new Float32Array(m * m * 3);
  const uv = new Float32Array(m * m * 2);
  const v = new THREE.Vector3();
  for (let r = 0; r < m; r++)
    for (let c = 0; c < m; c++) {
      const gr = Math.min(r * step, g.n - 1);
      const gc = Math.min(c * step, g.n - 1);
      const sx = g.x0 + gc * g.res;
      const sy = g.y0 - gr * g.res;
      toWorld(f, sx, sy, g.h[gr * g.n + gc], v);
      const k = r * m + c;
      pos[k * 3] = v.x;
      pos[k * 3 + 1] = v.y;
      pos[k * 3 + 2] = v.z;
      uv[k * 2] = c / (m - 1);
      uv[k * 2 + 1] = 1 - r / (m - 1);
    }
  const idx: number[] = [];
  const inHole = (r: number, c: number) => {
    if (!hole) return false;
    const sx = g.x0 + c * step * g.res;
    const sy = g.y0 - r * step * g.res;
    return sx > hole[0] && sx < hole[2] && sy > hole[1] && sy < hole[3];
  };
  for (let r = 0; r < m - 1; r++)
    for (let c = 0; c < m - 1; c++) {
      if (inHole(r, c) && inHole(r + 1, c + 1) && inHole(r, c + 1) && inHole(r + 1, c)) continue;
      const a = r * m + c;
      const b = a + 1;
      const d = a + m;
      const e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Sub-mesh over a stereo box (for draping the sunlight field), lifted slightly above the terrain. */
export function buildDrape(g: HeightGrid, f: SiteFrame, box: [number, number, number, number], lift = 0.6): THREE.BufferGeometry {
  const c0 = Math.max(0, Math.floor((box[0] - g.x0) / g.res));
  const c1 = Math.min(g.n - 1, Math.ceil((box[2] - g.x0) / g.res));
  const r0 = Math.max(0, Math.floor((g.y0 - box[3]) / g.res));
  const r1 = Math.min(g.n - 1, Math.ceil((g.y0 - box[1]) / g.res));
  const w = c1 - c0 + 1;
  const hgt = r1 - r0 + 1;
  const pos = new Float32Array(w * hgt * 3);
  const uv = new Float32Array(w * hgt * 2);
  const v = new THREE.Vector3();
  for (let r = 0; r < hgt; r++)
    for (let c = 0; c < w; c++) {
      const sx = g.x0 + (c0 + c) * g.res;
      const sy = g.y0 - (r0 + r) * g.res;
      toWorld(f, sx, sy, g.h[(r0 + r) * g.n + c0 + c] + lift, v);
      const k = r * w + c;
      pos.set([v.x, v.y, v.z], k * 3);
      uv.set([(sx - box[0]) / (box[2] - box[0]), (sy - box[1]) / (box[3] - box[1])], k * 2);
    }
  const idx: number[] = [];
  for (let r = 0; r < hgt - 1; r++)
    for (let c = 0; c < w - 1; c++) {
      const a = r * w + c;
      idx.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
