/** Schematic diagrams for the report (not to scale; each caption says so). */

/** Why the pole is hard: a Sun that skims the horizon, and a ridge that decides who is lit. */
export function GrazingSunDiagram() {
  return (
    <svg viewBox="0 0 760 230" className="pn-dg" role="img" aria-label="Schematic: the Sun grazing the horizon at the lunar south pole">
      <defs>
        <linearGradient id="dg-ground" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#2a3448" />
          <stop offset="1" stopColor="#0a0f1a" />
        </linearGradient>
        <radialGradient id="dg-sun">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.35" stopColor="#ffe1ad" />
          <stop offset="1" stopColor="rgba(255,196,119,0)" />
        </radialGradient>
        <linearGradient id="dg-ray" x1="0" x2="1">
          <stop offset="0" stopColor="rgba(255,214,150,0.55)" />
          <stop offset="1" stopColor="rgba(255,214,150,0)" />
        </linearGradient>
      </defs>
      <circle cx="712" cy="146" r="30" fill="url(#dg-sun)" />
      <circle cx="712" cy="146" r="7" fill="#fff" />
      <polygon points="712,140 140,166 140,176 712,152" fill="url(#dg-ray)" opacity="0.7" />
      <path d="M0,190 C120,186 200,170 260,150 C300,138 330,118 360,120 C390,122 420,160 470,178 C560,196 660,192 760,190 L760,230 L0,230 Z" fill="url(#dg-ground)" stroke="rgba(170,205,255,0.35)" />
      <path d="M360,120 L120,197" stroke="rgba(0,0,0,0.0)" />
      <polygon points="360,120 470,178 80,194 140,186" fill="rgba(0,0,0,0.45)" />
      <line x1="0" x2="760" y1="146" y2="146" stroke="rgba(143,199,255,0.4)" strokeDasharray="5 5" />
      <text x="16" y="138" className="pn-dg__t">level horizon</text>
      <g>
        <line x1="560" y1="183" x2="560" y2="168" stroke="#fff" />
        <rect x="552" y="160" width="16" height="9" fill="#cfd8e6" />
        <text x="574" y="166" className="pn-dg__t">lit lander</text>
      </g>
      <g>
        <line x1="200" y1="177" x2="200" y2="162" stroke="#fff" />
        <rect x="192" y="154" width="16" height="9" fill="#5a6476" />
        <text x="214" y="160" className="pn-dg__t">same lander, ~300 m away: in the ridge's shadow</text>
      </g>
      <text x="640" y="110" className="pn-dg__t pn-dg__t--sun">Sun ≤ ~1.5° above the level horizon</text>
      <text x="300" y="104" className="pn-dg__t">ridge</text>
    </svg>
  );
}

/** Processing pipeline from raw data to a decision. */
export function PipelineDiagram() {
  const nodes = [
    ["Terrain", "PGDA 78 5 m", "LOLA 80/240 m"],
    ["Horizon", "720 azimuths", "to 300 km"],
    ["Geometry", "SPICE DE440", "MOON_ME hourly"],
    ["Visibility", "solar-disc fraction", "Earth + DSN"],
    ["Uncertainty", "2,000 touchdowns", "P50 … P05"],
    ["Decision", "robust aim", "+ calendar"],
  ];
  const w = 112;
  const gap = 17;
  return (
    <svg viewBox="0 0 770 150" className="pn-dg" role="img" aria-label="Penumbra pipeline">
      <defs>
        <marker id="dg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0L10,5L0,10z" fill="rgba(255,196,119,0.9)" />
        </marker>
      </defs>
      {nodes.map(([t, a, b], i) => {
        const x = 8 + i * (w + gap);
        return (
          <g key={t}>
            <rect x={x} y={28} width={w} height={92} rx={4} className={i === nodes.length - 1 ? "pn-dg__box pn-dg__box--hot" : "pn-dg__box"} />
            <text x={x + 12} y={50} className="pn-dg__n">{`0${i + 1}`}</text>
            <text x={x + 12} y={74} className="pn-dg__h">{t}</text>
            <text x={x + 12} y={94} className="pn-dg__t">{a}</text>
            <text x={x + 12} y={110} className="pn-dg__t">{b}</text>
            {i < nodes.length - 1 && <line x1={x + w + 2} x2={x + w + gap - 2} y1={74} y2={74} stroke="rgba(255,196,119,0.9)" markerEnd="url(#dg-arrow)" />}
          </g>
        );
      })}
    </svg>
  );
}

