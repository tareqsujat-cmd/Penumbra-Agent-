import * as THREE from "three";
import { setState, useApp } from "../../state/store";
import { useSite } from "../../hooks/useMission";
import { bilinear, inField } from "../../utils/field";
import { Prov } from "../../components/ui";
import { fmtOffset } from "../../utils/format";

export interface SurfacePick {
  world: THREE.Vector3;
  ox: number;
  oy: number;
  lat: number;
  lon: number;
  h: number;
  level: "5 m" | "80 m" | "960 m";
}

export function SurfaceInfo({ pick, onClose, onFly }: { pick: SurfacePick & { p10?: number | null; sunNow?: string }; onClose: () => void; onFly: () => void }) {
  const site = useSite();
  const q = useApp((s) => s.percentile);
  const aim = useApp((s) => s.aim);
  const inside = inField(site.field, { x: pick.ox, y: pick.oy });
  const sun = inside ? bilinear(site.field.sun, site.field, pick.ox, pick.oy) : null;
  const earth = inside ? bilinear(site.field.earth, site.field, pick.ox, pick.oy) : null;
  const dAim = Math.hypot(pick.ox - aim.x, pick.oy - aim.y);
  const distKm = Math.hypot(pick.ox, pick.oy) / 1000;
  return (
    <section className="pn-sinfo" aria-label="Surface point information">
      <header>
        <div>
          <div className="ids-overline">Surface point</div>
          <b className="ids-num">
            {pick.lat.toFixed(4)}°, {pick.lon.toFixed(3)}°E
          </b>
        </div>
        <button className="ids-btn ids-btn--ghost pn-icon-btn" onClick={onClose} aria-label="Close surface information">
          ✕
        </button>
      </header>
      <dl>
        <dt>Elevation</dt>
        <dd className="ids-num">
          {pick.h.toFixed(1)} m <small>LOLA {pick.level}</small>
        </dd>
        <dt>From site point</dt>
        <dd className="ids-num">{distKm < 1 ? fmtOffset(pick.ox, pick.oy) : `${distKm.toFixed(2)} km`}</dd>
        <dt>From commanded aim</dt>
        <dd className="ids-num">{dAim < 1000 ? `${dAim.toFixed(0)} m` : `${(dAim / 1000).toFixed(2)} km`}</dd>
        <dt>Sun now (local terrain)</dt>
        <dd className={pick.sunNow?.startsWith("Visible") ? "pn-good" : "pn-bad"}>{pick.sunNow}</dd>
        {inside ? (
          <>
            <dt>Sunlight, 2027</dt>
            <dd className="ids-num">
              {sun!.toFixed(1)}% <Prov kind="computed" />
            </dd>
            <dt>Earth visible, 2027</dt>
            <dd className="ids-num">{earth!.toFixed(1)}%</dd>
            <dt>P{q} if you aim here</dt>
            <dd className="ids-num">{pick.p10 == null ? "turn on landing uncertainty" : `${pick.p10.toFixed(1)}%`}</dd>
          </>
        ) : (
          <>
            <dt>Landing analysis</dt>
            <dd>Outside the precomputed 5 m landing grid</dd>
          </>
        )}
      </dl>
      <div className="pn-sinfo__actions">
        <button className="ids-btn ids-btn--primary" disabled={!inside} onClick={() => setState({ aim: { x: pick.ox, y: pick.oy }, aimKind: "custom" })}>
          Aim here
        </button>
        <button className="ids-btn" onClick={onFly}>
          Fly here
        </button>
      </div>
    </section>
  );
}
