import { useApp } from "../../state/store";
import { useSite } from "../../hooks/useMission";

export function HeatLegend() {
  const metric = useApp((s) => s.heatMetric);
  const hasRobust = useApp((s) => s.robust.result !== null);
  const unc = useApp((s) => s.uncertainty);
  const q = useApp((s) => s.percentile);
  const site = useSite();
  const robust = metric === "robust" && hasRobust;
  const zone = unc.model === "circular" ? `±${unc.radius} m` : `σ ${unc.sigmaE}/${unc.sigmaN} m`;
  return (
    <div className="pn-legend" aria-label="Heatmap legend">
      <div className="ids-overline">{robust ? `P${q} sunlight if you aim here (${zone})` : "Sunlight, % of 2027"}</div>
      <div className="ids-legend__ramp" />
      <div className="ids-legend__ticks">
        <span>0</span>
        <span>25</span>
        <span>50</span>
        <span>75</span>
        <span>100</span>
      </div>
      <p className="pn-legend__src">{site.field.source}</p>
    </div>
  );
}
