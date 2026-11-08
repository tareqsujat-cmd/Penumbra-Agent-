import { useEffect, useMemo, useState } from "react";
import { scaleLinear } from "d3";
import { getState, setState, useApp } from "../../state/store";
import { useVisibility } from "../../hooks/useMission";
import { HOURS_2027 } from "../../utils/field";
import { cividisCss } from "../../utils/color";
import { fmtDate, MONTHS } from "../../utils/format";
import { Seg, Tip } from "../../components/ui";

type Run = { a: number; b: number; v: number };

/** Merge consecutive equal values into runs so each row is a handful of rects. */
function runs(arr: ArrayLike<number>, quant = (v: number) => v): Run[] {
  const out: Run[] = [];
  let a = 0;
  let cur = quant(arr[0]);
  for (let i = 1; i <= arr.length; i++) {
    const v = i < arr.length ? quant(arr[i]) : NaN;
    if (v !== cur) {
      out.push({ a, b: i, v: cur });
      a = i;
      cur = v;
    }
  }
  return out;
}

const ROW_H = 16;
const LABEL_W = 64;

export function Calendar() {
  const vis = useVisibility();
  const landingIdx = useApp((s) => s.landingIdx);
  const cursorIdx = useApp((s) => s.cursorIdx);
  const windowDays = useApp((s) => s.windowDays);
  const playing = useApp((s) => s.playing);
  const speed = useApp((s) => s.playSpeed);
  const [width, wrap] = useWidth();
  const plotW = Math.max(200, width - LABEL_W - 8);
  const daily = vis.dailySun;
  const xYear = scaleLinear().domain([0, 365]).range([0, plotW]);
  const xWin = scaleLinear().domain([0, vis.hours]).range([0, plotW]);

  // play: advance the cursor through the window
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const s = getState();
      const end = s.landingIdx + s.windowDays * 24 - 1;
      setState({ cursorIdx: s.cursorIdx + s.playSpeed > end ? s.landingIdx : s.cursorIdx + s.playSpeed });
    }, 90);
    return () => clearInterval(id);
  }, [playing, speed]);

  const sunRuns = useMemo(() => runs(vis.sunFrac, (v) => (v >= 0.999 ? 2 : v > 0.001 ? 1 : 0)), [vis]);
  const blockedRuns = useMemo(() => runs(vis.terrainBlocked).filter((r) => r.v === 1), [vis]);
  const earthRuns = useMemo(() => runs(vis.earth).filter((r) => r.v === 1), [vis]);
  const dsnRuns = useMemo(() => runs(vis.dsn).filter((r) => r.v === 1), [vis]);
  const socRuns = useMemo(() => runs(vis.soc, (v) => Math.round(v * 10) / 10), [vis]);
  const hibRuns = useMemo(() => runs(vis.hibernating).filter((r) => r.v === 1), [vis]);

  const setLanding = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect();
    const day = Math.round(xYear.invert(clientX - r.left - LABEL_W));
    const idx = Math.min(Math.max(day, 0), 365 - windowDays) * 24 + 13;
    setState((s) => ({ landingIdx: idx, cursorIdx: idx + Math.min(s.cursorIdx - s.landingIdx, windowDays * 24 - 1) }));
  };
  const setCursor = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect();
    const k = Math.round(xWin.invert(clientX - r.left - LABEL_W));
    setState({ cursorIdx: landingIdx + Math.min(Math.max(k, 0), vis.hours - 1) });
  };
  const drag = (fn: (x: number, el: SVGSVGElement) => void) => ({
    onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => {
      (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
      fn(e.clientX, e.currentTarget);
    },
    onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.buttons) fn(e.clientX, e.currentTarget);
    },
  });
  const k = Math.min(Math.max(cursorIdx - landingIdx, 0), vis.hours - 1);
  const winStart = landingIdx / 24;
  const monthStarts = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const rows = [
    { key: "SUN", tip: "Bright: whole solar disc above the skyline. Mid: partly blocked. Hatched: Sun above the smooth horizon but blocked by terrain. Dark: night." },
    { key: "EARTH", tip: "Earth above the terrain skyline by at least the chosen safety margin." },
    { key: "DSN", tip: "Earth visible from the site AND the Moon above the mask at Goldstone, Madrid or Canberra (station positions and topocentric frames from NAIF SPICE kernels). Geometric visibility does not guarantee scheduled DSN service." },
    { key: "POWER", tip: "Battery state of charge for the selected vehicle scenario (hourly energy balance). Hatched: low-power hibernation. Red mark: battery depleted." },
  ];

  if (!vis.hours)
    return (
      <div className="pn-cal pn-cal--loading" ref={wrap} aria-busy="true">
        <p className="pn-insp__empty">{vis.error ? `Visibility unavailable: ${vis.error.message}` : "Computing hourly Sun, Earth, DSN and power at the aim…"}</p>
      </div>
    );
  return (
    <section className="pn-cal" aria-label="Mission calendar">
      <div className="pn-cal__bar">
        <div className="pn-cal__date">
          <span className="ids-overline">Landing</span>
          <b className="ids-num">{fmtDate(landingIdx)}</b>
          <div className="pn-cal__steps">
            <button className="pn-tool pn-tool--sm" aria-label="Landing one day earlier" onClick={() => shiftLanding(-24)}>‹</button>
            <button className="pn-tool pn-tool--sm" aria-label="Landing one day later" onClick={() => shiftLanding(24)}>›</button>
          </div>
        </div>
        <div className="pn-cal__date">
          <span className="ids-overline">Cursor</span>
          <b className="ids-num">{fmtDate(cursorIdx)}</b>
          <span className="pn-cal__rel ids-num">L + {((cursorIdx - landingIdx) / 24).toFixed(1)} d</span>
        </div>
        <div className="pn-cal__ctrls">
          <button className="ids-btn pn-play" onClick={() => setState({ playing: !playing })} aria-pressed={playing}>
            {playing ? "❚❚ Pause" : "▶ Play"}
          </button>
          <Seg label="Playback speed" size="sm" value={String(speed)} onChange={(v) => setState({ playSpeed: Number(v) as 1 | 6 | 24 })} options={[{ value: "1", label: "1 h" }, { value: "6", label: "6 h" }, { value: "24", label: "1 d" }]} />
          <Seg
            label="Mission horizon"
            size="sm"
            value={String(windowDays)}
            onChange={(v) => {
              const w = Number(v) as 14 | 30 | 90;
              setState((s) => ({ windowDays: w, landingIdx: Math.min(s.landingIdx, (365 - w) * 24 + 13), cursorIdx: Math.min(s.cursorIdx, s.landingIdx + w * 24 - 1) }));
            }}
            options={[{ value: "14", label: "14 d" }, { value: "30", label: "30 d" }, { value: "90", label: "90 d" }]}
          />
        </div>
      </div>
      <div ref={wrap} className="pn-cal__plot">
        <svg width={width} height={34} className="pn-cal__year" {...drag(setLanding)} role="slider" aria-label="Landing date in 2027" aria-valuemin={0} aria-valuemax={364} aria-valuenow={Math.round(winStart)} tabIndex={0} onKeyDown={(e) => { if (e.key === "ArrowRight") shiftLanding(24); if (e.key === "ArrowLeft") shiftLanding(-24); }}>
          <text x={0} y={14} className="pn-cal__label">2027</text>
          <g transform={`translate(${LABEL_W},0)`}>
            {Array.from(daily).map((v, d) => (
              <rect key={d} x={xYear(d)} y={4} width={Math.max(1, xYear(1) - xYear(0)) + 0.4} height={14} fill={cividisCss(v / 100)} />
            ))}
            <rect x={xYear(winStart)} y={1} width={xYear(windowDays) - xYear(0)} height={20} className="pn-cal__window" rx="2" />
            <line x1={xYear(winStart)} x2={xYear(winStart)} y1={0} y2={22} className="pn-cal__handle" />
            {monthStarts.map((m, i) => (
              <text key={m} x={xYear(m) + 2} y={31} className="pn-cal__tick">{MONTHS[i]}</text>
            ))}
          </g>
        </svg>
        <svg width={width} height={rows.length * (ROW_H + 8) + 20} className="pn-cal__rows" {...drag(setCursor)} role="slider" aria-label="Time cursor within the mission window" aria-valuemin={0} aria-valuemax={vis.hours - 1} aria-valuenow={k} tabIndex={0} onKeyDown={(e) => { if (e.key === "ArrowRight") shiftCursor(e.shiftKey ? 24 : 1); if (e.key === "ArrowLeft") shiftCursor(e.shiftKey ? -24 : -1); }}>
          <defs>
            <pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="5" height="5" className="pn-hatch-bg" />
              <line x1="0" y1="0" x2="0" y2="5" className="pn-hatch-line" />
            </pattern>
          </defs>
          {rows.map((r, i) => (
            <text key={r.key} x={0} y={i * (ROW_H + 8) + ROW_H - 3} className="pn-cal__label">{r.key}</text>
          ))}
          <g transform={`translate(${LABEL_W},0)`}>
            {rows.map((_, i) => (
              <rect key={i} x={0} y={i * (ROW_H + 8)} width={plotW} height={ROW_H} rx="2" className="pn-cal__track" />
            ))}
            {sunRuns.filter((r) => r.v > 0).map((r) => (
              <rect key={`s${r.a}`} x={xWin(r.a)} y={0} width={xWin(r.b) - xWin(r.a)} height={ROW_H} className={r.v === 2 ? "pn-band--sun" : "pn-band--sunpart"} />
            ))}
            {blockedRuns.map((r) => (
              <rect key={`b${r.a}`} x={xWin(r.a)} y={0} width={xWin(r.b) - xWin(r.a)} height={ROW_H} fill="url(#hatch)" />
            ))}
            {earthRuns.map((r) => (
              <rect key={`e${r.a}`} x={xWin(r.a)} y={ROW_H + 8} width={xWin(r.b) - xWin(r.a)} height={ROW_H} className="pn-band--earth" />
            ))}
            {dsnRuns.map((r) => (
              <rect key={`d${r.a}`} x={xWin(r.a)} y={2 * (ROW_H + 8)} width={xWin(r.b) - xWin(r.a)} height={ROW_H} className="pn-band--dsn" />
            ))}
            {socRuns.map((r) => (
              <rect key={`p${r.a}`} x={xWin(r.a)} y={3 * (ROW_H + 8)} width={xWin(r.b) - xWin(r.a)} height={ROW_H} fill={cividisCss(r.v)} />
            ))}
            {hibRuns.map((r) => (
              <rect key={`h${r.a}`} x={xWin(r.a)} y={3 * (ROW_H + 8)} width={xWin(r.b) - xWin(r.a)} height={ROW_H} fill="url(#hatch)" opacity="0.8" />
            ))}
            {vis.depletedAt !== null && <rect x={xWin(vis.depletedAt) - 1.5} y={3 * (ROW_H + 8) - 3} width={3} height={ROW_H + 6} className="pn-band--dead" />}
            {Array.from({ length: Math.floor(vis.hours / 24) + 1 }, (_, d) => d)
              .filter((d) => d % (windowDays > 30 ? 10 : windowDays > 14 ? 5 : 2) === 0)
              .map((d) => (
                <text key={d} x={xWin(d * 24)} y={rows.length * (ROW_H + 8) + 12} className="pn-cal__tick" textAnchor={d === 0 ? "start" : "middle"}>
                  L+{d}d
                </text>
              ))}
            <line x1={xWin(k)} x2={xWin(k)} y1={-2} y2={rows.length * (ROW_H + 8) - 4} className="pn-cal__cursor" />
            <circle cx={xWin(k)} cy={-2} r={4} className="pn-cal__cursor-knob" />
          </g>
        </svg>
        <div className="pn-cal__tips">
          {rows.map((r) => (
            <Tip key={r.key} title={r.key} text={r.tip} />
          ))}
        </div>
      </div>
    </section>
  );
}

function shiftLanding(dh: number) {
  setState((s) => {
    const idx = Math.min(Math.max(s.landingIdx + dh, 13), (365 - s.windowDays) * 24 + 13);
    return { landingIdx: idx, cursorIdx: Math.min(Math.max(s.cursorIdx + dh, idx), idx + s.windowDays * 24 - 1) };
  });
}

function shiftCursor(dh: number) {
  setState((s) => ({ cursorIdx: Math.min(Math.max(s.cursorIdx + dh, s.landingIdx), Math.min(HOURS_2027 - 1, s.landingIdx + s.windowDays * 24 - 1)) }));
}

/** Width of whichever element currently holds the returned callback ref (re-attaches when that element changes,
 *  e.g. from the loading placeholder to the plot). */
function useWidth(): [number, (el: HTMLDivElement | null) => void] {
  const [w, setW] = useState(800);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!el) return;
    setW(Math.floor(el.getBoundingClientRect().width) || 800);
    const ro = new ResizeObserver((e) => {
      const cw = Math.floor(e[0].contentRect.width);
      if (cw > 0) setW(cw);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [w, setEl];
}

