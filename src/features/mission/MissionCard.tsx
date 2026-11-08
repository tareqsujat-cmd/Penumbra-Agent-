import { useState, type ReactNode } from "react";
import { currentVehicle, setState, useApp } from "../../state/store";
import { useRisk, useSite, useStrings, useVisibility } from "../../hooks/useMission";
import { Num, Prov, Seg, SliderField, Tip } from "../../components/ui";
import { UncertaintyControls } from "../uncertainty/UncertaintyControls";
import { RobustAimButton, RobustAimResult } from "./RobustAim";
import { Histogram } from "./Histogram";
import { MissionStats } from "./MissionStats";
import { inField, offsetToLatLon } from "../../utils/field";
import { fmtHours, fmtOffset } from "../../utils/format";

const AIM_LABEL = { brightest: "Brightest point", robust: "Robust aim", custom: "Custom point", nominal: "Site reference point" } as const;

/** Collapsible inspector section with a one-line summary on the right. */
function Section({ title, summary, open = false, children }: { title: string; summary?: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <details className="pn-sec" open={open}>
      <summary className="pn-sec__head">
        <span className="pn-sec__chev" aria-hidden="true" />
        <span className="pn-sec__title">{title}</span>
        {summary != null && <span className="pn-sec__sum">{summary}</span>}
      </summary>
      <div className="pn-sec__body">{children}</div>
    </details>
  );
}

function Kpi({ label, value, sub, tone, tip }: { label: string; value: ReactNode; sub: ReactNode; tone?: "good" | "bad" | "muted"; tip?: string }) {
  return (
    <div className={`pn-kpi${tone ? ` is-${tone}` : ""}`}>
      <div className="pn-kpi__label">
        {label} {tip && <Tip title={label} text={tip} />}
      </div>
      <div className="pn-kpi__value ids-num">{value}</div>
      <div className="pn-kpi__sub">{sub}</div>
    </div>
  );
}

export function MissionCard() {
  const { t } = useStrings();
  const site = useSite();
  const risk = useRisk();
  const vis = useVisibility();
  const aim = useApp((s) => s.aim);
  const aimKind = useApp((s) => s.aimKind);
  const unc = useApp((s) => s.uncertainty);
  const q = useApp((s) => s.percentile);
  const robust = useApp((s) => s.robust);
  const windowDays = useApp((s) => s.windowDays);
  const vehicle = useApp((s) => currentVehicle(s));
  const [lat, lon] = offsetToLatLon(site, aim);
  const r = robust.result;
  const zone = unc.model === "circular" ? `±${unc.radius} m` : `σ ${unc.sigmaE}×${unc.sigmaN} m`;
  return (
    <aside className="pn-insp" aria-label={t.mission}>
      <header className="pn-insp__head">
        <div className="ids-overline">{t.mission}</div>
        <h2 className="pn-insp__title">{site.name}</h2>
        <p className="pn-insp__meta">
          <span className={`pn-aimtag is-${aimKind}`}>{AIM_LABEL[aimKind]}</span>
          <span className="ids-num">
            {lat.toFixed(4)}°, {lon.toFixed(3)}°E
          </span>
          <span>{fmtOffset(aim.x, aim.y)}</span>
        </p>
      </header>

      <div className="pn-insp__kpis">
        <Kpi label={t.nominal} value={<Num value={risk.nominal} unit="%" />} sub="sunlight at the aim, 2027" tip="Sunlight (% of 2027 hours, disc-weighted, 2 m mast) exactly at the commanded aim point." />
        <Kpi
          label={`Worst likely · P${q}`}
          value={unc.enabled ? <Num value={risk.pq} unit="%" digits={risk.pq % 1 && risk.pq < 99 ? 1 : 0} /> : "—"}
          sub={!unc.enabled ? "landing uncertainty off" : !Number.isFinite(risk.pq) ? "simulating touchdowns…" : risk.nominal - risk.pq > 0.5 ? `−${(risk.nominal - risk.pq).toFixed(1)} pp if you miss` : "no loss if you miss"}
          tone={unc.enabled && risk.nominal - risk.pq > 10 ? "bad" : undefined}
          tip={`${100 - q}% of simulated touchdowns perform at least this well under the selected landing-error model (${zone}).`}
        />
        <Kpi
          label="Robust aim"
          value={r ? <Num value={r.robust.pq} unit="%" digits={r.robust.pq % 1 ? 1 : 0} /> : "—"}
          sub={r ? `P${q} · +${(r.robust.pq - r.bestNominal.pq).toFixed(1)} pp vs brightest` : "not searched yet"}
          tone={r ? "good" : "muted"}
          tip="The worst-likely sunlight when aiming at the robust aim instead of the brightest point."
        />
      </div>

      <div className="pn-insp__scroll">
        <Section title={t.uncertainty} summary={unc.enabled ? `${zone} · P${q}` : "off"} open>
          <UncertaintyControls />
        </Section>
        <Section title="Touchdown outcomes" summary={unc.enabled ? (risk.loading && !risk.nGridPoints ? "computing…" : `${risk.nGridPoints.toLocaleString()} touchdowns`) : "—"} open={unc.enabled}>
          {unc.enabled && risk.histogram.length > 0 ? (
            <Histogram bins={risk.histogram} nominal={risk.nominal} pq={risk.pq} q={q} />
          ) : (
            <p className="pn-insp__empty">Turn on landing uncertainty to see how sunlight varies across possible touchdown points.</p>
          )}
          <p className="pn-provline">
            Landing-zone statistics from the site sunlight grid. <Prov kind="computed" />
          </p>
        </Section>
        <Section title="Robust aim" summary={r ? `${r.robust.value.toFixed(0)}% · P${q} ${r.robust.pq.toFixed(1)}%` : "not searched"} open>
          <RobustAimResult />
        </Section>
        <Section title={`First ${windowDays} days after landing`} summary={Number.isFinite(vis.summary.sunlightPct) ? `${vis.summary.sunlightPct.toFixed(0)}% sun · ${fmtHours(vis.summary.longestDarkH)} night` : "computing…"}>
          <MissionStats />
        </Section>
        <Section title="Vehicle & settings" summary={vehicle.name}>
          <PlannerSettings />
        </Section>
        <p className="pn-caveats">
          <b>Caveats.</b> Terrain resolution and elevation error affect results. A user-selected uncertainty model is not the true distribution of a real lander. DSN geometric visibility is not scheduled service. The energy model is not a thermal or electrical mission simulation.
        </p>
      </div>

      <footer className="pn-insp__foot">
        <RobustAimButton />
      </footer>
    </aside>
  );
}

