/** Plain-language explanations of the person's choices (site, landing date, landing accuracy, caution level, aim,
 *  vehicle, mission length), written for someone with no technical background. Numbers come only from what the app
 *  has computed (the mission card); jargon is avoided or explained in the same sentence. */
import { fmtDate } from "../../../utils/format";
import type { Percentile, SiteId } from "../../../types";
import { duration, ok, pct, riskReady, siteName, vehicleOf, visReady, zone, type GuideCtx } from "./util";

export type ChoiceId = "site" | "date" | "accuracy" | "level" | "aim" | "vehicle" | "window";

/** What kind of place each site is, in everyday words (facts from the site registry and the validation results). */
export const SITE_PLAIN: Record<SiteId, string> = {
  cr1: "a long, high ridge between Shackleton and de Gerlache craters, almost at the south pole. Because it is high up, it sees over the hills around it, which makes it one of the best-lit places near the pole.",
  shk: "the rim of Shackleton crater, a crater about 21 km across that sits almost exactly on the south pole. Parts of the rim catch the Sun much of the time, while the crater floor below never sees it.",
  mal: "a big mountain about 120 km from the pole that faces Earth. That makes it good for staying in touch with Earth, but it gets less sunlight than the ridges right at the pole.",
  mou: "a high, flat-topped mountain (a plateau). Penumbra uses it as a stand-in for the Griffin-1 landing area, because no official landing coordinates have been published.",
  nob: "the rim of Nobile crater, a large crater near the south pole.",
};

/** "9 in 10" for P10 */
export const IN_N: Record<Percentile, string> = { 50: "1 in 2", 20: "4 in 5", 10: "9 in 10", 5: "19 in 20" };
const LEVEL_WORDS: Record<Percentile, string> = { 50: "an ordinary day", 20: "a somewhat unlucky day", 10: "a bad day", 5: "a really bad day" };

const POLE_SUN =
  "At the south pole the Sun never climbs high: it circles low along the horizon and keeps disappearing behind hills, sometimes for hours, sometimes for days.";

export function explainSite(c: GuideCtx): string {
  const { s, m } = c;
  let t = `**Site: ${siteName(c)}.** This is ${SITE_PLAIN[s.siteId]}`;
  if (riskReady(m)) t += ` At your aim point the Sun is up about **${pct(m.risk!.nominal)}** of the time over 2027, roughly ${Math.round(m.risk!.nominal)} of every 100 hours.`;
  return t;
}

export function explainDate(c: GuideCtx): string {
  const { s, m } = c;
  let t = `**Landing date: ${fmtDate(s.landingIdx, false)}.** This is when your mission starts. ${POLE_SUN} So the date decides how much sunshine you get after landing and when the first long night arrives.`;
  if (visReady(m)) {
    const w = m.vis!.summary;
    const sunDays = (w.sunlightPct / 100) * s.windowDays;
    t += ` Landing then gives you sunlight for about **${sunDays < 10 ? sunDays.toFixed(1) : Math.round(sunDays)} of your first ${s.windowDays} days**`;
    t += w.darkStartsInH == null ? ", with no darkness at all." : `. The first darkness starts after ${duration(w.darkStartsInH)}, and the longest stretch of darkness lasts **${duration(w.longestDarkH)}**.`;
    t += ` Earth is in view about ${pct(w.earthPct)} of the time (you need to see Earth to talk to it directly).`;
  }
  return t;
}

export function explainAccuracy(c: GuideCtx): string {
  const { s, m } = c;
  const u = s.uncertainty;
  const intro = "Landers never touch down exactly where they aim. It's like throwing a dart: you aim at the middle, but you land somewhere around it.";
  if (!u.enabled)
    return `**Landing accuracy: not set (switched off).** ${intro} Right now Penumbra assumes a perfect landing, which no real lander can promise. Turn on **Landing uncertainty** to see what happens if you miss.`;
  const size = u.model === "circular" ? `you could come down anywhere within **${u.radius} m** of your aim${u.radius === 100 ? ", about the length of a football pitch" : ""}` : `you could come down anywhere in ${zone(s)} oval around your aim`;
  let t = `**Landing accuracy: ${zone(s)}.** ${intro} With this setting, ${size}. Penumbra imagines 2,000 possible landings in that area and checks the sunlight at each one.`;
  if (riskReady(m) && ok(m.risk!.p[s.percentile])) {
    const nominal = m.risk!.nominal;
    const bad = m.risk!.p[s.percentile];
    const drop = nominal - bad;
    const how = drop < 5 ? "doesn't matter much" : drop < 15 ? "matters" : "matters a lot";
    t += ` Here, a perfect landing gets **${pct(nominal)}** sunlight, but on ${LEVEL_WORDS[s.percentile]} (only the unluckiest landings) you'd get **${pct(bad)}**. So at this spot, how precisely you land **${how}**.`;
  }
  t += " For comparison, NASA asks crewed landers to land within about 100 m; the Athena lander came down 250–370 m from its target.";
  return t;
}

