/**
 * Landing-site terrain inside the globe: the site's 5 m and 80 m LOLA meshes (built in the site's local metre frame)
 * are placed on the curved Moon by one matrix (site east/up/north basis, metres → km), together with the draped
 * sunlight field, the landing zone, possible touchdowns and the brightest / robust / commanded aim markers.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import { getState, useApp } from "../../state/store";
import { useModel, useRisk } from "../../hooks/useMission";
import { fieldExtent } from "../../utils/field";
import { cividis } from "../../utils/color";
import { fromWorld, toWorld } from "../terrain3d/frame";
import { buildDrape, buildTerrain, heightAt } from "../terrain3d/grids";
import { heatTexture, slopeTexture } from "../terrain3d/heatTexture";
import { ellipsePoints, labelTexture, useLabelDeclutter, type Grids } from "../terrain3d/Terrain3D";
import type { SiteData, XY } from "../../types";
import { setStereoUV, useSiteImagery } from "./siteImagery";

/** Site-frame matrix: local x = east, y = up, z = −north (metres) → MOON_ME kilometres. */
export function siteMatrix(g: Grids): THREE.Matrix4 {
  const f = g.frame;
  const m = new THREE.Matrix4().makeBasis(f.east, f.up, f.north.clone().negate());
  m.scale(new THREE.Vector3(0.001, 0.001, 0.001));
  m.setPosition(f.origin.clone().multiplyScalar(0.001));
  return m;
}

/** World point (km) → site offsets (m) from the site reference point. */
export function worldToSite(g: Grids, p: THREE.Vector3): XY {
  const local = p.clone().applyMatrix4(siteMatrix(g).invert());
  const w = fromWorld(g.frame, local);
  return { x: w.sx - g.cx, y: w.sy - g.cy };
}

