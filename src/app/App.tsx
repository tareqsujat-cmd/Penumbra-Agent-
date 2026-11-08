import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useEffect, useState } from "react";
import { getState, setState, useApp, type View } from "../state/store";
import { brightest, decodeEphem } from "../utils/field";
import { ApiError, loadSite, loadSiteList, siteSync } from "../api/client";
import type { SiteId } from "../types";
import { useStrings } from "../hooks/useMission";
import { Header } from "./Header";
import { MapView } from "../features/map/MapView";
import { Terrain3D } from "../features/terrain3d/Terrain3D";
import { Seg } from "../components/ui";
import { MissionCard } from "../features/mission/MissionCard";
import { Calendar } from "../features/timeline/Calendar";
import { SkyView } from "../features/skyline/SkyView";
import { Compare } from "../features/comparison/Compare";
import { ValidationPanel } from "../features/validation/ValidationPanel";
import { SimpleView } from "../features/simple/SimpleView";
import { DataDialog, ExportDialog, VehicleDialog } from "../features/provenance/Dialogs";
import { GlobeView } from "../features/globe/GlobeView";
import { SystemPage, Eclipse } from "../features/about/SystemPage";
import { ResearchReport } from "../features/report/ResearchReport";
import { StarBackdrop } from "../components/StarBackdrop";
import { loadSky } from "../features/sky/stars";
import { MissionSequence } from "./MissionSequence";

function Toast() {
  const toast = useApp((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setState({ toast: null }), 3600);
    return () => clearTimeout(id);
  }, [toast]);
  return (
    <div className={`pn-toast${toast ? " is-in" : ""}`} role="status" aria-live="polite">
      {toast}
    </div>
  );
}

function Planner() {
  const { t } = useStrings();
  const view = useApp((s) => s.view);
  const mapMode = useApp((s) => s.mapMode);
  const [skySeen, setSkySeen] = useState(false);
  const tab = view === "sky" ? "sky" : "map";
  useEffect(() => {
    if (tab === "sky") {
      setSkySeen(true);
      if (!getState().progress.sky) setState((s) => ({ progress: { ...s.progress, sky: true } }));
    }
  }, [tab]);
  return (
    <div className="pn-planner">
      <MissionSequence />
      <Tabs.Root className="pn-views" value={tab} onValueChange={(v) => setState({ view: v as View })}>
        <Tabs.List className="pn-views__tabs" aria-label="Views">
          <Tabs.Trigger value="map" className="pn-views__tab">{t.viewMap}</Tabs.Trigger>
          <Tabs.Trigger value="sky" className="pn-views__tab">{t.viewSky}</Tabs.Trigger>
          {tab === "map" && (
            <div className="pn-views__mode">
              <Seg label="Map mode" size="sm" value={mapMode} onChange={(v) => setState({ mapMode: v })} options={[{ value: "3d", label: "3-D terrain" }, { value: "2d", label: "2-D plan" }]} />
            </div>
          )}
        </Tabs.List>
        <Tabs.Content value="map" className="pn-views__panel" forceMount hidden={tab !== "map"}>
          {mapMode === "3d" ? <Terrain3D active={tab === "map"} /> : <MapView />}
        </Tabs.Content>
        <Tabs.Content value="sky" className="pn-views__panel" forceMount hidden={tab !== "sky"}>
          {skySeen && <SkyView active={tab === "sky"} />}
        </Tabs.Content>
      </Tabs.Root>
      <MissionCard />
      <div className="pn-planner__cal">
        <Calendar />
      </div>
    </div>
  );
}

/** Compare: full-width ranking, with the calendar to move the landing date. */
function ComparePage() {
  useEffect(() => {
    if (!getState().progress.compare) setState((s) => ({ progress: { ...s.progress, compare: true } }));
  }, []);
  return (
    <div className="pn-page pn-page--cal">
      <div className="pn-page__body">
        <Compare />
      </div>
      <div className="pn-planner__cal">
        <Calendar />
      </div>
    </div>
  );
}

function SciencePage() {
  return (
    <div className="pn-page">
      <div className="pn-page__body">
        <ValidationPanel />
      </div>
    </div>
  );
}

