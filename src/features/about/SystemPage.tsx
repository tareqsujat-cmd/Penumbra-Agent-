/** System: what Penumbra is, how it works, how to navigate it, its data, validation and limits.
 *  Results (validation errors, dataset counts, site list) are read live from the API. */
import { useRef } from "react";
import { api, siteListSync } from "../../api/client";
import { useApiCall } from "../../hooks/useMission";
import { useReveal, useScrollProgress } from "../../hooks/useReveal";
import { SECTIONS, goTo } from "../../app/Header";
import { setState } from "../../state/store";

const PIPELINE = [
  {
    n: "01",
    title: "Terrain",
    body: "NASA PGDA 78 5 m elevation around each site, LOLA 80 m to 150 km and LOLA 240 m to 300 km, all in the MOON_ME frame.",
    spec: "3 DEMs · 5 / 80 / 240 m",
  },
  {
    n: "02",
    title: "Horizon",
    body: "From every point of a 10–25 m grid, 720 rays (one per half degree) march across the curved Moon and record the highest terrain they meet.",
    spec: "720 azimuths · 3,450 samples each",
  },
  {
    n: "03",
    title: "Sun & Earth",
    body: "JPL SPICE kernels give the apparent Sun and Earth directions every hour, and the DSN stations' view of the Moon. No internet needed.",
    spec: "DE440 · MOON_ME · hourly",
  },
  {
    n: "04",
    title: "Visibility",
    body: "The visible fraction of the solar disc above the skyline, Earth above the skyline plus a safety margin, and DSN geometric opportunities.",
    spec: "disc fraction · Earth margin · DSN masks",
  },
  {
    n: "05",
    title: "Uncertainty",
    body: "Landers miss. 2,000 touchdowns are drawn inside your landing ellipse and each is scored from the computed grid.",
    spec: "circular / elliptical Gaussian · P50–P05",
  },
  {
    n: "06",
    title: "Robust aim",
    body: "Every candidate aim is tested against all likely touchdowns; the aim whose worst likely sunlight is highest wins.",
    spec: "argmax P10 · ~6,000 candidates · 50 ms",
  },
];

function Eclipse({ className = "" }: { className?: string }) {
  return (
    <div className={`pn-eclipse ${className}`} aria-hidden="true">
      <span className="pn-eclipse__corona" />
      <span className="pn-eclipse__disc" />
    </div>
  );
}

