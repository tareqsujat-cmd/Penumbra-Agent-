import { api } from "../../api/client";
import { getState, setState, useApp } from "../../state/store";
import { useModel, useSite, useStrings } from "../../hooks/useMission";
import { Num, Prov, Steps, Tip } from "../../components/ui";
import { fmtOffset } from "../../utils/format";
import type { Percentile, SiteId, UncertaintyModel } from "../../types";

/** Staged robust-aim search shared by the planner card and the globe landing panel. */
export async function findRobustAim(siteId: SiteId, model: UncertaintyModel, q: Percentile) {
  const s = getState();
  if (!s.uncertainty.enabled) setState({ uncertainty: { ...s.uncertainty, enabled: true } });
  setState({ robust: { status: "running", stage: 0, result: null, revealed: false }, heatMetric: "nominal" });
  const t0 = performance.now();
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await wait(550);
  setState({ robust: { ...getState().robust, stage: 1 } });
  const result = await api.robustAim({ site: siteId, aim: s.aim, model, enabled: true, percentile: q, seed: 7 });
  await wait(Math.max(0, 1150 - (performance.now() - t0)));
  setState({ robust: { ...getState().robust, stage: 2 } });
  await wait(650);
  setState({ robust: { status: "done", stage: 3, result, revealed: false }, heatMetric: "robust" });
  await wait(950);
  setState({ robust: { ...getState().robust, revealed: true } });
}

export function resetRobust() {
  setState((s) => ({ robust: { status: "idle", stage: 0, result: null, revealed: false }, heatMetric: "nominal", aimKind: s.aimKind === "robust" ? "custom" : s.aimKind }));
}

function useRobustStages() {
  const site = useSite();
  return ["Sampling landing zone…", `Evaluating ${site.field.nx * site.field.ny} candidate aims…`, "Optimising robust aim…"];
}

/** Primary action (pinned at the bottom of the planner's mission panel). */
export function RobustAimButton() {
  const { t } = useStrings();
  const site = useSite();
  const model = useModel();
  const robust = useApp((s) => s.robust);
  const q = useApp((s) => s.percentile);
  const stages = useRobustStages();
  return (
    <div className="pn-robust">
      <button className="ids-btn ids-btn--primary ids-btn--lg ids-btn--block pn-robust__btn" onClick={() => findRobustAim(site.id, model, q)} disabled={robust.status === "running"}>
        {robust.status === "running" ? (
          <>
            <span className="ids-btn__spinner" />
            {stages[Math.min(robust.stage, 2)]}
          </>
        ) : (
          <>{robust.status === "done" ? "Search again" : t.findRobust}</>
        )}
      </button>
      {robust.status === "running" && <Steps steps={stages} active={robust.stage} />}
    </div>
  );
}

/** Brightest point vs robust aim, once a search has run. */
export function RobustAimResult() {
  const { t } = useStrings();
  const robust = useApp((s) => s.robust);
  const q = useApp((s) => s.percentile);
  const aimKind = useApp((s) => s.aimKind);
  const r = robust.result;
  if (!r)
    return (
      <p className="pn-insp__empty">
        Press <b>{t.findRobust}</b> below. Penumbra tests every candidate aim against all likely touchdowns and keeps the one whose P{q} sunlight is highest.
      </p>
    );
  return (
    <div className="pn-robust__result">
      <div className="pn-robust__cols">
        <div className="pn-robust__col pn-robust__col--bright">
          <div className="pn-robust__tag">
            <span className="pn-glyph pn-glyph--tri" aria-hidden="true" /> {t.brightest}
          </div>
          <dl>
            <dt>Nominal</dt>
            <dd className="ids-num">{r.bestNominal.value.toFixed(0)}%</dd>
            <dt>P{q}</dt>
            <dd className="ids-num pn-bad">{r.bestNominal.pq.toFixed(0)}%</dd>
          </dl>
        </div>
        <div className="pn-robust__col pn-robust__col--robust">
          <div className="pn-robust__tag">
            <span className="pn-glyph pn-glyph--star" aria-hidden="true" /> Robust aim
          </div>
          <dl>
            <dt>Nominal</dt>
            <dd className="ids-num">
              <Num value={r.robust.value} />%
            </dd>
            <dt>P{q}</dt>
            <dd className="ids-num pn-good">
              <Num value={r.robust.pq} digits={r.robust.pq % 1 ? 1 : 0} />%
            </dd>
          </dl>
        </div>
      </div>
      <div className={`pn-reveal${robust.revealed ? " is-in" : ""}`} role="status">
        {t.reveal}
      </div>
      <p className="pn-robust__where">
        Robust aim is {fmtOffset(r.robust.x - r.bestNominal.x, r.robust.y - r.bestNominal.y)} of the brightest point · {r.candidates} aims searched in {r.elapsedMs.toFixed(0)} ms{" "}
        <Prov kind="computed" />
      </p>
      <div className="pn-robust__actions">
        <button className="ids-btn ids-btn--block" onClick={() => setState({ aim: { x: r.robust.x, y: r.robust.y }, aimKind: "robust" })} disabled={aimKind === "robust"}>
          {aimKind === "robust" ? "✓ Robust aim commanded" : "Command robust aim"}
        </button>
        <Tip
          title="How the robust aim is chosen"
          text={`For every candidate aim, Penumbra looks at all the places the lander could touch down under the selected landing-error model and takes the P${q} sunlight (the value that ${100 - q}% of touchdowns reach or exceed). The robust aim maximises that lower-tail value.`}
        />
      </div>
    </div>
  );
}
