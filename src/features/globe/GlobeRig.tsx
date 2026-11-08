import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { R } from "./tiles/MoonTiles";

export interface RigFly {
  dir: THREE.Vector3;
  range: number;
  tilt?: number;
  fwd?: THREE.Vector3;
  ms?: number;
  n: number;
}

interface RigState {
  target: THREE.Vector3; // unit direction of the look-at point
  fwd: THREE.Vector3; // tangent "screen up" direction at the target (parallel-transported, so spinning never twists)
  range: number; // km from the surface point to the camera
  tilt: number; // rad, 0 = looking straight down
  omega: THREE.Vector3; // spin inertia (axis * rad/s)
  flight: null | { t0: number; ms: number; from: Omit<RigState, "omega" | "flight">; to: Omit<RigState, "omega" | "flight"> };
}

const tiltMax = (range: number) => 1.3 * THREE.MathUtils.clamp((2800 - range) / 2600, 0, 1);

function tangent(n: THREE.Vector3, v: THREE.Vector3): THREE.Vector3 {
  const t = v.clone().addScaledVector(n, -v.dot(n));
  if (t.lengthSq() < 1e-10) {
    t.set(0, 0, 1).addScaledVector(n, -n.z);
    if (t.lengthSq() < 1e-10) t.set(1, 0, 0).addScaledVector(n, -n.x);
  }
  return t.normalize();
}

/**
 * Globe camera rig (Google Earth / Cesium style, built on the JPL 3DTilesRenderer controls idea):
 * left-drag spins the Moon like a ball (release to let it roll), the wheel zooms toward the point under the
 * cursor, right-drag (or Shift+drag) turns and tilts the view once you are close to the surface.
 */
