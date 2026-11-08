import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import { setState, useApp } from "../../state/store";
import { useSite, useSkyline, useVisibility } from "../../hooks/useMission";
import { decodeEphem, skylineAt } from "../../utils/field";
import { Prov, Seg, Tip } from "../../components/ui";
import { fmtDate } from "../../utils/format";
import { Panorama } from "./Panorama";
import { useSky } from "../sky/StarField";
import { moonFrameAt, starBuffers, starMaterial } from "../sky/stars";
import { makeFrame } from "../terrain3d/frame";

const R_TERRAIN = 60;
const R_SKY = 95;

/** az clockwise from north, el up; north = −Z, east = +X. */
function dir(azDeg: number, elDeg: number, r: number): THREE.Vector3 {
  const az = (azDeg * Math.PI) / 180;
  const el = (Math.min(elDeg, 85) * Math.PI) / 180;
  return new THREE.Vector3(r * Math.cos(el) * Math.sin(az), r * Math.sin(el), -r * Math.cos(el) * Math.cos(az));
}

function glowTexture(inner: string, outer: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.18, inner);
  grad.addColorStop(0.22, outer);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Text rendered into a canvas texture (no DOM overlays inside the WebGL scene). */
function Label({ text, position, color = "#6f7c92", size = 3, bold = false, bg = false }: { text: string; position: THREE.Vector3; color?: string; size?: number; bold?: boolean; bg?: boolean }) {
  const { tex, aspect } = useMemo(() => {
    const px = 48;
    const font = `${bold ? 700 : 500} ${px}px "Space Grotesk", system-ui, sans-serif`;
    const c = document.createElement("canvas");
    const g = c.getContext("2d")!;
    g.font = font;
    const w = Math.ceil(g.measureText(text).width) + (bg ? 28 : 8);
    c.width = w;
    c.height = px + 20;
    const g2 = c.getContext("2d")!;
    if (bg) {
      g2.fillStyle = "rgba(3,4,6,0.78)";
      g2.beginPath();
      g2.roundRect(0, 0, c.width, c.height, 10);
      g2.fill();
    }
    g2.font = font;
    g2.fillStyle = color;
    g2.textBaseline = "middle";
    g2.fillText(text, bg ? 14 : 4, c.height / 2 + 2);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { tex: t, aspect: c.width / c.height };
  }, [text, color, bold, bg]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <sprite position={position} scale={[size * aspect, size, 1]} renderOrder={10}>
      <spriteMaterial map={tex} transparent depthTest={false} depthWrite={false} />
    </sprite>
  );
}

function Terrain({ deg, ve }: { deg: number[]; ve: number }) {
  const geom = useMemo(() => {
    const n = 360;
    const pos: number[] = [];
    const col: number[] = [];
    const top = new THREE.Color("#3a3f47");
    const bot = new THREE.Color("#07080a");
    for (let i = 0; i <= n; i++) {
      const az = (i / n) * 360;
      const a = dir(az, skylineAt(deg, az) * ve, R_TERRAIN);
      const b = dir(az, -25, R_TERRAIN);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      col.push(top.r, top.g, top.b, bot.r, bot.g, bot.b);
    }
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    return g;
  }, [deg, ve]);
  useEffect(() => () => geom.dispose(), [geom]);
  const edge = useMemo(() => Array.from({ length: 361 }, (_, i) => dir(i, skylineAt(deg, i) * ve, R_TERRAIN - 0.05)), [deg, ve]);
  return (
    <group>
      <mesh geometry={geom}>
        <meshBasicMaterial vertexColors side={THREE.DoubleSide} />
      </mesh>
      <Line points={edge} color="#c9d2de" lineWidth={1.4} />
    </group>
  );
}

function Rings({ ve }: { ve: number }) {
  const rings = [0, 2, 5, 10].filter((e) => e * ve <= 80);
  return (
    <group>
      {rings.map((e) => (
        <group key={e}>
          <Line points={Array.from({ length: 181 }, (_, i) => dir(i * 2, e * ve, R_SKY - 2))} color={e === 0 ? "#5f9bff" : "#2a3446"} lineWidth={e === 0 ? 1.2 : 1} dashed={e !== 0} dashSize={1.2} gapSize={1.2} />
          {e > 0 && <Label text={`${e}°`} position={dir(8, e * ve + 1, R_SKY - 3)} size={2.2} />}
        </group>
      ))}
      {Array.from({ length: 12 }, (_, i) => i * 30).map((az) =>
        az % 90 === 0 ? (
          <Label key={az} text={"NESW"[az / 90]} position={dir(az, -2.5, R_SKY - 3)} size={4.2} color="#d9e1ec" bold />
        ) : (
          <Label key={az} text={`${az}°`} position={dir(az, -2.5, R_SKY - 3)} size={2.2} />
        ),
      )}
    </group>
  );
}

