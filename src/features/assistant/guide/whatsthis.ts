/** "What's this?": the person taps anything on screen and the guide explains it in plain words, with their numbers.
 *  While the mode is on, hovering outlines the part that would be explained; Esc or tapping the panel cancels. */
import { SCREENS } from "./content";
import type { Chip, GuideReply } from "./engine";
import { explainAccuracy, explainAim, explainChoice, explainDate, explainLevel, explainSite, IN_N, verdict } from "./plain";
import { duration, P, pct, riskReady, visReady, type GuideCtx } from "./util";
import type { AppState } from "../../../state/store";

interface Target {
  sel: string;
  explain: (c: GuideCtx, el: HTMLElement) => GuideReply;
}

const more = (id: Parameters<typeof explainChoice>[0]): Chip => ({ label: "Tell me more", intent: { kind: "more", id } });
const reply = (text: string, chips: Chip[] = []): GuideReply => ({ text, chips: [...chips, { label: "Explain something else", intent: { kind: "whatsthis" } }] });

function kpi(c: GuideCtx, el: HTMLElement): GuideReply {
  const label = el.querySelector(".pn-kpi__label")?.textContent ?? "";
  const { s, m } = c;
  if (/nominal/i.test(label)) {
    const n = riskReady(m) ? ` Right now it's **${pct(m.risk!.nominal)}**, about ${Math.round(m.risk!.nominal)} of every 100 hours.` : "";
    return reply(`**This is the sunlight if you land exactly on target**: how much of 2027 the Sun is above the hills at your aim point.${n} Real landings miss a little, so the next number shows a bad day.`, [more("date")]);
  }
  if (/worst likely/i.test(label)) return reply(`**This is your sunlight on a bad day.** ${explainLevel(c).replace(/^\*\*[^*]+\*\* /, "")}`, [{ label: "What does landing accuracy mean?", intent: { kind: "choice", id: "accuracy" } }, more("level")]);
  if (/robust/i.test(label)) return reply(explainAim(c), [more("aim")]);
  return reply(`These are your key numbers for ${P(s.percentile)} planning.`);
}

function calendarRows(c: GuideCtx): GuideReply {
  const { s, m } = c;
  const w = visReady(m) ? m.vis!.summary : null;
  return reply(
    `**This is your mission calendar**: the first ${s.windowDays} days after landing, hour by hour, left to right.\n\n` +
      `- **SUN:** bright when the Sun is fully up, dimmer when a hill hides part of it, dark at night.${w ? ` Overall: sunlight ${pct(w.sunlightPct)} of the time; the longest darkness lasts ${duration(w.longestDarkH)}.` : ""}\n` +
      `- **EARTH:** coloured when Earth is above the hills, so you could talk to it directly.${w ? ` (${pct(w.earthPct)} of the time.)` : ""}\n` +
      `- **DSN:** coloured when one of NASA's big antennas (California, Spain, Australia) can also see the Moon.${w ? ` (${pct(w.dsnPct)} of the time.)` : ""}\n` +
      `- **POWER:** the battery level. Striped means the vehicle is sleeping to save power; a red mark means the battery ran out.${w ? ` (Battery ${w.enduranceDays == null ? "lasts the whole period" : `runs out after about ${w.enduranceDays.toFixed(1)} days`}.)` : ""}\n\n` +
      "Drag inside the rows to move through time; the Sun on the map and skyline moves with it.",
    [{ label: "Help me pick a better date", intent: { kind: "dateHelper" } }, more("window")],
  );
}

