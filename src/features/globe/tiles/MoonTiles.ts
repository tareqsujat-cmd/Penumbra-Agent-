/**
 * Level-of-detail Moon surface (the Cesium / NASA-AMMOS LithoSphere approach, kept small):
 *  - geographic quadtree between the polar caps: LROC WAC imagery (levels 0..7) and, deeper, Kaguya TC x SLDEM
 *    relief tiles (levels 8..11, down to ~10 m/px), draped on LOLA LDEM_16 heights;
 *  - two polar quadtrees (south, north) on the NASA Moon Trek polar grid, poleward of |lat| = 75.6 deg:
 *    LOLA 240/80 m heights textured with photo + relief composites (scripts/polarlib.py): LRO WAC polar mosaic
 *    (levels 0..7, 67 m/px), then Kaguya TC (levels 8..10, ~8 m/px) or, within 85.5 deg of the pole, the LROC NAC
 *    polar mosaic (levels 8..11, ~4 m/px); shadowed ground is shown with Chang'e-2 / LOLA hillshade relief.
 * Traversal requests the tiles the view needs directly (nearest the screen centre first) together with their
 * missing ancestors, which load first as stand-ins. Every sharp tile that is ready is drawn at once; a coarser
 * ancestor fills only the gaps, sunk slightly below so the sharp tiles always win. Requests for places the view has
 * left are cancelled, and images decode off the main thread, so zooming and panning stay smooth and sharpen fast.
 * Meshes are positioned relative to their own centre (RTC) to avoid float32 jitter at 1737 km from the origin.
 */
import * as THREE from "three";

export const R = 1737.4; // km
export const CAP_LAT = -75.6; // south cap edge; the north cap mirrors it
const CAP_ABS = Math.abs(CAP_LAT);
const SPLIT = 256 * 1.1; // split when a 256 px tile covers more than this many screen pixels
const MAX_INFLIGHT = 14;
const MAX_MESHES = 700; // GPU budget: ~0.35 MB per tile texture
const MAX_RECORDS = 6000;
const R_M = 1737400;
// Moon Trek polar grid
const ORIGIN = 1095930;
const SPAN0 = 2 * ORIGIN;
const CAP_RHO = 441000;
const NAC_EXT = 136525;
const LIM80 = 3799.5 * 80 * 0.998;
const HGT_MAX = 8;
const OUTER_MAX = 10;
const NAC_MAX = 11;
const N = 65;

export type Hemi = "s" | "n";

export interface TileManifest {
  wac: { prefetched: number; max: number };
  hr?: { from_level: number; max: number };
  polar: { S: number; levels: number; imgLevels?: number; n: number; scale: number; hemis?: Hemi[] };
  ldem16: { w: number; h: number; scale: number };
  polarAlbedo: number;
  siteImages?: Record<string, [number, number, number, number]>;
  imageVersion?: number;
}

export interface HoleUniforms {
  hole: { value: THREE.Vector4 };
  holeOn: { value: number };
}

type State = "idle" | "loading" | "ready" | "failed";

interface Tile {
  key: string;
  kind: "geo" | "polar";
  hemi: Hemi;
  L: number;
  a: number; // geo: x · polar: col
  b: number; // geo: y · polar: row
  state: State;
  mesh: THREE.Mesh | null;
  used: number;
  dir: THREE.Vector3;
  ang: number;
  sizeKm: number;
  abort: AbortController | null;
  topLat: number;
  botLat: number;
  prio: number;
}

