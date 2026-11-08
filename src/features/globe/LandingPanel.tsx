import { useEffect, useRef } from "react";
import { setState, useApp } from "../../state/store";
import { useModel, useRisk, useSite, useVisibility } from "../../hooks/useMission";
import { brightest } from "../../utils/field";
import { loadSite } from "../../api/client";
import { findRobustAim, resetRobust } from "../mission/RobustAim";
import { Num, Prov, Steps, Tip } from "../../components/ui";
import { cividisCss } from "../../utils/color";
import { fmtDate, fmtHours, fmtOffset, MONTHS } from "../../utils/format";
import { MiniTimeline } from "./MiniTimeline";
import type { Percentile, SiteId } from "../../types";

export const LANDING_SITES: { id: SiteId; name: string; blurb: string }[] = [
  { id: "cr1", name: "Connecting Ridge", blurb: "Best-lit ridge · Moon Base I target" },
  { id: "shk", name: "Shackleton rim", blurb: "Crater rim · published reference point" },
  { id: "mal", name: "Malapert massif", blurb: "Earth-facing mountain" },
  { id: "mou", name: "Mons Mouton", blurb: "Plateau near Griffin-1's region" },
  { id: "nob", name: "Nobile rim 1", blurb: "Crater rim near Mons Mouton" },
];

const ACCURACY = [
  { r: 50, label: "Precise", sub: "±50 m", icon: "◎" },
  { r: 100, label: "Typical", sub: "±100 m", icon: "◉" },
  { r: 400, label: "Loose", sub: "±400 m", icon: "○" },
];

/** Select a site for the globe landing analysis (aim starts at its brightest point). */
export async function openSiteOnGlobe(id: SiteId) {
  const s = await loadSite(id);
  const b = brightest(s.field);
  setState((st) => ({
    siteId: id,
    globeSite: id,
    aim: { x: b.x, y: b.y },
    aimKind: "brightest",
    robust: { status: "idle", stage: 0, result: null, revealed: false },
    heatMetric: "nominal",
    uncertainty: { ...st.uncertainty, enabled: true, model: "circular" },
  }));
}

function YearStrip() {
  const landingIdx = useApp((s) => s.landingIdx);
  const windowDays = useApp((s) => s.windowDays);
  const daily = useVisibility().dailySun;
  const day = Math.floor(landingIdx / 24);
  const set = (d: number) => {
    const idx = Math.min(Math.max(d, 0), 365 - windowDays) * 24 + 13;
    setState({ landingIdx: idx, cursorIdx: idx });
  };
  return (
    <div className="pn-lp__year">
      <svg viewBox="0 0 365 26" preserveAspectRatio="none" role="slider" aria-label="Landing day in 2027" aria-valuemin={0} aria-valuemax={364} aria-valuenow={day} tabIndex={0}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          set(Math.round(((e.clientX - r.left) / r.width) * 365));
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") set(day + 1);
          if (e.key === "ArrowLeft") set(day - 1);
        }}
      >
        {Array.from(daily).map((v, d) => (
          <rect key={d} x={d} y={2} width={1.05} height={18} fill={cividisCss(v / 100)} />
        ))}
        <rect x={day} y={0} width={windowDays} height={22} className="pn-lp__win" />
      </svg>
      <div className="pn-lp__months">
        {MONTHS.map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>
    </div>
  );
}

