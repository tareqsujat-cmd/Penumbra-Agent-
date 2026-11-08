import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Line, MapControls } from "@react-three/drei";
import * as THREE from "three";
import type { MapControls as MapControlsImpl } from "three-stdlib";
import { api, loadRegion, siteListSync } from "../../api/client";
import { getState, setState, useApp } from "../../state/store";
import { useModel, useRisk, useSite } from "../../hooks/useMission";
import { bilinear, decodeEphem, fieldExtent, inField } from "../../utils/field";
import { azElToWorld, fromWorld, latLonToStereo, makeFrame, toWorld, type SiteFrame } from "./frame";
import { buildDrape, buildTerrain, gridCovers, heightAt, loadGrid, type HeightGrid } from "./grids";
import { heatTexture, slopeTexture } from "./heatTexture";
import { cividis } from "../../utils/color";
import { LayerList } from "../map/LayerList";
import { HeatLegend } from "../map/HeatLegend";
import { SurfaceInfo, type SurfacePick } from "./SurfaceInfo";
import { Seg } from "../../components/ui";
import { StarField } from "../sky/StarField";
import { setStereoUV, useSiteImagery } from "../globe/siteImagery";
import type { SiteData, UncertaintyModel, XY } from "../../types";


export interface Grids {
  detail: HeightGrid;
  context: HeightGrid;
  region: HeightGrid;
  frame: SiteFrame;
  cx: number;
  cy: number;
}

export async function loadSiteGrids(site: SiteData, ve: number): Promise<Grids> {
  const [cx, cy] = site.terrain.center_xy;
  const t = site.terrain;
  const detail = await loadGrid(t.height_png, t.hmin, t.hmax, cx - t.half, cy + t.half, t.res);
  const ctx = (site as SiteData & { context: { half: number; res: number; hmin: number; hmax: number; height_png: string; center_offset: [number, number] } }).context;
  const ccx = cx + ctx.center_offset[0];
  const ccy = cy + ctx.center_offset[1];
  const context = await loadGrid(ctx.height_png, ctx.hmin, ctx.hmax, ccx - ctx.half, ccy + ctx.half, ctx.res);
  const REGION = await loadRegion();
  const region = await loadGrid(REGION.height_png, REGION.hmin, REGION.hmax, REGION.x0, REGION.y0, REGION.res);
  const h0 = heightAt([detail], cx, cy);
  return { detail, context, region, frame: makeFrame(site.lat, site.lon, h0, ve), cx, cy };
}

// ---------------------------------------------------------------- textures for Sun and Earth

function sunTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, "rgba(255,255,250,1)");
  grad.addColorStop(0.08, "rgba(255,252,240,1)");
  grad.addColorStop(0.12, "rgba(255,236,190,0.55)");
  grad.addColorStop(0.35, "rgba(255,210,140,0.12)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Earth disc with the phase seen from the Moon; the lit limb faces +x (rotate the sprite toward the Sun). */
function earthTexture(phaseDeg: number): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const r = 52;
  g.translate(64, 64);
  g.fillStyle = "#0b1a2c";
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  const k = Math.cos((phaseDeg * Math.PI) / 180);
  g.fillStyle = "#7fb4ea";
  g.beginPath();
  g.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
  g.ellipse(0, 0, Math.abs(k) * r, r, 0, Math.PI / 2, -Math.PI / 2, k < 0);
  g.fill();
  const glow = g.createRadialGradient(0, 0, r * 0.9, 0, 0, r * 1.2);
  glow.addColorStop(0, "rgba(127,180,234,0.25)");
  glow.addColorStop(1, "rgba(127,180,234,0)");
  g.fillStyle = glow;
  g.beginPath();
  g.arc(0, 0, r * 1.2, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function labelTexture(text: string, color: string, bold = true): { tex: THREE.Texture; aspect: number } {
  const px = 44;
  const font = `${bold ? 600 : 500} ${px}px "Space Grotesk", system-ui, sans-serif`;
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  g.font = font;
  c.width = Math.ceil(g.measureText(text).width) + 36;
  c.height = px + 24;
  const g2 = c.getContext("2d")!;
  g2.fillStyle = "rgba(5,7,10,0.82)";
  g2.beginPath();
  g2.roundRect(0, 0, c.width, c.height, 12);
  g2.fill();
  g2.font = font;
  g2.fillStyle = color;
  g2.textBaseline = "middle";
  g2.fillText(text, 18, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: c.width / c.height };
}

/** Screen rectangles of the pin labels already placed this frame (pins nudge their labels so none overlap). */
const placed: { t: number; rects: [number, number, number, number][] } = { t: -1, rects: [] };
const OFFSETS = [0, 1.15, -1.15, 2.3, -2.3, 3.45, 4.6];

/** Keeps a pin's label sprite (size `s`, sizeAttenuation off) clear of labels placed earlier in the same frame by
 *  shifting it up or down in label heights, starting from its preferred `stack` slot. */
export function useLabelDeclutter(sprite: React.RefObject<THREE.Sprite | null>, top: THREE.Vector3, aspect: number, s: number, stack: number) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    const sp = sprite.current;
    if (!sp) return;
    if (placed.t !== state.clock.elapsedTime) {
      placed.t = state.clock.elapsedTime;
      placed.rects = [];
    }
    const cam = state.camera as THREE.PerspectiveCamera;
    v.copy(top).project(cam);
    if (v.z > 1) return;
    const H = state.size.height;
    const h = (s * H) / 2 / Math.tan((cam.fov * Math.PI) / 360);
    const w = h * aspect;
    const ax = ((v.x + 1) / 2) * state.size.width;
    const ay = ((v.y + 1) / 2) * H;
    const rect = (k: number): [number, number, number, number] => [ax + 0.06 * w, ay + (k - 0.5) * h, ax + 1.06 * w, ay + (k + 0.5) * h];
    let k = stack * 1.15;
    for (const o of OFFSETS) {
      const r = rect(stack * 1.15 + o);
      if (!placed.rects.some((q) => r[0] < q[2] + 3 && r[2] > q[0] - 3 && r[1] < q[3] + 2 && r[3] > q[1] - 2)) {
        k = stack * 1.15 + o;
        break;
      }
    }
    placed.rects.push(rect(k));
    sp.center.set(-0.06, 0.5 - k);
  });
}