export function dirLL(latDeg: number, lonDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const la = (latDeg * Math.PI) / 180;
  const lo = (lonDeg * Math.PI) / 180;
  return out.set(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
}

/** Polar stereographic metres → [lat, lon] radians (LOLA/PDS conventions; north uses y = -rho cos lon). */
export function polarLL(h: Hemi, sx: number, sy: number): [number, number] {
  const rho = Math.hypot(sx, sy);
  const c = 2 * Math.atan(rho / (2 * R_M));
  return h === "s" ? [c - Math.PI / 2, Math.atan2(sx, sy)] : [Math.PI / 2 - c, Math.atan2(sx, -sy)];
}

export function llPolar(h: Hemi, latRad: number, lonRad: number): [number, number] {
  const rho = h === "s" ? 2 * R_M * Math.tan(Math.PI / 4 + latRad / 2) : 2 * R_M * Math.tan(Math.PI / 4 - latRad / 2);
  return h === "s" ? [rho * Math.sin(lonRad), rho * Math.cos(lonRad)] : [rho * Math.sin(lonRad), -rho * Math.cos(lonRad)];
}

/** Global LOLA LDEM_16 heights (m), bilinear; column 0 at lon -180, row 0 at lat +90. */
export class GlobalHeights {
  constructor(private z: Int16Array, private w: number, private h: number, private scale: number) {}
  at(latDeg: number, lonDeg: number): number {
    const x = (((((lonDeg + 180) % 360) + 360) % 360) / 360) * this.w - 0.5;
    const y = ((90 - latDeg) / 180) * this.h - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.min(Math.max(Math.floor(y), 0), this.h - 2);
    const tx = x - x0;
    const ty = Math.min(Math.max(y - y0, 0), 1);
    const xa = ((x0 % this.w) + this.w) % this.w;
    const xb = (xa + 1) % this.w;
    const z = this.z;
    const w = this.w;
    return (z[y0 * w + xa] * (1 - tx) * (1 - ty) + z[y0 * w + xb] * tx * (1 - ty) + z[(y0 + 1) * w + xa] * (1 - tx) * ty + z[(y0 + 1) * w + xb] * tx * ty) * this.scale;
  }
}

/** Inside the selected site's box the south polar surface sinks 150 m, so the detailed site terrain drawn there
 *  always wins the depth test (no holes, no z-fighting). */
export function applyHole(m: THREE.MeshStandardMaterial, u: HoleUniforms): void {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uHole = u.hole;
    sh.uniforms.uHoleOn = u.holeOn;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 sxy;\nuniform vec4 uHole;\nuniform float uHoleOn;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nif (uHoleOn > 0.5 && sxy.x > uHole.x && sxy.x < uHole.z && sxy.y > uHole.y && sxy.y < uHole.w) {\n  vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  transformed -= normalize(wp) * 0.15;\n}",
      );
  };
  m.customProgramCacheKey = () => "pn-polar-hole";
}

export function makePolarMaterial(albedo: number): THREE.MeshStandardMaterial & { userData: HoleUniforms } {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color().setScalar(albedo).convertSRGBToLinear(), roughness: 1, metalness: 0 });
  const u: HoleUniforms = { hole: { value: new THREE.Vector4(0, 0, 0, 0) }, holeOn: { value: 0 } };
  m.userData = u;
  applyHole(m, u);
  return m as never;
}

function addSkirt(pos: number[], nor: number[], uv: number[], idx: number[], rim: number[], drop: number, center: THREE.Vector3, extra?: { arr: number[]; size: number }, keep?: (k: number) => boolean) {
  const base = pos.length / 3;
  const c = center;
  for (const k of rim) {
    const px = pos[k * 3] + c.x;
    const py = pos[k * 3 + 1] + c.y;
    const pz = pos[k * 3 + 2] + c.z;
    const len = Math.hypot(px, py, pz);
    const s = (len - drop) / len;
    pos.push(px * s - c.x, py * s - c.y, pz * s - c.z);
    nor.push(nor[k * 3], nor[k * 3 + 1], nor[k * 3 + 2]);
    uv.push(uv[k * 2], uv[k * 2 + 1]);
    if (extra) for (let e = 0; e < extra.size; e++) extra.arr.push(extra.arr[k * extra.size + e]);
  }
  for (let t = 0; t < rim.length; t++) {
    const a = rim[t];
    const b = rim[(t + 1) % rim.length];
    if (keep && !(keep(a) && keep(b))) continue;
    const a2 = base + t;
    const b2 = base + ((t + 1) % rim.length);
    idx.push(a, b, a2, b, b2, a2);
  }
}

function rimLoop(n: number): number[] {
  const cols = n + 1;
  const out: number[] = [];
  for (let c = 0; c < n; c++) out.push(c);
  for (let r = 0; r < n; r++) out.push(r * cols + n);
  for (let c = n; c > 0; c--) out.push(n * cols + c);
  for (let r = n; r > 0; r--) out.push(r * cols);
  return out;
}

function disposeMesh(m: THREE.Mesh) {
  m.geometry.dispose();
  const mat = m.material as THREE.MeshStandardMaterial;
  const img = mat.map?.image as { close?: () => void } | undefined;
  mat.map?.dispose();
  img?.close?.();
  mat.dispose();
}