export function explainLevel(c: GuideCtx): string {
  const { s, m } = c;
  const q = s.percentile;
  let t = `**How careful the plan is: P${q === 5 ? "05" : q}.** This means planning for ${LEVEL_WORDS[q]}: out of all the possible landings, **${IN_N[q]}** get at least the number shown, and only the unluckiest get less.`;
  t += " P50 is an ordinary day (half do better, half worse), P10 is a bad day (a sensible choice for planning), and P05 is very careful.";
  if (s.uncertainty.enabled && riskReady(m) && ok(m.risk!.p[q])) t += ` With your settings that number is **${pct(m.risk!.p[q])}** sunlight.`;
  return t;
}

export function explainAim(c: GuideCtx): string {
  const { s } = c;
  const r = s.robust.result;
  const kind = s.aimKind;
  let t =
    kind === "robust"
      ? "**Aim: the robust aim.** This spot was chosen so that even if you miss your target a little, you still get plenty of sunlight. It may be a bit less sunny than the very brightest spot, but it's the safer bet."
      : kind === "brightest"
        ? "**Aim: the brightest point.** This is the single sunniest spot at the site. It's like the sunniest seat in a stadium: perfect if you sit exactly there, but if you miss by a little you may end up in the shade."
        : kind === "custom"
          ? "**Aim: a point you picked yourself.**"
          : "**Aim: the site's reference point** (the centre of the map). It hasn't been chosen for sunlight yet.";
  if (r && s.robust.status === "done") {
    const gain = r.robust.pq - r.bestNominal.pq;
    t += ` On a bad day, aiming at the robust aim keeps **${pct(r.robust.pq)}** sunlight versus **${pct(r.bestNominal.pq)}** at the brightest point${gain > 0.5 ? `, ${gain.toFixed(1)} points better` : ", about the same"}.`;
  } else if (kind !== "robust" && s.uncertainty.enabled) {
    t += " Press **Find robust aim** to see if there's a safer spot nearby.";
  }
  return t;
}

export function explainVehicle(c: GuideCtx): string {
  const { s, m } = c;
  const v = vehicleOf(s);
  if (!v) return "";
  const panels = v.panels.length;
  const watts = v.panels.reduce((a, p) => a + p.watts, 0);
  let t = `**Vehicle: ${v.name}.** It has ${panels} upright solar panel${panels === 1 ? "" : "s"} (${watts} W in total) and a ${v.batteryWh.toLocaleString("en-US")} Wh battery. The panels charge the battery while the Sun shines; in the dark it lives on its battery, and it drops into a low-power sleep (hibernation) when the battery runs low.`;
  t += v.basis === "verified" ? " The battery and panel figures come from NASA; the power use is an assumption." : " These figures are assumptions, not official numbers.";
  if (visReady(m)) {
    const e = m.vis!.summary.enduranceDays;
    t += e == null ? ` In your first ${s.windowDays} days, the battery **never runs out**.` : ` In your first ${s.windowDays} days, the battery **runs out after about ${e.toFixed(1)} days**, so the mission would be at risk during a long night.`;
  }
  return t;
}

export function explainWindow(c: GuideCtx): string {
  return `**Mission length: ${c.s.windowDays} days.** The sunlight, darkness, Earth contact and battery numbers cover the first ${c.s.windowDays} days after landing. A longer mission has to survive more nights.`;
}

const EXPLAINERS: Record<ChoiceId, (c: GuideCtx) => string> = {
  site: explainSite,
  date: explainDate,
  accuracy: explainAccuracy,
  level: explainLevel,
  aim: explainAim,
  vehicle: explainVehicle,
  window: explainWindow,
};