export function Pin({ at, color, label, height = 28, glyph = "dot", stack = 0 }: { at: THREE.Vector3; color: string; label: string; height?: number; glyph?: "dot" | "star" | "tri"; stack?: number }) {
  const { tex, aspect } = useMemo(() => labelTexture(label, color === "#ffffff" ? "#e8edf4" : color), [label, color]);
  useEffect(() => () => tex.dispose(), [tex]);
  const top = useMemo(() => at.clone().add(new THREE.Vector3(0, height, 0)), [at, height]);
  const s = 0.024;
  const sprite = useRef<THREE.Sprite>(null);
  useLabelDeclutter(sprite, top, aspect, s, stack);
  return (
    <group>
      <Line points={[at, top]} color={color} lineWidth={1.6} />
      <mesh position={at}>
        <sphereGeometry args={[glyph === "star" ? 4 : 2.6, 16, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <sprite ref={sprite} position={top} scale={[s * aspect, s, 1]} center={new THREE.Vector2(-0.06, 0.5 - stack * 1.15)} renderOrder={20}>
        <spriteMaterial map={tex} sizeAttenuation={false} depthTest={false} transparent />
      </sprite>
    </group>
  );
}

function RegionPin({ at, label, onClick, stack = 0, accent = false }: { at: THREE.Vector3; label: string; onClick?: () => void; stack?: number; accent?: boolean }) {
  const { tex, aspect } = useMemo(() => labelTexture(label, accent ? "#ffd98a" : "#e8edf4", accent), [label, accent]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <sprite position={at} scale={[0.024 * aspect, 0.024, 1]} center={new THREE.Vector2(0.5, stack === 0 ? 1.4 : -0.2 - (stack - 1) * 1.7)} renderOrder={20} onClick={(e) => { e.stopPropagation(); onClick?.(); }}>
      <spriteMaterial map={tex} sizeAttenuation={false} depthTest={false} transparent />
    </sprite>
  );
}

// ---------------------------------------------------------------- scene

interface SceneProps {
  site: SiteData;
  grids: Grids;
  sunDir: THREE.Vector3;
  sunEl: number;
  earthDir: THREE.Vector3;
  earthPhase: number;
  earthRot: number;
  studio: boolean;
  flyRequest: { kind: "site" | "overview" | "point"; point?: THREE.Vector3; n: number } | null;
  onPick: (p: SurfacePick) => void;
  onHover: (info: { lat: number; lon: number; h: number; sun: number | null } | null) => void;
  pick: THREE.Vector3 | null;
}

function Scene({ site, grids, sunDir, sunEl, earthDir, earthPhase, earthRot, studio, flyRequest, onPick, onHover, pick }: SceneProps) {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as unknown as MapControlsImpl | null;
  const aim = useApp((s) => s.aim);
  const cursorIdx = useApp((s) => s.cursorIdx);
  const layers = useApp((s) => s.layers);
  const unc = useApp((s) => s.uncertainty);
  const robust = useApp((s) => s.robust);
  const heatMetric = useApp((s) => s.heatMetric);
  const model = useModel();
  const risk = useRisk();
  const f = grids.frame;
  const { cx, cy } = grids;
  const field = site.field;

  const imagery = useSiteImagery(site.id);
  const geoms = useMemo(() => {
    const t = site.terrain;
    const detailBox: [number, number, number, number] = [cx - t.half + 10, cy - t.half + 10, cx + t.half - 10, cy + t.half - 10];
    const c = grids.context;
    const ctxBox: [number, number, number, number] = [c.x0 + 2 * c.res, c.y0 - (c.n - 3) * c.res, c.x0 + (c.n - 3) * c.res, c.y0 - 2 * c.res];
    const g = {
      detail: buildTerrain(grids.detail, f, 1),
      context: buildTerrain(grids.context, f, 1, detailBox),
      region: buildTerrain(grids.region, f, 1, ctxBox),
    };
    const det = imagery.detail ?? imagery.ctx;
    if (det) setStereoUV(g.detail, grids.detail, det.box);
    if (imagery.ctx) {
      setStereoUV(g.context, grids.context, imagery.ctx.box);
    }
    if (imagery.region) setStereoUV(g.region, grids.region, imagery.region.box);
    return g;
  }, [grids, f, site, cx, cy, imagery]);
  useEffect(() => () => Object.values(geoms).forEach((g) => g.dispose()), [geoms]);

  const fx = fieldExtent(field);
  const drapeBox = useMemo<[number, number, number, number]>(() => [cx + fx[0], cy + fx[1], cx + fx[2], cy + fx[3]], [cx, cy, fx[0], fx[1], fx[2], fx[3]]);
  const drapeGeo = useMemo(() => buildDrape(grids.detail, f, drapeBox, 0.8), [grids, f, drapeBox]);
  const slopeGeo = useMemo(() => buildDrape(grids.detail, f, [cx - site.terrain.half, cy - site.terrain.half, cx + site.terrain.half, cy + site.terrain.half], 0.5), [grids, f, site, cx, cy]);
  const nominalTex = useMemo(() => heatTexture(field.sun), [field]);
  const robustTex = useMemo(() => (robust.result ? heatTexture(robust.result.score, { tint: "rgba(47,209,160,0.8)" }) : null), [robust.result]);
  const [slopeTex, setSlopeTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    slopeTexture(site.terrain.slope_png, site.terrain.slope_max_deg).then(setSlopeTex);
  }, [site]);

  // crossfade nominal → robust (§29)
  const nomMat = useRef<THREE.MeshStandardMaterial>(null);
  const robMat = useRef<THREE.MeshStandardMaterial>(null);
  const mix = useRef(0);
  const target = heatMetric === "robust" && robust.result ? 1 : 0;

  // world helpers
  const W = (ox: number, oy: number, lift = 0) => toWorld(f, cx + ox, cy + oy, heightAt([grids.detail, grids.context, grids.region], cx + ox, cy + oy) + lift);

  // landing ellipse (draped) with animated growth
  const growth = useRef(unc.enabled ? 1 : 0);
  const [grow, setGrow] = useState(growth.current);
  const ringPts = useMemo(() => {
    if (grow < 0.01) return null;
    const pts: THREE.Vector3[] = [];
    const ring = ellipsePoints(aim, model, grow);
    for (const [x, y] of ring) pts.push(W(x, y, 2.5));
    return pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aim, model, grow, grids]);

  const samplePts = useMemo(() => {
    if (!unc.enabled) return null;
    const n = Math.min(risk.samples.length, 600);
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const v = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      const s = risk.samples[k];
      v.copy(W(s.x, s.y, 1.6));
      pos.set([v.x, v.y, v.z], k * 3);
      const [r, g, b] = cividis(s.v / 100);
      col.set([r / 255, g / 255, b / 255], k * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return geo;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [risk.samples, unc.enabled, grids]);

  // brightest / robust / aim / known points
  const brightestXY = useMemo(() => {
    let bi = 0;
    let bj = 0;
    for (let j = 0; j < field.ny; j++) for (let i = 0; i < field.nx; i++) if (field.sun[j][i] > field.sun[bj][bi]) { bi = i; bj = j; }
    return { x: field.x0 + bi * field.dx, y: field.y0 + bj * field.dx, v: field.sun[bj][bi] };
  }, [field]);
  const robustPos = useRef<XY | null>(null);
  const [robustAt, setRobustAt] = useState<XY | null>(null);

  // other sites and the pole for the overview
  const regionPins = useMemo(() => {
    const out: { label: string; at: THREE.Vector3; id?: string; accent?: boolean }[] = [{ label: `${site.name} (selected)`, at: toWorld(f, cx, cy, heightAt([grids.context], cx, cy) + 400), accent: true }];
    const all = [...siteListSync()];
    for (const s of all) {
      if (s.id === site.id) continue;
      const [sx, sy] = latLonToStereo((s.lat * Math.PI) / 180, (s.lon * Math.PI) / 180);
      out.push({ label: s.name, id: s.id, at: toWorld(f, sx, sy, heightAt([grids.context, grids.region], sx, sy) + 400) });
    }
    out.push({ label: "South Pole (90°S)", at: toWorld(f, 0, 0, heightAt([grids.region], 0, 0) + 400) });
    return out;
  }, [site, f, grids]);
  const regionGroup = useRef<THREE.Group>(null);
  const detailGroup = useRef<THREE.Group>(null);

  // lights
  const sun = useRef<THREE.DirectionalLight>(null);
  const sunGlare = useMemo(sunTexture, []);
  const earthTex = useMemo(() => earthTexture(earthPhase), [earthPhase]);
  useEffect(() => () => earthTex.dispose(), [earthTex]);

  // camera flights
  const flight = useRef<{ from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t0: number; ms: number } | null>(null);
  useEffect(() => {
    if (!flyRequest || !controls) return;
    const tgt = controls.target.clone();
    let to: THREE.Vector3;
    let tTo: THREE.Vector3;
    if (flyRequest.kind === "overview") {
      const pole = toWorld(f, 0, 0, 0);
      tTo = pole.clone().lerp(new THREE.Vector3(0, 0, 0), 0.5);
      to = tTo.clone().add(new THREE.Vector3(60000, 230000, 150000));
    } else if (flyRequest.kind === "point" && flyRequest.point) {
      tTo = flyRequest.point.clone();
      const off = camera.position.clone().sub(tgt).setLength(Math.min(camera.position.distanceTo(tgt), 900));
      to = tTo.clone().add(off);
    } else {
      tTo = W(aim.x, aim.y, 0);
      to = tTo.clone().add(sunwardOffset(sunDir));
    }
    flight.current = { from: camera.position.clone(), to, tFrom: tgt, tTo, t0: performance.now(), ms: flyRequest.kind === "overview" ? 2600 : 1400 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyRequest?.n]);

  // initial camera per site
  useEffect(() => {
    const tgt = W(aim.x, aim.y, 0);
    camera.position.copy(tgt.clone().add(sunwardOffset(sunDir)));
    if (controls) {
      controls.target.copy(tgt);
      controls.update();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grids, controls]);

  useFrame((_, dt) => {
    // flights
    const fl = flight.current;
    if (fl && controls) {
      const k = Math.min(1, (performance.now() - fl.t0) / fl.ms);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      camera.position.lerpVectors(fl.from, fl.to, e);
      controls.target.lerpVectors(fl.tFrom, fl.tTo, e);
      if (k >= 1) flight.current = null;
    }
    // keep the camera above the ground (JPL EnvironmentControls "adjustHeight" idea)
    const g = fromWorld(f, camera.position);
    const ground = toWorld(f, g.sx, g.sy, heightAt([grids.detail, grids.context, grids.region], g.sx, g.sy));
    if (camera.position.y < ground.y + 18) camera.position.y = ground.y + 18;
    // level of detail for labels
    const dist = controls ? camera.position.distanceTo(controls.target) : 1000;
    if (regionGroup.current) regionGroup.current.visible = dist > 6000;
    if (detailGroup.current) detailGroup.current.visible = dist < 60000;
    // shadow camera follows the view
    const L = sun.current;
    if (L && controls) {
      const S = THREE.MathUtils.clamp(dist * 1.1, 900, 90000);
      L.target.position.copy(controls.target);
      L.position.copy(controls.target).addScaledVector(sunDir, S * 4);
      const cam = L.shadow.camera as THREE.OrthographicCamera;
      if (Math.abs(cam.right - S) > S * 0.05) {
        cam.left = -S;
        cam.right = S;
        cam.top = S;
        cam.bottom = -S;
        cam.near = 1;
        cam.far = S * 9;
        cam.updateProjectionMatrix();
        L.shadow.normalBias = (2 * S) / 4096 * 1.2;
      }
      L.target.updateMatrixWorld();
    }
    // heatmap crossfade
    mix.current += (target - mix.current) * Math.min(1, dt * 4);
    if (nomMat.current) nomMat.current.opacity = 0.5 * (1 - mix.current); // terrain detail stays readable under the field
    if (robMat.current) robMat.current.opacity = 0.55 * mix.current;
    // ellipse growth
    const gt = unc.enabled ? 1 : 0;
    if (Math.abs(growth.current - gt) > 0.002) {
      growth.current += (gt - growth.current) * Math.min(1, dt * 6);
      setGrow(Math.round(growth.current * 50) / 50);
    }
    // robust star glides from the brightest point
    const res = robust.result;
    if (res) {
      const cur = robustPos.current ?? { x: brightestXY.x, y: brightestXY.y };
      const nx = cur.x + (res.robust.x - cur.x) * Math.min(1, dt * 2.6);
      const ny = cur.y + (res.robust.y - cur.y) * Math.min(1, dt * 2.6);
      if (Math.hypot(nx - cur.x, ny - cur.y) > 0.05 || !robustAt) {
        robustPos.current = { x: nx, y: ny };
        setRobustAt({ x: Math.round(nx * 10) / 10, y: Math.round(ny * 10) / 10 });
      }
    } else if (robustPos.current) {
      robustPos.current = null;
      setRobustAt(null);
    }
  });

  const lastHover = useRef(0);
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return;
    e.stopPropagation();
    const p = e.point.clone();
    const w = fromWorld(f, p);
    const level = gridCovers(grids.detail, w.sx, w.sy) ? "5 m" : gridCovers(grids.context, w.sx, w.sy) ? "80 m" : "960 m";
    onPick({ world: p, ox: w.sx - cx, oy: w.sy - cy, lat: w.lat, lon: w.lon, h: heightAt([grids.detail, grids.context, grids.region], w.sx, w.sy), level });
  };
  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    const now = performance.now();
    if (now - lastHover.current < 70) return;
    lastHover.current = now;
    const w = fromWorld(f, e.point);
    const o = { x: w.sx - cx, y: w.sy - cy };
    onHover({ lat: w.lat, lon: w.lon, h: w.h, sun: inField(field, o) ? bilinear(field.sun, field, o.x, o.y) : null });
  };

  const regolith = useMemo(() => new THREE.MeshStandardMaterial({ color: "#a8a39c", roughness: 1, metalness: 0 }), []);
  const ctxMat = useMemo(() => (imagery.ctx ? new THREE.MeshStandardMaterial({ map: imagery.ctx.tex, roughness: 1, metalness: 0 }) : regolith), [imagery.ctx, regolith]);
  // the 5 m landing terrain gets its own 4.2 m/px image (sharper than the 30 km context image)
  const detailMat = useMemo(() => (imagery.detail ? new THREE.MeshStandardMaterial({ map: imagery.detail.tex, roughness: 1, metalness: 0 }) : ctxMat), [imagery.detail, ctxMat]);
  const regionMat = useMemo(() => (imagery.region ? new THREE.MeshStandardMaterial({ map: imagery.region.tex, roughness: 1, metalness: 0 }) : regolith), [imagery.region, regolith]);
  const dotTex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(16, 16, 13, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#05070a";
    g.lineWidth = 3;
    g.stroke();
    return new THREE.CanvasTexture(c);
  }, []);
  // Always lit: a high soft light and a bright sky fill, no hard shadows, so every slope and crater floor reads
  const light = studio ? azElToWorld(315, 52) : sunDir;
  // On a high ridge the true horizon dips below 0°, so keep the Sun on and let the curved terrain and
  // shadow maps decide what is lit; only switch off once it is well below any local horizon.
  const sunOn = studio ? 1 : THREE.MathUtils.smoothstep(sunEl, -3, -2.2);

  return (
    <>
      <MapControls makeDefault enableDamping dampingFactor={0.12} zoomToCursor maxPolarAngle={1.42} minDistance={25} maxDistance={600000} />
      <StarField hourIdx={cursorIdx} frame="local" site={grids.frame} radius={2_000_000} />
      <hemisphereLight args={studio ? ["#e4e9f2", "#3b3d42", 0.95] : ["#27324a", "#0a0a0a", 0.16]} />
      <directionalLight ref={sun} intensity={(studio ? 2.3 : 3.4) * sunOn} color="#fff8ee" castShadow={!studio} shadow-mapSize-width={4096} shadow-mapSize-height={4096} shadow-bias={-0.0003} position={light.clone().multiplyScalar(4000)} />
      {/* earthshine: faint bluish fill from the Earth's direction, scaled by its phase */}
      <directionalLight intensity={0.05 * (1 + Math.cos((earthPhase * Math.PI) / 180)) * (earthDir.y > 0 ? 1 : 0)} color="#9cc4ff" position={earthDir.clone().multiplyScalar(4000)} />
      <mesh geometry={geoms.region} material={regionMat} receiveShadow castShadow onClick={handleClick} />
      <mesh geometry={geoms.context} material={ctxMat} receiveShadow castShadow onClick={handleClick} />
      <mesh geometry={geoms.detail} material={detailMat} receiveShadow castShadow onClick={handleClick} onPointerMove={handleMove} onPointerOut={() => onHover(null)} />
      {layers.slope && slopeTex && (
        <mesh geometry={slopeGeo} renderOrder={2}>
          <meshBasicMaterial map={slopeTex} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
        </mesh>
      )}
      {layers.heat && (
        <>
          <mesh geometry={drapeGeo} renderOrder={3} onClick={handleClick} onPointerMove={handleMove}>
            <meshStandardMaterial ref={nomMat} map={nominalTex} emissiveMap={nominalTex} emissive="#ffffff" emissiveIntensity={0.25} roughness={1} transparent opacity={0.68} depthWrite={false} polygonOffset polygonOffsetFactor={-4} />
          </mesh>
          {robustTex && (
            <mesh geometry={drapeGeo} renderOrder={4}>
              <meshStandardMaterial ref={robMat} map={robustTex} emissiveMap={robustTex} emissive="#ffffff" emissiveIntensity={0.25} roughness={1} transparent opacity={0} depthWrite={false} polygonOffset polygonOffsetFactor={-5} />
            </mesh>
          )}
        </>
      )}
      <group ref={detailGroup}>
        {layers.ellipse && ringPts && <Line points={ringPts} color="#8db8ff" lineWidth={2.4} dashed dashSize={10} gapSize={6} />}
        {layers.samples && samplePts && (
          <points geometry={samplePts}>
            <pointsMaterial vertexColors size={4.5} sizeAttenuation={false} map={dotTex} alphaTest={0.5} transparent />
          </points>
        )}
        <Pin at={W(brightestXY.x, brightestXY.y)} color="#e69f00" label={`Brightest point ${brightestXY.v.toFixed(0)}%`} glyph="tri" height={34} stack={0} />
        {robust.result && robustAt && <Pin at={W(robustAt.x, robustAt.y)} color="#2fd1a0" label={`Robust aim ${robust.result.robust.value.toFixed(0)}% · P${getState().percentile} ${robust.result.robust.pq.toFixed(1)}%`} glyph="star" height={34} stack={1} />}
        <Pin at={W(aim.x, aim.y)} color="#ffffff" label="Commanded aim" height={34} stack={-1} />
        {layers.known && site.known_points?.map((k) => <Pin key={k.label} at={W(k.xy[0], k.xy[1])} color="#cfd6e1" label={k.label} height={34} stack={-2} />)}
        {pick && (
          <mesh position={pick}>
            <torusGeometry args={[9, 1.4, 8, 32]} />
            <meshBasicMaterial color="#8db8ff" />
          </mesh>
        )}
      </group>
      <group ref={regionGroup}>
        {regionPins.map((p, k) => (
          <RegionPin key={p.label} at={p.at} label={p.label} stack={k} accent={p.accent} onClick={p.id ? () => setState({ toast: `Switch site from the Site menu to fly to ${p.label}.` }) : undefined} />
        ))}
      </group>
      {/* Sun and Earth in the black lunar sky (drawn far away; discs enlarged for visibility) */}
      <sprite position={sunDir.clone().multiplyScalar(250000)} scale={[26000, 26000, 1]}>
        <spriteMaterial map={sunGlare} transparent depthWrite={false} fog={false} />
      </sprite>
      <sprite position={earthDir.clone().multiplyScalar(250000)} scale={[9000, 9000, 1]}>
        <spriteMaterial map={earthTex} rotation={earthRot} transparent depthWrite={false} />
      </sprite>
    </>
  );
}

/** Camera offset on the Sun's side, 25° off the Sun azimuth, so nearby slopes are front-lit. */
function sunwardOffset(sunDir: THREE.Vector3): THREE.Vector3 {
  const h = new THREE.Vector3(sunDir.x, 0, sunDir.z).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.44);
  return h.multiplyScalar(900).add(new THREE.Vector3(0, 260, 0));
}

export function ellipsePoints(center: XY, m: UncertaintyModel, scale: number, n = 120): [number, number][] {
  const pts: [number, number][] = [];
  if (m.kind === "circular") {
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * 2 * Math.PI;
      pts.push([center.x + m.radius * scale * Math.cos(a), center.y + m.radius * scale * Math.sin(a)]);
    }
  } else {
    const kk = Math.sqrt(-2 * Math.log(1 - m.conf)) * scale;
    const r = (m.rotDeg * Math.PI) / 180;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * 2 * Math.PI;
      const u = m.sigmaE * kk * Math.cos(a);
      const v = m.sigmaN * kk * Math.sin(a);
      pts.push([center.x + u * Math.cos(r) - v * Math.sin(r), center.y + u * Math.sin(r) + v * Math.cos(r)]);
    }
  }
  return pts;
}