const inBand = (lat: number) => lat >= CAP_LAT - 0.4 && lat <= CAP_ABS + 0.4;

function pBounds(L: number, row: number, col: number): [number, number, number, number] {
  const s = SPAN0 / 2 ** L;
  const x0 = -ORIGIN + col * s;
  const y1 = ORIGIN - row * s;
  return [x0, y1 - s, x0 + s, y1];
}
function pInCap(L: number, row: number, col: number): boolean {
  const [x0, y0, x1, y1] = pBounds(L, row, col);
  const nx = x0 <= 0 && 0 <= x1 ? 0 : Math.min(Math.abs(x0), Math.abs(x1));
  const ny = y0 <= 0 && 0 <= y1 ? 0 : Math.min(Math.abs(y0), Math.abs(y1));
  return Math.hypot(nx, ny) <= CAP_RHO;
}
function pInNac(L: number, row: number, col: number): boolean {
  const [x0, y0, x1, y1] = pBounds(L, row, col);
  return x0 < NAC_EXT && x1 > -NAC_EXT && y0 < NAC_EXT && y1 > -NAC_EXT;
}
function pIn80(L: number, row: number, col: number): boolean {
  const [x0, y0, x1, y1] = pBounds(L, row, col);
  return Math.max(Math.abs(x0), Math.abs(x1), Math.abs(y0), Math.abs(y1)) <= LIM80;
}

export class MoonTiles {
  group = new THREE.Group();
  ready = false;
  private tiles = new Map<string, Tile>();
  private frame = 0;
  private inflight = 0;
  private loader = new THREE.TextureLoader();
  private frustum = new THREE.Frustum();
  private m4 = new THREE.Matrix4();
  private tmp = new THREE.Vector3();
  private selected: Tile[] = [];
  private fallback = new Set<Tile>();
  private backdrops = new Set<Tile>();
  private loading = new Set<Tile>();
  private hrFrom: number;
  private hgtCache = new Map<string, Promise<Int16Array | null>>();

  constructor(
    public man: TileManifest,
    public heights: GlobalHeights,
    private fallbackMat: THREE.MeshStandardMaterial,
    private holeU: HoleUniforms,
    private base = "./tiles",
  ) {
    this.hrFrom = man.hr?.from_level ?? 99;
  }

  // ------------------------------------------------------------------ tile bookkeeping
  private geo(L: number, x: number, y: number): Tile {
    const key = `g${L}/${x}/${y}`;
    let t = this.tiles.get(key);
    if (!t) {
      const d = 180 / 2 ** L;
      const lon0 = -180 + x * d;
      const lat1 = 90 - y * d;
      const dir = dirLL(lat1 - d / 2, lon0 + d / 2);
      let ang = 0;
      for (const [la, lo] of [[lat1, lon0], [lat1, lon0 + d], [lat1 - d, lon0], [lat1 - d, lon0 + d], [lat1, lon0 + d / 2], [lat1 - d, lon0 + d / 2]])
        ang = Math.max(ang, dir.angleTo(dirLL(la, lo, this.tmp)));
      t = { key, kind: "geo", hemi: "s", L, a: x, b: y, state: "idle", mesh: null, used: 0, dir, ang, sizeKm: (R * d * Math.PI) / 180, abort: null, topLat: lat1, botLat: lat1 - d, prio: 0 };
      this.tiles.set(key, t);
    }
    return t;
  }

