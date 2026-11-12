/** "Show me where": highlights a real control on screen with a glowing outline and a label, after switching to the
 *  section it lives in and opening its collapsed card section if needed. */
import { getState, setState, type Mode } from "../../../state/store";
import { goTo } from "../../../app/Header";

export type SpotId =
  | "site" | "date" | "calendar" | "sequence" | "kpis" | "uncertainty" | "level" | "robustBtn" | "robustResult"
  | "skylineTab" | "window" | "vehicle" | "compareNav" | "comparePicker" | "export" | "data" | "briefingAccuracy";

interface Spot {
  label: string;
  /** section the control lives in (navigated to first) */
  mode?: Mode;
  find: () => HTMLElement | null;
}

const q = (sel: string) => () => document.querySelector<HTMLElement>(sel);
const byText = (sel: string, text: string) => () =>
  Array.from(document.querySelectorAll<HTMLElement>(sel)).find((el) => el.textContent?.toLowerCase().includes(text.toLowerCase())) ?? null;
/** a collapsible mission-card section by its title (opened on the way) */
const section = (title: string) => () => {
  const sum = byText(".pn-sec__title", title)();
  const det = sum?.closest("details") as HTMLDetailsElement | null;
  if (det && !det.open) det.open = true;
  return det;
};

export const SPOTS: Record<SpotId, Spot> = {
  site: { label: "Site: pick the landing site here", find: q(".pn-hdr__picker") },
  date: { label: "Landing date: one day back or forward", find: q(".pn-hdr__date") },
  calendar: { label: "Mission calendar: drag the year strip to move the landing date", mode: "planner", find: q(".pn-cal") },
  window: { label: "Mission window: 14, 30 or 90 days after landing", mode: "planner", find: byText(".pn-cal .ids-seg, .pn-cal [role=radiogroup]", "30") },
  sequence: { label: "Mission sequence: your steps, in order", mode: "planner", find: q(".pn-seq") },
  kpis: { label: "Your key numbers", mode: "planner", find: q(".pn-insp__kpis") },
  uncertainty: {
    label: "Landing uncertainty: switch it on and set the zone size",
    mode: "planner",
    find: () => {
      section("Landing uncertainty")();
      return document.querySelector<HTMLElement>(".pn-unc");
    },
  },
  level: {
    label: "Robustness level: how cautious to be",
    mode: "planner",
    find: () => {
      section("Landing uncertainty")();
      return byText(".pn-unc .pn-field", "Robustness level")();
    },
  },
  robustBtn: { label: "Find robust aim", mode: "planner", find: q(".pn-robust__btn") },
  robustResult: {
    label: "Brightest point vs robust aim",
    mode: "planner",
    find: () => {
      section("Robust aim")();
      return document.querySelector<HTMLElement>(".pn-robust__result") ?? byText(".pn-sec__title", "Robust aim")();
    },
  },
  skylineTab: { label: "Skyline: the terrain horizon at your aim", mode: "planner", find: byText(".pn-views__tab", "Skyline") },
  vehicle: { label: "Vehicle & settings", mode: "planner", find: section("Vehicle") },
  compareNav: { label: "04 Compare: rank the sites", find: q('.pn-nav__item[data-mode="compare"]') },
  comparePicker: { label: "Pick the sites to compare", mode: "compare", find: q(".pn-compare__picker") },
  export: { label: "Export: download the decision summary", find: q(".pn-hdr__export") },
  data: { label: "Data: where every number comes from", find: q(".pn-hdr__data") },
  briefingAccuracy: { label: "Landing accuracy for the briefing", mode: "simple", find: q(".pn-simple__ctrls") },
};

const visible = (el: HTMLElement | null): el is HTMLElement => !!el && el.getClientRects().length > 0 && el.offsetParent !== null;

async function waitFor(find: () => HTMLElement | null, ms = 2500): Promise<HTMLElement | null> {
  const t0 = performance.now();
  for (;;) {
    const el = find();
    if (visible(el)) return el;
    if (performance.now() - t0 > ms) return null;
    await new Promise((r) => setTimeout(r, 100));
  }
}

let current: (() => void) | null = null;

/** Highlight a control; returns false if it is not on screen (the caller then says so). */
export async function spotlight(id: SpotId, holdMs = 5000): Promise<boolean> {
  const spot = SPOTS[id];
  if (spot.mode && getState().mode !== spot.mode) goTo(spot.mode);
  if (id === "skylineTab" || id === "calendar" || id === "kpis") {
    if (getState().view !== "map" && id !== "skylineTab") setState({ view: "map" });
  }
  const el = await waitFor(spot.find);
  if (!el) return false;
  // on a phone the panel covers the screen: get it out of the way so the control can be seen
  if (window.innerWidth <= 640) setState({ assistantOpen: false });
  el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  current?.();

  const ring = document.createElement("div");
  ring.className = "pn-spot";
  ring.setAttribute("aria-hidden", "true");
  const tag = document.createElement("div");
  tag.className = "pn-spot__label";
  tag.textContent = spot.label;
  document.body.append(ring, tag);
  el.setAttribute("data-spotlit", "true");

  let raf = 0;
  const place = () => {
    const r = el.getBoundingClientRect();
    const pad = 6;
    Object.assign(ring.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
    const below = r.bottom + 44 < window.innerHeight;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - tag.offsetWidth - 8));
    Object.assign(tag.style, { left: `${left}px`, top: below ? `${r.bottom + 10}px` : `${Math.max(8, r.top - tag.offsetHeight - 10)}px` });
    raf = requestAnimationFrame(place);
  };
  place();
  const done = () => {
    cancelAnimationFrame(raf);
    ring.remove();
    tag.remove();
    el.removeAttribute("data-spotlit");
    window.removeEventListener("pointerdown", done, true);
    clearTimeout(timer);
    if (current === done) current = null;
  };
  const timer = setTimeout(done, holdMs);
  window.addEventListener("pointerdown", done, true);
  current = done;
  return true;
}