const qStar = new THREE.Quaternion();
const vStar = new THREE.Vector3();

/** Stars from the Bright Star Catalogue at the cursor time, in the site's horizon frame, with elevations stretched
 *  like the Sun and Earth (stars above the stretched range are left out rather than piled at the zenith). */
function StarDome({ lat, lon, hourIdx, ve }: { lat: number; lon: number; hourIdx: number; ve: number }) {
  const sky = useSky();
  const buf = useMemo(() => (sky ? starBuffers(sky, 6.0, 1.15) : null), [sky]);
  const geo = useMemo(() => {
    if (!buf) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(buf.n * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(buf.colors, 3));
    g.setAttribute("size", new THREE.BufferAttribute(new Float32Array(buf.n), 1));
    return g;
  }, [buf]);
  const mat = useMemo(() => starMaterial(1), []);
  useEffect(() => () => geo?.dispose(), [geo]);
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => {
    if (!sky || !buf || !geo) return;
    const f = makeFrame(lat, lon, 0);
    moonFrameAt(sky, hourIdx, qStar);
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const size = geo.getAttribute("size") as THREE.BufferAttribute;
    for (let i = 0; i < buf.n; i++) {
      vStar.set(buf.dirs[i * 3], buf.dirs[i * 3 + 1], buf.dirs[i * 3 + 2]).applyQuaternion(qStar);
      const el = (Math.asin(Math.max(-1, Math.min(1, vStar.dot(f.up)))) * 180) / Math.PI;
      const az = (Math.atan2(vStar.dot(f.east), vStar.dot(f.north)) * 180) / Math.PI;
      const shown = el > -3 && el * ve <= 84;
      const d = dir(az, el * ve, R_SKY + 2);
      pos.setXYZ(i, d.x, d.y, d.z);
      size.setX(i, shown ? buf.sizes[i] : 0);
    }
    pos.needsUpdate = true;
    size.needsUpdate = true;
    geo.computeBoundingSphere();
  }, [sky, buf, geo, lat, lon, hourIdx, ve]);
  if (!geo) return null;
  return <points geometry={geo} material={mat} frustumCulled={false} renderOrder={-5} />;
}

function Body({ az, el, ve, kind }: { az: number; el: number; ve: number; kind: "sun" | "earth" }) {
  const tex = useMemo(() => (kind === "sun" ? glowTexture("#fff6d8", "rgba(255,200,80,0.28)") : glowTexture("#5aa6ff", "rgba(80,150,255,0.18)")), [kind]);
  useEffect(() => () => tex.dispose(), [tex]);
  const s = kind === "sun" ? 16 : 11;
  return (
    <group>
      <sprite position={dir(az, el * ve, R_SKY)} scale={[s, s, 1]}>
        <spriteMaterial map={tex} transparent depthWrite={false} />
      </sprite>
      <Label text={`${kind === "sun" ? "Sun" : "Earth"} ${el.toFixed(2)}°`} position={dir(az, el * ve + (kind === "sun" ? 5 : 4.2), R_SKY)} size={2.4} color={kind === "sun" ? "#ffd98a" : "#9fd2f5"} bg />
    </group>
  );
}

function LookControls({ initialAz }: { initialAz: number }) {
  const { camera, gl } = useThree();
  const st = useRef({ yaw: initialAz, pitch: 6, drag: false, x: 0, y: 0 });
  useEffect(() => {
    const el = gl.domElement;
    const down = (e: PointerEvent) => {
      st.current.drag = true;
      st.current.x = e.clientX;
      st.current.y = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!st.current.drag) return;
      st.current.yaw -= (e.clientX - st.current.x) * 0.18;
      st.current.pitch = Math.min(70, Math.max(-20, st.current.pitch + (e.clientY - st.current.y) * 0.14));
      st.current.x = e.clientX;
      st.current.y = e.clientY;
    };
    const up = () => (st.current.drag = false);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = camera as THREE.PerspectiveCamera;
      c.fov = Math.min(95, Math.max(25, c.fov + e.deltaY * 0.04));
      c.updateProjectionMatrix();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("wheel", wheel);
    };
  }, [gl, camera]);
  useFrame(() => camera.lookAt(dir(st.current.yaw, st.current.pitch, 10)));
  return null;
}