  private polar(h: Hemi, L: number, row: number, col: number): Tile {
    const key = `p${h}${L}/${row}_${col}`;
    let t = this.tiles.get(key);
    if (!t) {
      const [x0, y0, x1, y1] = pBounds(L, row, col);
      const [la, lo] = polarLL(h, (x0 + x1) / 2, (y0 + y1) / 2);
      const dir = dirLL((la * 180) / Math.PI, (lo * 180) / Math.PI);
      let ang = 0;
      for (const [sx, sy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
        const [a, b] = polarLL(h, sx, sy);
        ang = Math.max(ang, dir.angleTo(dirLL((a * 180) / Math.PI, (b * 180) / Math.PI, this.tmp)));
      }
      t = { key, kind: "polar", hemi: h, L, a: col, b: row, state: "idle", mesh: null, used: 0, dir, ang, sizeKm: (x1 - x0) / 1000, abort: null, topLat: 0, botLat: 0, prio: 0 };
      this.tiles.set(key, t);
    }
    return t;
  }

  private geoInCap(t: Tile): boolean {
    return t.topLat <= CAP_LAT || t.botLat >= CAP_ABS;
  }

  private children(t: Tile): Tile[] {
    if (t.kind === "geo") {
      const { L, a: x, b: y } = t;
      return [this.geo(L + 1, 2 * x, 2 * y), this.geo(L + 1, 2 * x + 1, 2 * y), this.geo(L + 1, 2 * x, 2 * y + 1), this.geo(L + 1, 2 * x + 1, 2 * y + 1)].filter((k) => !this.geoInCap(k));
    }
    const { L, a: col, b: row, hemi } = t;
    const out: Tile[] = [];
    for (const [r, c] of [[2 * row, 2 * col], [2 * row, 2 * col + 1], [2 * row + 1, 2 * col], [2 * row + 1, 2 * col + 1]])
      if (pInCap(L + 1, r, c)) out.push(this.polar(hemi, L + 1, r, c));
    return out;
  }

  private maxLevel(t: Tile): number {
    if (t.kind === "geo") return this.man.wac.max;
    return pInNac(t.L, t.b, t.a) ? NAC_MAX : OUTER_MAX;
  }

  // ------------------------------------------------------------------ visibility and screen size
  private camPos = new THREE.Vector3();
  private camDir = new THREE.Vector3();
  private look = new THREE.Vector3();
  private horizon = 0;
  private K = 1;

  private visible(t: Tile): boolean {
    if (this.camDir.angleTo(t.dir) > this.horizon + t.ang) return false;
    const c = this.tmp.copy(t.dir).multiplyScalar(R);
    const rad = 2 * R * Math.sin(t.ang / 2) + 12;
    return this.frustum.intersectsSphere(new THREE.Sphere(c, rad));
  }

  private pixels(t: Tile): number {
    const c = this.tmp.copy(t.dir).multiplyScalar(R);
    const chord = 2 * R * Math.sin(t.ang / 2);
    const d = Math.max(0.05, this.camPos.distanceTo(c) - chord);
    return (t.sizeKm / d) * this.K;
  }

  // ------------------------------------------------------------------ traversal (skip levels)
  update(camera: THREE.PerspectiveCamera, viewportH: number) {
    this.frame++;
    camera.updateMatrixWorld();
    this.m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m4);
    this.camPos.copy(camera.position);
    const dist = this.camPos.length();
    this.camDir.copy(this.camPos).normalize();
    this.horizon = Math.acos(Math.min(1, (R - 10) / dist)) + Math.acos(R / (R + 10));
    this.K = viewportH / (2 * Math.tan(((camera.fov * Math.PI) / 180) / 2));
    // the point at the screen centre: load tiles nearest to it first
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const b = this.camPos.dot(fwd);
    const disc = b * b - (dist * dist - R * R);
    this.look.copy(disc > 0 ? this.camPos.clone().addScaledVector(fwd, -b - Math.sqrt(disc)) : this.camPos).normalize();

    const want: Tile[] = [];
    this.fallback.clear();
    this.backdrops.clear();
    this.selected = [];
    for (const [x, y] of [[0, 0], [1, 0]]) this.visit(this.geo(0, x, y), want, true);
    for (const h of ["s", "n"] as Hemi[]) this.visit(this.polar(h, 0, 0, 0), want, true);
    const sel = new Set(this.selected);
    for (const t of this.tiles.values()) if (t.mesh) t.mesh.visible = sel.has(t);
    for (const t of sel) {
      // stand-ins sit a little lower (more for coarser tiles) so any sharper tile drawn over them wins the depth test
      const sink = this.backdrops.has(t) ? t.sizeKm * 0.004 : 0;
      t.mesh!.position.copy(t.mesh!.userData.base as THREE.Vector3).addScaledVector(t.dir, -sink);
    }
    // cancel requests for tiles the view no longer needs (they would delay the ones it does)
    for (const t of this.loading) if (this.frame - t.used > 20) t.abort?.abort();
    this.ready = this.geo(0, 0, 0).state === "ready" && this.geo(0, 1, 0).state === "ready";
    // nearest the screen centre first; stand-in ancestors before the leaves they cover
    for (const t of want) t.prio = this.look.angleTo(t.dir) * (this.fallback.has(t) ? 0.5 : 1) - t.L * 1e-4;
    want.sort((p, q) => p.prio - q.prio);
    for (const t of want) {
      if (this.inflight >= MAX_INFLIGHT) break;
      if (t.state === "idle") this.load(t);
    }
    if (this.frame % 30 === 0) this.evict(sel);
  }