/** Horizon tracing: rays across the curved Moon; the highest apparent terrain sets the horizon. */
export function HorizonDiagram() {
  return (
    <svg viewBox="0 0 760 220" className="pn-dg" role="img" aria-label="Schematic: tracing the terrain horizon">
      <path d="M0,200 Q380,150 760,200 L760,220 L0,220 Z" fill="#141c2c" stroke="rgba(170,205,255,0.3)" />
      <path d="M0,200 Q380,150 760,200" fill="none" stroke="rgba(170,205,255,0.25)" />
      <path d="M470,166 L520,128 L560,150 L600,140 L650,170" fill="#1d2738" stroke="rgba(170,205,255,0.45)" />
      <line x1="120" y1="179" x2="120" y2="160" stroke="#fff" strokeWidth="2" />
      <circle cx="120" cy="158" r="4" fill="#fff" />
      <text x="70" y="148" className="pn-dg__t">observer + mast</text>
      {[0, 1, 2, 3, 4, 5, 6].map((k) => {
        const x = 200 + k * 60;
        const ground = 200 - ((380 - Math.abs(380 - x)) / 380) * 50 * (1 - Math.pow((x - 380) / 380, 2) * 0);
        return <circle key={k} cx={x} cy={Math.min(ground, 200) - 6} r={2.3} fill="rgba(143,199,255,0.8)" />;
      })}
      <line x1="120" y1="158" x2="520" y2="128" stroke="var(--solar)" strokeWidth="1.6" />
      <line x1="120" y1="158" x2="740" y2="158" stroke="rgba(143,199,255,0.45)" strokeDasharray="5 5" />
      <path d="M240,158 A120,120 0 0 0 238,149" fill="none" stroke="var(--solar)" />
      <text x="250" y="150" className="pn-dg__t pn-dg__t--sun">H(α) = max elevation of terrain along azimuth α</text>
      <text x="420" y="196" className="pn-dg__t">samples: 5 m → 80 m → 240 m steps, out to 300 km</text>
      <text x="560" y="120" className="pn-dg__t">ridge sets the horizon</text>
    </svg>
  );
}

/** Landing uncertainty: aim at the brightest point vs at the robust aim. */
export function UncertaintyDiagram() {
  const dots = (cx: number, cy: number, seed: number) => {
    const out: [number, number][] = [];
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 70; k++) {
      const r = 46 * Math.sqrt(rnd());
      const t = rnd() * Math.PI * 2;
      out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
    return out;
  };
  // left: a bright spike beside darker ground; right: a broad bright plateau
  return (
    <svg viewBox="0 0 760 200" className="pn-dg" role="img" aria-label="Schematic: landing uncertainty around two aim points">
      <rect x="20" y="20" width="340" height="160" rx="6" className="pn-dg__box" />
      <rect x="400" y="20" width="340" height="160" rx="6" className="pn-dg__box" />
      <circle cx="190" cy="100" r="14" fill="rgba(255,196,119,0.75)" />
      <ellipse cx="575" cy="100" rx="110" ry="62" fill="rgba(255,196,119,0.32)" />
      {dots(190, 100, 7).map(([x, y], i) => (
        <circle key={`a${i}`} cx={x} cy={y} r={2} fill={Math.hypot(x - 190, y - 100) < 14 ? "#ffe2b0" : "#5d6b86"} />
      ))}
      {dots(575, 100, 11).map(([x, y], i) => (
        <circle key={`b${i}`} cx={x} cy={y} r={2} fill={((x - 575) / 110) ** 2 + ((y - 100) / 62) ** 2 < 1 ? "#ffe2b0" : "#5d6b86"} />
      ))}
      <circle cx="190" cy="100" r="46" fill="none" stroke="#fff" strokeDasharray="4 4" strokeOpacity="0.7" />
      <circle cx="575" cy="100" r="46" fill="none" stroke="#2fd1a0" strokeDasharray="4 4" />
      <text x="36" y="44" className="pn-dg__h">Aim at the brightest point</text>
      <text x="36" y="166" className="pn-dg__t">bright if you hit it; most touchdowns land dark</text>
      <text x="416" y="44" className="pn-dg__h">Aim at the robust point</text>
      <text x="416" y="166" className="pn-dg__t">slightly less bright, but most touchdowns stay lit</text>
    </svg>
  );
}
