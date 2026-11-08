import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import * as RSlider from "@radix-ui/react-slider";
import * as THREE from "three";
import regionWide from "../../data/generated/region_wide.json";
import { getState, setState, useApp } from "../../state/store";
import { earthPos, heightAt as coarseHeightAt, HOURS, loadHeights, loadSlopes, sunDir, vecToLL, type HeightMap } from "./globeData";
import { GlobeScene, type Lighting, type Selection } from "./GlobeScene";
import { AreaCard } from "./AreaCard";
import { LandingPanel, openSiteOnGlobe } from "./LandingPanel";
import { CAP_LAT, dirLL, GlobalHeights, llPolar, makePolarMaterial, MoonTiles, R, type TileManifest } from "./tiles/MoonTiles";
import { gridCovers, heightAt as gridsHeightAt, loadGrid, sampleGrid, type HeightGrid } from "../terrain3d/grids";
import { latLonToStereo } from "../terrain3d/frame";
import { loadSiteGrids, type Grids } from "../terrain3d/Terrain3D";
import { siteListSync, siteLoaded, siteSync } from "../../api/client";
import { inField } from "../../utils/field";
import { worldToSite } from "./SiteLayer";
import type { RigFly } from "./GlobeRig";
import { Seg, Tip } from "../../components/ui";
import { fmtDate } from "../../utils/format";
import type { SiteId } from "../../types";
import { ExploreHero } from "./ExploreHero";

/** |sin(lat)| poleward of which the LROC NAC polar mosaics apply (85.5 deg). */
const NAC_Z = Math.sin((85.5 * Math.PI) / 180);

const RW = regionWide as { px: number; res: number; x0: number; y0: number; hmin: number; hmax: number; height_png: string };

function tangentNorth(dir: THREE.Vector3): THREE.Vector3 {
  const t = new THREE.Vector3(0, 0, 1).addScaledVector(dir, -dir.z);
  return t.lengthSq() < 1e-8 ? new THREE.Vector3(1, 0, 0) : t.normalize();
}