export function GlobeRig({
  initialDir,
  surfaceKm,
  pickMeshes,
  minRange,
  onClick,
  onHover,
  onChange,
  fly,
  onUserInput,
}: {
  initialDir: THREE.Vector3;
  surfaceKm: (dir: THREE.Vector3) => number;
  pickMeshes: () => THREE.Object3D[];
  minRange: (dir: THREE.Vector3) => number;
  onClick: (p: THREE.Vector3) => void;
  onHover: (p: THREE.Vector3 | null) => void;
  onChange: (range: number, target: THREE.Vector3) => void;
  fly: RigFly | null;
  onUserInput: () => void;
}) {
  const { camera, gl } = useThree();
  const cam = camera as THREE.PerspectiveCamera;
  const cb = useRef({ surfaceKm, pickMeshes, minRange, onClick, onHover, onChange, onUserInput });
  cb.current = { surfaceKm, pickMeshes, minRange, onClick, onHover, onChange, onUserInput };
  const s = useRef<RigState>({
    target: initialDir.clone().normalize(),
    fwd: tangent(initialDir.clone().normalize(), new THREE.Vector3(0, 0, 1)),
    range: 5400,
    tilt: 0,
    omega: new THREE.Vector3(),
    flight: null,
  });

  const surfacePoint = (dir: THREE.Vector3) => dir.clone().multiplyScalar(R + cb.current.surfaceKm(dir));

  const pick = (clientX: number, clientY: number): THREE.Vector3 | null => {
    const r = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, cam);
    const hits = ray.intersectObjects(cb.current.pickMeshes().filter((m) => m.visible), false);
    if (hits.length) return hits[0].point.clone();
    const rad = R + cb.current.surfaceKm(s.current.target);
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    const b = o.dot(d);
    const disc = b * b - (o.lengthSq() - rad * rad);
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    return t > 0 ? o.clone().addScaledVector(d, t) : null;
  };

  const place = () => {
    const st = s.current;
    const n = st.target;
    st.fwd = tangent(n, st.fwd);
    st.tilt = Math.min(st.tilt, tiltMax(st.range));
    const T = surfacePoint(n);
    const off = n.clone().multiplyScalar(Math.cos(st.tilt)).addScaledVector(st.fwd, -Math.sin(st.tilt));
    const P = T.clone().addScaledVector(off, st.range);
    // keep the camera above the terrain (JPL EnvironmentControls "adjustHeight")
    const pd = P.clone().normalize();
    const floor = R + cb.current.surfaceKm(pd) + Math.max(0.03, st.range * 0.08);
    if (P.length() < floor) P.setLength(floor);
    cam.position.copy(P);
    cam.up.copy(st.fwd).multiplyScalar(Math.cos(st.tilt)).addScaledVector(n, Math.sin(st.tilt));
    cam.lookAt(T);
    const near = Math.max(0.002, Math.min(st.range * 0.002, 5));
    const fov = THREE.MathUtils.lerp(48, 32, THREE.MathUtils.clamp(Math.log(st.range / 30) / Math.log(4000 / 30), 0, 1));
    if (Math.abs(cam.near - near) / near > 0.2 || Math.abs(cam.fov - fov) > 0.3) {
      cam.near = near;
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cb.current.onChange(st.range, n);
  };

  const rotate = (q: THREE.Quaternion) => {
    s.current.target.applyQuaternion(q).normalize();
    s.current.fwd.applyQuaternion(q);
  };

  useEffect(() => {
    const el = gl.domElement;
    const st = s.current;
    let mode: null | "spin" | "orbit" = null;
    let lastX = 0;
    let lastY = 0;
    let downX = 0;
    let downY = 0;
    let downT = 0;
    let lastT = 0;
    let lastHover = 0;
    const kmPerPx = () => (st.range * 2 * Math.tan((cam.fov * Math.PI) / 360)) / el.clientHeight;

    const down = (e: PointerEvent) => {
      mode = e.button === 2 || e.shiftKey || e.ctrlKey ? "orbit" : "spin";
      lastX = downX = e.clientX;
      lastY = downY = e.clientY;
      lastT = downT = performance.now();
      st.omega.set(0, 0, 0);
      st.flight = null;
      el.setPointerCapture(e.pointerId);
      cb.current.onUserInput();
    };
    const move = (e: PointerEvent) => {
      const now = performance.now();
      if (!mode) {
        if (now - lastHover > 70) {
          lastHover = now;
          cb.current.onHover(pick(e.clientX, e.clientY));
        }
        return;
      }
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (mode === "orbit") {
        st.fwd.applyAxisAngle(st.target, dx * 0.006);
        st.tilt = THREE.MathUtils.clamp(st.tilt + dy * 0.005, 0, tiltMax(st.range));
        return;
      }
      if (Math.hypot(dx, dy) < 0.3) return;
      const n = st.target;
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
      const upv = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      const rt = tangent(n, right);
      const ut = tangent(n, upv);
      const dvec = rt.multiplyScalar(-dx).addScaledVector(ut, dy);
      const len = dvec.length();
      const axis = n.clone().cross(dvec).normalize();
      const angle = (len * kmPerPx()) / (R + cb.current.surfaceKm(n));
      rotate(new THREE.Quaternion().setFromAxisAngle(axis, angle));
      const dt = Math.max(8, now - lastT) / 1000;
      st.omega.copy(axis).multiplyScalar((angle / dt) * 0.85).addScaledVector(st.omega, 0.15);
      lastT = now;
    };
    const up = (e: PointerEvent) => {
      if (!mode) return;
      const was = mode;
      mode = null;
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (moved < 5 && performance.now() - downT < 450 && was === "spin") {
        st.omega.set(0, 0, 0);
        const p = pick(e.clientX, e.clientY);
        if (p) cb.current.onClick(p);
      } else if (was !== "spin" || performance.now() - lastT > 110) {
        st.omega.set(0, 0, 0);
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      cb.current.onUserInput();
      st.flight = null;
      const f = Math.exp(THREE.MathUtils.clamp(e.deltaY, -300, 300) * 0.0013);
      const r1 = THREE.MathUtils.clamp(st.range * f, cb.current.minRange(st.target), 60000);
      const k = r1 / st.range;
      if (k < 1) {
        const p = pick(e.clientX, e.clientY);
        if (p) {
          const q = new THREE.Quaternion().setFromUnitVectors(st.target, p.clone().normalize());
          rotate(new THREE.Quaternion().slerp(q, 1 - k));
        }
      }
      st.range = r1;
    };
    const dbl = (e: MouseEvent) => {
      const p = pick(e.clientX, e.clientY);
      if (!p) return;
      flyTo({ dir: p.clone().normalize(), range: Math.max(cb.current.minRange(p.clone().normalize()), st.range * 0.35), tilt: st.tilt, n: Date.now() });
    };
    const key = (e: KeyboardEvent) => {
      const a = (st.range * 0.08) / R;
      const right = tangent(st.target, new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0));
      if (e.key === "ArrowLeft") rotate(new THREE.Quaternion().setFromAxisAngle(st.fwd, -a));
      else if (e.key === "ArrowRight") rotate(new THREE.Quaternion().setFromAxisAngle(st.fwd, a));
      else if (e.key === "ArrowUp") rotate(new THREE.Quaternion().setFromAxisAngle(right, -a));
      else if (e.key === "ArrowDown") rotate(new THREE.Quaternion().setFromAxisAngle(right, a));
      else if (e.key === "+" || e.key === "=") st.range = Math.max(cb.current.minRange(st.target), st.range * 0.8);
      else if (e.key === "-") st.range = Math.min(60000, st.range * 1.25);
      else return;
      e.preventDefault();
    };
    const ctx = (e: Event) => e.preventDefault();
    el.tabIndex = 0;
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("dblclick", dbl);
    el.addEventListener("keydown", key);
    el.addEventListener("contextmenu", ctx);
    const leave = () => cb.current.onHover(null);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("dblclick", dbl);
      el.removeEventListener("keydown", key);
      el.removeEventListener("contextmenu", ctx);
      el.removeEventListener("pointerleave", leave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, cam]);

  const flyTo = (f: RigFly) => {
    const st = s.current;
    const toDir = f.dir.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(st.target, toDir);
    const toFwd = f.fwd ? tangent(toDir, f.fwd) : tangent(toDir, st.fwd.clone().applyQuaternion(q));
    st.omega.set(0, 0, 0);
    st.flight = {
      t0: performance.now(),
      ms: f.ms ?? (Math.abs(Math.log(f.range / st.range)) > 3 ? 2600 : 1500),
      from: { target: st.target.clone(), fwd: st.fwd.clone(), range: st.range, tilt: st.tilt },
      to: { target: toDir, fwd: toFwd, range: f.range, tilt: f.tilt ?? 0 },
    };
  };

  useEffect(() => {
    if (fly) flyTo(fly);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fly?.n]);

  useFrame((_, dt) => {
    const st = s.current;
    if (st.flight) {
      const f = st.flight;
      const k = Math.min(1, (performance.now() - f.t0) / f.ms);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const q = new THREE.Quaternion().setFromUnitVectors(f.from.target, f.to.target);
      const qe = new THREE.Quaternion().slerp(q, e);
      st.target.copy(f.from.target).applyQuaternion(qe).normalize();
      const carried = f.from.fwd.clone().applyQuaternion(qe);
      st.fwd.copy(tangent(st.target, carried.lerp(tangent(st.target, f.to.fwd), e)));
      // altitude rises mid-flight on long hops, like a real flyover
      const hop = f.from.target.angleTo(f.to.target) * R;
      const peak = Math.min(6000, hop * 0.6);
      const rLog = Math.exp(Math.log(f.from.range) * (1 - e) + Math.log(f.to.range) * e);
      st.range = rLog + peak * Math.sin(Math.PI * e) * (hop > 50 ? 1 : 0);
      st.tilt = f.from.tilt * (1 - e) + f.to.tilt * e;
      if (k >= 1) {
        st.range = f.to.range;
        st.flight = null;
      }
    } else if (st.omega.lengthSq() > 1e-10) {
      const w = st.omega.length();
      rotate(new THREE.Quaternion().setFromAxisAngle(st.omega.clone().normalize(), w * dt));
      st.omega.multiplyScalar(Math.exp(-dt * 1.5));
    }
    st.range = Math.max(st.range, st.flight ? 0.01 : cb.current.minRange(st.target));
    place();
  });
  return null;
}
