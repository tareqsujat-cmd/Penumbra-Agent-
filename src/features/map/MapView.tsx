import { useEffect, useMemo, useRef, useState } from "react";
import OlMap from "ol/Map";
import View from "ol/View";
import Feature from "ol/Feature";
import ImageLayer from "ol/layer/Image";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Static from "ol/source/ImageStatic";
import Projection from "ol/proj/Projection";
import { Point, Polygon, LineString } from "ol/geom";
import { Circle as CircleStyle, Fill, RegularShape, Stroke, Style, Text } from "ol/style";
import ScaleLine from "ol/control/ScaleLine";
import { defaults as defaultInteractions } from "ol/interaction/defaults";
import "ol/ol.css";
import { getState, setState, useApp } from "../../state/store";
import { useModel, useRisk, useSite, useStrings } from "../../hooks/useMission";
import { bilinear, decodeEphem, fieldExtent, inField } from "../../utils/field";
import { cividis, decodeHeights, gridToCanvas, hillshade } from "../../utils/color";
import { LayerList } from "./LayerList";
import { CursorReadout, type CursorInfo } from "./CursorReadout";
import { HeatLegend } from "./HeatLegend";
import type { UncertaintyModel, XY } from "../../types";

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#fff";

function ellipseRing(center: XY, m: UncertaintyModel, scale: number, n = 96): number[][] {
  const pts: number[][] = [];
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

function markerStyle(kind: "aim" | "brightest" | "robust" | "known", label: string | null): Style[] {
  const ink = "#0b0f14";
  const styles: Style[] = [];
  if (kind === "aim") {
    styles.push(new Style({ image: new CircleStyle({ radius: 9, fill: new Fill({ color: "rgba(255,255,255,0.08)" }), stroke: new Stroke({ color: "#ffffff", width: 2.4 }) }) }));
    styles.push(new Style({ image: new CircleStyle({ radius: 3, fill: new Fill({ color: "#ffffff" }) }) }));
  } else if (kind === "brightest") {
    styles.push(new Style({ image: new RegularShape({ points: 3, radius: 10, fill: new Fill({ color: "#e69f00" }), stroke: new Stroke({ color: ink, width: 1.6 }) }) }));
  } else if (kind === "robust") {
    styles.push(new Style({ image: new RegularShape({ points: 5, radius: 13, radius2: 5.6, fill: new Fill({ color: "#2fd1a0" }), stroke: new Stroke({ color: ink, width: 1.6 }) }) }));
  } else {
    styles.push(new Style({ image: new RegularShape({ points: 4, radius: 7, radius2: 0, angle: Math.PI / 4, stroke: new Stroke({ color: "#ffffff", width: 2 }) }) }));
  }
  if (label)
    styles.push(
      new Style({
        text: new Text({
          text: label,
          offsetX: 16,
          offsetY: -14,
          textAlign: "left",
          font: "600 12px Inter, system-ui, sans-serif",
          fill: new Fill({ color: "#ffffff" }),
          backgroundFill: new Fill({ color: "rgba(7,9,12,0.78)" }),
          padding: [3, 6, 3, 6],
        }),
      }),
    );
  return styles;
}

interface MapLayers {
  relief: ImageLayer<Static>;
  slope: ImageLayer<Static>;
  heat: ImageLayer<Static>;
  score: ImageLayer<Static>;
  grid: VectorLayer<VectorSource>;
  zone: VectorLayer<VectorSource>;
  samples: VectorLayer<VectorSource>;
  markers: VectorLayer<VectorSource>;
}

export function MapView({ simple = false }: { simple?: boolean }) {
  const site = useSite();
  const { t } = useStrings();
  const aim = useApp((s) => s.aim);
  const layers = useApp((s) => s.layers);
  const unc = useApp((s) => s.uncertainty);
  const robust = useApp((s) => s.robust);
  const heatMetric = useApp((s) => s.heatMetric);
  const cursorIdx = useApp((s) => s.cursorIdx);
  const siteLoading = useApp((s) => s.siteLoading);
  const model = useModel();
  const risk = useRisk();
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<OlMap | null>(null);
  const L = useRef<MapLayers>({} as MapLayers);
  const heightsRef = useRef<{ h: Float32Array; n: number } | null>(null);
  const shadeCanvas = useRef(document.createElement("canvas"));
  const ellipseScale = useRef(unc.enabled ? 1 : 0);
  const robustPos = useRef<XY | null>(null);
  const [cursor, setCursor] = useState<CursorInfo | null>(null);
  const ephem = useMemo(() => decodeEphem(site), [site]);
  const sunAzBucket = Math.round(ephem.sunAz[Math.min(cursorIdx, ephem.n - 1)] / 4) * 4;

  const half = site.terrain.half + site.terrain.res / 2;
  const extent = useMemo(() => [-half, -half, half, half] as [number, number, number, number], [half]);
  const projection = useMemo(() => new Projection({ code: `PN-LOCAL-${site.id}`, units: "m", extent }), [site.id, extent]);

  // ---- create map once per site (projection changes with the site)
  useEffect(() => {
    if (!el.current) return;
    const vec = (z: number) => new VectorLayer({ source: new VectorSource(), zIndex: z, updateWhileAnimating: true, updateWhileInteracting: true });
    L.current = { relief: new ImageLayer({ zIndex: 1 }), slope: new ImageLayer({ zIndex: 2, opacity: 0.85 }), heat: new ImageLayer({ zIndex: 3, opacity: 0.72 }), score: new ImageLayer({ zIndex: 4, opacity: 0 }), grid: vec(5), zone: vec(6), samples: vec(7), markers: vec(8) };
    const map = new OlMap({
      target: el.current,
      layers: Object.values(L.current),
      controls: [new ScaleLine({ units: "metric", bar: true, steps: 2, minWidth: 110 })],
      interactions: defaultInteractions({ altShiftDragRotate: false, pinchRotate: false }),
      view: new View({ projection, center: [0, 0], extent, constrainOnlyCenter: true, zoom: 2, maxZoom: 7, minZoom: 1, enableRotation: false }),
    });
    const fx0 = fieldExtent(site.field);
    map.getView().fit([fx0[0] - 110, fx0[1] - 110, fx0[2] + 110, fx0[3] + 110], { padding: [16, 16, 16, 16] });
    map.on("singleclick", (evt) => {
      const [x, y] = evt.coordinate;
      const f = site.field;
      if (!inField(f, { x, y })) {
        setState({ toast: "Outside the precomputed landing grid. Pick a point inside the dashed box." });
        return;
      }
      setState({ aim: { x, y }, aimKind: "custom", robust: { ...getState().robust, revealed: false } });
    });
    map.on("pointermove", (evt) => {
      const [x, y] = evt.coordinate;
      const hh = heightsRef.current;
      let h: number | null = null;
      if (hh) {
        const c = Math.round((x + site.terrain.half) / site.terrain.res);
        const r = Math.round((site.terrain.half - y) / site.terrain.res);
        if (c >= 0 && r >= 0 && c < hh.n && r < hh.n) h = hh.h[r * hh.n + c];
      }
      const inside = inField(site.field, { x, y });
      setCursor({ x, y, h, sun: inside ? bilinear(site.field.sun, site.field, x, y) : null });
    });
    map.getViewport().addEventListener("pointerleave", () => setCursor(null));
    const ro = new ResizeObserver(() => map.updateSize());
    ro.observe(el.current);
    mapRef.current = map;

    // static layers for this site
    const f = site.field;
    const fx = fieldExtent(f);
    L.current.heat.setSource(new Static({ url: gridToCanvas(f.sun).toDataURL(), imageExtent: fx, projection, interpolate: true }));
    const slopeImg = new Image();
    slopeImg.onload = () => {
      const c = document.createElement("canvas");
      c.width = slopeImg.width;
      c.height = slopeImg.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(slopeImg, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      for (let k = 0; k < d.data.length; k += 4) {
        const s = (d.data[k] / 255) * site.terrain.slope_max_deg;
        const a = Math.min(1, Math.max(0, (s - 5) / 20));
        d.data[k] = 213;
        d.data[k + 1] = 94;
        d.data[k + 2] = 0;
        d.data[k + 3] = a * 230;
      }
      ctx.putImageData(d, 0, 0);
      L.current.slope.setSource(new Static({ url: c.toDataURL(), imageExtent: extent, projection }));
    };
    slopeImg.src = site.terrain.slope_png;
    const gridSrc = (L.current.grid as VectorLayer<VectorSource>).getSource()!;
    const [a, b, c2, d2] = fx;
    const box = new Feature(new LineString([[a, b], [c2, b], [c2, d2], [a, d2], [a, b]]));
    box.setStyle(new Style({ stroke: new Stroke({ color: "rgba(255,255,255,0.55)", width: 1.2, lineDash: [6, 6] }) }));
    gridSrc.addFeature(box);
    decodeHeights(site.terrain.height_png, site.terrain.hmin, site.terrain.hmax).then((hh) => {
      heightsRef.current = hh;
      renderRelief();
    });
    return () => {
      ro.disconnect();
      map.setTarget(undefined);
      mapRef.current = null;
      heightsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id]);

  function renderRelief() {
    const hh = heightsRef.current;
    if (!hh) return;
    hillshade(hh.h, hh.n, site.terrain.res, sunAzBucketRef.current, 14, shadeCanvas.current);
    L.current.relief.setSource(new Static({ url: shadeCanvas.current.toDataURL(), imageExtent: extent, projection }));
  }
  const sunAzBucketRef = useRef(sunAzBucket);
  useEffect(() => {
    sunAzBucketRef.current = sunAzBucket;
    renderRelief();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sunAzBucket]);

  // ---- layer visibility
  useEffect(() => {
    L.current.relief?.setVisible(layers.relief);
    L.current.slope?.setVisible(layers.slope);
    L.current.heat?.setVisible(layers.heat);
    L.current.score?.setVisible(layers.heat);
    L.current.samples?.setVisible(layers.samples && unc.enabled);
    L.current.zone?.setVisible(layers.ellipse);
  }, [layers, unc.enabled, site.id]);

  // ---- robust score field + crossfade nominal → robust (§29)
  useEffect(() => {
    const res = robust.result;
    if (res) L.current.score.setSource(new Static({ url: gridToCanvas(res.score).toDataURL(), imageExtent: fieldExtent(site.field), projection, interpolate: true }));
    const target = heatMetric === "robust" && res ? 1 : 0;
    const layer = L.current.score;
    const start = performance.now();
    const from = layer.getOpacity() / 0.72;
    let raf = 0;
    const step = (tt: number) => {
      const k = Math.min(1, (tt - start) / 700);
      const v = from + (target - from) * k;
      layer.setOpacity(0.72 * v);
      L.current.heat.setOpacity(0.72 * (1 - v));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [robust.result, heatMetric, site.id, projection]);

  // ---- landing zone: animated ellipse growth (§29)
  useEffect(() => {
    const src = (L.current.zone as VectorLayer<VectorSource>)?.getSource();
    if (!src) return;
    const target = unc.enabled ? 1 : 0;
    const start = performance.now();
    const from = ellipseScale.current;
    let raf = 0;
    const draw = (sc: number) => {
      src.clear();
      if (sc <= 0.001) return;
      const outer = new Feature(new Polygon([ellipseRing(aim, model, sc)]));
      outer.setStyle(new Style({ fill: new Fill({ color: "rgba(95,155,255,0.07)" }), stroke: new Stroke({ color: css("--blue-300"), width: 2, lineDash: [8, 5] }) }));
      src.addFeature(outer);
    };
    const step = (tt: number) => {
      const k = Math.min(1, (tt - start) / 520);
      const e = 1 - Math.pow(1 - k, 3);
      ellipseScale.current = from + (target - from) * e;
      draw(ellipseScale.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [unc.enabled, aim, model, site.id]);

  // ---- touchdown samples
  useEffect(() => {
    const src = (L.current.samples as VectorLayer<VectorSource>)?.getSource();
    if (!src) return;
    src.clear();
    if (!unc.enabled) return;
    const feats = risk.samples.slice(0, 450).map((s) => {
      const f = new Feature(new Point([s.x, s.y]));
      const [r, g, b] = cividis(s.v / 100);
      f.setStyle(new Style({ image: new CircleStyle({ radius: 3.1, fill: new Fill({ color: `rgb(${r | 0},${g | 0},${b | 0})` }), stroke: new Stroke({ color: "rgba(7,9,12,0.85)", width: 0.9 }) }) }));
      return f;
    });
    src.addFeatures(feats);
  }, [risk.samples, unc.enabled, site.id]);

  // ---- markers (aim ●, brightest ▲, robust ★ gliding from the brightest point, known points ×)
  useEffect(() => {
    const src = (L.current.markers as VectorLayer<VectorSource>)?.getSource();
    if (!src) return;
    const f = site.field;
    let bi = 0;
    let bj = 0;
    for (let j = 0; j < f.ny; j++) for (let i = 0; i < f.nx; i++) if (f.sun[j][i] > f.sun[bj][bi]) { bi = i; bj = j; }
    const bright = { x: f.x0 + bi * f.dx, y: f.y0 + bj * f.dx };
    const draw = (rp: XY | null) => {
      src.clear();
      if (layers.known)
        for (const k of site.known_points ?? []) {
          const kf = new Feature(new Point(k.xy));
          kf.setStyle(markerStyle("known", null));
          src.addFeature(kf);
        }
      const bf = new Feature(new Point([bright.x, bright.y]));
      bf.setStyle(markerStyle("brightest", `${t.brightest} ${f.sun[bj][bi].toFixed(0)}%`));
      src.addFeature(bf);
      if (rp && robust.result) {
        const rf = new Feature(new Point([rp.x, rp.y]));
        rf.setStyle(markerStyle("robust", `${t.robustAim.replace("Penumbra ", "")} ${robust.result.robust.value.toFixed(0)}%`));
        src.addFeature(rf);
      }
      const af = new Feature(new Point([aim.x, aim.y]));
      af.setStyle(markerStyle("aim", null));
      src.addFeature(af);
    };
    const res = robust.result;
    if (!res) {
      robustPos.current = null;
      draw(null);
      return;
    }
    const target = { x: res.robust.x, y: res.robust.y };
    const from = robustPos.current ?? bright;
    const start = performance.now();
    let raf = 0;
    const step = (tt: number) => {
      const k = Math.min(1, (tt - start) / 900);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const p = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e };
      robustPos.current = p;
      draw(p);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [aim, robust.result, layers.known, site, t]);

  return (
    <div className="pn-map">
      <div ref={el} className="pn-map__canvas" role="application" aria-label={`Landing map, ${site.name}. Click inside the dashed box to set the commanded aim.`} />
      {!simple && <LayerList />}
      <div className="pn-map__tools" role="toolbar" aria-label="Map tools">
        <button className="pn-tool" onClick={() => mapRef.current?.getView().animate({ zoom: (mapRef.current.getView().getZoom() ?? 2) + 0.6, duration: 220 })} aria-label="Zoom in">+</button>
        <button className="pn-tool" onClick={() => mapRef.current?.getView().animate({ zoom: (mapRef.current.getView().getZoom() ?? 2) - 0.6, duration: 220 })} aria-label="Zoom out">−</button>
        <button className="pn-tool" title="Fit landing zone" onClick={() => { const fx = fieldExtent(site.field); mapRef.current?.getView().fit([fx[0] - 110, fx[1] - 110, fx[2] + 110, fx[3] + 110], { padding: [16, 16, 16, 16], duration: 350 }); }} aria-label="Fit landing zone">⤢</button>
      </div>
      <div className="pn-map__north" aria-hidden="true">
        <span>▲</span>grid N
      </div>
      <HeatLegend />
      <CursorReadout info={cursor} />
      {siteLoading && (
        <div className="pn-map__loading" role="status">
          <div className="pn-map__loading-card">
            <span className="ids-btn__spinner" />
            <div>
              <b>{site.name}</b>
              <p>{siteLoading}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