export function SkyView({ active = true }: { active?: boolean }) {
  const site = useSite();
  const vis = useVisibility();
  const sky = useSkyline();
  const cursorIdx = useApp((s) => s.cursorIdx);
  const landingIdx = useApp((s) => s.landingIdx);
  const skyMode = useApp((s) => s.skyMode);
  const ve = useApp((s) => s.verticalExaggeration);
  const e = useMemo(() => decodeEphem(site), [site]);
  const i = Math.min(cursorIdx, e.n - 1);
  const k = Math.max(0, Math.min(Math.max(cursorIdx - landingIdx, 0), vis.hours - 1));
  const tracks = useMemo(() => {
    const sun: THREE.Vector3[] = [];
    const earth: THREE.Vector3[] = [];
    for (let h = landingIdx; h < Math.min(landingIdx + vis.hours, e.n); h += 3) {
      sun.push(dir(e.sunAz[h], e.sunEl[h] * ve, R_SKY - 1));
      earth.push(dir(e.earthAz[h], e.earthEl[h] * ve, R_SKY - 1));
    }
    return { sun, earth };
  }, [e, landingIdx, vis.hours, ve]);
  const sunVis = vis.sunFrac[k];
  const earthVis = vis.earth[k] === 1;

  return (
    <div className="pn-sky">
      <div className="pn-sky__bar">
        <Seg label="Sky view" size="sm" value={skyMode} onChange={(v) => setState({ skyMode: v })} options={[{ value: "dome", label: "3-D sky dome" }, { value: "panorama", label: "2-D panorama" }]} />
        <Seg label="Vertical exaggeration" size="sm" value={String(ve)} onChange={(v) => setState({ verticalExaggeration: Number(v) as 1 | 5 | 10 })} options={[{ value: "1", label: "×1" }, { value: "5", label: "×5" }, { value: "10", label: "×10" }]} />
        <Tip title="Vertical exaggeration" text="At the south pole the Sun never rises more than a few degrees. Elevations are stretched so the skyline, Sun and Earth can be read. Sun and Earth discs are drawn larger than life." />
        <span className="pn-sky__src">
          Skyline at the aim <Prov kind="computed" />
          <Tip title="Skyline at the aim point" text="Traced by the backend at the commanded aim: 720 azimuths through NASA PGDA 78 5 m terrain and LOLA 80/240 m out to 300 km, 2 m mast." />
          · Sun/Earth: NAIF SPICE (DE440) <Prov kind="computed" />
        </span>
      </div>
      <div className="pn-sky__stage">
        {skyMode === "dome" ? (
          <Canvas frameloop={active ? "always" : "never"} camera={{ fov: 72, position: [0, 0.2, 0], near: 0.1, far: 500 }} gl={{ antialias: true }} onCreated={({ scene }) => (scene.background = new THREE.Color("#030406"))} aria-label="Three-dimensional sky dome">
            <LookControls initialAz={e.sunAz[i]} />
            <StarDome lat={site.lat} lon={site.lon} hourIdx={cursorIdx} ve={ve} />
            <Rings ve={ve} />
            {tracks.sun.length > 1 && <Line points={tracks.sun} color="#e69f00" lineWidth={1} transparent opacity={0.55} />}
            {tracks.earth.length > 1 && <Line points={tracks.earth} color="#56b4e9" lineWidth={1} transparent opacity={0.45} />}
            <Body kind="sun" az={e.sunAz[i]} el={e.sunEl[i]} ve={ve} />
            <Body kind="earth" az={e.earthAz[i]} el={e.earthEl[i]} ve={ve} />
            <Terrain deg={sky.deg} ve={ve} />
          </Canvas>
        ) : (
          <Panorama />
        )}
        <div className="pn-sky__hud">
          <div className="ids-overline">{site.name} · first-person, 2 m mast</div>
          <b className="ids-num">{fmtDate(cursorIdx)}</b>
          <dl>
            <dt>Sun</dt>
            <dd className="ids-num">
              az {e.sunAz[i].toFixed(1)}° · el {e.sunEl[i].toFixed(2)}°
            </dd>
            <dt>Solar disc visible</dt>
            <dd className={`ids-num ${sunVis > 0.99 ? "pn-good" : sunVis > 0 ? "pn-warn" : "pn-bad"}`}>{(sunVis * 100).toFixed(0)}%</dd>
            <dt>Earth</dt>
            <dd className="ids-num">
              az {e.earthAz[i].toFixed(1)}° · el {e.earthEl[i].toFixed(2)}° · <span className={earthVis ? "pn-good" : "pn-bad"}>{earthVis ? "visible" : "below margin"}</span>
            </dd>
          </dl>
          {site.ephem_note && <p className="pn-sky__note">{site.ephem_note}</p>}
          <p className="pn-sky__note">Drag to look around · scroll to zoom · time follows the calendar cursor</p>
        </div>
      </div>
    </div>
  );
}