function dotTexture(color: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = color;
  g.beginPath();
  g.arc(32, 32, 22, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = "#05070a";
  g.stroke();
  return new THREE.CanvasTexture(c);
}

/** Marker on the globe: a short radial stem, a screen-size dot and a label (all in km world space). */
function GlobePin({ at, color, label, stack = 0 }: { at: THREE.Vector3; color: string; label: string; stack?: number }) {
  const { tex, aspect } = useMemo(() => labelTexture(label, color === "#ffffff" ? "#e8edf4" : color), [label, color]);
  const dot = useMemo(() => dotTexture(color), [color]);
  useEffect(() => () => {
    tex.dispose();
    dot.dispose();
  }, [tex, dot]);
  const top = useMemo(() => at.clone().addScaledVector(at.clone().normalize(), 0.03), [at]);
  const sprite = useRef<THREE.Sprite>(null);
  useLabelDeclutter(sprite, top, aspect, 0.022, stack);
  return (
    <group>
      <Line points={[at, top]} color={color} lineWidth={1.8} />
      <sprite position={at} scale={[0.011, 0.011, 1]} renderOrder={21}>
        <spriteMaterial map={dot} sizeAttenuation={false} depthTest={false} transparent />
      </sprite>
      <sprite ref={sprite} position={top} scale={[0.022 * aspect, 0.022, 1]} center={new THREE.Vector2(-0.06, 0.5 - stack * 1.15)} renderOrder={22}>
        <spriteMaterial map={tex} sizeAttenuation={false} depthTest={false} transparent />
      </sprite>
    </group>
  );
}

export function SiteLayer({ site, grids, albedo, onMeshes }: { site: SiteData; grids: Grids; albedo: number; onMeshes: (m: THREE.Object3D[]) => void }) {
  const aim = useApp((s) => s.aim);
  const layers = useApp((s) => s.layers);
  const unc = useApp((s) => s.uncertainty);
  const robust = useApp((s) => s.robust);
  const heatMetric = useApp((s) => s.heatMetric);
  const model = useModel();
  const risk = useRisk();
  const f = grids.frame;
  const { cx, cy } = grids;
  const field = site.field;
  const matrix = useMemo(() => siteMatrix(grids), [grids]);
  const imagery = useSiteImagery(site.id);
  const all = [grids.detail, grids.context, grids.region];
  const W = (ox: number, oy: number, lift = 0) => toWorld(f, cx + ox, cy + oy, heightAt(all, cx + ox, cy + oy) + lift);
  const WK = (ox: number, oy: number) => W(ox, oy, 1).applyMatrix4(matrix);

  // Only the 5 m landing terrain replaces the globe surface; around it the globe's own LROC NAC tiles (4.2 m/px)
  // stay visible, so selecting a site never swaps sharp imagery for a coarser texture.
  const tex = imagery.detail ?? imagery.ctx;
  const geoms = useMemo(() => {
    const out = { detail: buildTerrain(grids.detail, f, 1) };
    if (tex) setStereoUV(out.detail, grids.detail, tex.box);
    return out;
  }, [grids, f, tex]);
  useEffect(() => () => Object.values(geoms).forEach((g) => g.dispose()), [geoms]);

  const fx = fieldExtent(field);
  const drapeGeo = useMemo(() => buildDrape(grids.detail, f, [cx + fx[0], cy + fx[1], cx + fx[2], cy + fx[3]], 0.8), [grids, f, cx, cy, fx[0], fx[1], fx[2], fx[3]]);
  const slopeGeo = useMemo(() => buildDrape(grids.detail, f, [cx - site.terrain.half, cy - site.terrain.half, cx + site.terrain.half, cy + site.terrain.half], 0.5), [grids, f, site, cx, cy]);
  const nominalTex = useMemo(() => heatTexture(field.sun), [field]);
  const robustTex = useMemo(() => (robust.result ? heatTexture(robust.result.score, { tint: "rgba(47,209,160,0.8)" }) : null), [robust.result]);
  const [slopeTex, setSlopeTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    slopeTexture(site.terrain.slope_png, site.terrain.slope_max_deg).then(setSlopeTex);
  }, [site]);

  const regolith = useMemo(
    () => (tex ? new THREE.MeshStandardMaterial({ map: tex.tex, roughness: 1, metalness: 0 }) : new THREE.MeshStandardMaterial({ color: new THREE.Color().setScalar(albedo).convertSRGBToLinear(), roughness: 1, metalness: 0 })),
    [albedo, tex],
  );
  const detailRef = useRef<THREE.Mesh>(null);
  const drapeRef = useRef<THREE.Mesh>(null);
  useEffect(() => {
    onMeshes([detailRef.current, drapeRef.current].filter(Boolean) as THREE.Object3D[]);
    return () => onMeshes([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoms, drapeGeo, layers.heat]);

  // crossfade nominal → robust field, animated landing-zone growth, gliding robust star
  const nomMat = useRef<THREE.MeshStandardMaterial>(null);
  const robMat = useRef<THREE.MeshStandardMaterial>(null);
  const mix = useRef(0);
  const growth = useRef(unc.enabled ? 1 : 0);
  const [grow, setGrow] = useState(growth.current);
  const brightestXY = useMemo(() => {
    let bi = 0;
    let bj = 0;
    for (let j = 0; j < field.ny; j++) for (let i = 0; i < field.nx; i++) if (field.sun[j][i] > field.sun[bj][bi]) { bi = i; bj = j; }
    return { x: field.x0 + bi * field.dx, y: field.y0 + bj * field.dx, v: field.sun[bj][bi] };
  }, [field]);
  const robustPos = useRef<XY | null>(null);
  const [robustAt, setRobustAt] = useState<XY | null>(null);
  useFrame((_, dt) => {
    const target = heatMetric === "robust" && robust.result ? 1 : 0;
    mix.current += (target - mix.current) * Math.min(1, dt * 4);
    if (nomMat.current) nomMat.current.opacity = 0.5 * (1 - mix.current); // terrain detail stays readable under the field
    if (robMat.current) robMat.current.opacity = 0.55 * mix.current;
    const gt = unc.enabled ? 1 : 0;
    if (Math.abs(growth.current - gt) > 0.002) {
      growth.current += (gt - growth.current) * Math.min(1, dt * 6);
      setGrow(Math.round(growth.current * 50) / 50);
    }
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

  const ringPts = useMemo(() => (grow < 0.01 ? null : ellipsePoints(aim, model, grow).map(([x, y]) => W(x, y, 2.5))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aim, model, grow, grids]);
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
  const samplePts = useMemo(() => {
    if (!unc.enabled) return null;
    const n = Math.min(risk.samples.length, 600);
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const smp = risk.samples[k];
      const v = W(smp.x, smp.y, 1.6);
      pos.set([v.x, v.y, v.z], k * 3);
      const [r, g, b] = cividis(smp.v / 100);
      col.set([r / 255, g / 255, b / 255], k * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return geo;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [risk.samples, unc.enabled, grids]);

  return (
    <>
    <group matrixAutoUpdate={false} matrix={matrix}>
      <mesh ref={detailRef} geometry={geoms.detail} material={regolith} castShadow receiveShadow />
      {layers.slope && slopeTex && (
        <mesh geometry={slopeGeo} renderOrder={2}>
          <meshBasicMaterial map={slopeTex} transparent depthWrite={false} />
        </mesh>
      )}
      {layers.heat && (
        <>
          <mesh ref={drapeRef} geometry={drapeGeo} renderOrder={3} receiveShadow>
            <meshStandardMaterial ref={nomMat} map={nominalTex} emissiveMap={nominalTex} emissive="#ffffff" emissiveIntensity={0.25} roughness={1} transparent opacity={0.7} depthWrite={false} />
          </mesh>
          {robustTex && (
            <mesh geometry={drapeGeo} renderOrder={4}>
              <meshStandardMaterial ref={robMat} map={robustTex} emissiveMap={robustTex} emissive="#ffffff" emissiveIntensity={0.25} roughness={1} transparent opacity={0} depthWrite={false} />
            </mesh>
          )}
        </>
      )}
      {layers.ellipse && ringPts && <Line points={ringPts} color="#8db8ff" lineWidth={2.4} dashed dashSize={10} gapSize={6} />}
      {layers.samples && samplePts && (
        <points geometry={samplePts}>
          <pointsMaterial vertexColors size={7} sizeAttenuation={false} map={dotTex} alphaTest={0.5} transparent />
        </points>
      )}
    </group>
    <GlobePin at={WK(brightestXY.x, brightestXY.y)} color="#e69f00" label={`Brightest spot ${brightestXY.v.toFixed(0)}%`} stack={0} />
    {robust.result && robustAt && (
      <GlobePin at={WK(robustAt.x, robustAt.y)} color="#2fd1a0" label={`Safest aim ${robust.result.robust.value.toFixed(0)}% · worst likely ${robust.result.robust.pq.toFixed(1)}% (P${getState().percentile})`} stack={1} />
    )}
    <GlobePin at={WK(aim.x, aim.y)} color="#ffffff" label="Your aim" stack={-1} />
    {layers.known && site.known_points?.map((k) => <GlobePin key={k.label} at={WK(k.xy[0], k.xy[1])} color="#cfd6e1" label={k.label} stack={-2} />)}
    </>
  );
}
