/** Report charts: small, hand-built SVG charts in the site's visual language (hairline axes, Space Mono ticks).
 *  They only draw what the engine computed; no values are invented here. */
import { useMemo } from "react";
import { scaleLinear } from "d3";
import type { Ephemeris, Field } from "../../types";
import { gridToCanvas } from "../../utils/color";

const SUN = "var(--solar)";
const EARTH = "#56b4e9";
const TEAL = "#2fd1a0";
const ION = "#8fc7ff";
const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

function Grid({ x, y, w, h, xs, ys, fmtX, fmtY }: { x: (v: number) => number; y: (v: number) => number; w: number; h: number; xs: number[]; ys: number[]; fmtX: (v: number) => string; fmtY: (v: number) => string }) {
  return (
    <g className="pn-ch__grid">
      {ys.map((v) => (
        <g key={`y${v}`}>
          <line x1={0} x2={w} y1={y(v)} y2={y(v)} />
          <text x={-8} y={y(v) + 4} textAnchor="end">
            {fmtY(v)}
          </text>
        </g>
      ))}
      {xs.map((v, i) => (
        <text key={`x${i}`} x={x(v)} y={h + 18} textAnchor="middle">
          {fmtX(v)}
        </text>
      ))}
    </g>
  );
}

/** Daily range of Sun and Earth elevation over a year at the site centre (smooth Moon, no terrain). */
export function ElevationChart({ e }: { e: Ephemeris }) {
  const W = 760;
  const H = 230;
  const m = { l: 44, r: 12, t: 12, b: 28 };
  const w = W - m.l - m.r;
  const h = H - m.t - m.b;
  const days = Math.floor(e.n / 24);
  const d = useMemo(() => {
    const out = { sunLo: [] as number[], sunHi: [] as number[], eLo: [] as number[], eHi: [] as number[] };
    for (let k = 0; k < days; k++) {
      let a = 99, b = -99, c = 99, dd = -99;
      for (let i = k * 24; i < k * 24 + 24; i++) {
        a = Math.min(a, e.sunEl[i]);
        b = Math.max(b, e.sunEl[i]);
        c = Math.min(c, e.earthEl[i]);
        dd = Math.max(dd, e.earthEl[i]);
      }
      out.sunLo.push(a);
      out.sunHi.push(b);
      out.eLo.push(c);
      out.eHi.push(dd);
    }
    return out;
  }, [e, days]);
  const lim = Math.ceil(Math.max(...d.eHi.map(Math.abs), ...d.eLo.map(Math.abs), ...d.sunHi.map(Math.abs), 3));
  const x = scaleLinear().domain([0, days]).range([0, w]);
  const y = scaleLinear().domain([-lim, lim]).range([h, 0]);
  const band = (lo: number[], hi: number[]) =>
    `M${hi.map((v, k) => `${x(k)},${y(v)}`).join("L")}L${lo
      .map((v, k) => `${x(k)},${y(v)}`)
      .reverse()
      .join("L")}Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pn-ch" role="img" aria-label="Daily range of Sun and Earth elevation through the year">
      <g transform={`translate(${m.l},${m.t})`}>
        <Grid x={x} y={y} w={w} h={h} xs={MONTH_START} ys={[-lim, -lim / 2, 0, lim / 2, lim]} fmtX={(v) => MONTHS[MONTH_START.indexOf(v)]} fmtY={(v) => `${v.toFixed(0)}°`} />
        <rect x={0} y={y(0)} width={w} height={h - y(0)} className="pn-ch__below" />
        <path d={band(d.eLo, d.eHi)} fill={EARTH} fillOpacity={0.22} stroke={EARTH} strokeOpacity={0.6} strokeWidth={0.8} />
        <path d={band(d.sunLo, d.sunHi)} fill="rgba(255,196,119,0.32)" stroke={SUN} strokeWidth={1} />
        <line x1={0} x2={w} y1={y(0)} y2={y(0)} className="pn-ch__zero" />
        <text x={w - 4} y={y(0) - 6} textAnchor="end" className="pn-ch__note">
          level horizon
        </text>
      </g>
    </svg>
  );
}

/** Smooth Moon vs real terrain, Sun and Earth, for several sites (grouped horizontal bars). */
export function TerrainBars({ rows }: { rows: { name: string; smoothSun: number; terrainSun: number; smoothEarth: number; terrainEarth: number }[] }) {
  const W = 760;
  const rowH = 46;
  const m = { l: 190, r: 46, t: 20, b: 24 };
  const H = m.t + m.b + rows.length * rowH;
  const w = W - m.l - m.r;
  const x = scaleLinear().domain([0, 100]).range([0, w]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pn-ch" role="img" aria-label="Sunlight and Earth visibility: smooth Moon versus real terrain">
      <g transform={`translate(${m.l},${m.t})`}>
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v} className="pn-ch__grid">
            <line x1={x(v)} x2={x(v)} y1={-6} y2={rows.length * rowH} />
            <text x={x(v)} y={rows.length * rowH + 16} textAnchor="middle">
              {v}%
            </text>
          </g>
        ))}
        {rows.map((r, i) => (
          <g key={r.name} transform={`translate(0,${i * rowH})`}>
            <text x={-12} y={20} textAnchor="end" className="pn-ch__label">
              {r.name}
            </text>
            <rect x={0} y={4} width={x(r.smoothSun)} height={8} className="pn-ch__ghost" />
            <rect x={0} y={4} width={x(r.terrainSun)} height={8} fill={SUN} />
            <rect x={0} y={18} width={x(r.smoothEarth)} height={8} className="pn-ch__ghost" />
            <rect x={0} y={18} width={x(r.terrainEarth)} height={8} fill={EARTH} />
            <text x={Math.max(x(r.terrainSun), x(r.smoothSun)) + 6} y={12} className="pn-ch__val">
              {r.terrainSun.toFixed(0)}%
            </text>
            <text x={Math.max(x(r.terrainEarth), x(r.smoothEarth)) + 6} y={26} className="pn-ch__val">
              {r.terrainEarth.toFixed(0)}%
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

/** The terrain skyline seen from a point, with every hourly Sun position of the year. */
export function SkylineChart({ deg, e }: { deg: number[]; e: Ephemeris }) {
  const W = 760;
  const H = 240;
  const m = { l: 44, r: 12, t: 14, b: 28 };
  const w = W - m.l - m.r;
  const h = H - m.t - m.b;
  const top = Math.max(4, Math.ceil(Math.max(...deg, ...Array.from(e.sunEl)) + 0.5));
  const bot = Math.floor(Math.min(...deg, -1.5) - 0.5);
  const x = scaleLinear().domain([0, 360]).range([0, w]);
  const y = scaleLinear().domain([bot, top]).range([h, 0]);
  const sky = `M0,${h}L${deg.map((v, k) => `${x(k * (360 / deg.length))},${y(v)}`).join("L")}L${w},${y(deg[0])}L${w},${h}Z`;
  const dots = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < e.n; i += 3) out.push(`M${x(e.sunAz[i])},${y(e.sunEl[i])}h0.01`);
    return out.join("");
  }, [e, x, y]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pn-ch" role="img" aria-label="Terrain skyline with the Sun's positions through the year">
      <g transform={`translate(${m.l},${m.t})`}>
        <Grid x={x} y={y} w={w} h={h} xs={[0, 90, 180, 270, 360]} ys={[bot, 0, top]} fmtX={(v) => ["N", "E", "S", "W", "N"][v / 90]} fmtY={(v) => `${v}°`} />
        <path d={dots} stroke={SUN} strokeOpacity={0.55} strokeWidth={2.2} strokeLinecap="round" />
        <path d={sky} className="pn-ch__terrain" />
        <line x1={0} x2={w} y1={y(0)} y2={y(0)} className="pn-ch__zero" />
      </g>
    </svg>
  );
}

/** Energy endurance estimate by landing date for several sites. */
export function EnduranceChart({ series, cap }: { series: { name: string; color: string; pts: { day: number; days: number | null }[] }[]; cap: number }) {
  const W = 760;
  const H = 250;
  const m = { l: 44, r: 16, t: 14, b: 28 };
  const w = W - m.l - m.r;
  const h = H - m.t - m.b;
  const x = scaleLinear().domain([0, 365]).range([0, w]);
  const top = Math.max(5, Math.ceil(Math.max(...series.flatMap((s) => s.pts.map((p) => Math.min(cap, p.days ?? cap)))) / 5) * 5);
  const y = scaleLinear().domain([0, top]).range([h, 0]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pn-ch" role="img" aria-label="Energy endurance estimate by landing date">
      <g transform={`translate(${m.l},${m.t})`}>
        <Grid x={x} y={y} w={w} h={h} xs={MONTH_START} ys={[0, top / 3, (2 * top) / 3, top]} fmtX={(v) => MONTHS[MONTH_START.indexOf(v)]} fmtY={(v) => `${v.toFixed(0)} d`} />
        {series.map((s, i) => (
          <g key={s.name} transform={`translate(${w - 230},${8 + i * 18})`}>
            <line x1={0} x2={18} y1={0} y2={0} stroke={s.color} strokeWidth={2} />
            <text x={26} y={4} className="pn-ch__label">
              {s.name}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <g key={s.name}>
            <path
              d={`M${s.pts.map((p) => `${x(p.day)},${y(Math.min(cap, p.days ?? cap))}`).join("L")}`}
              fill="none"
              stroke={s.color}
              strokeWidth={1.6}
              strokeLinejoin="round"
            />
          </g>
        ))}
      </g>
    </svg>
  );
}

/** Spread of sunlight across simulated touchdowns: nominal (aim) and the P50 / P10 / P05 outcomes. */
export function RangeChart({ rows }: { rows: { label: string; nominal: number; p50: number; p10: number; p05: number }[] }) {
  const W = 760;
  const rowH = 44;
  const m = { l: 230, r: 30, t: 22, b: 26 };
  const H = m.t + m.b + rows.length * rowH;
  const w = W - m.l - m.r;
  const x = scaleLinear().domain([0, 100]).range([0, w]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pn-ch" role="img" aria-label="Sunlight at the aim versus across possible touchdowns">
      <g transform={`translate(${m.l},${m.t})`}>
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v} className="pn-ch__grid">
            <line x1={x(v)} x2={x(v)} y1={-8} y2={rows.length * rowH} />
            <text x={x(v)} y={rows.length * rowH + 16} textAnchor="middle">
              {v}%
            </text>
          </g>
        ))}
        {rows.map((r, i) => (
          <g key={r.label} transform={`translate(0,${i * rowH + 14})`}>
            <text x={-12} y={4} textAnchor="end" className="pn-ch__label">
              {r.label}
            </text>
            <line x1={x(r.p05)} x2={x(r.nominal)} y1={0} y2={0} stroke="rgba(150,180,255,0.35)" strokeWidth={6} strokeLinecap="round" />
            <circle cx={x(r.p05)} cy={0} r={4} fill="#ef5b52" />
            <circle cx={x(r.p10)} cy={0} r={4.5} fill={SUN} />
            <circle cx={x(r.p50)} cy={0} r={4} fill={ION} />
            <path d={`M${x(r.nominal)},-7l5,9h-10z`} fill="#fff" />
            <text x={x(r.p10)} y={-10} textAnchor="middle" className="pn-ch__val">
              {r.p10.toFixed(0)}
            </text>
            <text x={x(r.nominal) + 8} y={4} className="pn-ch__val">
              {r.nominal.toFixed(0)}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

/** Computed sunlight field around a site, with the brightest point and the robust aim. */
export function FieldMap({ field, bright, robust, radius }: { field: Field; bright: { x: number; y: number }; robust: { x: number; y: number }; radius: number }) {
  const S = 420;
  const url = useMemo(() => gridToCanvas(field.sun).toDataURL(), [field]);
  const ext = { x0: field.x0, x1: field.x0 + (field.nx - 1) * field.dx, y0: field.y0, y1: field.y0 + (field.ny - 1) * field.dx };
  const px = (v: number) => ((v - ext.x0) / (ext.x1 - ext.x0)) * S;
  const py = (v: number) => S - ((v - ext.y0) / (ext.y1 - ext.y0)) * S;
  const r = (radius / (ext.x1 - ext.x0)) * S;
  return (
    <svg viewBox={`-10 -10 ${S + 20} ${S + 40}`} className="pn-ch pn-ch--map" role="img" aria-label="Sunlight map with the brightest point and the robust aim">
      <image href={url} x={0} y={0} width={S} height={S} preserveAspectRatio="none" style={{ imageRendering: "auto" }} />
      <rect x={0} y={0} width={S} height={S} fill="none" stroke="rgba(170,205,255,0.35)" />
      <circle cx={px(bright.x)} cy={py(bright.y)} r={r} fill="none" stroke="#fff" strokeDasharray="4 4" strokeOpacity={0.8} />
      <circle cx={px(robust.x)} cy={py(robust.y)} r={r} fill="none" stroke={TEAL} strokeDasharray="4 4" />
      <path d={`M${px(bright.x)},${py(bright.y) - 8}l7,12h-14z`} fill="var(--solar)" stroke="#000" strokeWidth={1} />
      <path
        d={`M${px(robust.x)},${py(robust.y) - 9}l2.6,5.4 5.9,.8-4.3,4.1 1,5.9-5.2-2.8-5.2,2.8 1-5.9-4.3-4.1 5.9-.8z`}
        fill={TEAL}
        stroke="#000"
        strokeWidth={0.8}
      />
      <line x1={S - 110} x2={S - 110 + (200 / (ext.x1 - ext.x0)) * S} y1={S + 18} y2={S + 18} stroke="#fff" />
      <text x={S - 110} y={S + 32} className="pn-ch__note">
        200 m
      </text>
      <text x={0} y={S + 32} className="pn-ch__note">
        grid north ↑ · {field.dx} m grid
      </text>
    </svg>
  );
}

/** Our values against an independent reference (scatter on the 1:1 line). */
export function ScatterChart({ points }: { points: { name: string; ref: number; ours: number; kind: "sun" | "earth" }[] }) {
  const S = 300;
  const P = 36;
  const s = scaleLinear().domain([0, 100]).range([P, S - 10]);
  const y = scaleLinear().domain([0, 100]).range([S - P, 10]);
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="pn-ch pn-ch--square" role="img" aria-label="Penumbra versus NASA PGDA 69">
      {[0, 25, 50, 75, 100].map((t) => (
        <g key={t} className="pn-ch__grid">
          <line x1={s(t)} x2={s(t)} y1={y(0)} y2={y(100)} />
          <line x1={s(0)} x2={s(100)} y1={y(t)} y2={y(t)} />
          <text x={s(t)} y={S - P + 16} textAnchor="middle">
            {t}
          </text>
          <text x={P - 6} y={y(t) + 4} textAnchor="end">
            {t}
          </text>
        </g>
      ))}
      <line x1={s(0)} y1={y(0)} x2={s(100)} y2={y(100)} className="pn-ch__zero" strokeDasharray="3 3" />
      {points.map((p, i) =>
        p.kind === "sun" ? (
          <circle key={i} cx={s(p.ref)} cy={y(p.ours)} r={4.2} fill={SUN}>
            <title>{`${p.name}: reference ${p.ref}%, Penumbra ${p.ours}%`}</title>
          </circle>
        ) : (
          <rect key={i} x={s(p.ref) - 3.6} y={y(p.ours) - 3.6} width={7.2} height={7.2} fill={EARTH}>
            <title>{`${p.name}: reference ${p.ref}%, Penumbra ${p.ours}%`}</title>
          </rect>
        ),
      )}
    </svg>
  );
}

/** Published value vs ours for named points (dumbbells). */
export function DumbbellChart({ rows }: { rows: { label: string; published: number; ours: number }[] }) {
  const W = 760;
  const rowH = 30;
  const m = { l: 250, r: 40, t: 14, b: 26 };
  const H = m.t + m.b + rows.length * rowH;
  const w = W - m.l - m.r;
  const lo = Math.floor(Math.min(...rows.flatMap((r) => [r.published, r.ours])) / 10) * 10;
  const x = scaleLinear().domain([lo, 100]).range([0, w]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pn-ch" role="img" aria-label="Published illumination versus Penumbra">
      <g transform={`translate(${m.l},${m.t})`}>
        {Array.from({ length: (100 - lo) / 10 + 1 }, (_, k) => lo + k * 10).map((v) => (
          <g key={v} className="pn-ch__grid">
            <line x1={x(v)} x2={x(v)} y1={-6} y2={rows.length * rowH} />
            <text x={x(v)} y={rows.length * rowH + 16} textAnchor="middle">
              {v}%
            </text>
          </g>
        ))}
        {rows.map((r, i) => (
          <g key={r.label} transform={`translate(0,${i * rowH + 12})`}>
            <text x={-12} y={4} textAnchor="end" className="pn-ch__label">
              {r.label}
            </text>
            <line x1={x(r.published)} x2={x(r.ours)} y1={0} y2={0} stroke="rgba(150,180,255,0.4)" strokeWidth={2} />
            <circle cx={x(r.published)} cy={0} r={5} fill="none" stroke="#fff" strokeWidth={1.5} />
            <circle cx={x(r.ours)} cy={0} r={4.5} fill={TEAL} />
            <text x={Math.max(x(r.ours), x(r.published)) + 10} y={4} className="pn-ch__val">
              {(r.ours - r.published > 0 ? "+" : "") + (r.ours - r.published).toFixed(1)}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
