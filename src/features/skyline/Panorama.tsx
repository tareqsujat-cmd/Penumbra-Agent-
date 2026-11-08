import { useMemo, useRef } from "react";
import { useApp } from "../../state/store";
import { useSite, useSkyline, useVisibility } from "../../hooks/useMission";
import { decodeEphem, skylineAt } from "../../utils/field";

/** 2-D panorama fallback: azimuth across, elevation up (stretched), skyline, Sun and Earth tracks. */
export function Panorama() {
  const site = useSite();
  const vis = useVisibility();
  const cursorIdx = useApp((s) => s.cursorIdx);
  const landingIdx = useApp((s) => s.landingIdx);
  const sky = useSkyline();
  const e = useMemo(() => decodeEphem(site), [site]);
  const ref = useRef<SVGSVGElement>(null);
  const W = 1000;
  const H = 420;
  const lo = -8;
  const hi = 8;
  const x = (az: number) => (az / 360) * W;
  const y = (el: number) => H - ((el - lo) / (hi - lo)) * H;
  const terrain = useMemo(() => {
    let p = `M0 ${H}`;
    for (let a = 0; a <= 360; a += 0.5) p += ` L${x(a).toFixed(1)} ${y(skylineAt(sky.deg, a)).toFixed(1)}`;
    return `${p} L${W} ${H} Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sky]);
  const track = (azA: Float32Array, elA: Float32Array) => {
    const segs: string[] = [];
    let cur = "";
    let prev = -1;
    for (let h = landingIdx; h < Math.min(landingIdx + vis.hours, e.n); h += 2) {
      const ax = x(azA[h]);
      if (prev >= 0 && Math.abs(ax - prev) > W / 2) {
        segs.push(cur);
        cur = "";
      }
      cur += `${cur ? " L" : "M"}${ax.toFixed(1)} ${y(elA[h]).toFixed(1)}`;
      prev = ax;
    }
    segs.push(cur);
    return segs;
  };
  const i = Math.min(cursorIdx, e.n - 1);
  return (
    <svg ref={ref} className="pn-pano" viewBox={`0 0 ${W} ${H + 26}`} preserveAspectRatio="none" role="img" aria-label="Panorama of the terrain horizon with Sun and Earth tracks">
      <defs>
        <clipPath id="pano-clip">
          <rect x={0} y={0} width={W} height={H} />
        </clipPath>
      </defs>
      {[-6, -4, -2, 0, 2, 4, 6].map((v) => (
        <g key={v}>
          <line x1={0} x2={W} y1={y(v)} y2={y(v)} className={v === 0 ? "pn-pano__zero" : "pn-pano__grid"} />
          <text x={4} y={y(v) - 3} className="pn-pano__lab">{v}°</text>
        </g>
      ))}
      <g clipPath="url(#pano-clip)">
        {track(e.sunAz, e.sunEl).map((d, k) => (
          <path key={`s${k}`} d={d} className="pn-pano__sun" />
        ))}
        {track(e.earthAz, e.earthEl).map((d, k) => (
          <path key={`e${k}`} d={d} className="pn-pano__earth" />
        ))}
      </g>
      <path d={terrain} className="pn-pano__terrain" />
      <circle cx={x(e.sunAz[i])} cy={y(e.sunEl[i])} r={9} className="pn-pano__sundot" />
      <circle cx={x(e.earthAz[i])} cy={y(e.earthEl[i])} r={8} className="pn-pano__earthdot" />
      {[0, 45, 90, 135, 180, 225, 270, 315, 360].map((a) => (
        <text key={a} x={x(a)} y={H + 18} textAnchor={a === 0 ? "start" : a === 360 ? "end" : "middle"} className="pn-pano__lab">
          {a % 90 === 0 ? `${"NESWN"[a / 90]} ${a}°` : `${a}°`}
        </text>
      ))}
    </svg>
  );
}
