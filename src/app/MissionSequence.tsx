/** Mission sequence: the planner's story, step by step. Each step shows whether it is done and jumps to it. */
import { getState, setState, useApp } from "../state/store";
import { useModel, useSite } from "../hooks/useMission";
import { findRobustAim } from "../features/mission/RobustAim";
import { goTo } from "./Header";

interface Step {
  n: string;
  label: string;
  hint: string;
  done: boolean;
  active?: boolean;
  go: () => void;
}

function openSiteMenu() {
  (document.querySelector(".pn-hdr__picker") as HTMLButtonElement | null)?.click();
}

function focusCalendar() {
  const el = document.querySelector(".pn-cal") as HTMLElement | null;
  el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  el?.classList.add("is-flash");
  setTimeout(() => el?.classList.remove("is-flash"), 1200);
}

export function MissionSequence() {
  const site = useSite();
  const model = useModel();
  const unc = useApp((s) => s.uncertainty.enabled);
  const robust = useApp((s) => s.robust);
  const q = useApp((s) => s.percentile);
  const view = useApp((s) => s.view);
  const progress = useApp((s) => s.progress);
  const steps: Step[] = [
    { n: "01", label: "Site", hint: `${site.name} · change the landing site`, done: true, go: openSiteMenu },
    { n: "02", label: "Date", hint: "Pick the landing date on the calendar strip", done: true, go: focusCalendar },
    {
      n: "03",
      label: "Uncertainty",
      hint: "Turn on the landing ellipse: where you may actually land",
      done: unc,
      go: () => setState((s) => ({ uncertainty: { ...s.uncertainty, enabled: true }, view: "map" })),
    },
    {
      n: "04",
      label: "Robust aim",
      hint: "Search every aim for the best worst-likely sunlight",
      done: robust.status === "done",
      active: robust.status === "running",
      go: () => {
        if (getState().robust.status !== "running") findRobustAim(site.id, model, q);
      },
    },
    {
      n: "05",
      label: "Skyline",
      hint: "See the real terrain horizon with the Sun and Earth moving over it",
      done: progress.sky || view === "sky",
      go: () => setState((s) => ({ view: "sky", progress: { ...s.progress, sky: true } })),
    },
    { n: "06", label: "Compare", hint: "Rank this site against the others", done: progress.compare, go: () => goTo("compare") },
    {
      n: "07",
      label: "Export",
      hint: "Download the decision summary with its provenance",
      done: progress.export,
      go: () => setState((s) => ({ dialog: "export", progress: { ...s.progress, export: true } })),
    },
  ];
  const next = steps.find((s) => !s.done);
  return (
    <nav className="pn-seq" aria-label="Mission sequence">
      <span className="pn-seq__title">Mission sequence</span>
      <ol className="pn-seq__list">
        {steps.map((s) => (
          <li key={s.n}>
            <button
              className={`pn-seq__step${s.done ? " is-done" : ""}${s === next ? " is-next" : ""}${s.active ? " is-active" : ""}`}
              onClick={s.go}
              title={s.hint}
              aria-label={`Step ${s.n}: ${s.label}${s.done ? " (done)" : ""}. ${s.hint}`}
            >
              <span className="pn-seq__n">{s.done ? "✓" : s.n}</span>
              <span className="pn-seq__label">{s.label}</span>
            </button>
          </li>
        ))}
      </ol>
      {next && <span className="pn-seq__next">Next: {next.hint}</span>}
    </nav>
  );
}
