import { useMemo } from "react";
import { currentVehicle, setState, useApp } from "../../state/store";
import { useSite, useSkyline, useStrings, useVisibility } from "../../hooks/useMission";
import { Check, Prov, Tip } from "../../components/ui";
import { decodeEphem, skylineAt } from "../../utils/field";
import { fmtHours } from "../../utils/format";

function Stat({ label, value, sub, tip, prov }: { label: string; value: string; sub?: string; tip?: string; prov?: "computed" | "assumption" }) {
  return (
    <div className="pn-stat">
      <div className="pn-stat__label">
        {label} {tip && <Tip title={label} text={tip} />}
      </div>
      <div className="pn-stat__value ids-num">{value}</div>
      {sub && (
        <div className="pn-stat__sub">
          {sub} {prov && <Prov kind={prov} />}
        </div>
      )}
    </div>
  );
}

export function MissionStats() {
  const { t } = useStrings();
  const vis = useVisibility();
  const windowDays = useApp((s) => s.windowDays);
  const cursorIdx = useApp((s) => s.cursorIdx);
  const landingIdx = useApp((s) => s.landingIdx);
  const earthMargin = useApp((s) => s.earthMarginDeg);
  const dsnMask = useApp((s) => s.dsnMaskDeg);
  const vehicle = useApp((s) => currentVehicle(s));
  const k = Math.max(0, Math.min(Math.max(cursorIdx - landingIdx, 0), vis.hours - 1));
  const s = vis.summary;
  const earthNow = vis.earth[k] === 1;
  const st = vis.station;
  return (
    <section className="pn-stats" aria-label="Mission window">
      <div className="pn-card__sub">
        <span className="ids-overline">First {windowDays} days from landing</span>
      </div>
      <div className="pn-stats__grid">
        <Stat label={t.sunlight} value={`${s.sunlightPct.toFixed(0)}%`} sub="of hours, disc-weighted" prov="computed" tip="Share of hours with the Sun above the terrain skyline at the aim, weighted by the visible fraction of the solar disc." />
        <Stat label={t.darkness} value={fmtHours(s.longestDarkH)} sub={s.darkStartsInH === null ? "no darkness in window" : `first starts after ${fmtHours(s.darkStartsInH)}`} tip="Longest continuous period with no part of the Sun above the skyline." />
        <Stat label={t.earthVis} value={`${s.earthPct.toFixed(0)}%`} sub={`${earthMargin}° safety margin`} prov="assumption" tip={`Earth counts as visible when its elevation is at least ${earthMargin}° above the terrain skyline. The margin is our assumption, not a NASA requirement.`} />
        <Stat label={t.endurance} value={s.enduranceDays === null ? `> ${windowDays} d` : `${s.enduranceDays.toFixed(1)} d`} sub={vehicle.name} prov={vehicle.basis === "verified" ? "computed" : "assumption"} tip="Simplified hourly energy balance. It is not a thermal or electrical mission simulation and does not guarantee survival." />
      </div>
      <div className="pn-dsn">
        <div className="pn-dsn__head">
          <span className="pn-stat__label">
            {t.dsn}
            <Tip title="DSN geometric visibility" text="Geometric visibility does not guarantee scheduled DSN service or a successful communications link." />
          </span>
          <span className="ids-num pn-dsn__pct">{s.dsnPct.toFixed(0)}% of window</span>
        </div>
        <div className="pn-dsn__row">
          <Check ok={earthNow} label="Earth from lander" />
          <Check ok={st.goldstone[k] === 1} label="Goldstone" />
          <Check ok={st.madrid[k] === 1} label="Madrid" />
          <Check ok={st.canberra[k] === 1} label="Canberra" />
        </div>
        <div className="pn-dsn__foot">
          <span>
            At cursor time · mask{" "}
            <button className="pn-link" onClick={() => setState({ dsnMaskDeg: dsnMask === 6 ? 10.1 : 6 })}>
              {dsnMask === 6 ? "6° downlink" : "10.1° uplink"}
            </button>{" "}
            <Prov kind="computed" />
          </span>
          <b className={vis.dsn[k] ? "pn-good" : "pn-bad"}>{vis.dsn[k] ? `Opportunity: ${[st.goldstone[k] && "Goldstone", st.madrid[k] && "Madrid", st.canberra[k] && "Canberra"].filter(Boolean).join(", ")}` : "No opportunity"}</b>
        </div>
      </div>
      <HorizonMini />
    </section>
  );
}

/** Compact terrain-horizon strip with the Sun and Earth at the cursor time. */
export function HorizonMini() {
  const site = useSite();
  const cursorIdx = useApp((s) => s.cursorIdx);
  const sky = useSkyline();
  const e = useMemo(() => decodeEphem(site), [site]);
  const W = 300;
  const H = 64;
  const lo = -3;
  const hi = 6;
  const y = (el: number) => H - ((el - lo) / (hi - lo)) * H;
  const path = useMemo(() => {
    const d = sky.deg;
    let p = `M0 ${H}`;
    for (let i = 0; i <= 360; i += 2) p += ` L${(i / 360) * W} ${y(skylineAt(d, i)).toFixed(1)}`;
    return p + ` L${W} ${H} Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sky]);
  const i = Math.min(cursorIdx, e.n - 1);
  const sx = (e.sunAz[i] / 360) * W;
  const ex = (e.earthAz[i] / 360) * W;
  return (
    <figure className="pn-hzmini">
      <figcaption>
        <span className="pn-stat__label">Terrain horizon (vertical ×)</span>
        <Prov kind="computed" />
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H + 14}`} role="img" aria-label="Terrain horizon with Sun and Earth positions">
        <line x1="0" x2={W} y1={y(0)} y2={y(0)} className="pn-hzmini__zero" />
        <path d={path} className="pn-hzmini__terrain" />
        <circle cx={sx} cy={y(e.sunEl[i])} r="5" className="pn-hzmini__sun" />
        <circle cx={ex} cy={y(e.earthEl[i])} r="4.5" className="pn-hzmini__earth" />
        {["N", "E", "S", "W"].map((c, k) => (
          <text key={c} x={(k * W) / 4 + (k === 0 ? 2 : 0)} y={H + 12} className="pn-hist__tick" textAnchor={k === 0 ? "start" : "middle"}>
            {c}
          </text>
        ))}
      </svg>
    </figure>
  );
}
