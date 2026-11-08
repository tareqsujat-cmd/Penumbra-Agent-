import { useMemo } from "react";
import { setState, useApp } from "../../state/store";
import { useVisibility } from "../../hooks/useMission";
import { cividisCss } from "../../utils/color";

type Run = { a: number; b: number; v: number };

function runs(arr: ArrayLike<number>, quant: (v: number) => number): Run[] {
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

/** Compact Sun / Earth / DSN / battery bands for the mission window; click to move the time cursor. */
export function MiniTimeline() {
  const vis = useVisibility();
  const landingIdx = useApp((s) => s.landingIdx);
  const cursorIdx = useApp((s) => s.cursorIdx);
  const W = 320;
  const rowH = 11;
  const gap = 5;
  const x = (k: number) => (k / vis.hours) * W;
  const rows = useMemo(
    () => ({
      sun: runs(vis.sunFrac, (v) => (v >= 0.999 ? 2 : v > 0.001 ? 1 : 0)).filter((r) => r.v > 0),
      earth: runs(vis.earth, (v) => v).filter((r) => r.v === 1),
      dsn: runs(vis.dsn, (v) => v).filter((r) => r.v === 1),
      soc: runs(vis.soc, (v) => Math.round(v * 10) / 10),
    }),
    [vis],
  );
  const k = Math.min(Math.max(cursorIdx - landingIdx, 0), vis.hours - 1);
  const labels = ["Sun", "Earth", "DSN", "Battery"];
  if (!vis.hours)
    return (
      <figure className="pn-mini pn-mini--loading" aria-busy="true">
        <figcaption>{vis.error ? `Visibility unavailable: ${vis.error.message}` : "Computing hourly Sun, Earth, DSN and power at the aim…"}</figcaption>
      </figure>
    );
  return (
    <figure className="pn-mini">
      <div className="pn-mini__labels">
        {labels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${4 * (rowH + gap)}`}
        preserveAspectRatio="none"
        role="slider"
        aria-label="Time in the mission window"
        aria-valuemin={0}
        aria-valuemax={vis.hours - 1}
        aria-valuenow={k}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setState({ cursorIdx: landingIdx + Math.round(((e.clientX - r.left) / r.width) * (vis.hours - 1)) });
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={0} y={i * (rowH + gap)} width={W} height={rowH} rx={2} className="pn-cal__track" />
        ))}
        {rows.sun.map((r) => <rect key={`s${r.a}`} x={x(r.a)} y={0} width={x(r.b) - x(r.a)} height={rowH} className={r.v === 2 ? "pn-band--sun" : "pn-band--sunpart"} />)}
        {rows.earth.map((r) => <rect key={`e${r.a}`} x={x(r.a)} y={rowH + gap} width={x(r.b) - x(r.a)} height={rowH} className="pn-band--earth" />)}
        {rows.dsn.map((r) => <rect key={`d${r.a}`} x={x(r.a)} y={2 * (rowH + gap)} width={x(r.b) - x(r.a)} height={rowH} className="pn-band--dsn" />)}
        {rows.soc.map((r) => <rect key={`p${r.a}`} x={x(r.a)} y={3 * (rowH + gap)} width={x(r.b) - x(r.a)} height={rowH} fill={cividisCss(r.v)} />)}
        <line x1={x(k)} x2={x(k)} y1={0} y2={4 * (rowH + gap)} className="pn-cal__cursor" />
      </svg>
      <figcaption>
        <span>Landing</span>
        <span>+{Math.round(vis.hours / 48)} d</span>
        <span>+{Math.round(vis.hours / 24)} d</span>
      </figcaption>
    </figure>
  );
}
