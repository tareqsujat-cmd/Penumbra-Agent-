import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { StarField } from "../sky/StarField";
import * as THREE from "three";
import { siteListSync } from "../../api/client";
import { earthPos, earthQuat, G, llToVec, sunDir, type HeightMap } from "./globeData";
import { buildEarth, buildMoon, buildSouthCap } from "./globeGeometry";
import { GlobeRig, type RigFly } from "./GlobeRig";
import { dirLL, R, type MoonTiles } from "./tiles/MoonTiles";
import { SiteLayer } from "./SiteLayer";
import type { Grids } from "../terrain3d/Terrain3D";
import type { SiteData, SiteId } from "../../types";

export interface Selection {
  lat: number;
  lon: number;
  radiusKm: number;
}

export type Lighting = "always" | "sun";

function sunGlare(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(256, 256, 0, 256, 256, 256);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.035, "rgba(255,253,245,1)");
  grad.addColorStop(0.06, "rgba(255,240,210,0.55)");
  grad.addColorStop(0.18, "rgba(255,220,170,0.12)");
  grad.addColorStop(0.5, "rgba(255,200,140,0.03)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  g.globalCompositeOperation = "lighter";
  for (const a of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
    g.save();
    g.translate(256, 256);
    g.rotate(a);
    const sg = g.createLinearGradient(-256, 0, 256, 0);
    sg.addColorStop(0, "rgba(255,240,220,0)");
    sg.addColorStop(0.5, a % (Math.PI / 2) === 0 ? "rgba(255,240,220,0.35)" : "rgba(255,240,220,0.15)");
    sg.addColorStop(1, "rgba(255,240,220,0)");
    g.fillStyle = sg;
    g.fillRect(-256, -1.2, 512, 2.4);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function labelTexture(text: string, accent: boolean): { tex: THREE.Texture; aspect: number } {
  const px = 42;
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  const font = `${accent ? 600 : 500} ${px}px "Space Grotesk", system-ui, sans-serif`;
  g.font = font;
  c.width = Math.ceil(g.measureText(text).width) + 58;
  c.height = px + 22;
  const g2 = c.getContext("2d")!;
  g2.fillStyle = "rgba(4,6,9,0.78)";
  g2.beginPath();
  g2.roundRect(0, 0, c.width, c.height, 12);
  g2.fill();
  g2.fillStyle = accent ? "#2fd1a0" : "#ffd98a";
  g2.beginPath();
  g2.arc(24, c.height / 2, 8, 0, Math.PI * 2);
  g2.fill();
  g2.font = font;
  g2.fillStyle = "#eef2f7";
  g2.textBaseline = "middle";
  g2.fillText(text, 42, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: c.width / c.height };
}

function SitePin({ at, label, accent, onClick, stack = 0 }: { at: THREE.Vector3; label: string; accent: boolean; onClick: () => void; stack?: number }) {
  const { tex, aspect } = useMemo(() => labelTexture(label, accent), [label, accent]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <sprite position={at} scale={[0.02 * aspect, 0.02, 1]} center={new THREE.Vector2(0.09, 0.5 - stack * 1.15)} renderOrder={30} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <spriteMaterial map={tex} sizeAttenuation={false} depthTest={false} transparent />
    </sprite>
  );
}

const atmosphereMat = () =>
  new THREE.ShaderMaterial({
    uniforms: { sun: { value: new THREE.Vector3(1, 0, 0) } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vW = normalize(mat3(modelMatrix)*normal);
      vN = normalize(normalMatrix*normal); vV = normalize(-(modelViewMatrix*vec4(position,1.0)).xyz);
      gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: `uniform vec3 sun; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){ float f = pow(1.0 - max(dot(vN,vV),0.0), 2.6); float lit = smoothstep(-0.25, 0.35, dot(vW, sun));
      gl_FragColor = vec4(vec3(0.33,0.58,1.0)*f*lit*1.4, f*lit); }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

const SITE_STACK: Record<string, number> = { cr1: -1, shk: 1, mal: 0, mou: 1, nob: -1 };

export function GlobeScene(p: {
  tiles: MoonTiles | null;
  baseHeights: HeightMap;
  surfaceKm: (dir: THREE.Vector3) => number;
  minRange: (dir: THREE.Vector3) => number;
  lighting: Lighting;
  hourIdx: number;
  earthMode: "enhanced" | "true";
  selection: Selection | null;
  onClick: (pt: THREE.Vector3) => void;
  onHover: (pt: THREE.Vector3 | null) => void;
  onRange: (range: number, target: THREE.Vector3) => void;
  fly: RigFly | null;
  initialDir: THREE.Vector3;
  onUserInput: () => void;
  site: SiteData | null;
  siteGrids: Grids | null;
  albedo: number;
  onSitePin: (id: SiteId) => void;
}) {
  const { camera, gl, size } = useThree();
  const cam = camera as THREE.PerspectiveCamera;
  const [range, setRange] = useState(5400);
  const target = useRef(p.initialDir.clone());
  const siteMeshes = useRef<THREE.Object3D[]>([]);

  // fallback surface (single mesh) shown until the tile pyramid is available
  const baseGeo = useMemo(() => buildMoon(p.baseHeights), [p.baseHeights]);
  const [capGeo, setCapGeo] = useState<THREE.BufferGeometry | null>(null);
  useEffect(() => {
    if (!p.tiles) buildSouthCap().then(setCapGeo);
  }, [p.tiles]);
  const tex = useMemo(() => {
    const L = new THREE.TextureLoader();
    const albedo = L.load(G.moon.albedo);
    albedo.colorSpace = THREE.SRGBColorSpace;
    albedo.anisotropy = 8;
    const normal = L.load(G.moon.normal);
    const earth = L.load(G.earth_texture);
    earth.colorSpace = THREE.SRGBColorSpace;
    earth.anisotropy = 8;
    return { albedo, normal, earth };
  }, []);
  const baseMat = useMemo(() => new THREE.MeshStandardMaterial({ map: tex.albedo, normalMap: tex.normal, normalScale: new THREE.Vector2(1.6, 1.6), roughness: 1, metalness: 0 }), [tex]);
  const capMat = useMemo(() => new THREE.MeshStandardMaterial({ map: tex.albedo, roughness: 1, metalness: 0 }), [tex]);
  const baseRef = useRef<THREE.Mesh>(null);
  const earthGeo = useMemo(() => buildEarth(1, 160, 80), []);
  const atmoGeo = useMemo(() => buildEarth(1.028, 96, 48), []);
  const atmo = useMemo(atmosphereMat, []);
  const glare = useMemo(sunGlare, []);

  const s = useMemo(() => sunDir(p.hourIdx), [p.hourIdx]);
  const eTrue = useMemo(() => earthPos(p.hourIdx), [p.hourIdx]);
  const eDir = eTrue.clone().normalize();
  const eQuat = useMemo(() => earthQuat(p.hourIdx), [p.hourIdx]);
  const eDist = p.earthMode === "true" ? eTrue.length() : 60000;
  const eRadius = p.earthMode === "true" ? 6371 : 6371 * (eDist / eTrue.length()) * 4;
  const earthPhase = (1 + Math.cos(s.angleTo(eDir.clone().negate()))) / 2;
  useEffect(() => {
    atmo.uniforms.sun.value.copy(s);
  }, [s, atmo]);

  const sun = useRef<THREE.DirectionalLight>(null);
  const head = useRef<THREE.DirectionalLight>(null);
  const zenith = useRef<THREE.DirectionalLight>(null);
  const fill = useRef<THREE.AmbientLight>(null);
  useFrame(() => {
    const tl = p.tiles;
    if (tl) {
      tl.update(cam, size.height);
      if (baseRef.current) baseRef.current.visible = !tl.ready;
    }
    const T = target.current.clone().multiplyScalar(R + p.surfaceKm(target.current));
    const real = p.lighting === "sun";
    // Sun light: true direction; the shadow box follows the view when close to the surface
    const L = sun.current;
    if (L) {
      L.intensity = real ? 3.1 : 0;
      const half = THREE.MathUtils.clamp(range * 1.3, 1.5, 600);
      L.castShadow = real && range < 900;
      L.position.copy(T).addScaledVector(s, half * 6);
      L.target.position.copy(T);
      L.target.updateMatrixWorld();
      const sc = L.shadow.camera as THREE.OrthographicCamera;
      if (Math.abs(sc.right - half) > half * 0.1) {
        sc.left = -half;
        sc.right = half;
        sc.top = half;
        sc.bottom = -half;
        sc.near = half * 0.5;
        sc.far = half * 12;
        sc.updateProjectionMatrix();
        L.shadow.normalBias = half / 1500;
      }
    }
    // Always lit: a soft light from over the viewer's shoulder, so every side of the Moon reads naturally
    const H = head.current;
    if (H) {
      H.intensity = real ? 0 : 3.2;
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
      const upv = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      const back = cam.position.clone().sub(T).normalize();
      const far = back.multiplyScalar(0.8).addScaledVector(upv, 0.5).addScaledVector(right, -0.45).normalize();
      const n = target.current;
      const flat = (v: THREE.Vector3) => v.clone().addScaledVector(n, -v.dot(n)).normalize();
      // top-down: light from the screen's upper left (map hillshade); tilted: swing it behind the viewer's left
      // shoulder, so slopes facing the camera are lit instead of back-lit
      const tilt = THREE.MathUtils.clamp((1 - cam.position.clone().sub(T).normalize().dot(n)) * 1.8, 0, 1);
      const el = (40 * Math.PI) / 180;
      const near = flat(right).multiplyScalar(-0.8).addScaledVector(flat(upv), 0.6 * (1 - 2 * tilt)).normalize().multiplyScalar(Math.cos(el)).addScaledVector(n, Math.sin(el));
      const w = THREE.MathUtils.smoothstep(range, 700, 3500);
      const dir = near.multiplyScalar(1 - w).addScaledVector(far, w).normalize();
      H.position.copy(T).addScaledVector(dir, 1000);
      H.target.position.copy(T);
      H.target.updateMatrixWorld();
    }
    // soft light from the local zenith in always-lit mode, so steep slopes facing away from the key light stay readable
    const Z = zenith.current;
    if (Z) {
      Z.intensity = real ? 0 : 0.7 * (1 - THREE.MathUtils.smoothstep(range, 700, 3500));
      Z.position.copy(T).addScaledVector(target.current, 1000);
      Z.target.position.copy(T);
      Z.target.updateMatrixWorld();
    }
    // exposure: the polar Sun only grazes the ground, so open up near the pole like a long-exposure mosaic
    const polar = target.current.z < -0.96 && range < 2600;
    const k = real && polar ? THREE.MathUtils.clamp((2600 - range) / 2200, 0, 1) : 0;
    gl.toneMappingExposure = real ? 1.25 + k * 2.2 : 1.3;
    if (fill.current) fill.current.intensity = real ? 0.012 + k * 0.045 : 0.12;
  });

  // selection outline on the surface
  const ring = useMemo(() => {
    const sel = p.selection;
    if (!sel) return null;
    const c = dirLL(sel.lat, sel.lon);
    const e1 = new THREE.Vector3(0, 0, 1).cross(c);
    if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0);
    e1.normalize();
    const e2 = c.clone().cross(e1).normalize();
    const th = sel.radiusKm / R;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 160; k++) {
      const ph = (k / 160) * Math.PI * 2;
      const d = c.clone().multiplyScalar(Math.cos(th)).addScaledVector(e1, Math.sin(th) * Math.cos(ph)).addScaledVector(e2, Math.sin(th) * Math.sin(ph)).normalize();
      pts.push(d.clone().multiplyScalar(R + p.surfaceKm(d) + 0.15 + sel.radiusKm * 0.004));
    }
    return { pts, centre: c.clone().multiplyScalar(R + p.surfaceKm(c) + 0.15) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.selection, p.tiles]);
  const dotTex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    g.fillStyle = "#8db8ff";
    g.beginPath();
    g.arc(32, 32, 20, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = "#05070a";
    g.stroke();
    return new THREE.CanvasTexture(c);
  }, []);

  const pins = useMemo(
    () =>
      siteListSync().map((st) => {
        const d = llToVec(st.lat, st.lon, 1);
        return { ...st, at: d.clone().multiplyScalar(R + p.surfaceKm(d) + 1.2) };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.tiles],
  );
  const showPins = range < 3000 && range > (p.site ? 60 : 0) && target.current.z < -0.8;

  return (
    <>
      {/* the real sky: Yale Bright Star Catalogue, turned into MOON_ME for the current hour */}
      <StarField hourIdx={p.hourIdx} frame="moon" radius={2_000_000} opacity={p.lighting === "sun" ? 0.85 : 1} />
      <GlobeRig
        initialDir={p.initialDir}
        surfaceKm={p.surfaceKm}
        minRange={p.minRange}
        pickMeshes={() => [...(p.tiles ? p.tiles.meshes() : []), ...(baseRef.current && baseRef.current.visible ? [baseRef.current] : []), ...siteMeshes.current]}
        onClick={p.onClick}
        onHover={p.onHover}
        onChange={(r, t) => {
          target.current.copy(t);
          if (Math.abs(r - range) / range > 0.03) setRange(r);
          p.onRange(r, t);
        }}
        fly={p.fly}
        onUserInput={p.onUserInput}
      />
      <ambientLight ref={fill} intensity={0.07} />
      <directionalLight ref={sun} intensity={3.1} color="#fffaf2" shadow-mapSize-width={4096} shadow-mapSize-height={4096} shadow-bias={-0.0004} />
      <directionalLight ref={head} intensity={0} color="#fffaf4" />
      <directionalLight ref={zenith} intensity={0} color="#eef2ff" />
      {/* earthshine on the night side (real-Sun mode), proportional to the Earth's phase seen from the Moon */}
      <directionalLight intensity={p.lighting === "sun" ? 0.06 * earthPhase : 0} color="#a9c8ff" position={eDir.clone().multiplyScalar(3000)} />
      {p.tiles && <primitive object={p.tiles.group} />}
      <mesh ref={baseRef} geometry={baseGeo} material={baseMat} receiveShadow />
      {!p.tiles && capGeo && <mesh geometry={capGeo} material={capMat} castShadow receiveShadow />}
      {p.site && p.siteGrids && <SiteLayer site={p.site} grids={p.siteGrids} albedo={p.albedo} onMeshes={(m) => (siteMeshes.current = m)} />}
      {ring && (
        <>
          <Line points={ring.pts} color="#8db8ff" lineWidth={2.2} />
          <sprite position={ring.centre} scale={[0.012, 0.012, 1]} renderOrder={31}>
            <spriteMaterial map={dotTex} sizeAttenuation={false} depthTest={false} transparent />
          </sprite>
        </>
      )}
      {showPins &&
        pins.map((pn) => <SitePin key={pn.id} at={pn.at} label={pn.name} accent={pn.id === p.site?.id} onClick={() => p.onSitePin(pn.id)} stack={SITE_STACK[pn.id] ?? 0} />)}
      <group position={eDir.clone().multiplyScalar(eDist)} quaternion={eQuat} scale={eRadius}>
        <mesh geometry={earthGeo}>
          <meshStandardMaterial map={tex.earth} roughness={0.75} metalness={0} />
        </mesh>
        <mesh geometry={atmoGeo} material={atmo} />
      </group>
      <sprite position={s.clone().multiplyScalar(1.4e6)} scale={[1.9e5, 1.9e5, 1]} renderOrder={1}>
        <spriteMaterial map={glare} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
    </>
  );
}
