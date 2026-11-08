/** Research report: problem, gaps, method, findings, validation, limitations and references, laid out as a paper.
 *  Every number in the text and every chart is computed live by the Penumbra engine from NASA/JPL data. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, enduranceByDay, loadSite, siteListSync } from "../../api/client";
import { useApiCall } from "../../hooks/useMission";
import { useReveal } from "../../hooks/useReveal";
import { bilinear, brightest, decodeEphem } from "../../utils/field";
import { vehiclePresets } from "../../data/vehicles";
import type { SiteData, SiteId } from "../../types";
import { REFS } from "./references";
import { DumbbellChart, ElevationChart, EnduranceChart, FieldMap, RangeChart, ScatterChart, SkylineChart, TerrainBars } from "./charts";
import { GrazingSunDiagram, HorizonDiagram, PipelineDiagram, UncertaintyDiagram } from "./diagrams";

const n = (v: number | undefined | null, d = 0) => (v === undefined || v === null || !Number.isFinite(v) ? "…" : v.toFixed(d));

function Cite({ k }: { k: string | string[] }) {
  const keys = Array.isArray(k) ? k : [k];
  return (
    <sup className="pn-cite">
      [
      {keys.map((key, i) => {
        const idx = REFS.findIndex((r) => r.key === key) + 1;
        return (
          <span key={key}>
            {i > 0 && ", "}
            <a href={`#ref-${key}`} onClick={(e) => jump(e, `ref-${key}`)}>
              {idx}
            </a>
          </span>
        );
      })}
      ]
    </sup>
  );
}

function jump(e: React.MouseEvent, id: string) {
  e.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function Fig({ id, wide = false, caption, children, loading }: { id: string; wide?: boolean; caption: ReactNode; children: ReactNode; loading?: boolean }) {
  return (
    <figure className={`pn-fig${wide ? " pn-fig--wide" : ""}`} id={id} data-reveal>
      <div className={`pn-fig__plot${loading ? " is-loading" : ""}`}>{loading ? <span className="pn-fig__wait">Computing from the engine…</span> : children}</div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

const SECTIONS = [
  ["abstract", "Abstract"],
  ["s1", "1 · The problem"],
  ["s2", "2 · Gaps in current practice"],
  ["s3", "3 · Research questions"],
  ["s4", "4 · Data"],
  ["s5", "5 · Method"],
  ["s6", "6 · Findings"],
  ["s7", "7 · Validation"],
  ["s8", "8 · Discussion and limits"],
  ["s9", "9 · Conclusions"],
  ["refs", "References"],
] as const;

export function ResearchReport() {
  const ids = siteListSync().map((s) => s.id as SiteId);
  const bundles = useApiCall("report:bundles", () => Promise.all(ids.map((id) => loadSite(id)))).data;
  const val = useApiCall("validation", () => api.validation()).data;
  const by = useMemo(() => new Map((bundles ?? []).map((b) => [b.id, b])), [bundles]);
  const cr1 = by.get("cr1");
  const shk = by.get("shk");
  const mou = by.get("mou");

  // 6.4 brightest vs robust (Connecting Ridge, ±100 m, P10)
  const circ = { kind: "circular" as const, radius: 100 };
  const robust = useApiCall(cr1 ? "report:robust" : null, () => api.robustAim({ site: "cr1", aim: { x: 0, y: 0 }, model: circ, enabled: true, percentile: 10, seed: 7 })).data;

  // 6.3 touchdown spread at the brightest points (±100 m and ±400 m)
  const risk = useApiCall(shk && cr1 ? "report:risk" : null, async () => {
    const rows: { label: string; nominal: number; p50: number; p10: number; p05: number }[] = [];
    for (const [s, name] of [
      [shk!, "Shackleton rim"],
      [cr1!, "Connecting Ridge"],
    ] as [SiteData, string][]) {
      const b = brightest(s.field);
      for (const r of [100, 400]) {
        try {
          const x = await api.landingRisk({ site: s.id, aim: { x: b.x, y: b.y }, model: { kind: "circular", radius: r }, enabled: true, percentile: 10, seed: 7 });
          rows.push({ label: `${name} · ±${r} m`, nominal: x.nominal, p50: x.p[50], p10: x.p[10], p05: x.p[5] });
        } catch {
          /* landing zone would leave the 5 m grid: row omitted */
        }
      }
    }
    return rows;
  }).data;

  // 6.5 energy endurance by landing date (VIPER preset, 90-day window)
  const CAP = 90;
  const endurance = useApiCall(cr1 && mou ? "report:endurance" : null, async () => {
    const viper = vehiclePresets()[0];
    const out: { name: string; color: string; pts: { day: number; days: number | null }[] }[] = [];
    for (const [s, name, color] of [
      [cr1!, "Connecting Ridge", "var(--solar)"],
      [mou!, "Mons Mouton / Leibnitz β", "#56b4e9"],
    ] as [SiteData, string, string][]) {
      const b = brightest(s.field);
      const r = await enduranceByDay(s.id, { x: b.x, y: b.y }, viper, CAP, 1);
      out.push({ name, color, pts: r.days.map((d, k) => ({ day: d, days: r.endurance_days[k] })) });
    }
    return out;
  }).data;

  // derived numbers for the text
  const geo = useMemo(() => {
    if (!cr1) return null;
    const e = decodeEphem(cr1);
    let sunUp = 0, both = 0, max = -99;
    for (let i = 0; i < e.n; i++) {
      if (e.sunEl[i] > 0) sunUp++;
      if (e.sunEl[i] > 0 && e.earthEl[i] > 0) both++;
      max = Math.max(max, e.sunEl[i]);
    }
    return { e, sunUp: (100 * sunUp) / e.n, both: (100 * both) / e.n, max };
  }, [cr1]);
  const terrain = useMemo(() => {
    if (!bundles) return null;
    return bundles.map((s) => {
      const e = decodeEphem(s);
      const b = brightest(s.field);
      let su = 0, eu = 0;
      for (let i = 0; i < e.n; i++) {
        if (e.sunEl[i] > 0) su++;
        if (e.earthEl[i] > 0) eu++;
      }
      return {
        name: s.name,
        smoothSun: (100 * su) / e.n,
        terrainSun: b.value,
        smoothEarth: (100 * eu) / e.n,
        terrainEarth: bilinear(s.field.earth, s.field, b.x, b.y),
      };
    });
  }, [bundles]);
  const changed = terrain ? terrain.filter((r) => Math.abs(r.terrainSun - r.smoothSun) >= 10 || Math.abs(r.terrainEarth - r.smoothEarth) >= 10).length : null;
  const shk100 = risk?.find((r) => r.label.startsWith("Shackleton") && r.label.endsWith("±100 m"));
  const cr100 = risk?.find((r) => r.label.startsWith("Connecting") && r.label.endsWith("±100 m"));
  const dist = robust ? Math.hypot(robust.robust.x - robust.bestNominal.x, robust.robust.y - robust.bestNominal.y) : null;
  const endCr = endurance?.[0].pts.map((p) => p.days ?? CAP);
  const endMou = endurance?.[1].pts.map((p) => p.days ?? CAP);
  const v1 = val?.v1_pgda69;
  const v2 = val?.v2_glaser2018;
  const v4 = val?.v4_spice_horizons;

  const root = useRef<HTMLDivElement>(null);
  useReveal(root, [!!bundles, !!val, !!robust, !!risk, !!endurance]);
  const [active, setActive] = useState("abstract");
  useEffect(() => {
    const scroller = root.current?.closest(".pn-page");
    const heads = SECTIONS.map(([id]) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { root: scroller, rootMargin: "-10% 0px -70% 0px" },
    );
    heads.forEach((h) => io.observe(h));
    return () => io.disconnect();
  }, []);

  // figures are numbered in order of appearance
  const figs = { grazing: 1, pipe: 2, horizon: 3, unc: 4, elev: 5, sky: 6, terr: 7, range: 8, map: 9, endur: 10, scatter: 11, glaser: 12 };

  return (
    <div className="pn-rep" ref={root}>
      <aside className="pn-rep__toc" aria-label="Contents">
        <div className="pn-kicker">Contents</div>
        <ol>
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className={active === id ? "is-on" : ""} onClick={(e) => jump(e, id)}>
                {label}
              </a>
            </li>
          ))}
        </ol>
        <p className="pn-rep__live">
          <span className="pn-rep__pulse" aria-hidden="true" /> Figures computed live by the engine
        </p>
      </aside>

      <article className="pn-rep__paper">
        <header className="pn-rep__title" data-reveal>
          <div className="pn-kicker">06 · Research report</div>
          <h1 className="pn-display pn-glow">Terrain- and uncertainty-aware landing analysis for the lunar south pole</h1>
          <p className="pn-rep__sub">Know your odds of light before you land</p>
          <dl className="pn-rep__meta">
            <div>
              <dt>Authors</dt>
              <dd>The Penumbra team · NASA Space Apps Challenge 2026</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>1.0 · figures computed {val ? val.computed_utc.slice(0, 10) : "…"}</dd>
            </div>
            <div>
              <dt>Frame</dt>
              <dd>MOON_ME · terrain {val ? val.terrain_version : "…"}</dd>
            </div>
          </dl>
        </header>

        <section id="abstract" className="pn-rep__abstract" data-reveal>
          <h2>Abstract</h2>
          <p>
            Landing near the lunar south pole is a bet on light. At Connecting Ridge the Sun never climbs more than {n(geo?.max, 1)}° above a level horizon in 2027, so
            metre-scale terrain decides whether a lander can charge its batteries and see the Earth. Planning products usually report how often a single point is
            sunlit, yet landers miss their targets by tens to hundreds of metres <Cite k="athena" />. We present Penumbra, a planning system that combines NASA 5 m and LOLA
            terrain <Cite k={["barker", "lola"]} />, JPL SPICE geometry <Cite k="spice" /> and a Monte Carlo model of landing dispersion, reports the full distribution of
            outcomes over every likely touchdown, and finds the aim point that maximises the worst likely outcome. At the brightest point of Shackleton rim the Sun shines{" "}
            {n(shk100?.nominal)}% of 2027, yet with a ±100 m landing zone one touchdown in ten receives {n(shk100?.p10)}% or less. On Connecting Ridge, aiming {n(dist)} m
            from the brightest point raises the 10th-percentile outcome from {n(robust?.bestNominal.pq, 1)}% to {n(robust?.robust.pq, 1)}%. At a fixed point, the landing date
            changes the energy endurance of a VIPER-class rover from {n(endMou && Math.min(...endMou))} to {endMou ? (Math.max(...endMou) >= CAP ? `${CAP}+` : n(Math.max(...endMou))) : "…"}{" "}
            days. The engine reproduces NASA's PGDA 69 visibility maps to {n(v1?.mae_sun, 2)} pp (Sun) and {n(v1?.mae_earth, 2)} pp (Earth) and published ridge illumination at{" "}
            {n(v2?.n_within)} of {n(v2?.n)} points within 3 pp <Cite k="glaser" />.
          </p>
          <p className="pn-rep__kw">
            <b>Keywords</b> lunar south pole · illumination · landing dispersion · robust optimisation · LOLA · PGDA 78 · SPICE · Deep Space Network
          </p>
        </section>

        <section id="s1" data-reveal>
          <h2>
            <span>1</span> The problem
          </h2>
          <p>
            Near the lunar poles the Sun stays close to the horizon all year (Figure {figs.elev}). Light is therefore set by the shape of the terrain around a lander rather
            than by the time of day: a crater rim or a ridge a few hundred metres away can hide the Sun for days (Figure {figs.grazing}). This is why candidate sites such as Connecting Ridge, the target of NASA's first Moon Base mission <Cite k="moonbase" />, sit on high ground.
          </p>
          <Fig id="fig-grazing" caption={<><b>Figure {figs.grazing}.</b> Schematic (not to scale): with the Sun grazing the horizon, a nearby ridge decides which of two neighbouring landing spots has light.</>}>
            <GrazingSunDiagram />
          </Fig>
          <p>
            Landers do not touch down exactly where they aim. IM-2 Athena came down 250–370 m from its target <Cite k="athena" />, and NASA's human-landing requirement is a
            100 m radius <Cite k="barker" />. Over such distances polar illumination can change from near-permanent light to long darkness. A plan that only evaluates the
            commanded aim point therefore answers the wrong question.
          </p>
          <blockquote className="pn-rep__quote">
            “Regions demonstrating robust illumination across mission windows and reduced sensitivity to timing uncertainties … are favored.” · “Terrain safety remains a
            primary consideration, with assessments focused on minimizing the degree of slope variability within a landing ellipse.”
            <cite>
              NASA Artemis III site-selection update <Cite k="lpsc9" />
            </cite>
          </blockquote>
        </section>

        <section id="s2" data-reveal>
          <h2>
            <span>2</span> Gaps in current practice
          </h2>
          <ol className="pn-rep__gaps">
            <li>
              <b>Point metrics, not landing zones.</b> Illumination maps and published site studies report the average illumination of a pixel or a named point{" "}
              <Cite k={["mazarico", "glaser"]} />. They do not say what happens across the ellipse a real lander may land in.
            </li>
            <li>
              <b>Long averages hide the landing date.</b> Multi-year averages smooth out the fact that a lander's survival depends on the darkness that follows its landing.
            </li>
            <li>
              <b>Constraints assessed one at a time.</b> Power, Earth visibility and ground-station geometry are often studied separately, while planners need them
              "evaluated simultaneously on a calendar basis" <Cite k="lpsc9" />.
            </li>
            <li>
              <b>Uncertainty rarely communicated.</b> Mapping programmes call for "deliberate strategies … to communicate uncertainty, confidence, and scale dependence"{" "}
              <Cite k="lmap" />.
            </li>
            <li>
              <b>Resolution matters at knife-edge ridges.</b> Coarse elevation models misstate illumination on the very ridges that are most attractive{" "}
              <Cite k={["glaser", "barker"]} />.
            </li>
          </ol>
        </section>

        <section id="s3" data-reveal>
          <h2>
            <span>3</span> Research questions
          </h2>
          <dl className="pn-rep__rq">
            <div>
              <dt>RQ1</dt>
              <dd>How much do sunlight and Earth visibility vary across a realistic landing zone at polar sites?</dd>
            </div>
            <div>
              <dt>RQ2</dt>
              <dd>Can choosing a different aim point reduce the downside of a landing miss, and at what nominal cost?</dd>
            </div>
            <div>
              <dt>RQ3</dt>
              <dd>How strongly does the landing date change a lander's energy endurance at a fixed point?</dd>
            </div>
            <div>
              <dt>RQ4</dt>
              <dd>Can these quantities be computed accurately enough to be trusted, as judged against independent NASA products and published studies?</dd>
            </div>
          </dl>
        </section>

        <section id="s4" data-reveal>
          <h2>
            <span>4</span> Data
          </h2>
          <p>All inputs are public NASA and JPL products, stored locally with SHA-256 checksums so the analysis runs offline (Table 1).</p>
          <div className="pn-rep__tablewrap" data-reveal>
            <table className="pn-rep__table">
              <caption>
                <b>Table 1.</b> Datasets
              </caption>
              <thead>
                <tr>
                  <th>Dataset</th>
                  <th>Resolution</th>
                  <th>Use</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>NASA PGDA product 78 (5 m site DEMs, slope, error) <Cite k="barker" /></td>
                  <td>5 m</td>
                  <td>Terrain within 12 km of each site</td>
                </tr>
                <tr>
                  <td>LRO LOLA LDEM_80S_80M and LDEM_75S_240M <Cite k="lola" /></td>
                  <td>80 m · 240 m</td>
                  <td>Horizon terrain to 150 km and 300 km</td>
                </tr>
                <tr>
                  <td>NAIF SPICE kernels: DE440, MOON_ME, DSN stations, Earth orientation <Cite k="spice" /></td>
                  <td>hourly</td>
                  <td>Apparent Sun, Earth and station geometry</td>
                </tr>
                <tr>
                  <td>NASA PGDA product 69 average visibility <Cite k="mazarico" /></td>
                  <td>120 m</td>
                  <td>Independent validation</td>
                </tr>
                <tr>
                  <td>JPL Horizons tables <Cite k="horizons" /></td>
                  <td>hourly</td>
                  <td>Geometry cross-check</td>
                </tr>
                <tr>
                  <td>DSN 810-005 module 301 <Cite k="dsn" /></td>
                  <td>–</td>
                  <td>Station elevation masks (6°, 10.1°)</td>
                </tr>
                <tr>
                  <td>Bright Star Catalogue <Cite k="bsc" /></td>
                  <td>9,110 stars</td>
                  <td>Star field in the 3-D views (visual only)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section id="s5" data-reveal>
          <h2>
            <span>5</span> Method
          </h2>
          <Fig id="fig-pipe" wide caption={<><b>Figure {figs.pipe}.</b> The Penumbra pipeline, from raw NASA data to a landing decision.</>}>
            <PipelineDiagram />
          </Fig>
          <h3>5.1 Terrain horizon</h3>
          <p>
            For an observer at height <i>h</i>₀ plus mast <i>m</i>, rays leave in 720 azimuths (0.5° bins). Each ray follows the great circle across the curved Moon and samples
            the finest available elevation model: 5 m to 12 km, 80 m to 150 km and 240 m to 300 km <Cite k={["barker", "lola"]} />. The horizon in azimuth α is the highest
            apparent elevation of the terrain along that ray (Figure {figs.horizon}):
          </p>
          <div className="pn-eq">
            H(α) = max<sub>s ≥ s<sub>min</sub></sub> asin( ((R + h(s))·v(s) − P₀) · û₀ / |(R + h(s))·v(s) − P₀| )
          </div>
          <p>
            Here v(s) is the unit vector of the point at arc distance s, P₀ the observer position and û₀ its local vertical. Lunar curvature enters through the 3-D geometry. The
            nearest 1.5 cells of the finest model are skipped, so an observer's own terrain cell cannot shade it.
          </p>
          <Fig id="fig-horizon" caption={<><b>Figure {figs.horizon}.</b> Schematic of horizon tracing (not to scale).</>}>
            <HorizonDiagram />
          </Fig>
          <h3>5.2 Sun, Earth and ground stations</h3>
          <p>
            Apparent ("LT+S") Sun and Earth directions come every hour from local SPICE kernels in the MOON_ME frame, the frame of the terrain products{" "}
            <Cite k={["spice", "lola"]} />. Deep Space Network geometry uses the station kernels and the elevation masks of the DSN handbook <Cite k="dsn" />.
          </p>
          <h3>5.3 Visibility</h3>
          <p>With e the elevation of a body above the skyline at its azimuth and ρ its angular radius, the visible fraction of the solar disc is</p>
          <div className="pn-eq">
            f = 1 − [ acos(e/ρ) − (e/ρ)·√(1 − (e/ρ)²) ] / π, for |e| &lt; ρ (0 below, 1 above)
          </div>
          <p>
            Earth counts as visible when e ≥ 2°, a margin that is our assumption and is user-set. A DSN geometric opportunity requires Earth visibility and the Moon above the mask
            at Goldstone, Madrid or Canberra.
          </p>
          <h3>5.4 Landing uncertainty and robust aim</h3>
          <p>
            Touchdowns are drawn around the aim from a circular or elliptical Gaussian model (2,000 samples, fixed seed). Each touchdown is scored from a precomputed grid of
            horizons at 10–25 m spacing; horizons are never recomputed per sample. For a candidate aim <i>a</i> the robust score is the q-th percentile of the outcome, and the
            robust aim maximises it (Figure {figs.unc}):
          </p>
          <div className="pn-eq">
            a* = argmax<sub>a</sub> P<sub>q</sub>[ sunlight(X) ], X ~ p(X | a), q ∈ {"{"}50, 20, 10, 5{"}"}
          </div>
          <Fig id="fig-unc" caption={<><b>Figure {figs.unc}.</b> Schematic: the same landing error around two aims. The robust aim trades a little nominal sunlight for a much better worst case.</>}>
            <UncertaintyDiagram />
          </Fig>
          <h3>5.5 Energy endurance</h3>
          <p>
            Power from vertical panels, P = Σ P<sub>rated</sub> · f · max(0, cos E<sub>sun</sub> cos(A<sub>sun</sub> − A<sub>panel</sub>)), drives an hourly battery balance with
            hibernation. The VIPER preset uses NASA's published battery and array ratings <Cite k="viper" />; its operating load is our assumption. The output is an energy
            endurance estimate, not a thermal or electrical simulation.
          </p>
        </section>

        <section id="s6" data-reveal>
          <h2>
            <span>6</span> Findings
          </h2>
          <h3>6.1 The Sun skims the horizon</h3>
          <p>
            Even on a perfectly smooth Moon, the Sun at Connecting Ridge stays within {n(geo?.max, 1)}° of the horizon all year and is above it {n(geo?.sunUp)}% of the time; the
            Sun and the Earth are up together only {n(geo?.both)}% of the time (Figure {figs.elev}).
          </p>
          <Fig id="fig-elev" wide loading={!geo} caption={<><b>Figure {figs.elev}.</b> Daily range of Sun (amber) and Earth (blue) elevation at Connecting Ridge in 2027 on a smooth Moon, from SPICE (DE440, MOON_ME) <Cite k="spice" />.</>}>
            {geo && <ElevationChart e={geo.e} />}
          </Fig>
          <h3>6.2 Real terrain changes the answer</h3>
          <p>
            With real terrain, sunlight or Earth visibility at the best point of {n(changed)} of {n(terrain?.length)} sites moves by at least 10 percentage points from the
            smooth-Moon value (Figure {figs.terr}). On high ridges the horizon can even dip below the level horizon, extending the day (Figure {figs.sky}); a few hundred
            metres away, on a crater wall, it can rise above the Sun's highest path and leave the ground in permanent shadow.
          </p>
          <Fig id="fig-sky" wide loading={!cr1 || !geo} caption={<><b>Figure {figs.sky}.</b> The terrain skyline seen from the brightest point of Connecting Ridge (2 m mast), with every third hourly Sun position of 2027. Terrain: PGDA 78 5 m and LOLA <Cite k={["barker", "lola"]} />.</>}>
            {cr1 && geo && <SkylineChart deg={cr1.skyline.deg} e={geo.e} />}
          </Fig>
          <Fig id="fig-terr" wide loading={!terrain} caption={<><b>Figure {figs.terr}.</b> Smooth Moon (outline) against real terrain (filled) at each site's brightest grid point: Sun (amber; terrain value is the disc-weighted sunlit fraction) and Earth (blue), 2027, 2 m mast.</>}>
            {terrain && <TerrainBars rows={terrain} />}
          </Fig>
          <h3>6.3 Where you actually land decides it too (RQ1)</h3>
          <p>
            Aiming at the brightest point of Shackleton rim gives {n(shk100?.nominal)}% sunlight if the landing is perfect, but across a ±100 m landing zone the median touchdown
            gets {n(shk100?.p50)}% and one in ten gets {n(shk100?.p10)}% or less. On Connecting Ridge the same zone spans {n(cr100?.p05)}% to {n(cr100?.nominal)}% (Figure{" "}
            {figs.range}).
          </p>
          <Fig id="fig-range" wide loading={!risk} caption={<><b>Figure {figs.range}.</b> Sunlight in 2027 at the aim (white triangle) and across 2,000 simulated touchdowns: median P50 (blue), P10 (amber) and P05 (red), for ±100 m and ±400 m landing zones around each site's brightest point.</>}>
            {risk && <RangeChart rows={risk} />}
          </Fig>
          <h3>6.4 The brightest spot is not the safest aim (RQ2)</h3>
          <p>
            On Connecting Ridge the brightest grid point receives {n(robust?.bestNominal.value, 1)}% sunlight, but its 10th-percentile outcome under a ±100 m miss is{" "}
            {n(robust?.bestNominal.pq, 1)}%. Searching {robust ? robust.candidates.toLocaleString() : "…"} candidate aims finds a point {n(dist)} m away with{" "}
            {n(robust?.robust.value, 1)}% nominal and {n(robust?.robust.pq, 1)}% in the 10th percentile (Figure {figs.map}). The gain grows with larger uncertainty and stricter
            percentiles.
          </p>
          <Fig id="fig-map" loading={!cr1 || !robust} caption={<><b>Figure {figs.map}.</b> Connecting Ridge: computed sunlight (cividis, 2027, 2 m mast) on a 10 m grid. Triangle: brightest point; star: robust aim (P10, ±100 m, circles show the landing zone).</>}>
            {cr1 && robust && <FieldMap field={cr1.field} bright={robust.bestNominal} robust={robust.robust} radius={100} />}
          </Fig>
          <h3>6.5 When you land decides how long you last (RQ3)</h3>
          <p>
            At the brightest point of Connecting Ridge a VIPER-class rover's energy endurance ranges from {n(endCr && Math.min(...endCr))} to{" "}
            {endCr ? (Math.max(...endCr) >= CAP ? `${CAP}+` : n(Math.max(...endCr))) : "…"} days depending on the landing date; on the Mons Mouton plateau from{" "}
            {n(endMou && Math.min(...endMou))} to {endMou ? (Math.max(...endMou) >= CAP ? `${CAP}+` : n(Math.max(...endMou))) : "…"} days (Figure {figs.endur}). "Percent sunlit"
            alone does not reveal this. The ceiling near two weeks reflects the fixed heading in this estimate: half a lunar day later the Sun reaches the side without a panel.
          </p>
          <Fig id="fig-endur" wide loading={!endurance} caption={<><b>Figure {figs.endur}.</b> Energy endurance estimate (days until the battery is exhausted) for every landing day of 2027, VIPER preset <Cite k="viper" />, at each site's brightest point. Fixed heading with the aft panel toward the Sun at landing and no repositioning; a rover that turns its panels would do better. Loads are assumptions.</>}>
            {endurance && <EnduranceChart series={endurance} cap={CAP} />}
          </Fig>
        </section>

        <section id="s7" data-reveal>
          <h2>
            <span>7</span> Validation (RQ4)
          </h2>
          <p>
            Tolerances were fixed before any result existed. Against NASA's PGDA 69 maps <Cite k="mazarico" /> at {n(v1?.points.length)} points (five sites and twelve random
            landable points), the mean absolute error is {n(v1?.mae_sun, 2)} pp for the Sun and {n(v1?.mae_earth, 2)} pp for the Earth (target ≤ 2 pp; Figure {figs.scatter}).
            Against Gläser et al. <Cite k="glaser" />, {n(v2?.n_within)} of {n(v2?.n)} published values agree within 3 pp (Figure {figs.glaser}). SPICE geometry agrees with JPL
            Horizons <Cite k="horizons" /> to {v4 ? Math.max(...v4.cases.map((c) => c.max_arcsec)).toFixed(2) : "…"}″.
          </p>
          <div className="pn-rep__pair pn-rep__pair--stack">
            <Fig id="fig-scatter" loading={!v1} caption={<><b>Figure {figs.scatter}.</b> Penumbra against NASA PGDA 69: Sun (amber dots) and Earth (blue squares) average visibility, %, on the 1:1 line.</>}>
              {v1 && (
                <ScatterChart
                  points={[
                    ...v1.points.map((p) => ({ name: p.name, ref: p.pgda_sun, ours: p.ours_sun, kind: "sun" as const })),
                    ...v1.points.map((p) => ({ name: p.name, ref: p.pgda_earth, ours: p.ours_earth, kind: "earth" as const })),
                  ]}
                />
              )}
            </Fig>
            <Fig id="fig-glaser" wide loading={!v2} caption={<><b>Figure {figs.glaser}.</b> Published average illumination (open circles) against Penumbra (filled), with the difference in percentage points.</>}>
              {v2 && <DumbbellChart rows={v2.points.map((p) => ({ label: p.point, published: p.published, ours: p.ours }))} />}
            </Fig>
          </div>
        </section>

        <section id="s8" data-reveal>
          <h2>
            <span>8</span> Discussion and limitations
          </h2>
          <p>
            The results support planning for landing zones rather than points. Three limits apply. First, terrain resolution and elevation error affect the answer: 5 m
            products are partly interpolated between laser tracks, and surface-level light on knife-edge ridges depends on the elevation model's scale <Cite k={["barker", "glaser"]} />.
            Second, the landing-error model is chosen by the user and is not the true distribution of any specific lander. Third, DSN geometric visibility does not guarantee
            scheduled service, and the energy model is not a thermal or electrical simulation. Terrain-error clones published with PGDA 78 <Cite k="barker" /> can extend the
            uncertainty analysis to the terrain itself.
          </p>
        </section>

        <section id="s9" data-reveal>
          <h2>
            <span>9</span> Conclusions
          </h2>
          <ul className="pn-rep__concl">
            <li>Polar landing outcomes vary strongly across realistic landing zones; plans should report distributions, not single points.</li>
            <li>Aiming for the best worst likely outcome, rather than the brightest point, reduces the downside of a landing miss at a small nominal cost.</li>
            <li>The landing date changes energy endurance at a fixed point, so sites must be compared on a calendar basis.</li>
            <li>These quantities can be computed from public NASA and JPL data with errors of a few percentage points against independent results.</li>
          </ul>
          <p className="pn-rep__avail">
            <b>Data and code availability.</b> All inputs are public NASA/JPL products (Table 1). Every figure on this page is regenerated by the Penumbra engine when the page
            loads; the method and validation are documented in the project repository.
          </p>
        </section>

        <section id="refs" className="pn-rep__refs" data-reveal>
          <h2>References</h2>
          <ol>
            {REFS.map((r) => (
              <li key={r.key} id={`ref-${r.key}`}>
                {r.text}{" "}
                {r.url && (
                  <a href={r.url} target="_blank" rel="noreferrer">
                    {r.url.replace(/^https?:\/\//, "").slice(0, 70)}
                    {r.url.length > 78 ? "…" : ""}
                  </a>
                )}
              </li>
            ))}
          </ol>
        </section>
      </article>
    </div>
  );
}
