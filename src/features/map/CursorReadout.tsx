import { useSite } from "../../hooks/useMission";
import { offsetToLatLon } from "../../utils/field";

export interface CursorInfo {
  x: number;
  y: number;
  h: number | null;
  sun: number | null;
}

/** Monospace status strip (LROC QuickMap pattern): position, height and the value under the cursor. */
export function CursorReadout({ info }: { info: CursorInfo | null }) {
  const site = useSite();
  const ll = info ? offsetToLatLon(site, info) : null;
  const cell = (k: string, v: string) => (
    <div className="pn-readout__cell">
      <span>{k}</span>
      <b className="ids-num">{v}</b>
    </div>
  );
  return (
    <div className="pn-readout" aria-live="off">
      {cell("X, Y", info ? `${info.x.toFixed(0)}, ${info.y.toFixed(0)} m` : "—")}
      {cell("LAT, LON", ll ? `${ll[0].toFixed(4)}°, ${ll[1].toFixed(3)}°E` : "—")}
      {cell("HEIGHT", info?.h != null ? `${info.h.toFixed(1)} m` : "—")}
      {cell("SUNLIGHT", info?.sun != null ? `${info.sun.toFixed(1)} %` : "—")}
      {cell("DEM", "5 m · MOON_ME")}
    </div>
  );
}