export function explainChoice(id: ChoiceId, c: GuideCtx): string {
  return EXPLAINERS[id](c);
}

/** One sentence that sums the situation up, built from the numbers on screen. */
export function verdict(c: GuideCtx): string | null {
  const { s, m } = c;
  if (!riskReady(m)) return null;
  const parts: string[] = [];
  const n = m.risk!.nominal;
  parts.push(n >= 70 ? `a well-lit spot (sunlight ${pct(n)} of the year)` : n >= 40 ? `a moderately lit spot (sunlight ${pct(n)} of the year)` : `a fairly dark spot (sunlight only ${pct(n)} of the year)`);
  if (s.uncertainty.enabled && ok(m.risk!.p[s.percentile])) {
    const drop = n - m.risk!.p[s.percentile];
    parts.push(drop < 5 ? "missing your target costs little" : drop < 15 ? "missing your target costs some light" : "missing your target could cost a lot of light");
  } else parts.push("but landing accuracy isn't set yet");
  if (visReady(m)) {
    const e = m.vis!.summary.enduranceDays;
    parts.push(e == null ? `the battery lasts the whole ${s.windowDays} days` : `the battery would run out after about ${e.toFixed(1)} days`);
  }
  const [a, ...rest] = parts;
  return `**In short:** ${a}; ${rest.join(", and ")}.`;
}

/** Every current choice, explained in order. */
export function explainAllChoices(c: GuideCtx): string {
  const order: ChoiceId[] = ["site", "date", "accuracy", "level", "aim", "vehicle"];
  const v = verdict(c);
  return [v, ...order.map((id) => explainChoice(id, c)).filter(Boolean)].filter(Boolean).join("\n\n");
}

/** "Tell me more": the deeper detail behind each choice, still in readable language (facts from
 *  docs/SCIENTIFIC_VALIDATION.md, ARCHITECTURE.md and the site registry). */
const MORE: Record<ChoiceId, string> = {
  site: "**More about the sites.** The ground at each site comes from NASA's PGDA product 78: laser-measured terrain with a 5 m pixel, covering a 1.4 km square landing area. Further out, NASA's LOLA maps (80 m and 240 m pixels) fill in the hills up to 300 km away, because a distant mountain can block the low Sun too. Connecting Ridge and Shackleton are checked on a finer 10 m grid of possible landing spots; the other sites use 25 m.",
  date: "**More about dates.** Penumbra works out where the Sun and Earth are in the sky for every hour of 2027 using NASA JPL's SPICE data, the same data spacecraft teams use; it matches JPL's own Horizons service to within 0.1 arcseconds. Each hour it compares the Sun's height with the real skyline, traced in 720 directions around your spot, and counts a partly hidden Sun proportionally.",
  accuracy: "**More about landing accuracy.** *Circular* spreads the possible landings evenly inside the circle. *Elliptical Gaussian* bunches them towards the middle of an oval, with a spread east and north (written σ, sigma) and a rotation. Penumbra draws 2,000 landings and uses the same 2,000 for every target it tests, so comparisons between targets are fair.",
  level: "**More about P-levels.** They are percentiles. Line up the 2,000 imagined landings from darkest to sunniest: P10 is the value 10% of the way up the line, so 90% of landings do at least that well. P50 is the middle of the line (the median), P05 is 5% of the way up.",
  aim: "**More about the robust aim.** Penumbra tests every point on the site's grid of possible targets (thousands of them) whose whole landing zone stays on the mapped ground. For each target it takes the bad-day sunlight across the same 2,000 landings and keeps the highest; ties go to the sunnier target. The search takes about a twentieth of a second.",
  vehicle: "**More about the battery estimate.** Every hour Penumbra works out how much sunlight reaches each upright solar panel (depending on where the Sun is and how much of it peeks over the hills), adds that energy to the battery and takes away what the vehicle uses. At its reserve the vehicle hibernates on low power until the panels recharge it. It ignores temperature and electrical details, so treat it as an estimate.",
  window: "**More about the mission window.** Sunlight, darkness, Earth contact, antenna contact and the battery are all counted hour by hour over this many days after landing. The sunlight on the map and the *Nominal* number cover the whole of 2027 instead.",
};

export function explainMore(id: ChoiceId): string {
  return MORE[id];
}