export function LandingPanel({ onClose, onPickSite }: { onClose: () => void; onPickSite: (id: SiteId) => void }) {
  const globeSite = useApp((s) => s.globeSite);
  const landingIdx = useApp((s) => s.landingIdx);
  const windowDays = useApp((s) => s.windowDays);
  const unc = useApp((s) => s.uncertainty);
  const q = useApp((s) => s.percentile);
  const robust = useApp((s) => s.robust);
  const aimKind = useApp((s) => s.aimKind);
  const site = useSite();
  const model = useModel();
  const risk = useRisk();
  const vis = useVisibility();
  const r = robust.result;
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (robust.status === "done") resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [robust.status]);
  const step = (dh: number) =>
    setState((s) => {
      const idx = Math.min(Math.max(s.landingIdx + dh, 13), (365 - s.windowDays) * 24 + 13);
      return { landingIdx: idx, cursorIdx: idx };
    });
  const stages = ["Sampling the landing zone…", `Testing ${site.field.nx * site.field.ny} possible aims…`, "Choosing the safest spot…"];

  return (
    <aside className="pn-lp" aria-label="Landing planner">
      <header className="pn-lp__head">
        <div>
          <div className="ids-overline">Landing planner</div>
          <h2>{globeSite ? site.name : "Plan a landing"}</h2>
        </div>
        <button className="ids-btn ids-btn--ghost pn-icon-btn" onClick={onClose} aria-label="Close landing planner">✕</button>
      </header>

      <section className="pn-lp__step">
        <div className="pn-lp__label"><span className="pn-lp__n">1</span>Where?</div>
        <div className="pn-lp__sites">
          {LANDING_SITES.map((s) => (
            <button key={s.id} className={`pn-lp__site${globeSite === s.id ? " is-on" : ""}`} onClick={() => onPickSite(s.id)}>
              <b>{s.name}</b>
              <small>{s.blurb}</small>
            </button>
          ))}
        </div>
      </section>

      {globeSite && (
        <>
          <section className="pn-lp__step">
            <div className="pn-lp__label"><span className="pn-lp__n">2</span>When?</div>
            <div className="pn-lp__date">
              <button className="pn-tool pn-tool--sm" onClick={() => step(-24)} aria-label="One day earlier">‹</button>
              <b className="ids-num">{fmtDate(landingIdx)}</b>
              <button className="pn-tool pn-tool--sm" onClick={() => step(24)} aria-label="One day later">›</button>
            </div>
            <YearStrip />
            <p className="pn-lp__hint">Brighter days = more sunlight at your aim. Click the strip to pick a landing day.</p>
          </section>

          <section className="pn-lp__step">
            <div className="pn-lp__label">
              <span className="pn-lp__n">3</span>How accurately can you land?
              <Tip title="Landing accuracy" text="Landers rarely touch down exactly on target (Athena landed 250–370 m away; NASA asks human landers for 100 m). Penumbra checks every likely touchdown spot inside this zone." />
            </div>
            <div className="pn-lp__acc">
              {ACCURACY.map((a) => (
                <button
                  key={a.r}
                  className={`pn-lp__accbtn${unc.enabled && unc.model === "circular" && unc.radius === a.r ? " is-on" : ""}`}
                  onClick={() => {
                    setState((s) => ({ uncertainty: { ...s.uncertainty, enabled: true, model: "circular", radius: a.r } }));
                    resetRobust();
                  }}
                >
                  <span aria-hidden="true">{a.icon}</span>
                  <b>{a.label}</b>
                  <small>{a.sub}</small>
                </button>
              ))}
            </div>
            <div className="pn-lp__protect">
              <span>Plan for</span>
              {([[50, "a typical landing"], [20, "a bad landing"], [10, "a very bad landing"]] as [Percentile, string][]).map(([p, l]) => (
                <button key={p} className={`pn-chip${q === p ? " is-on" : ""}`} aria-pressed={q === p} onClick={() => { setState({ percentile: p }); resetRobust(); }}>
                  {l}
                </button>
              ))}
            </div>
          </section>

          <section className="pn-lp__step">
            <div className="pn-lp__label"><span className="pn-lp__n">4</span>Where should you aim?</div>
            <div className="pn-lp__now">
              <div>
                <span>At your aim</span>
                <b className="ids-num"><Num value={risk.nominal} unit="%" /></b>
                <small>sunlight in 2027</small>
              </div>
              <div>
                <span>{100 - q} in 100 landings get at least</span>
                <b className="ids-num pn-warn"><Num value={risk.pq} unit="%" digits={risk.pq % 1 && risk.pq < 99 ? 1 : 0} /></b>
                <small>if you actually land nearby</small>
              </div>
            </div>
            <button className="ids-btn ids-btn--primary ids-btn--lg ids-btn--block pn-lp__go" onClick={() => findRobustAim(site.id, model, q)} disabled={robust.status === "running"}>
              {robust.status === "running" ? (<><span className="ids-btn__spinner" />{stages[Math.min(robust.stage, 2)]}</>) : robust.status === "done" ? "Search again" : "Find the safest spot"}
            </button>
            {robust.status === "running" && <Steps steps={stages} active={robust.stage} />}
            {r && (
              <div className="pn-lp__result" ref={resultRef}>
                <div className="pn-lp__cmp">
                  <div className="pn-lp__opt">
                    <span className="pn-glyph pn-glyph--tri" aria-hidden="true" />
                    <div>
                      <b>Brightest spot</b>
                      <small>{r.bestNominal.value.toFixed(0)}% sunlight · worst likely <span className="pn-bad">{r.bestNominal.pq.toFixed(0)}%</span></small>
                    </div>
                  </div>
                  <div className="pn-lp__opt is-best">
                    <span className="pn-glyph pn-glyph--star" aria-hidden="true" />
                    <div>
                      <b>Safest aim</b>
                      <small>{r.robust.value.toFixed(0)}% sunlight · worst likely <span className="pn-good">{r.robust.pq.toFixed(1)}%</span></small>
                    </div>
                  </div>
                </div>
                <p className={`pn-lp__reveal${robust.revealed ? " is-in" : ""}`}>The brightest place is not necessarily the safest place to aim.</p>
                <p className="pn-lp__plain">
                  Aim {fmtOffset(r.robust.x - r.bestNominal.x, r.robust.y - r.bestNominal.y)} of the brightest spot. Even if you miss, {100 - q} in 100 landings still get at least {r.robust.pq.toFixed(0)}% sunlight.
                </p>
                <button className="ids-btn ids-btn--block" disabled={aimKind === "robust"} onClick={() => setState({ aim: { x: r.robust.x, y: r.robust.y }, aimKind: "robust" })}>
                  {aimKind === "robust" ? "✓ Aiming at the safest spot" : "Aim at the safest spot"}
                </button>
              </div>
            )}
            <p className="pn-lp__hint">Tip: click anywhere on the coloured area to move your aim. <Prov kind="computed" /></p>
          </section>

          <section className="pn-lp__step">
            <div className="pn-lp__label"><span className="pn-lp__n">5</span>After landing (first {windowDays} days)</div>
            <div className="pn-lp__tiles">
              <div><span>Sunlight</span><b className="ids-num">{vis.summary.sunlightPct.toFixed(0)}%</b></div>
              <div><span>Longest night</span><b className="ids-num">{fmtHours(vis.summary.longestDarkH)}</b></div>
              <div><span>Earth in view</span><b className="ids-num">{vis.summary.earthPct.toFixed(0)}%</b></div>
              <div>
                <span>Battery lasts <Tip title="Energy endurance estimate" text="Simplified hourly energy balance for the selected vehicle scenario (VIPER-class by default). Not a thermal or electrical mission simulation." /></span>
                <b className="ids-num">{vis.summary.enduranceDays === null ? `> ${windowDays} d` : `${vis.summary.enduranceDays.toFixed(1)} d`}</b>
              </div>
            </div>
            <MiniTimeline />
          </section>

          <footer className="pn-lp__foot">
            <button className="ids-btn" onClick={() => setState({ mode: "planner", view: "map" })}>Advanced planner</button>
            <button className="ids-btn" onClick={() => setState({ dialog: "export" })}>Export</button>
          </footer>
        </>
      )}
      {!globeSite && <p className="pn-lp__hint">Pick a site to fly down to its real LOLA terrain and see where sunlight is reliable.</p>}
    </aside>
  );
}
