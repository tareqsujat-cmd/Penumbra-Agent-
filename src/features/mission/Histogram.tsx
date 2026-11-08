import { cividisCss } from "../../utils/color";

/** Distribution of sunlight over simulated touchdowns, with nominal and lower-tail markers. */
export function Histogram({ bins, nominal, pq, q }: { bins: number[]; nominal: number; pq: number; q: number }) {
  const W = 300;
  const H = 74;
  const max = Math.max(1, ...bins);
  const bw = W / bins.length;
  const x = (v: number) => (v / 100) * W;
  return (
    <figure className="pn-hist">
      <svg viewBox={`0 0 ${W} ${H + 22}`} role="img" aria-label={`Touchdown outcomes: nominal ${nominal.toFixed(0)}%, P${q} ${pq.toFixed(0)}%`}>
        {bins.map((b, i) => (
          <rect key={i} x={i * bw + 0.8} y={H - (b / max) * (H - 6)} width={bw - 1.6} height={(b / max) * (H - 6)} rx="1.5" fill={cividisCss((i + 0.5) / bins.length)} opacity={b ? 0.95 : 0.15} />
        ))}
        <line x1={x(pq)} x2={x(pq)} y1="0" y2={H} className="pn-hist__pq" />
        <line x1={x(nominal)} x2={x(nominal)} y1="0" y2={H} className="pn-hist__nom" />
        <line x1="0" x2={W} y1={H} y2={H} className="pn-hist__axis" />
        {[0, 25, 50, 75, 100].map((v) => (
          <text key={v} x={x(v)} y={H + 14} textAnchor={v === 0 ? "start" : v === 100 ? "end" : "middle"} className="pn-hist__tick">
            {v}%
          </text>
        ))}
      </svg>
      <figcaption>
        <span className="pn-key pn-key--pq" />P{q} <span className="pn-key pn-key--nom" />
        nominal · 2,000 simulated touchdowns
      </figcaption>
    </figure>
  );
}