function PlannerSettings() {
  const site = useSite();
  const earthMargin = useApp((s) => s.earthMarginDeg);
  const dsnMask = useApp((s) => s.dsnMaskDeg);
  const vehicles = useApp((s) => s.vehicles);
  const vehicle = useApp((s) => currentVehicle(s));
  const [latIn, setLatIn] = useState("");
  const [lonIn, setLonIn] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function goTo() {
    const la = Number(latIn);
    const lo = Number(lonIn);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || la > -80 || la < -90) {
      setErr("Enter a south-polar latitude between −90° and −80° and an east longitude.");
      return;
    }
    const R = 1737400;
    const r = (d: number) => (d * Math.PI) / 180;
    const rho = 2 * R * Math.tan(Math.PI / 4 + r(la) / 2);
    const p = { x: rho * Math.sin(r(lo)) - site.terrain.center_xy[0], y: rho * Math.cos(r(lo)) - site.terrain.center_xy[1] };
    if (!inField(site.field, p)) {
      setErr(`High-resolution terrain is unavailable here: this point is ${(Math.hypot(p.x, p.y) / 1000).toFixed(1)} km from ${site.name}, outside the precomputed 5 m landing grid.`);
      return;
    }
    setErr(null);
    setState({ aim: p, aimKind: "custom" });
  }

  return (
    <div className="pn-settings__body">
        <div className="pn-field">
          <span className="pn-field__label">Exact coordinates (MOON_ME)</span>
          <div className="pn-coords">
            <input id="coord-lat" className="pn-input ids-num" placeholder="lat, e.g. −89.4398" value={latIn} onChange={(e) => setLatIn(e.target.value.replace("−", "-"))} aria-label="Latitude in degrees" />
            <input id="coord-lon" className="pn-input ids-num" placeholder="lon °E, e.g. 222.83" value={lonIn} onChange={(e) => setLonIn(e.target.value)} aria-label="East longitude in degrees" />
            <button className="ids-btn" onClick={goTo}>
              Set aim
            </button>
          </div>
          {err && (
            <div className="ids-alert ids-alert--warn pn-alert" role="alert">
              <span className="ids-alert__icon">!</span>
              <div>{err}</div>
            </div>
          )}
        </div>
        <div className="pn-field pn-field--static">
          <span className="pn-field__label">Mast height</span>
          <span className="ids-num">
            2.0 m <Prov kind="computed" />
          </span>
          <span className="pn-field__hint">Landing grids for this demo were precomputed for a 2 m mast.</span>
        </div>
        <SliderField id="earth-margin" label="Earth visibility margin" value={earthMargin} min={0} max={5} step={0.5} unit="°" prov="assumption" onChange={(v) => setState({ earthMarginDeg: v })} hint="Our assumption, not a NASA requirement." />
        <div className="pn-field">
          <span className="pn-field__label">DSN elevation mask</span>
          <Seg
            label="DSN elevation mask"
            size="sm"
            value={String(dsnMask)}
            onChange={(v) => setState({ dsnMaskDeg: v === "6" ? 6 : 10.1 })}
            options={[
              { value: "6", label: "6° downlink" },
              { value: "10.1", label: "10.1° uplink" },
            ]}
          />
          <span className="pn-field__hint">DSN 810-005 module 301: receive masks bottom out near 6°; uplink not below 10.1°.</span>
        </div>
        <div className="pn-field">
          <span className="pn-field__label">Vehicle scenario</span>
          <div className="pn-vehicle-row">
            <Seg
              label="Vehicle scenario"
              size="sm"
              value={vehicle.id}
              onChange={(v) => setState({ vehicleId: v })}
              options={vehicles.map((v) => ({ value: v.id, label: v.name.replace(" rover", "").replace(" lander", ""), title: v.basis === "assumption" ? "Assumption-based scenario" : "Sourced preset" }))}
            />
            <button className="ids-btn" onClick={() => setState({ dialog: "vehicle" })}>
              Edit scenario
            </button>
          </div>
          {vehicle.basis === "assumption" && (
            <span className="pn-field__hint pn-warn">
              <Prov kind="assumption" /> Some power parameters are assumptions.
            </span>
          )}
        </div>
    </div>
  );
}
