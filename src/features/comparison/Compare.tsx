import { currentVehicle, setState, useApp } from "../../state/store";
import { useApiCall, useDebounced, useModel } from "../../hooks/useMission";
import { api } from "../../api/client";
import { Prov, Tip } from "../../components/ui";
import { fmtDate, fmtHours } from "../../utils/format";
import type { CompareRow, SiteId } from "../../types";

const ALL: { id: SiteId; name: string }[] = [
  { id: "cr1", name: "Connecting Ridge" },
  { id: "shk", name: "Shackleton rim" },
  { id: "mal", name: "Malapert massif" },
  { id: "mou", name: "Mons Mouton / Leibnitz β" },
  { id: "nob", name: "Nobile rim 1" },
];
const COLORS = ["#e69f00", "#56b4e9", "#cc79a7", "#009e73", "#f0e442"];

type Metric = { key: string; label: string; get: (r: CompareRow) => number; fmt: (v: number) => string; max: number; better: "high" | "low"; tip: string };

export function Compare() {
  const ids = useApp((s) => s.compareIds);
  const q = useApp((s) => s.percentile);
  const enabled = true;
  const model = useDebounced(useModel());
  const landingIdx = useDebounced(useApp((s) => s.landingIdx), 200);
  const windowDays = useApp((s) => s.windowDays);
  const earthMarginDeg = useApp((s) => s.earthMarginDeg);
  const dsnMaskDeg = useApp((s) => s.dsnMaskDeg);
  const vehicle = useApp((s) => currentVehicle(s));
  const headingDeg = useApp((s) => s.headingDeg);
  const headingAuto = useApp((s) => s.headingAuto);
  const vis = { startIdx: landingIdx, hours: windowDays * 24, earthMarginDeg, dsnMaskDeg, vehicle, headingDeg, autoHeading: headingAuto };
  const res = useApiCall(JSON.stringify(["compare", ids, model, q, vis]), () => api.compare(ids, { model, enabled, percentile: q, seed: 7 }, vis));
  const rows = res.data?.rows ?? [];
  const pq = (r: CompareRow) => (q === 50 ? r.p50 : q === 20 ? r.p20 : q === 10 ? r.p10 : r.p05);
  const metrics: Metric[] = [
    { key: "bright", label: "Nominal (brightest point)", get: (r) => r.brightest, fmt: (v) => `${v.toFixed(0)}%`, max: 100, better: "high", tip: `Sunlight at the site's brightest point during the ${windowDays} days after landing (2 m mast).` },
    { key: "p50", label: "P50 at robust aim", get: (r) => r.p50, fmt: (v) => `${v.toFixed(0)}%`, max: 100, better: "high", tip: `Typical outcome across the landing zone when aiming at the robust aim (sunlight in the first ${windowDays} days).` },
    { key: "p20", label: "P20 at robust aim", get: (r) => r.p20, fmt: (v) => `${v.toFixed(0)}%`, max: 100, better: "high", tip: "Cautious outcome: 80% of touchdowns do at least this well." },
    { key: "p10", label: "P10 at robust aim", get: (r) => r.p10, fmt: (v) => `${v.toFixed(0)}%`, max: 100, better: "high", tip: "Conservative outcome: 90% of touchdowns do at least this well." },
    { key: "dark", label: `Longest darkness, first ${windowDays} d`, get: (r) => r.longestDarkH, fmt: fmtHours, max: Math.max(72, ...rows.map((r) => r.longestDarkH)), better: "low", tip: "Longest continuous night at the robust aim in the mission window." },
    { key: "earth", label: "Earth visibility", get: (r) => r.earthPct, fmt: (v) => `${v.toFixed(0)}%`, max: 100, better: "high", tip: "Share of hours with Earth above the skyline plus the safety margin." },
    { key: "dsn", label: "DSN geometric opportunity", get: (r) => r.dsnPct, fmt: (v) => `${v.toFixed(0)}%`, max: 100, better: "high", tip: "Earth visible AND at least one DSN station can see the Moon. Not a guarantee of scheduled service." },
  ];
  const ranked = res.data ? res.data.ranking.map((id) => rows.find((r) => r.site === id)!).filter(Boolean) : [];
  const toggle = (id: SiteId) =>
    setState((s) => {
      const has = s.compareIds.includes(id);
      if (has && s.compareIds.length <= 2) return { toast: "Compare needs at least two sites." };
      if (!has && s.compareIds.length >= ALL.length) return {};
      return { compareIds: has ? s.compareIds.filter((x) => x !== id) : [...s.compareIds, id] };
    });
  return (
    <div className="pn-compare">
      <header className="pn-compare__head">
        <div>
          <div className="ids-overline">Compare sites · landing {fmtDate(landingIdx, false)} · P{q} · same uncertainty model</div>
          <h2>Which site keeps the lander in sunlight, wherever it actually lands?</h2>
        </div>
        <div className="pn-compare__picker" role="group" aria-label="Sites to compare">
          {ALL.map((s) => {
            const on = ids.includes(s.id);
            const c = on ? COLORS[ids.indexOf(s.id)] : undefined;
            return (
              <button key={s.id} className={`pn-chip${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => toggle(s.id)} style={c ? ({ "--chip": c } as React.CSSProperties) : undefined}>
                <span className="pn-chip__dot" />
                {s.name}
              </button>
            );
          })}
                  <button
            className={`pn-chip pn-chip--all${ids.length === ALL.length ? " is-on" : ""}`}
            aria-pressed={ids.length === ALL.length}
            onClick={() => setState((s) => ({ compareIds: s.compareIds.length === ALL.length ? ["cr1", "shk", "mal"] : ALL.map((x) => x.id) }))}
          >
            {ids.length === ALL.length ? "Back to three" : "All sites"}
          </button>
        </div>
      </header>
      <div className="pn-compare__body">
        <div className="pn-rank">
          <div className="ids-overline">
            Ranking by P{q} sunlight, first {windowDays} days, at each robust aim {res.loading && <span className="pn-loading-dot">computing…</span>}
          </div>
          {res.error && <p className="pn-insp__empty">Comparison unavailable: {res.error.message}</p>}
          {!res.data && res.loading && <p className="pn-insp__empty">Finding the robust aim at each site and simulating touchdowns…</p>}
          <ol>
            {ranked.map((r, n) => (
              <li key={r.site}>
                <span className="pn-rank__n ids-num">{n + 1}</span>
                <span className="pn-chip__dot" style={{ background: COLORS[ids.indexOf(r.site)] }} />
                <div>
                  <b>{r.name}</b>
                  <small>
                    Best {windowDays}-day landing: {fmtDate(r.bestLandingIdx, false)} ({r.bestLandingSunPct.toFixed(0)}% sunlight) <Prov kind="computed" />
                  </small>
                </div>
                <span className="pn-rank__v ids-num">{pq(r).toFixed(0)}%</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="pn-dots">
          {metrics.map((m) => (
            <div className="pn-dots__row" key={m.key}>
              <div className="pn-dots__label">
                {m.label} <Tip title={m.label} text={m.tip} />
              </div>
              <div className="pn-dots__track">
                <span className="pn-dots__axis" />
                {(() => {
                  // labels go above; a label moves below only when its dot is within 9% of the previous label on that side
                  const pos = (r: CompareRow) => Math.min(100, (m.get(r) / m.max) * 100);
                  const below = new Set<string>();
                  let lastAbove = -1e9;
                  let lastBelow = -1e9;
                  for (const r of [...rows].sort((a, b) => pos(a) - pos(b))) {
                    const p = pos(r);
                    if (p - lastAbove >= 9) lastAbove = p;
                    else if (p - lastBelow >= 9) {
                      below.add(r.site);
                      lastBelow = p;
                    } else lastAbove = p;
                  }
                  return rows.map((r) => (
                    <span key={r.site} className="pn-dots__dot" style={{ left: `${pos(r)}%`, background: COLORS[ids.indexOf(r.site)] }} title={`${r.name}: ${m.fmt(m.get(r))}`}>
                      <span className={`pn-dots__val ids-num${below.has(r.site) ? " is-below" : ""}`}>{m.fmt(m.get(r))}</span>
                    </span>
                  ));
                })()}
              </div>
              <div className="pn-dots__dir">{m.better === "high" ? "higher is better →" : "← lower is better"}</div>
            </div>
          ))}
        </div>
      </div>
      <p className="pn-provline">
        Every value is computed by the Penumbra engine: 720-azimuth horizons on each site's grid (PGDA 78 5 m + LOLA), SPICE geometry for 2027, 2,000 simulated touchdowns. Change the landing date in the calendar to update the comparison.
      </p>
    </div>
  );
}
