import { useMemo, useState } from "react";
import { api } from "../../api/client";
import { currentVehicle, getState, setState, useApp } from "../../state/store";
import { useApiCall, useRisk, useSite, useVisibility } from "../../hooks/useMission";
import { Modal, Prov, SliderField } from "../../components/ui";
import { fmtIso } from "../../utils/format";
import { offsetToLatLon } from "../../utils/field";
import { vehiclePresets } from "../../data/vehicles";
import type { ProvenanceData } from "../../types";

const NO_PROV: ProvenanceData = { verified_utc: "", last_processed_utc: null, frame: "MOON_ME", kernels: [], terrain_version: "", groups: [] };
const utc = (s: string | null) => (s ? s.replace("T", " ").replace("Z", " UTC") : "—");

export function useProvenance(): ProvenanceData {
  return useApiCall("provenance", () => api.provenance()).data ?? NO_PROV;
}

export function DataDialog() {
  const open = useApp((s) => s.dialog === "data");
  const site = useSite();
  const P = useProvenance();
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <Modal open={open} onClose={() => setState({ dialog: null })} title="Data and provenance" subtitle={`Raw files verified ${utc(P.verified_utc)} · last processed ${utc(P.last_processed_utc)} · SHA-256 for every file · frame MOON_ME`} wide>
      <div className="pn-data__chips">
        {["NASA LOLA 80 m / 240 m", "NASA PGDA 78 · 5 m terrain + clones", "NASA PGDA 69 · validation", "JPL SPICE kernels", "JPL Horizons", "NASA DSN 810-005"].map((c) => (
          <span key={c} className="pn-pill pn-pill--data">{c}</span>
        ))}
      </div>
      <section className="pn-data__mock">
        <h4>Where each number on screen comes from</h4>
        <table className="pn-table pn-table--compact">
          <tbody>
            <tr><td>Terrain, relief and slope</td><td>{site.terrain.source ?? `NASA PGDA 78 ${site.tile}`}; {site.context.source}</td><td><Prov kind="verified" /></td></tr>
            <tr><td>Sun and Earth positions</td><td>{site.ephem.source}</td><td><Prov kind="computed" /></td></tr>
            <tr><td>Sunlight / Earth fields ({site.name})</td><td>{site.field.source}</td><td><Prov kind="computed" /></td></tr>
            <tr><td>Terrain skyline at the aim</td><td>720 azimuths traced through PGDA 78 5 m + LOLA 80/240 m, mast {site.field.mast_m ?? 2} m</td><td><Prov kind="computed" /></td></tr>
            <tr><td>Hourly Sun / Earth / DSN / power bands</td><td>Solar-disc fraction against the aim's skyline; DSN from station kernels; power from the vehicle scenario</td><td><Prov kind="computed" /></td></tr>
            <tr><td>Site centre</td><td>{site.centre_source}</td><td><Prov kind="verified" /></td></tr>
            <tr><td>Vehicle parameters</td><td>See the vehicle scenario; values not from a cited source are marked</td><td><Prov kind="assumption" /></td></tr>
          </tbody>
        </table>
        <p className="pn-provline">Frame: {P.frame}. Kernels: {P.kernels.join(", ")}. Terrain version: {P.terrain_version}.</p>
      </section>
      <ul className="pn-data__list">
        {P.groups.map((g) => (
          <li key={g.id} className={openId === g.id ? "is-open" : ""}>
            <button
              className="pn-data__row"
              aria-expanded={openId === g.id}
              aria-controls={`prov-${g.id}`}
              onClick={(e) => {
                const opening = openId !== g.id;
                setOpenId(opening ? g.id : null);
                // keep the opened entry in view inside the dialog's scroll area
                if (opening) {
                  const li = e.currentTarget.closest("li");
                  requestAnimationFrame(() => li?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
                }
              }}
            >
              <span className="pn-data__title">{g.title}</span>
              <span className="pn-data__meta ids-num">{g.files} files · {(g.bytes / 1e6).toFixed(g.bytes > 1e8 ? 0 : 1)} MB</span>
            </button>
            {openId === g.id && (
              <dl className="pn-data__detail" id={`prov-${g.id}`}>
                <dt>Source</dt><dd>{g.source}</dd>
                <dt>Product page</dt><dd><a className="pn-link" href={g.page.startsWith("http") ? g.page : undefined} target="_blank" rel="noreferrer">{g.page}</a></dd>
                <dt>Frame</dt><dd>{g.frame}</dd>
                <dt>Resolution</dt><dd>{g.resolution}</dd>
                <dt>Version</dt><dd>{g.version}</dd>
                <dt>Use</dt><dd>{g.usage}</dd>
                <dt>SHA-256 (first file)</dt><dd className="ids-num">{g.sha_first}…</dd>
              </dl>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function ExportDialog() {
  const open = useApp((s) => s.dialog === "export");
  const site = useSite();
  const risk = useRisk();
  const vis = useVisibility();
  const s = useApp((st) => st);
  const [copied, setCopied] = useState<string | null>(null);
  const prov = useProvenance();
  const payload = useMemo(() => {
    const v = currentVehicle(s);
    const r = s.robust.result;
    const ll = (x: number, y: number) => offsetToLatLon(site, { x, y }).map((n, i) => +n.toFixed(i ? 3 : 5));
    return {
      product: "Penumbra lunar landing decision summary",
      status: "Computed by the Penumbra engine from NASA/JPL data. A planning aid, not a mission-certified result.",
      generated_utc: new Date().toISOString(),
      site: { id: site.id, name: site.name, terrain_tile: `NASA PGDA 78 ${site.tile}` },
      landing_utc: fmtIso(s.landingIdx),
      mission_window_days: s.windowDays,
      commanded_aim: { lat_lon: ll(s.aim.x, s.aim.y), offset_m: [Math.round(s.aim.x), Math.round(s.aim.y)], kind: s.aimKind },
      robust_aim: r ? { lat_lon: ll(r.robust.x, r.robust.y), nominal_pct: +r.robust.value.toFixed(1), [`p${s.percentile}_pct`]: +r.robust.pq.toFixed(1) } : null,
      brightest_point: r ? { lat_lon: ll(r.bestNominal.x, r.bestNominal.y), nominal_pct: +r.bestNominal.value.toFixed(1), [`p${s.percentile}_pct`]: +r.bestNominal.pq.toFixed(1) } : null,
      uncertainty: s.uncertainty.enabled ? (s.uncertainty.model === "circular" ? { model: "circular", radius_m: s.uncertainty.radius } : { model: "gaussian", sigma_east_m: s.uncertainty.sigmaE, sigma_north_m: s.uncertainty.sigmaN, rotation_deg: s.uncertainty.rotDeg, confidence: s.uncertainty.conf }) : { model: "none" },
      outcomes: { nominal_pct: +risk.nominal.toFixed(1), p50_pct: +risk.p[50].toFixed(1), p10_pct: +risk.p[10].toFixed(1) },
      window: {
        sunlight_pct: +vis.summary.sunlightPct.toFixed(1),
        earth_visible_pct: +vis.summary.earthPct.toFixed(1),
        earth_margin_deg: s.earthMarginDeg,
        dsn_geometric_pct: +vis.summary.dsnPct.toFixed(1),
        dsn_mask_deg: s.dsnMaskDeg,
        longest_darkness_h: vis.summary.longestDarkH,
        energy_endurance_days: vis.summary.enduranceDays,
      },
      vehicle: { name: v.name, basis: v.basis, parameters: v.sources },
      provenance: {
        frame: "MOON_ME",
        terrain: "NASA PGDA 78 (Barker et al. 2021), LOLA LDEM 80/240 m",
        ephemeris: site.ephem.source,
        field: site.field.source,
        site_centre: site.centre_source,
        raw_data_verified_utc: prov.verified_utc,
        processed_utc: prov.last_processed_utc,
        kernels: prov.kernels,
        terrain_version: prov.terrain_version,
      },
      caveats: [
        "DSN geometric visibility does not guarantee scheduled service or a communications link.",
        "Simplified energy model; not a thermal or electrical mission simulation.",
        "The landing-uncertainty model is user-selected, not the true distribution of a real lander.",
        "Terrain resolution and elevation uncertainty affect results.",
      ],
    };
  }, [s, site, risk, vis, prov]);
  const json = JSON.stringify(payload, null, 2);
  // Embedded viewers (iframes) block downloads, so offer the file only in the standalone page.
  const canDownload = typeof window !== "undefined" && window.self === window.top;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied("Copied to clipboard");
    } catch {
      setCopied("Copy blocked here. Select the text below and copy it manually.");
    }
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = `penumbra_${site.id}_${fmtIso(s.landingIdx).slice(0, 10)}.json`;
    a.click();
    setCopied("Download started (browsers that block downloads here can use Copy)");
  };
  return (
    <Modal open={open} onClose={() => setState({ dialog: null })} title="Export decision summary" subtitle="Site, date, aims, uncertainty, outcomes, visibility, vehicle scenario, provenance and timestamp" wide>
      <div className="pn-export">
        <div className="pn-export__summary">
          <dl>
            <dt>Site</dt><dd>{site.name}</dd>
            <dt>Landing</dt><dd className="ids-num">{payload.landing_utc}</dd>
            <dt>Commanded aim</dt><dd className="ids-num">{payload.commanded_aim.lat_lon.join(", ")}</dd>
            <dt>Robust aim</dt><dd className="ids-num">{payload.robust_aim ? payload.robust_aim.lat_lon.join(", ") : "not computed yet"}</dd>
            <dt>Nominal / P50 / P10</dt><dd className="ids-num">{payload.outcomes.nominal_pct}% / {payload.outcomes.p50_pct}% / {payload.outcomes.p10_pct}%</dd>
            <dt>Sun · Earth · DSN</dt><dd className="ids-num">{payload.window.sunlight_pct}% · {payload.window.earth_visible_pct}% · {payload.window.dsn_geometric_pct}%</dd>
            <dt>Vehicle</dt><dd>{payload.vehicle.name} ({payload.vehicle.basis === "verified" ? "sourced preset" : "assumption-based"})</dd>
          </dl>
          <div className="pn-export__actions">
            <button className="ids-btn ids-btn--primary" onClick={copy}>Copy JSON</button>
            {canDownload && <button className="ids-btn" onClick={download}>Download JSON</button>}
            {copied && <span className="pn-field__hint" role="status">{copied}</span>}
          </div>
        </div>
        <pre className="pn-export__json" tabIndex={0}>{json}</pre>
      </div>
    </Modal>
  );
}

export function VehicleDialog() {
  const open = useApp((s) => s.dialog === "vehicle");
  const v = useApp((s) => currentVehicle(s));
  const heading = useApp((s) => s.headingDeg);
  const headingAuto = useApp((s) => s.headingAuto);
  const update = (patch: Partial<typeof v>) =>
    setState((s) => ({
      vehicles: s.vehicles.map((x) =>
        x.id === v.id
          ? {
              ...x,
              ...patch,
              sources: x.sources.map((src) => (("batteryWh" in patch && src.label === "Battery") || ("baseLoadW" in patch && src.label.startsWith("Operating")) || ("hibernateW" in patch && src.label.startsWith("Hibernation")) ? { ...src, prov: "assumption" as const, value: "edited by user" } : src)),
            }
          : x,
      ),
    }));
  return (
    <Modal open={open} onClose={() => setState({ dialog: null })} title="Power scenario" subtitle={`${v.name} · ${v.basis === "verified" ? "sourced preset: edits turn values into assumptions" : "ASSUMPTION-BASED preset"}`}>
      <div className="pn-vehicle">
        <p className="pn-field__hint">{v.notes}</p>
        <table className="pn-table pn-table--compact">
          <tbody>
            {v.sources.map((s) => (
              <tr key={s.label}><td>{s.label}</td><td className="ids-num">{s.value}</td><td><Prov kind={s.prov} /></td></tr>
            ))}
          </tbody>
        </table>
        <SliderField id="veh-bat" label="Battery capacity" value={v.batteryWh} min={200} max={8000} step={20} unit=" Wh" onChange={(x) => update({ batteryWh: x })} />
        <SliderField id="veh-base" label="Baseline load" value={v.baseLoadW} min={20} max={500} step={5} unit=" W" onChange={(x) => update({ baseLoadW: x })} />
        <SliderField id="veh-hib" label="Hibernation load" value={v.hibernateW} min={5} max={200} step={1} unit=" W" onChange={(x) => update({ hibernateW: x })} />
        <SliderField id="veh-res" label="Usable reserve" value={v.reservePct} min={0} max={50} step={1} unit=" %" onChange={(x) => update({ reservePct: x })} />
        <label className="pn-toggle-row">
          <button className={`pn-switch${headingAuto ? " is-on" : ""}`} role="switch" aria-checked={headingAuto} onClick={() => setState({ headingAuto: !headingAuto })}>
            <span className="pn-switch__knob" />
          </button>
          Point the aft panel at the Sun at landing
        </label>
        <SliderField id="veh-head" label="Vehicle heading (panel orientation)" value={heading} min={0} max={355} step={5} unit="°" disabled={headingAuto} onChange={(x) => setState({ headingDeg: x, headingAuto: false })} hint="Panels: port, starboard, aft (vertical). Heading rotates all panel normals; the heading stays fixed after landing." />
        <p className="pn-field__hint">Output is an energy endurance estimate from an hourly energy balance, not a guarantee of mission life, thermal survival or hardware reliability.</p>
        <button className="ids-btn" onClick={() => setState({ vehicles: getState().vehicles.map((x) => (x.id === v.id ? (freshPreset(v.id) ?? x) : x)) })}>Restore preset values</button>
      </div>
    </Modal>
  );
}

function freshPreset(id: string) {
  return vehiclePresets().find((p) => p.id === id);
}
