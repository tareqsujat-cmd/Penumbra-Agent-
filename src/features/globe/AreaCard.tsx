import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { earthPos, heightAt, HOURS, llToVec, R_KM, slopeAt, sunDir, type HeightMap } from "./globeData";
import type { Selection } from "./GlobeScene";
import { Seg, Tip } from "../../components/ui";
import { api, siteListSync } from "../../api/client";
import { useApiCall, useModel } from "../../hooks/useMission";
import { getState } from "../../state/store";
import type { SiteId } from "../../types";

const DAY = 24;

function fmtIn(h: number): string {
  if (h < 48) return `${h} h`;
  return `${(h / DAY).toFixed(1)} days`;
}

function localAzEl(u: THREE.Vector3, v: THREE.Vector3): [number, number] {
  const east = new THREE.Vector3(0, 0, 1).cross(u);
  if (east.lengthSq() < 1e-9) east.set(0, 1, 0);
  east.normalize();
  const north = u.clone().cross(east);
  const el = (Math.asin(Math.min(1, Math.max(-1, v.dot(u)))) * 180) / Math.PI;
  const az = ((Math.atan2(v.dot(east), v.dot(north)) * 180) / Math.PI + 360) % 360;
  return [az, el];
}

export function AreaCard({
  sel,
  heights,
  slopes,
  hourIdx,
  onRadius,
  onClose,
  onPlan,
}: {
  sel: Selection;
  heights: HeightMap;
  slopes: { s: Float32Array; w: number; hgt: number } | null;
  hourIdx: number;
  onRadius: (r: number) => void;
  onClose: () => void;
  onPlan: (id: SiteId) => void;
}) {
  const model = useModel();
  const u = useMemo(() => llToVec(sel.lat, sel.lon, 1), [sel.lat, sel.lon]);

  // terrain statistics inside the circle (rings of samples on the sphere)
  const terrain = useMemo(() => {
    const e1 = new THREE.Vector3(0, 0, 1).cross(u);
    if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0);
    e1.normalize();
    const e2 = u.clone().cross(e1).normalize();
    const hs: number[] = [];
    const ss: number[] = [];
    for (let ring = 0; ring <= 6; ring++) {
      const th = (sel.radiusKm / R_KM) * (ring / 6);
      const n = ring === 0 ? 1 : ring * 10;
      for (let k = 0; k < n; k++) {
        const ph = (k / n) * Math.PI * 2;
        const d = u.clone().multiplyScalar(Math.cos(th)).addScaledVector(e1, Math.sin(th) * Math.cos(ph)).addScaledVector(e2, Math.sin(th) * Math.sin(ph)).normalize();
        const lat = (Math.asin(d.z) * 180) / Math.PI;
        const lon = (Math.atan2(d.y, d.x) * 180) / Math.PI;
        hs.push(heightAt(heights, lat, lon));
        if (slopes) ss.push(slopeAt(slopes, lat, lon));
      }
    }
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    return { centre: hs[0], min: Math.min(...hs), max: Math.max(...hs), meanSlope: ss.length ? mean(ss) : null, maxSlope: ss.length ? Math.max(...ss) : null };
  }, [u, sel.radiusKm, heights, slopes]);

  // Sun and Earth geometry at the area centre (smooth Moon, no terrain), whole of 2027
  const geo = useMemo(() => {
    const s = new THREE.Vector3();
    const e = new THREE.Vector3();
    const p = u.clone().multiplyScalar(R_KM);
    let sunUp = 0;
    let earthUp = 0;
    let both = 0;
    const sunEl = new Float32Array(HOURS);
    for (let i = 0; i < HOURS; i++) {
      sunDir(i, s);
      earthPos(i, e).sub(p).normalize();
      const se = s.dot(u);
      const ee = e.dot(u);
      sunEl[i] = se;
      if (se > 0) sunUp++;
      if (ee > 0) earthUp++;
      if (se > 0 && ee > 0) both++;
    }
    return { sunUp: (100 * sunUp) / HOURS, earthUp: (100 * earthUp) / HOURS, both: (100 * both) / HOURS, sunEl };
  }, [u]);

  const now = useMemo(() => {
    const s = sunDir(hourIdx);
    const e = earthPos(hourIdx).sub(u.clone().multiplyScalar(R_KM)).normalize();
    const [sAz, sEl] = localAzEl(u, s);
    const [eAz, eEl] = localAzEl(u, e);
    const day = sEl > 0;
    let change: number | null = null;
    for (let i = hourIdx + 1; i < HOURS; i++) {
      if (geo.sunEl[i] > 0 !== day) {
        change = i - hourIdx;
        break;
      }
    }
    const earthLit = (1 + Math.cos(s.angleTo(earthPos(hourIdx).normalize().negate()))) / 2;
    return { sAz, sEl, eAz, eEl, day, change, earthLit };
  }, [hourIdx, u, geo]);

  // nearest Penumbra site
  const near = useMemo(() => {
    let best: { id: SiteId; name: string; km: number } | null = null;
    for (const st of siteListSync()) {
      const km = R_KM * llToVec(st.lat, st.lon, 1).angleTo(u);
      if (!best || km < best.km) best = { id: st.id, name: st.name, km };
    }
    return best;
  }, [u]);
  const nearSite = near && near.km <= sel.radiusKm + 15 ? near : null;
  const q = getState().percentile;
  const ra = useApiCall(nearSite ? JSON.stringify(["robust", nearSite.id, model, q]) : null, () =>
    api.robustAim({ site: nearSite!.id, aim: { x: 0, y: 0 }, model, enabled: true, percentile: q, seed: 7 }),
  );
  const penumbra = nearSite && ra.data ? { site: { id: nearSite.id, name: nearSite.name }, r: ra.data } : null;

  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [sel]);
  const coord = `${sel.lat.toFixed(4)}°, ${(((sel.lon % 360) + 360) % 360).toFixed(4)}°E`;
  const region = Math.abs(sel.lat) > 89.9 ? "South Pole" : sel.lat < -80 ? "South polar region" : sel.lat > 80 ? "North polar region" : Math.abs(((sel.lon + 540) % 360) - 180) < 90 ? "Nearside" : "Farside";

  return (
    <section className="pn-area" aria-label="Selected area">
      <header>
        <div>
          <div className="ids-overline">Selected area · {region}</div>
          <b className="ids-num">{coord}</b>
        </div>
        <button className="ids-btn ids-btn--ghost pn-icon-btn" onClick={onClose} aria-label="Close area information">✕</button>
      </header>
      <div className="pn-area__radius">
        <span>Area radius</span>
        <Seg label="Area radius" size="sm" value={String(sel.radiusKm)} onChange={(v) => onRadius(Number(v))} options={[{ value: "5", label: "5 km" }, { value: "20", label: "20 km" }, { value: "50", label: "50 km" }]} />
      </div>

      {penumbra && (
        <div className="pn-area__penumbra">
          <div className="ids-overline">Penumbra landing site · {penumbra.site.name}</div>
          <div className="pn-area__kpis">
            <div><span>Brightest point</span><b className="ids-num">{penumbra.r.bestNominal.value.toFixed(0)}%</b><small>P10 {penumbra.r.bestNominal.pq.toFixed(0)}%</small></div>
            <div><span>Robust aim</span><b className="ids-num pn-good">{penumbra.r.robust.value.toFixed(0)}%</b><small>P10 {penumbra.r.robust.pq.toFixed(1)}%</small></div>
          </div>
          <button className="ids-btn ids-btn--primary ids-btn--block" onClick={() => onPlan(penumbra.site.id)}>
            Plan a landing here
          </button>
        </div>
      )}

      <dl>
        <dt>Elevation (centre)</dt>
        <dd className="ids-num">{(terrain.centre / 1000).toFixed(2)} km</dd>
        <dt>Range in area</dt>
        <dd className="ids-num">{(terrain.min / 1000).toFixed(2)} to {(terrain.max / 1000).toFixed(2)} km</dd>
        <dt>Slope, mean / max <Tip title="Slope" text="From LOLA relief resampled to about 5 km per pixel. Local slopes at lander scale are steeper; the south-pole sites use 5 m terrain." /></dt>
        <dd className="ids-num">{terrain.meanSlope == null ? "…" : `${terrain.meanSlope.toFixed(1)}° / ${terrain.maxSlope!.toFixed(1)}°`}</dd>
      </dl>
      <div className="pn-area__now">
        <div className={`pn-area__chip ${now.day ? "is-day" : "is-night"}`}>
          <span className="pn-area__icon" aria-hidden="true">☀</span>
          <div>
            <b>{now.day ? "Sun up" : "Sun down"}</b>
            <small className="ids-num">el {now.sEl.toFixed(2)}° · az {now.sAz.toFixed(0)}°</small>
            <small>{now.change == null ? "no change before 2028" : `${now.day ? "Sunset" : "Sunrise"} in ${fmtIn(now.change)}`}</small>
          </div>
        </div>
        <div className={`pn-area__chip ${now.eEl > 0 ? "is-earth" : "is-night"}`}>
          <span className="pn-area__icon" aria-hidden="true">◐</span>
          <div>
            <b>{now.eEl > 0 ? "Earth in view" : "Earth below horizon"}</b>
            <small className="ids-num">el {now.eEl.toFixed(2)}° · az {now.eAz.toFixed(0)}°</small>
            <small className="ids-num">Earth {Math.round(now.earthLit * 100)}% lit</small>
          </div>
        </div>
      </div>
      <dl>
        <dt>Sun above horizon, 2027</dt>
        <dd className="ids-num">{geo.sunUp.toFixed(1)}%</dd>
        <dt>Earth above horizon, 2027</dt>
        <dd className="ids-num">{geo.earthUp.toFixed(1)}%</dd>
        <dt>Both at once</dt>
        <dd className="ids-num">{geo.both.toFixed(1)}%</dd>
        {near && !penumbra && (
          <>
            <dt>Nearest Penumbra site</dt>
            <dd>{near.name} · {near.km < 1000 ? `${near.km.toFixed(0)} km` : `${(near.km / 1000).toFixed(1)} thousand km`}</dd>
          </>
        )}
      </dl>
      <p className="pn-area__note">
        Sun and Earth: NAIF SPICE (DE440) geometry at the area centre on a smooth Moon; terrain shadows are included only in the south-pole landing analysis. Terrain: NASA LOLA. Imagery: LROC WAC.
      </p>
      <button
        className="ids-btn ids-btn--ghost pn-area__copy"
        onClick={() => {
          navigator.clipboard?.writeText(coord).then(() => setCopied(true), () => setCopied(false));
        }}
      >
        {copied ? "Coordinates copied" : "Copy coordinates"}
      </button>
    </section>
  );
}
