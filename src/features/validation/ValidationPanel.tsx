import { api } from "../../api/client";
import { useApiCall } from "../../hooks/useMission";
import type { ValidationData } from "../../types";
import { Prov, Tip } from "../../components/ui";

function Pill({ pass, children }: { pass: boolean; children: React.ReactNode }) {
  return <span className={`pn-pill ${pass ? "pn-pill--ok" : "pn-pill--bad"}`}>{children}</span>;
}

function Scatter({ v }: { v: ValidationData["v1_pgda69"] }) {
  const W = 300;
  const P = 34;
  const s = (x: number) => P + (x / 100) * (W - P - 8);
  const y = (x: number) => W - P - (x / 100) * (W - P - 8);
  return (
    <svg viewBox={`0 0 ${W} ${W}`} className="pn-scatter" role="img" aria-label={`Penumbra versus NASA PGDA 69 at ${v.points.length} points: mean error ${v.mae_sun} pp Sun, ${v.mae_earth} pp Earth`}>
      {[0, 25, 50, 75, 100].map((t) => (
        <g key={t}>
          <line x1={s(t)} x2={s(t)} y1={y(0)} y2={y(100)} className="pn-scatter__grid" />
          <line x1={s(0)} x2={s(100)} y1={y(t)} y2={y(t)} className="pn-scatter__grid" />
          <text x={s(t)} y={W - P + 16} textAnchor="middle" className="pn-hist__tick">{t}</text>
          <text x={P - 6} y={y(t) + 4} textAnchor="end" className="pn-hist__tick">{t}</text>
        </g>
      ))}
      <line x1={s(0)} y1={y(0)} x2={s(100)} y2={y(100)} className="pn-scatter__one" />
      {v.points.map((p) => (
        <g key={p.name}>
          <circle cx={s(p.pgda_sun)} cy={y(p.ours_sun)} r="4.5" className="pn-scatter__sun">
            <title>{`${p.name} — Sun: PGDA ${p.pgda_sun}%, Penumbra ${p.ours_sun}%`}</title>
          </circle>
          <rect x={s(p.pgda_earth) - 4} y={y(p.ours_earth) - 4} width="8" height="8" className="pn-scatter__earth">
            <title>{`${p.name} — Earth: PGDA ${p.pgda_earth}%, Penumbra ${p.ours_earth}%`}</title>
          </rect>
        </g>
      ))}
      <text x={W / 2 + P / 2} y={W - 4} textAnchor="middle" className="pn-scatter__ax">NASA PGDA 69 (%)</text>
      <text x={10} y={W / 2} textAnchor="middle" transform={`rotate(-90 10 ${W / 2})`} className="pn-scatter__ax">Penumbra (%)</text>
    </svg>
  );
}

