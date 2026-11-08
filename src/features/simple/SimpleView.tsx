import { useEffect } from "react";
import { getState, setState, useApp } from "../../state/store";
import { useApiCall, useDebounced, useModel, useRisk, useSite, useStrings, useVisibility } from "../../hooks/useMission";
import { api } from "../../api/client";
import { num } from "../../i18n/strings";
import { Terrain3D } from "../terrain3d/Terrain3D";
import { Calendar } from "../timeline/Calendar";
import { Prov, Seg } from "../../components/ui";
import { fmtDate, fmtOffset } from "../../utils/format";

export function SimpleView() {
  const { t } = useStrings();
  const site = useSite();
  const risk = useRisk();
  const vis = useVisibility();
  const model = useDebounced(useModel());
  const q = useApp((s) => s.percentile);
  const u = useApp((s) => s.uncertainty);
  const landingIdx = useApp((s) => s.landingIdx);
  const windowDays = useApp((s) => s.windowDays);
  const rr = useApiCall(JSON.stringify(["robust", site.id, model, q]), () =>
    api.robustAim({ site: site.id, aim: { x: 0, y: 0 }, model, enabled: true, percentile: q, seed: 7 }),
  );
  const rec = rr.data;
  // show the recommended aim (★) on the map
  useEffect(() => {
    if (rec && getState().robust.result !== rec) setState({ robust: { status: "done", stage: 3, result: rec, revealed: true } });
  }, [rec]);
  const first72 = vis.sunFrac.slice(0, 72);
  const early = (100 * first72.reduce((a, b) => a + b, 0)) / Math.max(1, first72.length);
  const light = early >= 70 ? t.goodLight : early >= 35 ? t.fairLight : t.poorLight;
  const drop = risk.nominal - risk.pq;
  const riskTxt = drop < 5 ? t.lowRisk : drop < 15 ? t.modRisk : t.highRisk;
  const riskLevel = drop < 5 ? "ok" : drop < 15 ? "warn" : "danger";
  const preset = !u.enabled ? "off" : u.model === "circular" ? String(u.radius) : "custom";
  const n = (v: number, d = 0) => num(v, d);
  return (
    <div className="pn-simple">
      <section className="pn-simple__card" aria-label="Survival card">
        <div className="ids-overline">
          {site.name} · {fmtDate(landingIdx, false)}
        </div>
        <h2>{t.simpleIntro}</h2>
        <div className="pn-simple__ctrls">
          <span className="pn-field__label">{t.uncertainty}</span>
          <Seg
            label={t.uncertainty}
            value={preset}
            onChange={(v) => setState((s) => ({ uncertainty: { ...s.uncertainty, enabled: v !== "off", model: "circular", radius: v === "off" ? s.uncertainty.radius : Number(v) } }))}
            options={[
              { value: "50", label: "Precise ±50 m" },
              { value: "100", label: "Typical ±100 m" },
              { value: "400", label: "Loose ±400 m" },
            ]}
          />
        </div>
        <ul className="pn-simple__facts">
          <li data-level={early >= 70 ? "ok" : early >= 35 ? "warn" : "danger"}>
            <b>{light}</b>
            <span>{n(early)}% · 72 h</span>
          </li>
          <li data-level={riskLevel}>
            <b>{riskTxt}</b>
            <span>
              ±{n(u.radius)} m
            </span>
          </li>
          <li>
            <span className="pn-simple__k">{t.p10Illum}</span>
            <b className="pn-simple__big ids-num">{n(risk.pq)}%</b>
          </li>
          <li>
            <span className="pn-simple__k">{t.earthGeo}</span>
            <b className="pn-simple__big ids-num">{n(vis.summary.earthPct)}%</b>
          </li>
          <li>
            <span className="pn-simple__k">
              {t.longestDark} {n(windowDays)} {t.days}
            </span>
            <b className="pn-simple__big ids-num">{vis.summary.longestDarkH < 48 ? `${n(vis.summary.longestDarkH)} ${t.hours}` : `${n(vis.summary.longestDarkH / 24, 1)} ${t.days}`}</b>
          </li>
          <li className="pn-simple__rec">
            <span className="pn-simple__k">{t.recommended}</span>
            {rec ? (
              <>
                <b>{fmtOffset(rec.robust.x, rec.robust.y)}</b>
                <span>{`P${q} ${n(rec.robust.pq)}% here vs ${n(rec.bestNominal.pq)}% at the brightest point`}</span>
              </>
            ) : (
              <span>{rr.error ? `Unavailable: ${rr.error.message}` : "Searching every candidate aim…"}</span>
            )}
          </li>
        </ul>
        <p className="pn-simple__explain">
          {"Landers rarely touch down exactly where they aim. Penumbra looks at every likely touchdown spot and recommends the aim that keeps enough sunlight in almost every case."}
        </p>
        <p className="pn-provline">
          Computed from NASA PGDA 78 5 m and LOLA terrain with JPL SPICE geometry · energy and DSN in Planner mode <Prov kind="computed" />
        </p>
      </section>
      <section className="pn-simple__map" aria-label="Compact landing map">
        <Terrain3D simple />
      </section>
      <div className="pn-simple__cal">
        <Calendar />
      </div>
    </div>
  );
}