/** Start-up screen while the site registry and the first site bundle load, or when the backend is down. */
function Boot({ error, steps }: { error: ApiError | null; steps: { label: string; done: boolean }[] }) {
  return (
    <div className="pn-boot" role="status" aria-live="polite">
      <StarBackdrop />
      <div className="pn-boot__card">
        <Eclipse className="pn-eclipse--sm" />
        <div className="pn-boot__name pn-glow">PENUMBRA</div>
        <div className="pn-kicker">Lunar south pole · landing analysis</div>
        {error ? (
          <>
            <h2>Data unavailable</h2>
            <p>{error.message}</p>
            <p className="pn-boot__code">
              {error.code}
              {error.detail && Object.keys(error.detail).length ? ` · ${JSON.stringify(error.detail)}` : ""}
            </p>
          </>
        ) : (
          <ul className="pn-boot__steps">
            {steps.map((st) => (
              <li key={st.label} data-done={st.done}>
                <span className="pn-boot__tick" aria-hidden="true">{st.done ? "✓" : ""}</span>
                {st.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function App() {
  const mode = useApp((s) => s.mode);
  const [boot, setBoot] = useState<{ ready: boolean; error: ApiError | null }>({ ready: false, error: null });
  const [done, setDone] = useState({ list: false, site: false, sky: false, fonts: false });
  useEffect(() => {
    const s = getState();
    const mark = (k: keyof typeof done) => <T,>(v: T) => {
      setDone((d) => ({ ...d, [k]: true }));
      return v;
    };
    Promise.all([
      loadSiteList().then(mark("list")),
      loadSite(s.siteId).then(mark("site")),
      loadSky().then(mark("sky")),
      (document.fonts?.ready ?? Promise.resolve()).then(mark("fonts")),
    ])
      .then(([list]) => {
        const site = siteSync(s.siteId);
        const b = brightest(site.field);
        setState({ aim: { x: b.x, y: b.y }, aimKind: "brightest" });
        const e = decodeEphem(site);
        let best = s.landingIdx;
        for (let k = s.landingIdx; k < Math.min(s.landingIdx + 72, e.n); k++) if (e.sunEl[k] > e.sunEl[best]) best = k;
        setState({ cursorIdx: best });
        setBoot({ ready: true, error: null });
        // the other sites load in the background so switching is instant
        list.filter((x) => x.id !== s.siteId).forEach((x, i) => setTimeout(() => loadSite(x.id as SiteId).catch(() => undefined), 400 * (i + 1)));
      })
      .catch((e: unknown) => setBoot({ ready: false, error: e instanceof ApiError ? e : new ApiError("COMPUTE_FAILED", String(e)) }));
  }, []);
  if (!boot.ready)
    return (
      <Boot
        error={boot.error}
        steps={[
          { label: "Site registry", done: done.list },
          { label: "5 m terrain and computed sunlight field", done: done.site },
          { label: "Bright Star Catalogue and lunar frame", done: done.sky },
          { label: "Instrument typefaces", done: done.fonts },
        ]}
      />
    );
  return (
    <Tooltip.Provider>
      <div className={`pn-app ids pn-mode-${mode}${mode === "globe" ? " is-globe" : ""}`}>
        {mode !== "globe" && mode !== "planner" && <StarBackdrop dim={mode === "about" ? 0.8 : mode === "report" ? 0.45 : 0.62} />}
        <Header />
        <main className="pn-main" key={mode}>
          {mode === "globe" ? (
            <GlobeView />
          ) : mode === "planner" ? (
            <Planner />
          ) : mode === "compare" ? (
            <ComparePage />
          ) : mode === "science" ? (
            <SciencePage />
          ) : mode === "report" ? (
            <div className="pn-page">
              <div className="pn-page__body">
                <ResearchReport />
              </div>
            </div>
          ) : mode === "about" ? (
            <div className="pn-page">
              <div className="pn-page__body">
                <SystemPage />
              </div>
            </div>
          ) : (
            <SimpleView />
          )}
        </main>
        <DataDialog />
        <ExportDialog />
        <VehicleDialog />
        <Toast />
      </div>
    </Tooltip.Provider>
  );
}