// ---------------------------------------------------------------- component

export function Terrain3D({ simple = false, active = true }: { simple?: boolean; active?: boolean }) {
  const site = useSite();
  const cursorIdx = useApp((s) => s.cursorIdx);
  const siteLoading = useApp((s) => s.siteLoading);
  const model = useModel();
  const q = useApp((s) => s.percentile);
  const uncEnabled = useApp((s) => s.uncertainty.enabled);
  const [ve, setVe] = useState<1 | 2>(1);
  const [studio, setStudio] = useState(true); // "Always lit" by default, like the Moon view
  const [grids, setGrids] = useState<Grids | null>(null);
  const [loadingMsg, setLoadingMsg] = useState<string | null>("Loading LOLA terrain…");
  const [pick, setPick] = useState<(SurfacePick & { p10?: number | null; sunNow?: string }) | null>(null);
  const [hover, setHover] = useState<{ lat: number; lon: number; h: number; sun: number | null } | null>(null);
  const [fly, setFly] = useState<SceneProps["flyRequest"]>(null);
  const meshesRef = useRef<THREE.Object3D[]>([]);

  useEffect(() => {
    let alive = true;
    setLoadingMsg("Loading 5 m and 80 m LOLA terrain…");
    setPick(null);
    loadSiteGrids(site, ve).then((g) => {
      if (!alive) return;
      setLoadingMsg("Building terrain mesh…");
      setTimeout(() => {
        if (!alive) return;
        meshesRef.current = [];
        setGrids(g);
        setLoadingMsg(null);
      }, 30);
    });
    return () => {
      alive = false;
    };
  }, [site, ve]);

  const e = useMemo(() => decodeEphem(site), [site]);
  const i = Math.min(cursorIdx, e.n - 1);
  const sunDir = useMemo(() => azElToWorld(e.sunAz[i], e.sunEl[i]), [e, i]);
  const earthDir = useMemo(() => azElToWorld(e.earthAz[i], e.earthEl[i]), [e, i]);
  const elong = (sunDir.angleTo(earthDir) * 180) / Math.PI;
  const earthPhase = 180 - elong; // phase angle at the Earth as seen from the Moon
  const earthRot = Math.atan2(e.sunEl[i] - e.earthEl[i], ((((e.sunAz[i] - e.earthAz[i] + 540) % 360) - 180) * Math.cos((e.earthEl[i] * Math.PI) / 180)));
  const phaseBucket = Math.round(earthPhase / 3) * 3;

  function onPick(p: SurfacePick) {
    if (!grids) return;
    const inside = inField(site.field, { x: p.ox, y: p.oy });
    const p10: number | null = null;
    if (inside && uncEnabled)
      api
        .landingRisk({ site: site.id, aim: { x: p.ox, y: p.oy }, model, enabled: true, percentile: q, seed: 7 })
        .then((r) => setPick((cur) => (cur && cur.ox === p.ox && cur.oy === p.oy ? { ...cur, p10: r.pq } : cur)))
        .catch(() => undefined);
    // is the Sun above the local terrain from here right now? (ray-cast toward the Sun)
    let sunNow = "Visible";
    const ray = new THREE.Raycaster(p.world.clone().add(new THREE.Vector3(0, 2, 0)), sunDir.clone().normalize(), 5, 400000);
    const hits = ray.intersectObjects(meshesRef.current, false);
    if (hits.length) sunNow = `Blocked by terrain ${(hits[0].distance / 1000).toFixed(1)} km away`;
    setPick({ ...p, p10, sunNow });
  }

  return (
    <div className="pn-t3d">
      {grids && (
        <Canvas
          frameloop={active ? "always" : "never"}
          shadows
          dpr={[1, 2]}
          gl={{ antialias: true, logarithmicDepthBuffer: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.45 }}
          camera={{ fov: 42, near: 1, far: 3_000_000, position: [-620, 520, 780] }}
          onCreated={({ scene }) => {
            scene.background = new THREE.Color("#000000");
          }}
          onPointerMissed={() => setPick(null)}
          aria-label="Three-dimensional lunar terrain. Scroll to zoom, drag to pan, right-drag to rotate, click the surface for information."
        >
          <MeshCollector target={meshesRef} />
          <Scene
            site={site}
            grids={grids}
            sunDir={sunDir}
            sunEl={e.sunEl[i]}
            earthDir={earthDir}
            earthPhase={phaseBucket}
            earthRot={earthRot}
            studio={studio}
            flyRequest={fly}
            onPick={onPick}
            onHover={setHover}
            pick={pick?.world ?? null}
          />
        </Canvas>
      )}
      {!simple && <LayerList />}
      <div className="pn-t3d__tools" role="toolbar" aria-label="Terrain view tools">
        <button className="pn-tool pn-tool--wide" onClick={() => setFly({ kind: "site", n: Date.now() })}>Landing zone</button>
        <button className="pn-tool pn-tool--wide" onClick={() => setFly({ kind: "overview", n: Date.now() })}>South polar region</button>
        <div className="pn-t3d__sep" />
        <Seg
          label="Lighting"
          size="sm"
          value={studio ? "always" : "sun"}
          onChange={(v) => setStudio(v === "always")}
          options={[
            { value: "always", label: "Always lit" },
            { value: "sun", label: "Real sunlight", title: "The Sun at the cursor time (SPICE), with real shadows" },
          ]}
        />
        <button className="pn-tool pn-tool--wide" onClick={() => setVe(ve === 1 ? 2 : 1)} title="Vertical exaggeration">Relief ×{ve}</button>
      </div>
      {!studio && e.sunEl[i] < -2.6 && <div className="pn-t3d__night">Sun below every local horizon at this time · earthshine only</div>}
      <HeatLegend />
      <div className="pn-readout" aria-live="off">
        <div className="pn-readout__cell"><span>LAT, LON</span><b className="ids-num">{hover ? `${hover.lat.toFixed(4)}°, ${hover.lon.toFixed(3)}°E` : "—"}</b></div>
        <div className="pn-readout__cell"><span>HEIGHT</span><b className="ids-num">{hover ? `${hover.h.toFixed(1)} m` : "—"}</b></div>
        <div className="pn-readout__cell"><span>SUNLIGHT</span><b className="ids-num">{hover?.sun != null ? `${hover.sun.toFixed(1)} %` : "—"}</b></div>
        <div className="pn-readout__cell"><span>SUN NOW</span><b className="ids-num">az {e.sunAz[i].toFixed(1)}° el {e.sunEl[i].toFixed(2)}°</b></div>
        <div className="pn-readout__cell"><span>TERRAIN</span><b className="ids-num">LOLA 5 m / 80 m / 960 m · MOON_ME</b></div>
      </div>
      <div className="pn-t3d__hint">Scroll to zoom toward the cursor · drag to pan · right-drag to tilt and rotate · click the surface</div>
      {pick && grids && <SurfaceInfo pick={pick} onClose={() => setPick(null)} onFly={() => setFly({ kind: "point", point: pick.world, n: Date.now() })} />}
      {(loadingMsg || siteLoading) && (
        <div className="pn-map__loading" role="status">
          <div className="pn-map__loading-card">
            <span className="ids-btn__spinner" />
            <div>
              <b>{site.name}</b>
              <p>{siteLoading ?? loadingMsg}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Collects terrain meshes so the Sun ray-cast can test occlusion. */
function MeshCollector({ target }: { target: React.MutableRefObject<THREE.Object3D[]> }) {
  const { scene } = useThree();
  useFrame(() => {
    if (target.current.length) return;
    const out: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).receiveShadow) out.push(o);
    });
    target.current = out;
  });
  return null;
}
