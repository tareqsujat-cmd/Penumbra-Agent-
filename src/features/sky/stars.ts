/** Real star field: the Yale Bright Star Catalogue (9,096 stars to V = 6.5, J2000) from /api/sky, with the SPICE
 *  rotation J2000 → MOON_ME every 6 h so the sky turns correctly over the Moon (one turn per sidereal month).
 *  No atmosphere on the Moon: stars do not twinkle and are not dimmed toward the horizon. */
import * as THREE from "three";

export interface SkyData {
  source: string;
  count: number;
  ra: number[];
  dec: number[];
  vmag: number[];
  bv: number[];
  named: Record<string, string>;
  frame: { from: string; to: string; year: number; step_h: number; quaternions_xyzw: number[][] };
}

let pending: Promise<SkyData | null> | null = null;

export function loadSky(): Promise<SkyData | null> {
  if (!pending)
    pending = fetch("/api/sky")
      .then((r) => (r.ok ? (r.json() as Promise<SkyData>) : null))
      .catch(() => null);
  return pending;
}

/** Star colour from B−V (Ballesteros 2012 temperature, then an approximate blackbody ramp). */
export function bvToRgb(bv: number): [number, number, number] {
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  const k = t / 100;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const r = k <= 66 ? 1 : clamp(1.293 * Math.pow(k - 60, -0.1332));
  const g = k <= 66 ? clamp(0.39 * Math.log(k) - 0.632) : clamp(1.13 * Math.pow(k - 60, -0.0755));
  const b = k >= 66 ? 1 : k <= 19 ? 0 : clamp(0.543 * Math.log(k - 10) - 1.196);
  // desaturate toward white: real star colours are subtle to the eye
  return [0.55 + 0.45 * r, 0.55 + 0.45 * g, 0.55 + 0.45 * b];
}

export interface StarBuffers {
  /** J2000 unit vectors */
  dirs: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  vmag: Float32Array;
  n: number;
}

const cache = new Map<string, StarBuffers>();

/** Unit vectors, colours and point sizes (px) for stars brighter than `limit`. */
export function starBuffers(sky: SkyData, limit = 6.5, scale = 1): StarBuffers {
  const key = `${limit}:${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let n = 0;
  while (n < sky.count && sky.vmag[n] <= limit) n++; // catalogue arrives sorted brightest first
  const dirs = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  const vmag = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ra = (sky.ra[i] * Math.PI) / 180;
    const de = (sky.dec[i] * Math.PI) / 180;
    dirs[i * 3] = Math.cos(de) * Math.cos(ra);
    dirs[i * 3 + 1] = Math.cos(de) * Math.sin(ra);
    dirs[i * 3 + 2] = Math.sin(de);
    const [r, g, b] = bvToRgb(sky.bv[i]);
    // brightness ∝ 10^(−0.4 m): map to point size and intensity, compressed so faint stars stay visible
    const m = sky.vmag[i];
    const f = Math.pow(10, -0.4 * (m - 6.5));
    const inten = Math.min(1, 0.32 + 0.16 * Math.log2(1 + f));
    colors[i * 3] = r * inten;
    colors[i * 3 + 1] = g * inten;
    colors[i * 3 + 2] = b * inten;
    sizes[i] = scale * Math.min(5.5, 1.1 + 0.62 * Math.log2(1 + f));
    vmag[i] = m;
  }
  const out = { dirs, colors, sizes, vmag, n };
  cache.set(key, out);
  return out;
}

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();

/** Rotation J2000 → MOON_ME at hour `h` of the frame's year (slerp between the 6-hour SPICE steps). */
export function moonFrameAt(sky: SkyData, h: number, out = new THREE.Quaternion()): THREE.Quaternion {
  const q = sky.frame.quaternions_xyzw;
  const f = Math.min(Math.max(h / sky.frame.step_h, 0), q.length - 1.000001);
  const i = Math.floor(f);
  qa.set(q[i][0], q[i][1], q[i][2], q[i][3]);
  qb.set(q[i + 1][0], q[i + 1][1], q[i + 1][2], q[i + 1][3]);
  return out.copy(qa).slerp(qb, f - i);
}

/** Point material: round soft stars, constant screen size, depth-tested so the Moon and Earth hide them. */
export function starMaterial(opacity = 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: opacity }, uPixelRatio: { value: Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio : 1) } },
    // log-depth chunks: the globe renders with a logarithmic depth buffer, and stars must be hidden by the Moon/Earth
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute float size;
      varying vec3 vColor;
      uniform float uPixelRatio;
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = size * uPixelRatio;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      varying vec3 vColor;
      uniform float uOpacity;
      void main() {
        #include <logdepthbuf_fragment>
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d) * 2.0;
        float core = smoothstep(1.0, 0.0, r);
        float a = core * core * uOpacity;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor * (0.6 + 0.6 * core), a);
      }`,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
}

/** Points geometry with the stars placed at radius `r` around the origin (J2000 axes). */
export function starGeometry(b: StarBuffers, r: number): THREE.BufferGeometry {
  const pos = new Float32Array(b.n * 3);
  for (let i = 0; i < b.n * 3; i++) pos[i] = b.dirs[i] * r;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(b.colors, 3));
  g.setAttribute("size", new THREE.BufferAttribute(b.sizes, 1));
  g.computeBoundingSphere();
  return g;
}