export function SystemPage() {
  const val = useApiCall("validation", () => api.validation()).data;
  const prov = useApiCall("provenance", () => api.provenance()).data;
  const sites = siteListSync();
  const root = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLElement>(null);
  useReveal(root, [!!val, !!prov]);
  useScrollProgress(hero, 520);
  const files = prov?.groups.reduce((a, g) => a + g.files, 0) ?? 0;
  const bytes = prov?.groups.reduce((a, g) => a + g.bytes, 0) ?? 0;
  return (
    <div className="pn-sys" ref={root}>
      <section className="pn-sys__hero" ref={hero}>
        <Eclipse />
        <div className="pn-sys__herotext">
          <div className="pn-kicker">07 · The system</div>
          <h1 className="pn-display pn-glow">Plan for where you may actually land</h1>
          <p className="pn-lede">
            At the lunar south pole the Sun never climbs more than about a degree and a half above a level horizon. A ridge a few hundred metres away can
            decide whether a lander has light, and landers do not touch down exactly where they aim. Penumbra turns NASA terrain and JPL geometry into the
            odds of light for every likely touchdown, and recommends the aim that keeps those odds high.
          </p>
          <div className="pn-sys__cta">
            <button className="ids-btn ids-btn--primary ids-btn--lg" onClick={() => goTo("planner")}>
              Open the mission planner
            </button>
            <button className="ids-btn ids-btn--lg pn-btn-line" onClick={() => goTo("globe")}>
              Explore the Moon
            </button>
          </div>
        </div>
      </section>

      <section className="pn-sys__section" data-reveal>
        <header className="pn-sys__head">
          <div className="pn-kicker">How it works</div>
          <h2 className="pn-display-sm">From raw NASA data to a landing decision</h2>
        </header>
        <ol className="pn-pipe">
          {PIPELINE.map((p, i) => (
            <li key={p.n} className="pn-pipe__stage" data-reveal style={{ "--i": i } as React.CSSProperties}>
              <span className="pn-pipe__n">{p.n}</span>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
              <span className="pn-pipe__spec ids-num">{p.spec}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="pn-sys__section" data-reveal>
        <header className="pn-sys__head">
          <div className="pn-kicker">Navigate</div>
          <h2 className="pn-display-sm">Seven sections, one mission</h2>
          <p className="pn-sys__sub">The numbered sections in the top bar follow a landing study from first look to final decision. Every number you see is computed by the engine; every source is one click away under DATA.</p>
        </header>
        <div className="pn-navcards">
          {SECTIONS.map((s, i) => (
            <button key={s.mode} className="pn-navcard" data-reveal style={{ "--i": i } as React.CSSProperties} onClick={() => goTo(s.mode)}>
              <span className="pn-navcard__n">{s.n}</span>
              <b>{s.label}</b>
              <span>{s.hint}</span>
              <span className="pn-navcard__go" aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      </section>

      <section className="pn-sys__section pn-sys__split" data-reveal>
        <div>
          <header className="pn-sys__head">
            <div className="pn-kicker">Data</div>
            <h2 className="pn-display-sm">NASA and JPL first</h2>
          </header>
          <ul className="pn-sys__facts">
            <li>
              <b className="ids-num">{prov ? prov.groups.length : "—"}</b>
              <span>datasets</span>
            </li>
            <li>
              <b className="ids-num">{prov ? files : "—"}</b>
              <span>files, each with a SHA-256 checksum</span>
            </li>
            <li>
              <b className="ids-num">{prov ? `${(bytes / 1e9).toFixed(1)} GB` : "—"}</b>
              <span>of terrain, ephemerides and references, all local</span>
            </li>
            <li>
              <b className="ids-num">{sites.length}</b>
              <span>south-pole sites on 5 m NASA terrain</span>
            </li>
          </ul>
          <ul className="pn-sys__list">
            {(prov?.groups ?? []).slice(0, 8).map((g) => (
              <li key={g.id}>{g.title}</li>
            ))}
          </ul>
          <button className="ids-btn pn-btn-line" onClick={() => setState({ dialog: "data" })}>
            Open full provenance
          </button>
        </div>
        <div>
          <header className="pn-sys__head">
            <div className="pn-kicker">Validation</div>
            <h2 className="pn-display-sm">Checked against independent results</h2>
          </header>
          {val ? (
            <ul className="pn-sys__checks">
              <li data-pass={val.v1_pgda69.pass}>
                <b>NASA PGDA 69 maps</b>
                <span className="ids-num">
                  {val.v1_pgda69.mae_sun.toFixed(2)} pp Sun · {val.v1_pgda69.mae_earth.toFixed(2)} pp Earth
                </span>
                <small>mean error at {val.v1_pgda69.points.length} points · target ≤ {val.v1_pgda69.tolerance_pp} pp</small>
              </li>
              <li data-pass={val.v2_glaser2018.pass}>
                <b>Gläser et al. (2018)</b>
                <span className="ids-num">
                  {val.v2_glaser2018.n_within} of {val.v2_glaser2018.n} within {val.v2_glaser2018.tolerance_pp} pp
                </span>
                <small>published illumination at named ridge points</small>
              </li>
              <li data-pass={val.v4_spice_horizons.pass}>
                <b>SPICE vs JPL Horizons</b>
                <span className="ids-num">≤ {Math.max(...val.v4_spice_horizons.cases.map((c) => c.max_arcsec)).toFixed(2)}″</span>
                <small>Sun and Earth directions through 2027</small>
              </li>
            </ul>
          ) : (
            <p className="pn-sys__sub">Running the validation cases…</p>
          )}
          <button className="ids-btn pn-btn-line" onClick={() => goTo("science")}>
            Open Science
          </button>
        </div>
      </section>

      <section className="pn-sys__section" data-reveal>
        <header className="pn-sys__head">
          <div className="pn-kicker">Limits</div>
          <h2 className="pn-display-sm">What the numbers do not say</h2>
        </header>
        <ul className="pn-limits">
          <li>
            <b>Terrain</b> Resolution and elevation error affect results; 5 m grids are partly interpolated between laser tracks.
          </li>
          <li>
            <b>Landing model</b> A user-selected uncertainty model is not the true distribution of a real lander.
          </li>
          <li>
            <b>DSN</b> Geometric visibility does not guarantee scheduled service or a working link.
          </li>
          <li>
            <b>Power</b> A simplified energy balance, not a thermal or electrical simulation; non-VIPER presets are assumptions.
          </li>
        </ul>
      </section>

      <footer className="pn-sys__foot">
        <span>NASA Space Apps Challenge 2026 · Challenge 4</span>
        <span>Terrain: NASA PGDA 78 (Barker et al. 2021), LRO LOLA · Ephemerides: NAIF SPICE · Validation: NASA PGDA 69 (Mazarico et al. 2011), Gläser et al. (2018) · Stars: Yale Bright Star Catalogue</span>
      </footer>
    </div>
  );
}

export { Eclipse };