export function ValidationPanel() {
  const r = useApiCall("validation", () => api.validation());
  if (!r.data)
    return (
      <div className="pn-science">
        <header className="pn-science__head">
          <div className="ids-overline">Science / validation</div>
          <h2>Checks against independent NASA products and published studies</h2>
          <p className="pn-banner">{r.error ? `Validation unavailable: ${r.error.message}` : "Running the validation cases with the Penumbra engine (first run takes a few seconds)…"}</p>
        </header>
      </div>
    );
  const V = r.data;
  const v1 = V.v1_pgda69;
  const v2 = V.v2_glaser2018;
  const v4 = V.v4_spice_horizons;
  const shadowOk = v2.points.filter((p) => p.shadow_within_tol).length;
  return (
    <div className="pn-science">
      <header className="pn-science__head">
        <div className="ids-overline">Science / validation</div>
        <h2>Checks against independent NASA products and published studies</h2>
        <p className="pn-banner">
          <Prov kind="computed" /> Computed by this build's engine on {V.computed_utc.replace("T", " ").replace("Z", " UTC")} ({V.terrain_version}). Tolerances were fixed before any result
          existed; a failing case is shown as failing.
        </p>
      </header>
      <div className="pn-science__grid">
        <section className="ids-panel pn-vcard">
          <div className="pn-vcard__head">
            <h3>V1 · NASA PGDA 69 Sun and Earth visibility maps</h3>
            <a className="pn-link" href="https://pgda.gsfc.nasa.gov/products/69" target="_blank" rel="noreferrer">Source ↗</a>
          </div>
          <div className="pn-vcard__kpis">
            <div className="ids-readout">
              <div className="ids-readout__label">Sun visibility · mean abs. error</div>
              <div className="ids-readout__value">{v1.mae_sun.toFixed(2)}<small> pp</small></div>
            </div>
            <div className="ids-readout">
              <div className="ids-readout__label">Earth visibility · mean abs. error</div>
              <div className="ids-readout__value">{v1.mae_earth.toFixed(2)}<small> pp</small></div>
            </div>
            <Pill pass={v1.pass}>Target ≤ {v1.tolerance_pp} pp · {v1.pass ? "met" : "not met"}</Pill>
          </div>
          <Scatter v={v1} />
          <p className="pn-vcard__method">
            <b>Method.</b> {v1.method} <span className="pn-key pn-key--sun" /> Sun <span className="pn-key pn-key--earth" /> Earth. <i>{v1.source}.</i>
          </p>
        </section>
        <section className="ids-panel pn-vcard">
          <div className="pn-vcard__head">
            <h3>V2 · Published ridge values · Gläser et al. (2018)</h3>
            <a className="pn-link" href="https://ntrs.nasa.gov/api/citations/20170007365/downloads/20170007365.pdf" target="_blank" rel="noreferrer">Paper ↗</a>
          </div>
          <table className="pn-table">
            <thead>
              <tr>
                <th>Point</th>
                <th>Published</th>
                <th>Penumbra</th>
                <th>Difference</th>
                <th>Longest shadow</th>
              </tr>
            </thead>
            <tbody>
              {v2.points.map((g) => (
                <tr key={g.point} title={`${g.table}; terrain: ${g.terrain}${g.ours_at_5m_surface !== null ? `; on the raw 5 m grid: ${g.ours_at_5m_surface}%` : ""}`}>
                  <td>{g.point}</td>
                  <td className="ids-num">{g.published.toFixed(1)}%</td>
                  <td className="ids-num">{g.ours.toFixed(1)}%</td>
                  <td className={`ids-num ${g.within_tol ? "pn-good" : "pn-bad"}`}>
                    {g.diff > 0 ? "+" : ""}
                    {g.diff.toFixed(1)} pp
                  </td>
                  <td className={`ids-num ${g.shadow_within_tol ? "pn-good" : "pn-bad"}`}>
                    {g.ours_shadow_h} h <small>vs {g.pub_shadow_h}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pn-vcard__method">
            <Pill pass={v2.pass}>
              {v2.n_within} of {v2.n} within {v2.tolerance_pp} pp
            </Pill>{" "}
            <Pill pass={shadowOk >= 5}>
              {shadowOk} of {v2.n} shadows within 10%
            </Pill>{" "}
            {v2.method}
          </p>
        </section>
        <section className="ids-panel pn-vcard">
          <div className="pn-vcard__head">
            <h3>V4 · Geometry cross-check · SPICE vs JPL Horizons</h3>
            <Tip title={`Why ${v4.tolerance_arcsec} arcseconds`} text="The stored Horizons tables use DE441; the local SPICE kernels use DE440. The tolerance was fixed before any result existed." />
          </div>
          <table className="pn-table">
            <thead>
              <tr>
                <th>Site</th>
                <th>Body</th>
                <th>Hours</th>
                <th>Max error</th>
                <th>Mean error</th>
              </tr>
            </thead>
            <tbody>
              {v4.cases.map((c) => (
                <tr key={`${c.site}-${c.target}`}>
                  <td>{c.site}</td>
                  <td>{c.target === "SUN" ? "Sun" : "Earth"}</td>
                  <td className="ids-num">{c.hours.toLocaleString()}</td>
                  <td className={`ids-num ${c.pass ? "pn-good" : "pn-bad"}`}>{c.max_arcsec.toFixed(2)}″</td>
                  <td className="ids-num">{c.mean_arcsec.toFixed(2)}″</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pn-vcard__method">
            <Pill pass={v4.pass}>All within {v4.tolerance_arcsec}″</Pill> {v4.method}
          </p>
        </section>
        <section className="ids-panel pn-vcard">
          <div className="pn-vcard__head">
            <h3>Automated tests · coordinates, frames, horizons, uncertainty, power</h3>
            <span className="pn-pill">MOON_ME (DE440, DE421-aligned)</span>
          </div>
          {V.tests ? (
            <ul className="pn-checklist">
              {V.tests.suites.map((s) => (
                <li key={s.name} data-state={s.passed === s.total ? "done" : "failed"}>
                  <b>{s.name}</b>
                  <span>
                    {s.passed} / {s.total} passed
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pn-vcard__method">No test report yet: run <code>python tasks.py test</code>.</p>
          )}
          <p className="pn-vcard__method">
            Includes: projection round trip vs pyproj (≤ 1 mm), PGDA 78 tile centres, MOON_ME vs MOON_PA, flat-Moon horizon dip, synthetic hill, mast monotonicity, disc fraction vs
            pixel counting, sampling models, percentiles, robust aim on a synthetic spike-vs-plateau field, power model.
            {V.tests && ` Report generated ${V.tests.generated_utc.replace("T", " ").replace("Z", " UTC")}.`}
          </p>
        </section>
      </div>
    </div>
  );
}
