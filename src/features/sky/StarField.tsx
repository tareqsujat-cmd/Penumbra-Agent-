/** Star sphere for the three.js views. It follows the camera (stars are at infinity) and is oriented with the
 *  SPICE rotation for the current hour: `frame="moon"` for scenes in MOON_ME axes (the globe), `frame="local"` for
 *  site scenes whose axes are east/up/−north (the terrain view). */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { loadSky, moonFrameAt, starBuffers, starGeometry, starMaterial, type SkyData } from "./stars";

export function useSky(): SkyData | null {
  const [sky, setSky] = useState<SkyData | null>(null);
  useEffect(() => {
    let alive = true;
    loadSky().then((s) => alive && setSky(s));
    return () => {
      alive = false;
    };
  }, []);
  return sky;
}

const qFrame = new THREE.Quaternion();
const qLocal = new THREE.Quaternion();
const mLocal = new THREE.Matrix4();

export function StarField({
  hourIdx,
  frame,
  radius,
  site,
  opacity = 1,
  limit = 6.5,
}: {
  hourIdx: number;
  frame: "moon" | "local";
  radius: number;
  /** site basis in MOON_ME (for frame="local") */
  site?: { east: THREE.Vector3; up: THREE.Vector3; north: THREE.Vector3 };
  opacity?: number;
  limit?: number;
}) {
  const sky = useSky();
  const group = useRef<THREE.Group>(null);
  const geo = useMemo(() => (sky ? starGeometry(starBuffers(sky, limit), radius) : null), [sky, limit, radius]);
  const mat = useMemo(() => starMaterial(opacity), [opacity]);
  useEffect(() => () => geo?.dispose(), [geo]);
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => {
    if (!sky || !group.current) return;
    moonFrameAt(sky, hourIdx, qFrame);
    if (frame === "moon" || !site) {
      group.current.quaternion.copy(qFrame);
      return;
    }
    // world = [east; up; −north] · MOON_ME
    mLocal.set(site.east.x, site.east.y, site.east.z, 0, site.up.x, site.up.y, site.up.z, 0, -site.north.x, -site.north.y, -site.north.z, 0, 0, 0, 0, 1);
    qLocal.setFromRotationMatrix(mLocal);
    group.current.quaternion.copy(qLocal.multiply(qFrame));
  }, [sky, hourIdx, frame, site]);
  useFrame(({ camera }) => {
    if (group.current) group.current.position.copy(camera.position);
  });
  if (!geo) return null;
  return (
    <group ref={group} renderOrder={-10}>
      <points geometry={geo} material={mat} frustumCulled={false} renderOrder={-10} />
    </group>
  );
}
