import { useState } from "react";
import { setState, useApp, type AppState } from "../../state/store";
import { useSite } from "../../hooks/useMission";
import { Prov } from "../../components/ui";

type Key = keyof AppState["layers"];

export function LayerList() {
  const layers = useApp((s) => s.layers);
  const heatMetric = useApp((s) => s.heatMetric);
  const hasRobust = useApp((s) => s.robust.result !== null);
  const site = useSite();
  const [open, setOpen] = useState(false);
  const rows: { key: Key; name: string; source: string; prov: "verified" | "computed" }[] = [
    { key: "heat", name: heatMetric === "robust" ? "Robust score (lower-tail sunlight)" : "Sunlight, % of 2027", source: `Penumbra engine · ${site.field.dx} m grid · 2 m mast`, prov: "computed" },
    { key: "ellipse", name: "Landing uncertainty zone", source: "User-selected model", prov: "computed" },
    { key: "samples", name: "Possible touchdowns", source: "2,000 simulated (500 drawn)", prov: "computed" },
    { key: "relief", name: "Shaded relief (lit by the Sun)", source: `NASA PGDA 78 · ${site.tile} · 5 m`, prov: "verified" },
    { key: "slope", name: "Slope > 5°", source: `NASA PGDA 78 · ${site.tile}_slp`, prov: "verified" },
    { key: "known", name: "Known points", source: site.known_points?.length ? "Gläser et al. 2018" : "None at this site", prov: "verified" },
  ];
  const toggle = (k: Key) => setState((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } }));
  return (
    <section className={`pn-layers${open ? "" : " is-closed"}`} aria-label="Map layers">
      <button className="pn-layers__head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="ids-overline">Layers</span>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <>
          <ul>
            {rows.map((r) => (
              <li key={r.key} className={layers[r.key] ? "is-on" : ""}>
                <button className="pn-layers__eye" role="switch" aria-checked={layers[r.key]} aria-label={`Show ${r.name}`} onClick={() => toggle(r.key)}>
                  {layers[r.key] ? "◉" : "○"}
                </button>
                <div className="pn-layers__txt">
                  <span>{r.name}</span>
                  <small>
                    {r.source} <Prov kind={r.prov} />
                  </small>
                </div>
              </li>
            ))}
          </ul>
          {hasRobust && (
            <div className="pn-layers__metric">
              <span className="ids-overline">Heatmap shows</span>
              <div className="ids-seg pn-seg pn-seg--sm" role="radiogroup" aria-label="Heatmap metric">
                {(["nominal", "robust"] as const).map((m) => (
                  <button key={m} className="ids-seg__opt" role="radio" aria-checked={heatMetric === m} onClick={() => setState({ heatMetric: m })}>
                    {m === "nominal" ? "Nominal" : "Robust"}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
