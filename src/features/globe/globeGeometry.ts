import * as THREE from "three";
import regionJson from "../../data/generated/region_wide.json";
import { heightAt, R_KM, type HeightMap } from "./globeData";
import { loadGrid } from "../terrain3d/grids";
import { stereoToLatLon } from "../terrain3d/frame";

export const CAP_LAT = -75.6; // poleward of this the 1440 m LOLA polar terrain replaces the global mesh

/** Global Moon mesh: lat/lon grid, LOLA heights displace the vertices, normals stay radial (relief comes from the normal map). */
export function buildMoon(hm: HeightMap, nLon = 768, nLat = 384): THREE.BufferGeometry {
  const cols = nLon + 1;
  const rows = nLat + 1;
  const pos = new Float32Array(cols * rows * 3);
  const nor = new Float32Array(cols * rows * 3);
  const uv = new Float32Array(cols * rows * 2);
  for (let r = 0; r < rows; r++) {
    const lat = 90 - (r / nLat) * 180;
    const la = (lat * Math.PI) / 180;
    for (let c = 0; c < cols; c++) {
      const lon = -180 + (c / nLon) * 360;
      const lo = (lon * Math.PI) / 180;
      const k = r * cols + c;
      const nx = Math.cos(la) * Math.cos(lo);
      const ny = Math.cos(la) * Math.sin(lo);
      const nz = Math.sin(la);
      const rad = R_KM + heightAt(hm, lat, lon) / 1000;
      pos[k * 3] = nx * rad;
      pos[k * 3 + 1] = ny * rad;
      pos[k * 3 + 2] = nz * rad;
      nor[k * 3] = nx;
      nor[k * 3 + 1] = ny;
      nor[k * 3 + 2] = nz;
      uv[k * 2] = c / nLon;
      uv[k * 2 + 1] = 1 - r / nLat;
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < nLat; r++) {
    const latBottom = 90 - ((r + 1) / nLat) * 180;
    if (latBottom < CAP_LAT - 0.4) continue;
    for (let c = 0; c < nLon; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeTangents();
  g.computeBoundingSphere();
  return g;
}

const REGION = regionJson as { px: number; res: number; x0: number; y0: number; hmin: number; hmax: number; height_png: string };

/** South polar cap from LOLA LDEM_75S_240M (whole product, decimated to 1440 m), true geometry and normals, lat/lon UVs for the albedo map. */
export async function buildSouthCap(): Promise<THREE.BufferGeometry> {
  const g = await loadGrid(REGION.height_png, REGION.hmin, REGION.hmax, REGION.x0, REGION.y0, REGION.res);
  const n = g.n;
  const pos = new Float32Array(n * n * 3);
  const uv = new Float32Array(n * n * 2);
  const latArr = new Float32Array(n * n);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const sx = g.x0 + c * g.res;
      const sy = g.y0 - r * g.res;
      const [la, lo] = stereoToLatLon(sx, sy);
      const rad = R_KM + g.h[r * n + c] / 1000 - 0.08; // just below true height, so site terrain drawn on top stays visible
      const k = r * n + c;
      pos[k * 3] = rad * Math.cos(la) * Math.cos(lo);
      pos[k * 3 + 1] = rad * Math.cos(la) * Math.sin(lo);
      pos[k * 3 + 2] = rad * Math.sin(la);
      const latD = (la * 180) / Math.PI;
      latArr[k] = latD;
      uv[k * 2] = ((lo * 180) / Math.PI + 180) / 360;
      uv[k * 2 + 1] = (latD + 90) / 180;
    }
  const idx: number[] = [];
  for (let r = 0; r < n - 1; r++)
    for (let c = 0; c < n - 1; c++) {
      const a = r * n + c;
      if (Math.max(latArr[a], latArr[a + 1], latArr[a + n], latArr[a + n + 1]) > CAP_LAT + 0.45) continue;
      idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Earth sphere in its own body-fixed frame (x = 0° lon, z = north), UVs for an equirectangular map starting at 180°W. */
export function buildEarth(radius: number, nLon = 160, nLat = 80): THREE.BufferGeometry {
  const cols = nLon + 1;
  const rows = nLat + 1;
  const pos = new Float32Array(cols * rows * 3);
  const uv = new Float32Array(cols * rows * 2);
  for (let r = 0; r < rows; r++) {
    const la = ((90 - (r / nLat) * 180) * Math.PI) / 180;
    for (let c = 0; c < cols; c++) {
      const lo = ((-180 + (c / nLon) * 360) * Math.PI) / 180;
      const k = r * cols + c;
      pos[k * 3] = radius * Math.cos(la) * Math.cos(lo);
      pos[k * 3 + 1] = radius * Math.cos(la) * Math.sin(lo);
      pos[k * 3 + 2] = radius * Math.sin(la);
      uv[k * 2] = c / nLon;
      uv[k * 2 + 1] = 1 - r / nLat;
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < nLat; r++)
    for (let c = 0; c < nLon; c++) {
      const a = r * cols + c;
      idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