  /** Returns true when the tile's area is fully drawn by selected tiles. */
  private visit(t: Tile, want: Tile[], root = false): boolean {
    if (t.kind === "geo" && this.geoInCap(t)) return true;
    if (!root && !this.visible(t)) return true;
    t.used = this.frame;
    const split = t.L < this.maxLevel(t) && (root || this.pixels(t) > SPLIT);
    if (!split) {
      if (t.state === "ready") {
        this.selected.push(t);
        return true;
      }
      if (t.state === "idle") want.push(t);
      return false;
    }
    let all = true;
    for (const k of this.children(t)) if (!this.visit(k, want)) all = false;
    if (all) return true;
    // some children are not ready: keep the ones that are, and draw this tile underneath to fill the gaps
    if (t.state === "ready") {
      this.selected.push(t);
      this.backdrops.add(t);
      return true;
    }
    if (t.state === "idle") {
      want.push(t);
      this.fallback.add(t);
    }
    return false;
  }

  // ------------------------------------------------------------------ loading and geometry
  private static bitmaps = typeof createImageBitmap === "function";

  /** Fetch and decode a tile image off the main thread (falls back to an <img> where ImageBitmap is unavailable). */
  private loadTexture(url: string, signal: AbortSignal): Promise<THREE.Texture | null> {
    const finish = (tex: THREE.Texture) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      return tex;
    };
    if (!MoonTiles.bitmaps)
      return new Promise((resolve) => this.loader.load(url, (tex) => resolve(finish(tex)), undefined, () => resolve(null)));
    return fetch(url, { signal })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => (b ? createImageBitmap(b, { imageOrientation: "flipY" }) : null))
      .then((bmp) => {
        if (!bmp) return null;
        const tex = new THREE.Texture(bmp as unknown as HTMLImageElement);
        tex.flipY = false; // already flipped while decoding
        return finish(tex);
      })
      .catch(() => null);
  }

  private heightTile(h: Hemi, L: number, row: number, col: number): Promise<Int16Array | null> {
    const key = `${h}${L}/${row}_${col}`;
    let p = this.hgtCache.get(key);
    if (!p) {
      p = fetch(`${this.base}/tp_${h}/hgt/${L}/${row}_${col}.bin`)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((b) => (b ? new Int16Array(b) : null))
        .catch(() => null);
      this.hgtCache.set(key, p);
      if (this.hgtCache.size > 600) this.hgtCache.delete(this.hgtCache.keys().next().value as string);
    }
    return p;
  }

  private load(t: Tile) {
    t.state = "loading";
    this.inflight++;
    this.loading.add(t);
    const ac = new AbortController();
    t.abort = ac;
    const done = (mesh: THREE.Mesh | null) => {
      this.inflight--;
      this.loading.delete(t);
      t.abort = null;
      if (!mesh) {
        t.state = ac.signal.aborted ? "idle" : "failed"; // cancelled tiles can be asked for again later
        return;
      }
      if (ac.signal.aborted && this.frame - t.used > 20) {
        disposeMesh(mesh);
        t.state = "idle";
        return;
      }
      mesh.userData.base = mesh.position.clone();
      t.mesh = mesh;
      mesh.visible = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.tile = t.key;
      this.group.add(mesh);
      t.state = "ready";
    };
    if (t.kind === "geo") {
      const src = t.L >= this.hrFrom ? "hr" : "wac";
      this.loadTexture(`${this.base}/${src}/${t.L}/${t.a}/${t.b}.jpg`, ac.signal).then((tex) => {
        if (!tex) return done(null);
        const { geo, center } = this.buildGeo(t);
        const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }));
        mesh.position.copy(center);
        done(mesh);
      });
      return;
    }
    // polar: heights from this level up to HGT_MAX (deeper tiles sample their ancestor), imagery at this level
    let hL = Math.min(t.L, HGT_MAX);
    if (hL === HGT_MAX && !pIn80(HGT_MAX, t.b >> (t.L - HGT_MAX), t.a >> (t.L - HGT_MAX))) hL = HGT_MAX - 1;
    const k = t.L - hL;
    Promise.all([this.heightTile(t.hemi, hL, t.b >> k, t.a >> k), this.loadTexture(`${this.base}/tp_${t.hemi}/img/${t.L}/${t.b}_${t.a}.jpg`, ac.signal)])
      .then(([hgt, tex]) => {
        if (!hgt || !tex) {
          tex?.dispose();
          return done(null);
        }
        const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
        if (t.hemi === "s") applyHole(mat, this.holeU);
        const { geo, center } = this.buildPolar(t, hgt, hL);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(center);
        done(mesh);
      })
      .catch(() => done(null));
  }

  private buildGeo(t: Tile): { geo: THREE.BufferGeometry; center: THREE.Vector3 } {
    const d = 180 / 2 ** t.L;
    const lon0 = -180 + t.a * d;
    const lat1 = 90 - t.b * d;
    const n = t.L <= 1 ? 64 : t.L <= 3 ? 40 : t.L <= 7 ? 24 : 16;
    const H = (la: number, lo: number) => R + this.heights.at(Math.max(-90, Math.min(90, la)), lo) / 1000;
    const cLat = lat1 - d / 2;
    const cLon = lon0 + d / 2;
    const center = dirLL(cLat, cLon).multiplyScalar(H(cLat, cLon));
    const cols = n + 1;
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const lat: number[] = [];
    const e = Math.max(d / n, 0.06);
    const v = new THREE.Vector3();
    const pe = new THREE.Vector3();
    const pw = new THREE.Vector3();
    const pn = new THREE.Vector3();
    const ps = new THREE.Vector3();
    for (let r = 0; r <= n; r++) {
      const la = lat1 - (r / n) * d;
      for (let c = 0; c <= n; c++) {
        const lo = lon0 + (c / n) * d;
        dirLL(la, lo, v).multiplyScalar(H(la, lo));
        pos.push(v.x - center.x, v.y - center.y, v.z - center.z);
        dirLL(la, lo + e, pe).multiplyScalar(H(la, lo + e));
        dirLL(la, lo - e, pw).multiplyScalar(H(la, lo - e));
        const laN = Math.min(89.999, la + e);
        const laS = Math.max(-89.999, la - e);
        dirLL(laN, lo, pn).multiplyScalar(H(laN, lo));
        dirLL(laS, lo, ps).multiplyScalar(H(laS, lo));
        const nn = pe.sub(pw).cross(pn.sub(ps)).normalize();
        if (!Number.isFinite(nn.x)) dirLL(la, lo, nn);
        nor.push(nn.x, nn.y, nn.z);
        uv.push(c / n, 1 - r / n);
        lat.push(la);
      }
    }
    const idx: number[] = [];
    for (let r = 0; r < n; r++) {
      const a0 = lat1 - (r / n) * d;
      const a1 = lat1 - ((r + 1) / n) * d;
      if ((a0 < CAP_LAT - 0.4 && a1 < CAP_LAT - 0.4) || (a0 > CAP_ABS + 0.4 && a1 > CAP_ABS + 0.4)) continue;
      for (let c = 0; c < n; c++) {
        const a = r * cols + c;
        idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
      }
    }
    addSkirt(pos, nor, uv, idx, rimLoop(n), Math.max(t.L >= 8 ? 0.3 : 1, t.sizeKm * 0.04), center, undefined, (k) => inBand(lat[k]));
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return { geo: g, center };
  }

  /** Polar tile mesh; heights come from the tile at level hL (an ancestor when t.L > hL), sampled bilinearly. */
  private buildPolar(t: Tile, data: Int16Array, hL: number): { geo: THREE.BufferGeometry; center: THREE.Vector3 } {
    const [x0, , x1, y1] = pBounds(t.L, t.b, t.a);
    const k = t.L - hL;
    const [ax0, , ax1, ay1] = pBounds(hL, t.b >> k, t.a >> k);
    const aspan = ax1 - ax0;
    const size = x1 - x0;
    const sample = (sx: number, sy: number) => {
      const u = Math.min(Math.max(((sx - ax0) / aspan) * (N - 1), 0), N - 1.0001);
      const v = Math.min(Math.max(((ay1 - sy) / aspan) * (N - 1), 0), N - 1.0001);
      const i = Math.floor(u);
      const j = Math.floor(v);
      const fu = u - i;
      const fv = v - j;
      return (data[j * N + i] * (1 - fu) * (1 - fv) + data[j * N + i + 1] * fu * (1 - fv) + data[(j + 1) * N + i] * (1 - fu) * fv + data[(j + 1) * N + i + 1] * fu * fv) * 0.5;
    };
    const pts: THREE.Vector3[] = [];
    const absLat: number[] = [];
    const sxy: number[] = [];
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) {
        const sx = x0 + (c / (N - 1)) * size;
        const sy = y1 - (r / (N - 1)) * size;
        const [la, lo] = polarLL(t.hemi, sx, sy);
        const rad = R + sample(sx, sy) / 1000;
        pts.push(new THREE.Vector3(rad * Math.cos(la) * Math.cos(lo), rad * Math.cos(la) * Math.sin(lo), rad * Math.sin(la)));
        absLat.push(Math.abs((la * 180) / Math.PI));
        sxy.push(sx / 1000, sy / 1000);
      }
    const mid = Math.floor(N / 2);
    const center = pts[mid * N + mid].clone();
    const pos: number[] = [];
    const uv: number[] = [];
    for (let q = 0; q < pts.length; q++) {
      pos.push(pts[q].x - center.x, pts[q].y - center.y, pts[q].z - center.z);
      uv.push((q % N) / (N - 1), 1 - Math.floor(q / N) / (N - 1));
    }
    const idx: number[] = [];
    for (let r = 0; r < N - 1; r++)
      for (let c = 0; c < N - 1; c++) {
        const a = r * N + c;
        if (Math.max(absLat[a], absLat[a + 1], absLat[a + N], absLat[a + N + 1]) < CAP_ABS - 0.45) continue;
        idx.push(a, a + N, a + 1, a + 1, a + N, a + N + 1);
      }
    const g0 = new THREE.BufferGeometry();
    g0.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g0.setIndex(idx.length ? idx : [0, 0, 0]);
    g0.computeVertexNormals();
    const nor = Array.from(g0.getAttribute("normal").array as Float32Array);
    g0.dispose();
    addSkirt(pos, nor, uv, idx, rimLoop(N - 1), Math.max(0.08, t.sizeKm * 0.08), center, { arr: sxy, size: 2 }, (q) => absLat[q] >= CAP_ABS - 0.45);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("sxy", new THREE.Float32BufferAttribute(sxy, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return { geo: g, center };
  }

  private disposeTile(t: Tile) {
    const m = t.mesh!;
    this.group.remove(m);
    if ((m.material as THREE.Material) !== this.fallbackMat) disposeMesh(m);
    else m.geometry.dispose();
    t.mesh = null;
    t.state = "idle";
  }

  private evict(sel: Set<Tile>) {
    let meshes = 0;
    for (const t of this.tiles.values()) if (t.mesh) meshes++;
    if (meshes > MAX_MESHES) {
      // never drop what this frame visited (ready children waiting for their siblings)
      const cands = [...this.tiles.values()].filter((t) => t.mesh && !sel.has(t) && t.L > 1 && t.used < this.frame).sort((p, q) => p.used - q.used);
      for (const t of cands.slice(0, meshes - MAX_MESHES + 60)) this.disposeTile(t);
    }
    if (this.tiles.size > MAX_RECORDS)
      for (const [k, t] of this.tiles) if (!t.mesh && t.state !== "loading" && t.L > 1 && this.frame - t.used > 300) this.tiles.delete(k);
  }

  meshes(): THREE.Mesh[] {
    return this.selected.map((t) => t.mesh!).filter(Boolean);
  }

  stats() {
    const lv = (k: Tile["kind"]) => Math.max(0, ...this.selected.filter((t) => t.kind === k).map((t) => t.L));
    return { tiles: this.tiles.size, drawn: this.selected.length, inflight: this.inflight, geoMax: lv("geo"), polarMax: lv("polar") };
  }

  dispose() {
    for (const t of this.tiles.values()) if (t.mesh) this.disposeTile(t);
    this.tiles.clear();
  }
}