export function GlobeView() {
  const [base, setBase] = useState<HeightMap | null>(null);
  const [slopes, setSlopes] = useState<{ s: Float32Array; w: number; hgt: number } | null>(null);
  const [tiles, setTiles] = useState<MoonTiles | null>(null);
  const [albedo, setAlbedo] = useState(0.27);
  const [siteGrids, setSiteGrids] = useState<Grids | null>(null);
  const [lighting, setLighting] = useState<Lighting>("always");
  const [earthMode, setEarthMode] = useState<"enhanced" | "true">("enhanced");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 6 | 24>(6);
  const [sel, setSel] = useState<Selection | null>(null);
  const [hover, setHover] = useState<{ lat: number; lon: number; h: number } | null>(null);
  const [range, setRange] = useState(5400);
  const [fly, setFly] = useState<RigFly | null>(null);
  const [touched, setTouched] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [landingOpen, setLandingOpen] = useState(false);
  const [heroOpen, setHeroOpen] = useState(true);
  // the intro leaves with an animation (fade, lift, blur) instead of vanishing
  const [heroLeaving, setHeroLeaving] = useState(false);
  useEffect(() => {
    if (!heroOpen || !(touched || landingOpen || sel)) return;
    setHeroLeaving(true);
    const id = setTimeout(() => {
      setHeroOpen(false);
      setHeroLeaving(false);
    }, 720);
    return () => clearTimeout(id);
  }, [touched, landingOpen, sel, heroOpen]);
  const closeHero = () => {
    setHeroLeaving(true);
    setTimeout(() => {
      setHeroOpen(false);
      setHeroLeaving(false);
    }, 720);
  };
  const [detail, setDetail] = useState("");
  const lastTarget = useRef(new THREE.Vector3(1, 0, 0));
  const hourIdx = useApp((s) => s.cursorIdx);
  const globeSite = useApp((s) => s.globeSite);
  const site = useMemo(() => (globeSite && siteLoaded(globeSite) ? siteSync(globeSite) : null), [globeSite]);

  // data used by the camera rig for surface heights (refs keep the callbacks stable)
  const gh = useRef<GlobalHeights | null>(null);
  const polarCoarse = useRef<HeightGrid | null>(null);
  const northCoarse = useRef<HeightGrid | null>(null);
  const gridsRef = useRef<Grids | null>(null);
  const baseRef = useRef<HeightMap | null>(null);
  const polarMat = useRef<ReturnType<typeof makePolarMaterial> | null>(null);
  const initialDir = useMemo(() => earthPos(getState().cursorIdx).normalize(), []);

  useEffect(() => {
    loadHeights().then((h) => {
      baseRef.current = h;
      setBase(h);
    });
    loadSlopes().then(setSlopes);
    loadGrid(RW.height_png, RW.hmin, RW.hmax, RW.x0, RW.y0, RW.res).then((g) => (polarCoarse.current = g));
    // tile pyramid (served by serve.py); without it the globe keeps its single-mesh surface
    (async () => {
      try {
        const man = (await (await fetch("./tiles/manifest.json")).json()) as TileManifest;
        const buf = await (await fetch("./tiles/ldem16.bin")).arrayBuffer();
        gh.current = new GlobalHeights(new Int16Array(buf), man.ldem16.w, man.ldem16.h, man.ldem16.scale);
        polarMat.current = makePolarMaterial(man.polarAlbedo);
        setAlbedo(man.polarAlbedo);
        try {
          const nb = await (await fetch("./tiles/polar_n_coarse.bin")).arrayBuffer();
          const z = new Int16Array(nb);
          const h = new Float32Array(z.length);
          for (let k = 0; k < z.length; k++) h[k] = z[k] * 0.5;
          const x0 = (0 - 1905.5) * 240;
          northCoarse.current = { h, n: 636, x0, y0: -x0, res: 1440 };
        } catch {
          northCoarse.current = null;
        }
        const mt = new MoonTiles(man, gh.current, polarMat.current, polarMat.current.userData);
        (window as unknown as { __pnTiles?: MoonTiles }).__pnTiles = mt; // inspected by the QA scripts
        setTiles(mt);
      } catch {
        setTiles(null);
      }
    })();
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setState((s) => ({ cursorIdx: (s.cursorIdx + speed) % HOURS })), 80);
    return () => clearInterval(id);
  }, [playing, speed]);
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(null), 5000);
    return () => clearTimeout(id);
  }, [note]);
  useEffect(() => {
    if (!tiles) return;
    const id = setInterval(() => {
      const st = tiles.stats();
      const z = Math.abs(lastTarget.current.z);
      const geoMpp = Math.round((1737400 * Math.PI) / 2 ** st.geoMax / 256);
      const pMpp = 8562 / 2 ** st.polarMax;
      const pTxt = pMpp < 10 ? pMpp.toFixed(1) : Math.round(pMpp);
      setDetail(
        z > 0.965
          ? st.polarMax <= 7
            ? `LRO WAC polar + LOLA/CE-2 relief · ${pTxt} m/px`
            : z > NAC_Z
              ? `LROC NAC polar mosaic · ${pTxt} m/px`
              : `Kaguya TC + CE-2 relief · ${pTxt} m/px`
          : st.geoMax >= 8
            ? `Kaguya TC + SLDEM · ${geoMpp} m/px`
            : `LROC WAC · ${geoMpp} m/px`,
      );
    }, 700);
    return () => clearInterval(id);
  }, [tiles]);

  // site terrain for the landing analysis
  useEffect(() => {
    let alive = true;
    gridsRef.current = null;
    setSiteGrids(null);
    if (polarMat.current) polarMat.current.userData.holeOn.value = 0;
    if (!site) return;
    loadSiteGrids(site, 1).then((g) => {
      if (!alive) return;
      gridsRef.current = g;
      setSiteGrids(g);
      const c = g.detail; // only the 5 m landing terrain replaces the globe tiles
      const inset = 2 * c.res;
      if (polarMat.current) {
        polarMat.current.userData.hole.value.set((c.x0 + inset) / 1000, (c.y0 - (c.n - 1) * c.res + inset) / 1000, (c.x0 + (c.n - 1) * c.res - inset) / 1000, (c.y0 - inset) / 1000);
        polarMat.current.userData.holeOn.value = 1;
      }
    });
    return () => {
      alive = false;
    };
  }, [site]);

  const surfaceKm = useCallback((dir: THREE.Vector3): number => {
    const lat = (Math.asin(Math.max(-1, Math.min(1, dir.z / dir.length()))) * 180) / Math.PI;
    const lon = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
    const g = gridsRef.current;
    if (g || lat < CAP_LAT + 0.3) {
      const [sx, sy] = latLonToStereo((lat * Math.PI) / 180, (lon * Math.PI) / 180);
      if (g && gridCovers(g.context, sx, sy, 2)) return gridsHeightAt([g.detail, g.context], sx, sy) / 1000;
      const pc = polarCoarse.current;
      if (pc && lat < CAP_LAT + 0.3 && gridCovers(pc, sx, sy, 1)) return sampleGrid(pc, sx, sy) / 1000;
    }
    if (lat > -CAP_LAT - 0.3 && northCoarse.current) {
      const [sx, sy] = llPolar("n", (lat * Math.PI) / 180, (lon * Math.PI) / 180);
      if (gridCovers(northCoarse.current, sx, sy, 1)) return sampleGrid(northCoarse.current, sx, sy) / 1000;
    }
    if (gh.current) return gh.current.at(lat, lon) / 1000;
    return baseRef.current ? coarseHeightAt(baseRef.current, lat, lon) / 1000 : 0;
  }, []);

  const siteDir = useCallback((id: SiteId) => {
    const st = siteListSync().find((s) => s.id === id)!;
    return dirLL(st.lat, st.lon);
  }, []);

  const minRange = useCallback(
    (dir: THREE.Vector3): number => {
      const id = getState().globeSite;
      if (id && gridsRef.current && dir.angleTo(siteDir(id)) * R < 25) return 0.12;
      // closest zoom limited by the sharpest imagery: LROC NAC near the poles (4 m/px), Kaguya TC elsewhere (7-10 m/px)
      const z = Math.abs(dir.z) / dir.length();
      return z > NAC_Z ? 0.8 : z > Math.sin((-CAP_LAT * Math.PI) / 180) ? 1.5 : 2;
    },
    [siteDir],
  );

  const flyToSite = useCallback(
    (id: SiteId) => {
      const d = siteDir(id);
      const s = sunDir(getState().cursorIdx);
      const sunT = s.clone().addScaledVector(d, -s.dot(d));
      // put the camera on the sunward side (front-lit slopes); the view looks away from the Sun
      const fwd = sunT.lengthSq() > 1e-8 ? sunT.normalize().negate().applyAxisAngle(d, 0.44) : tangentNorth(d);
      setFly({ dir: d, range: 3.6, tilt: 1.1, fwd, n: Date.now() });
    },
    [siteDir],
  );

  const pickSite = (id: SiteId) => {
    openSiteOnGlobe(id);
    setLandingOpen(true);
    setSel(null);
    flyToSite(id);
  };

  const onClick = (p: THREE.Vector3) => {
    const g = gridsRef.current;
    if (site && g) {
      const o = worldToSite(g, p);
      if (inField(site.field, o)) {
        setState({ aim: o, aimKind: "custom", toast: "Aim moved. Press “Find the safest spot” to compare." });
        return;
      }
    }
    const [lat, lon] = vecToLL(p);
    setSel({ lat, lon, radiusKm: sel?.radiusKm ?? 20 });
  };

  const presets = {
    nearside: () => setFly({ dir: earthPos(hourIdx).normalize(), range: 5400, tilt: 0, fwd: tangentNorth(earthPos(hourIdx).normalize()), n: Date.now() }),
    earth: () => {
      const d = earthPos(hourIdx).normalize().negate().applyAxisAngle(new THREE.Vector3(0, 0, 1), 0.42).add(new THREE.Vector3(0, 0, 0.12)).normalize();
      setFly({ dir: d, range: 7800, tilt: 0, fwd: tangentNorth(d), n: Date.now() });
    },
    south: () => pole(-1),
    north: () => pole(1),
  };
  function pole(sign: 1 | -1) {
    if (lighting === "sun") {
      let best = hourIdx;
      const v = new THREE.Vector3();
      for (let i = Math.max(0, hourIdx - 2160); i < Math.min(HOURS, hourIdx + 2160); i += 2) if (sign * sunDir(i, v).z > sign * sunDir(best).z) best = i;
      if (best !== hourIdx) {
        setState({ cursorIdx: best });
        setNote(`Time moved to ${fmtDate(best)}, when the Sun stands highest over the ${sign > 0 ? "north" : "south"} pole`);
      }
    }
    setFly({ dir: new THREE.Vector3(0.03, 0.005, sign).normalize(), range: 520, tilt: 0, fwd: new THREE.Vector3(sign > 0 ? -1 : 1, 0, 0), n: Date.now() });
  }

  const s = sunDir(hourIdx);
  const e = earthPos(hourIdx);
  const phase = (1 + Math.cos(s.angleTo(e.clone().normalize()))) / 2;

  return (
    <div className="pn-globe">
      {base ? (
        <Canvas
          shadows
          dpr={[1, 2]}
          gl={{ antialias: true, logarithmicDepthBuffer: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.12 }}
          camera={{ fov: 32, near: 0.01, far: 3_000_000, position: initialDir.clone().multiplyScalar(R + 5400).toArray(), up: [0, 0, 1] }}
          onCreated={({ scene }) => {
            scene.background = new THREE.Color("#000000");
          }}
          aria-label="Three-dimensional Moon. Drag to spin, release to let it roll, scroll to zoom, right-drag to tilt, click the surface to inspect."
        >
          <GlobeScene
            tiles={tiles}
            baseHeights={base}
            surfaceKm={surfaceKm}
            minRange={minRange}
            lighting={lighting}
            hourIdx={hourIdx}
            earthMode={earthMode}
            selection={landingOpen ? null : sel}
            onClick={onClick}
            onHover={(p) => {
              if (!p) return setHover(null);
              const [lat, lon] = vecToLL(p);
              setHover({ lat, lon, h: (p.length() - R) * 1000 });
            }}
            onRange={(r, t) => {
              lastTarget.current.copy(t);
              if (Math.abs(r - range) / range > 0.02) setRange(r);
            }}
            fly={fly}
            initialDir={initialDir}
            onUserInput={() => setTouched(true)}
            site={site}
            siteGrids={siteGrids}
            albedo={albedo}
            onSitePin={pickSite}
          />
        </Canvas>
      ) : (
        <div className="pn-globe__loading" role="status">
          <span className="ids-btn__spinner" />
          Loading NASA LOLA terrain and LROC imagery…
        </div>
      )}

      {heroOpen && base && (
        <ExploreHero
          leaving={heroLeaving}
          onBegin={() => setLandingOpen(true)}
          onClose={closeHero}
        />
      )}

      <nav className={`pn-globe__tools${landingOpen ? " is-shifted" : ""}`} aria-label="Globe views">
        <button className="ids-btn ids-btn--primary pn-globe__plan" onClick={() => setLandingOpen(true)}>Plan a landing</button>
        <button className="pn-tool pn-tool--wide" onClick={presets.nearside}>Nearside (from Earth)</button>
        <button className="pn-tool pn-tool--wide" onClick={presets.earth}>Earth in view</button>
        <div className="pn-globe__poles">
          <button className="pn-tool pn-tool--wide" onClick={presets.north}>North Pole</button>
          <button className="pn-tool pn-tool--wide is-accent" onClick={presets.south}>South Pole</button>
        </div>
        <div className="pn-globe__row">
          <Seg label="Lighting" size="sm" value={lighting} onChange={setLighting} options={[{ value: "always", label: "Always lit" }, { value: "sun", label: "Real sunlight" }]} />
          <Tip title="Lighting" text="Always lit shows every side of the Moon with soft light from over your shoulder, so you can explore anywhere. Real sunlight lights the Moon from the Sun's true direction at the selected time (SPICE), with day, night and long polar shadows." />
        </div>
        <div className="pn-globe__row">
          <Seg label="Earth size" size="sm" value={earthMode} onChange={setEarthMode} options={[{ value: "enhanced", label: "Earth ×4" }, { value: "true", label: "True scale" }]} />
          <Tip title="Earth size" text="The Earth is always in its true direction, orientation and phase. 'Earth ×4' brings it closer and draws it four times its real apparent size so it is easy to see." />
        </div>
      </nav>

      {note && <div className="pn-globe__note" role="status">{note}</div>}
      {!touched && base && !heroOpen && <div className="pn-globe__hint">Drag to spin · release to let it roll · scroll to zoom · right-drag to tilt · click to inspect</div>}

      <div className="pn-globe__time">
        <button className="pn-tool" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause time" : "Play time"}>{playing ? "❚❚" : "▶"}</button>
        <div className="pn-globe__when">
          <b className="ids-num">{fmtDate(hourIdx)}</b>
          <span className="ids-num">Moon from Earth {Math.round(phase * 100)}% lit{lighting === "always" ? " · switch to Real sunlight to see it" : ""}</span>
        </div>
        <RSlider.Root className="pn-slider pn-globe__slider" value={[hourIdx]} min={0} max={HOURS - 1} step={1} onValueChange={(v) => setState({ cursorIdx: v[0] })} aria-label="Time in 2027">
          <RSlider.Track className="pn-slider__track">
            <RSlider.Range className="pn-slider__range" />
          </RSlider.Track>
          <RSlider.Thumb className="pn-slider__thumb" aria-label="Time in 2027" />
        </RSlider.Root>
        <Seg label="Playback speed" size="sm" value={String(speed)} onChange={(v) => setSpeed(Number(v) as 1 | 6 | 24)} options={[{ value: "1", label: "1 h/s" }, { value: "6", label: "6 h/s" }, { value: "24", label: "1 d/s" }]} />
      </div>

      <div className="pn-readout pn-globe__readout" aria-live="off">
        <div className="pn-readout__cell"><span>CURSOR</span><b className="ids-num">{hover ? `${hover.lat.toFixed(4)}°, ${(((hover.lon % 360) + 360) % 360).toFixed(4)}°E` : "—"}</b></div>
        <div className="pn-readout__cell"><span>ELEVATION</span><b className="ids-num">{hover ? `${(hover.h / 1000).toFixed(3)} km` : "—"}</b></div>
        <div className="pn-readout__cell"><span>CAMERA RANGE</span><b className="ids-num">{range >= 100 ? `${range.toFixed(0)} km` : range >= 1 ? `${range.toFixed(1)} km` : `${(range * 1000).toFixed(0)} m`}</b></div>
        <div className="pn-readout__cell"><span>DETAIL</span><b className="ids-num">{siteGrids && range < 30 ? "LOLA 5 m site terrain" : detail || "LROC WAC · LOLA"}</b></div>
      </div>

      {landingOpen ? (
        <LandingPanel onClose={() => setLandingOpen(false)} onPickSite={pickSite} />
      ) : (
        sel && base && (
          <AreaCard sel={sel} heights={base} slopes={slopes} hourIdx={hourIdx} onRadius={(r) => setSel({ ...sel, radiusKm: r })} onClose={() => setSel(null)} onPlan={pickSite} />
        )
      )}
    </div>
  );
}
