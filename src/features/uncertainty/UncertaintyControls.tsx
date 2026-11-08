import { setState, useApp, type AppState } from "../../state/store";
import { Seg, SliderField, Tip } from "../../components/ui";
import { resetRobust } from "../mission/RobustAim";
import { useStrings } from "../../hooks/useMission";
import type { Percentile } from "../../types";

export function UncertaintyControls({ compact = false }: { compact?: boolean }) {
  const { t } = useStrings();
  const u = useApp((s) => s.uncertainty);
  const q = useApp((s) => s.percentile);
  const set = (p: Partial<AppState["uncertainty"]>) => {
    setState((s) => ({ uncertainty: { ...s.uncertainty, ...p } }));
    resetRobust();
  };
  return (
    <section className="pn-unc" aria-label={t.uncertainty}>
      <div className="pn-unc__head">
        <button className={`pn-switch${u.enabled ? " is-on" : ""}`} role="switch" aria-checked={u.enabled} onClick={() => setState((s) => ({ uncertainty: { ...s.uncertainty, enabled: !s.uncertainty.enabled } }))}>
          <span className="pn-switch__knob" />
        </button>
        <div className="pn-unc__title">
          <b>{t.uncertainty}</b>
          <span>{u.enabled ? (u.model === "circular" ? `±${u.radius} m circular zone` : `Gaussian σ ${u.sigmaE} × ${u.sigmaN} m, ${Math.round(u.conf * 100)}% ellipse`) : "Off: showing the aim point only"}</span>
        </div>
        <Tip title="Landing uncertainty" text="A user-selected model of where the lander may actually touch down. It is not automatically the true distribution of any real lander (Athena landed 250–370 m from its target; NASA's human-landing requirement is a 100 m radius)." />
      </div>
      {!compact && (
        <Seg
          label="Uncertainty model"
          size="sm"
          value={u.model}
          onChange={(m) => set({ model: m })}
          options={[
            { value: "circular", label: "Circular" },
            { value: "gaussian", label: "Elliptical Gaussian" },
          ]}
        />
      )}
      {u.model === "circular" ? (
        <SliderField id="unc-radius" label="Radius" value={u.radius} min={25} max={400} step={25} unit=" m" onChange={(v) => set({ radius: v, enabled: true })} />
      ) : (
        <div className="pn-unc__grid">
          <SliderField id="unc-se" label="σ east" value={u.sigmaE} min={10} max={200} step={5} unit=" m" onChange={(v) => set({ sigmaE: v, enabled: true })} />
          <SliderField id="unc-sn" label="σ north" value={u.sigmaN} min={10} max={200} step={5} unit=" m" onChange={(v) => set({ sigmaN: v, enabled: true })} />
          <SliderField id="unc-rot" label="Rotation" value={u.rotDeg} min={0} max={180} step={5} unit="°" onChange={(v) => set({ rotDeg: v, enabled: true })} />
          <SliderField id="unc-conf" label="Confidence ellipse" value={u.conf * 100} min={50} max={99} step={1} unit="%" onChange={(v) => set({ conf: v / 100 })} />
        </div>
      )}
      <div className="pn-field">
        <div className="pn-field__row">
          <span className="pn-field__label">Robustness level</span>
          <Tip title="Robustness level" text="Which lower-tail outcome to protect. P10 means: 90% of simulated touchdowns do at least this well." />
        </div>
        <Seg<`${Percentile}`>
          label="Robustness level"
          size="sm"
          value={`${q}` as `${Percentile}`}
          onChange={(v) => {
            setState({ percentile: Number(v) as Percentile });
            resetRobust();
          }}
          options={[
            { value: "50", label: "P50", title: "Typical" },
            { value: "20", label: "P20", title: "Cautious" },
            { value: "10", label: "P10", title: "Conservative" },
            { value: "5", label: "P05", title: "Highly conservative" },
          ]}
        />
      </div>
    </section>
  );
}