const TARGETS: Target[] = [
  { sel: ".pn-kpi", explain: kpi },
  { sel: ".pn-hdr__picker", explain: (c) => reply(explainSite(c), [{ label: "Help me choose a site", intent: { kind: "siteHelper" } }, more("site")]) },
  { sel: ".pn-hdr__date", explain: (c) => reply(explainDate(c), [{ label: "Help me pick a date", intent: { kind: "dateHelper" } }, more("date")]) },
  { sel: ".pn-cal__year", explain: () => reply("**This strip is the whole of 2027.** The bright and dark stripes show how sunny each day is at your aim. The box marks your landing date and the days after it: drag it to try another date.", [{ label: "Help me pick a date", intent: { kind: "dateHelper" } }]) },
  { sel: ".pn-cal__rows, .pn-cal__plot, .pn-cal__tips", explain: calendarRows },
  { sel: ".pn-cal__ctrls", explain: (c) => reply(`**These control the calendar:** play moves time forward (1, 6 or 24 hours per second), and 14 d / 30 d / 90 d sets the mission length (now ${c.s.windowDays} days).`, [more("window")]) },
  { sel: ".pn-cal", explain: calendarRows },
  { sel: ".pn-unc", explain: (c) => reply(`${explainAccuracy(c)}\n\n${explainLevel(c)}`, [more("accuracy"), more("level")]) },
  { sel: ".pn-hist", explain: (c) => reply(`**This chart shows the 2,000 imagined landings.** Each bar counts how many landings got that much sunlight: bars to the right are sunnier. The marks show the perfect landing and your ${P(c.s.percentile)} bad-day value (${IN_N[c.s.percentile]} landings do at least that well).`, [more("level")]) },
  { sel: ".pn-robust", explain: (c) => reply(explainAim(c), [more("aim")]) },
  { sel: ".pn-stats, .pn-stat, .pn-dsn", explain: (c) => reply(explainDate(c), [{ label: "What happens to the battery?", intent: { kind: "choice", id: "vehicle" } }, more("window")]) },
  { sel: ".pn-seq", explain: () => reply("**This is your mission sequence**: the steps to plan a landing, in order. Ticked steps are done; the glowing one is next. Click any step to jump to it.", [{ label: "Walk me through it", intent: { kind: "tour", step: 0 } }]) },
  { sel: ".pn-views__tab", explain: () => reply("**These switch the big view:** the *Landing map* shows the ground coloured by sunlight; the *Skyline* shows the hills around your spot with the Sun and Earth moving along them.") },
  { sel: ".pn-legend", explain: () => reply("**This is the colour key for the map**: how much of 2027 each spot is in sunlight. Yellow is sunniest, dark blue is darkest.") },
  { sel: ".pn-layers", explain: () => reply("**These are map layers**: switch on or off the relief shading, slopes, the sunlight colours, the imagined landings, known reference points and your landing zone.") },
  { sel: ".pn-sky, .pn-sky__stage", explain: () => reply("**This is the skyline** from your landing spot: the real hills around you, traced in 720 directions. The Sun and Earth move along it over time; when the Sun drops behind a hill, your lander is in shadow. Heights are stretched so the low Sun is easy to see.") },
  { sel: ".pn-t3d, .pn-map", explain: (c) => reply(`**This is the landing map** of ${c.site?.name ?? "the site"}: the real ground, coloured by how much of 2027 each spot gets sunlight (yellow = sunniest). The small dots are imagined landings around your aim, and the outline is your landing zone. Click the ground to aim somewhere else.`, [{ label: "Explain my choices", intent: { kind: "choices" } }]) },
  { sel: ".pn-insp", explain: (c) => reply(verdict(c) ?? "This is your mission card: the key numbers for your current plan.", [{ label: "Explain my results", intent: { kind: "explain" } }]) },
  { sel: ".pn-simple__card, .pn-simple__facts", explain: (c) => reply(`**This is your briefing**: the most important facts about landing here, in plain words. ${verdict(c) ?? ""}`, [{ label: "Explain my results", intent: { kind: "explain" } }]) },
  { sel: ".pn-compare, .pn-rank, .pn-dots", explain: () => reply(SCREENS.compare, [{ label: "Compare all sites for my date", intent: { kind: "whatif", id: "sites" } }]) },
  { sel: ".pn-lp", explain: () => reply("**This is the quick landing planner**: pick a site, a day and how precisely you can land, and it shows how much sunshine you'd get and how long the battery lasts.") },
  { sel: ".pn-globe", explain: () => reply(SCREENS.globe) },
  { sel: '.pn-nav__item, .pn-nav__menu', explain: (_c, el) => reply(SCREENS[(el.getAttribute("data-mode") as AppState["mode"]) ?? "globe"] ?? "These buttons switch between the sections of Penumbra.") },
  { sel: ".pn-hdr__export", explain: () => reply("**Export** saves your whole decision (site, date, target, results and data sources) as a file you can share.") },
  { sel: ".pn-hdr__data", explain: () => reply("**Data** lists where every number comes from: NASA terrain maps, JPL position data and the checks against published studies.", [{ label: "Can I trust the numbers?", intent: { kind: "trust" } }]) },
  { sel: ".pn-hdr__ask", explain: () => reply("That's me! Ask me anything about Penumbra, or let me walk you through it.") },
];

export function findTarget(el: Element | null): { target: Target; el: HTMLElement } | null {
  if (!el) return null;
  for (const t of TARGETS) {
    const hit = el.closest<HTMLElement>(t.sel);
    if (hit) return { target: t, el: hit };
  }
  return null;
}

let stop: (() => void) | null = null;

/** Start the mode; `onPick` gets the explanation (or null when nothing known was tapped). */
export function startWhatsThis(getCtx: () => GuideCtx, onPick: (r: GuideReply | null) => void, onCancel: () => void): () => void {
  stop?.();
  document.body.classList.add("pn-whatsthis");
  const ring = document.createElement("div");
  ring.className = "pn-spot pn-spot--hover";
  ring.style.display = "none";
  document.body.append(ring);
  const inPanel = (e: Event) => !!(e.target as Element | null)?.closest?.("#pn-assistant");
  const move = (e: PointerEvent) => {
    const hit = inPanel(e) ? null : findTarget(e.target as Element);
    if (!hit) return void (ring.style.display = "none");
    const r = hit.el.getBoundingClientRect();
    Object.assign(ring.style, { display: "block", left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
  };
  const click = (e: PointerEvent) => {
    if (inPanel(e)) {
      done();
      onCancel();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const hit = findTarget(e.target as Element);
    done();
    // the click that follows this tap must not press the control underneath
    const once = (ev: Event) => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    window.addEventListener("click", once, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", once, true), 400);
    onPick(hit ? hit.target.explain(getCtx(), hit.el) : null);
  };
  const swallow = (e: Event) => {
    if (!inPanel(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      done();
      onCancel();
    }
  };
  function done() {
    document.body.classList.remove("pn-whatsthis");
    ring.remove();
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerdown", click, true);
    window.removeEventListener("click", swallow, true);
    window.removeEventListener("keydown", key, true);
    if (stop === done) stop = null;
  }
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerdown", click, true);
  window.addEventListener("click", swallow, true); // the tap explains; it must not also press the control
  window.addEventListener("keydown", key, true);
  stop = done;
  return done;
}
