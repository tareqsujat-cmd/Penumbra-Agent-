/** Built-in guide content (no AI): definitions, how-to answers, screen tours and limitations.
 *  Facts come from the app's own text (mission card, tooltips, Briefing), README.md and docs/SCIENTIFIC_VALIDATION.md.
 *  Keep in step with backend/app/assistant/guide.py, which gives the AI assistant the same facts. */
import type { Mode } from "../../../state/store";

export interface Entry {
  title: string;
  /** keywords for typed questions (lower case) */
  keys: string[];
  body: string;
}

export const TERMS = {
  sunlight: {
    title: "Sunlight %",
    keys: ["sunlight", "illumination", "light", "lit", "sun"],
    body: "How much of the time the Sun is above the hills around your landing spot. 80% means the Sun is up about 80 of every 100 hours. At the south pole the Sun stays very low and keeps hiding behind hills, so this number changes a lot from place to place. If only part of the Sun peeks over a hill, Penumbra counts only that part. **Nominal** sunlight means the value if you land exactly on target.",
  },
  uncertainty: {
    title: "Landing uncertainty (landing accuracy)",
    keys: ["uncertainty", "ellipse", "accuracy", "landing zone", "radius", "sigma", "gaussian", "circular", "miss"],
    body: "Landers never touch down exactly where they aim. It's like throwing a dart: you aim at the middle but land somewhere around it. A ±100 m zone means you could land anywhere within 100 m of your target, about the length of a football pitch. Penumbra imagines 2,000 possible landings in that zone and checks the sunlight at each. For scale: NASA asks crewed landers for about 100 m; the Athena lander came down 250–370 m from its target. You choose the size, so it's a model, not a promise about any real lander.",
  },
  percentile: {
    title: "P50 / P20 / P10 / P05 (how careful the plan is)",
    keys: ["p10", "p05", "p20", "p50", "percentile", "robustness level", "worst likely", "pq", "9 of 10", "conservative", "caution"],
    body: "These describe how careful your plan is: planning for a good, ordinary or bad day. **P10** means planning for a bad day: out of 10 possible landings, 9 get at least the number shown and only the unluckiest 1 gets less. P50 is an ordinary day (half do better, half worse), P20 is a somewhat unlucky day, and P05 is a really bad day (19 out of 20 do better). P10 is a sensible choice for planning. The mission card calls this number **Worst likely**.",
  },
  robust: {
    title: "Robust aim (a safer target)",
    keys: ["robust aim", "robust", "brightest point", "brightest", "best aim", "where to aim", "safer target"],
    body: "The **brightest point** is the single sunniest spot: like the sunniest seat in a stadium, perfect if you sit exactly there, but the seats around it may be in the shade. The **robust aim** is a spot chosen so that even if you miss your target, you still get plenty of sun. Penumbra tries thousands of possible targets, imagines many landings around each, and keeps the one that does best on a bad day.",
  },
  earth: {
    title: "Earth visibility",
    keys: ["earth", "earth visibility", "communication", "contact", "margin"],
    body: "How much of the time Earth is above the hills, as seen from your landing spot. A lander needs to see Earth to talk to it directly, so more is better. Earth also rises and sets over the course of a month as seen from the Moon's south pole. Penumbra only counts Earth as visible when it is a little above the hills (2° by default), as a safety margin; that margin is our choice, not a NASA rule.",
  },
  dsn: {
    title: "DSN (NASA's big antennas)",
    keys: ["dsn", "deep space network", "goldstone", "madrid", "canberra", "antenna", "station", "uplink", "downlink"],
    body: "The Deep Space Network is NASA's set of giant radio antennas in California, Spain and Australia, used to talk to spacecraft. The DSN number is how much of the time Earth is visible from your landing spot **and** at least one of those antennas can see the Moon. It's about geometry only: it doesn't mean antenna time is actually booked for you.",
  },
  darkness: {
    title: "Longest darkness",
    keys: ["darkness", "dark", "night", "shadow", "longest dark"],
    body: "The longest stretch without any sunshine in the days after landing. During darkness solar panels make no power and the lander lives on its battery and gets cold, so a long night is the biggest danger. Compare it with how long the battery lasts.",
  },
  endurance: {
    title: "Battery (energy endurance)",
    keys: ["endurance", "battery", "power", "energy", "survive", "hibernat", "solar panel"],
    body: "How long the vehicle's battery keeps going. The solar panels charge it while the Sun shines; in the dark the vehicle runs on the battery, and it goes into a low-power sleep (hibernation) when the battery gets low. The calendar's POWER row shows the charge over time; a red mark means the battery ran out. It's a simplified estimate, not a full engineering simulation.",
  },
  window: {
    title: "Mission window (mission length)",
    keys: ["window", "mission window", "14 d", "30 d", "90 d", "days after landing", "mission length"],
    body: "How many days after landing the mission needs to last: 14, 30 or 90. The sunlight, darkness, Earth and battery numbers all cover this period. A longer mission has to survive more nights. Change it on the mission calendar.",
  },
} satisfies Record<string, Entry>;

export type TermId = keyof typeof TERMS;

export const HOWTO = {
  site: {
    title: "Change the landing site",
    keys: ["change site", "switch site", "other site", "select site", "choose site", "pick site"],
    body: "In **Mission**, **Briefing** or **Compare**, click **Site** in the header and pick one of the five south-pole sites. Switching site moves the aim to that site's brightest point and clears any robust-aim result. On the **Explore** globe you can also click a site.",
  },
  date: {
    title: "Change the landing date",
    keys: ["change date", "landing date", "move date", "pick date", "calendar", "when to land"],
    body: "Use the **‹ ›** buttons next to **Landing date** in the header (one day each), or drag the year strip on the **mission calendar** at the bottom. Everything updates: sunlight, Earth, DSN and battery for the days after landing.",
  },
  uncertaintyOn: {
    title: "Turn on landing uncertainty",
    keys: ["turn on uncertainty", "landing ellipse", "enable uncertainty", "uncertainty on"],
    body: "In the mission card on the right, open **Landing uncertainty** and flip its switch. Choose **Circular** or **Elliptical Gaussian**, set the size with the sliders, and pick the **Robustness level** (P50, P20, P10 or P05). The **Worst likely** number and the **Touchdown outcomes** histogram appear.",
  },
  robustAim: {
    title: "Find and use the robust aim",
    keys: ["find robust", "run robust", "command robust", "robust aim button"],
    body: "Press **Find robust aim** at the bottom of the mission card. The **Robust aim** section then shows the brightest point and the robust aim side by side. Click **Command robust aim** to move your aim there. Changing the uncertainty model or robustness level clears the result, so search again.",
  },
  skyline: {
    title: "See the skyline",
    keys: ["skyline", "horizon", "sky view", "panorama", "dome"],
    body: "In **Mission**, open the **Skyline** tab above the map. It shows the real terrain horizon traced at your aim, with the Sun and Earth moving over it. Switch between **3-D sky dome** and **2-D panorama**; vertical exaggeration ×5 or ×10 makes the low Sun readable.",
  },
  compare: {
    title: "Compare sites",
    keys: ["compare", "ranking", "which site", "best site", "rank"],
    body: "Open **04 Compare**. Pick two to five sites; each is scored at its own robust aim over the same mission window after your landing date, and ranked by your robustness level. Moving the landing date can change the ranking.",
  },
  exportIt: {
    title: "Export the decision",
    keys: ["export", "download", "save", "json", "decision summary", "share"],
    body: "Click **Export** in the header to download the decision summary (site, date, aims, uncertainty, outcomes, visibility, vehicle and data provenance) as JSON. You can also share the page URL: it is a permalink to the same view.",
  },
  data: {
    title: "See where the numbers come from",
    keys: ["data", "provenance", "source", "nasa data", "where do the numbers"],
    body: "Click **Data** in the header. It lists every NASA/JPL dataset (terrain, SPICE kernels, validation maps) with versions and checksums, and says which numbers are verified, computed or assumptions.",
  },
  vehicle: {
    title: "Change the vehicle",
    keys: ["vehicle", "rover", "lander", "viper", "nova-c", "blue ghost", "power scenario", "edit scenario"],
    body: "In the mission card, open **Vehicle & settings** and pick a **Vehicle scenario**: VIPER-class rover (sourced from NASA), or Nova-C-like and Blue-Ghost-like landers (assumption-based). **Edit scenario** changes panels, battery and loads (edited values become assumptions).",
  },
  globe: {
    title: "Use the 3-D globe",
    keys: ["globe", "explore", "spin", "zoom", "moon view", "fly"],
    body: "In **01 Explore**: drag to spin, scroll to zoom, right-drag to tilt, and click the surface to inspect an area (slope, Sun and Earth conditions). **Lighting** switches between Always lit and Real sunlight; the time slider plays through 2027. Click a south-pole site to open the landing planner.",
  },
  settings: {
    title: "Earth margin, DSN mask and coordinates",
    keys: ["settings", "earth margin", "dsn mask", "coordinates", "latitude", "set aim"],
    body: "In the mission card, **Vehicle & settings** has: exact MOON_ME coordinates to set an aim, the 2 m mast, the **Earth visibility margin** slider (0–5°), the **DSN elevation mask** (6° downlink or 10.1° uplink) and the vehicle scenario.",
  },
} satisfies Record<string, Entry>;

export type HowId = keyof typeof HOWTO;

/** "What can I do on this screen?" */
export const SCREENS: Record<Mode, string> = {
  globe: "**01 Explore** is the 3-D Moon. Drag to spin, scroll to zoom, right-drag to tilt, and click the surface to inspect any area. Use **Lighting** to switch between Always lit and Real sunlight, and the time slider to play through 2027. Click one of the five south-pole sites to open the landing planner, or go to **02 Mission** for the full planner.",
  planner: "**02 Mission** is the planner. Follow the **mission sequence** bar along the top: Site, Date, Uncertainty, Robust aim, Skyline, Compare, Export; its “Next” hint names the next step. The map or skyline is on the left, the **mission card** with your numbers on the right, and the **mission calendar** (Sun, Earth, DSN, power) along the bottom.",
  simple: "**03 Briefing** is the plain-language summary for one site and date: initial sunlight over the first 72 hours, landing-position risk, sunlight in 9 of 10 likely touchdowns, Earth visibility, the longest darkness and the recommended aim. Pick a landing accuracy (±50, ±100 or ±400 m) at the top. Energy and DSN details are in Mission.",
  compare: "**04 Compare** ranks two to five sites for the same mission: each is scored at its own robust aim over the window after your landing date. Pick sites at the top; the ranking uses your robustness level. Move the landing date on the calendar to see how the ranking changes.",
  science: "**05 Science** shows how Penumbra was checked against NASA and published data: NASA PGDA 69 sunlight and Earth maps (average error 1.61 points for Sun, 0.62 for Earth), Gläser et al. 2018 (6 of 7 points within 3 points) and JPL Horizons (within 0.1 arcseconds). Tolerances were fixed in advance.",
  report: "**06 Research** is the research report: the problem, gaps in existing tools, the method, findings and references.",
  about: "**07 System** explains how Penumbra works, the NASA/JPL data it uses, and its limits.",
};

export const LIMITATIONS =
  "Penumbra's results have known limits:\n\n" +
  "- **Terrain:** resolution and elevation error affect results; the 5 m terrain is partly interpolated, and light on knife-edge ridges is sensitive to it.\n" +
  "- **Landing model:** the uncertainty model is your choice, not the true distribution of a real lander.\n" +
  "- **DSN:** geometric visibility only, not scheduled service.\n" +
  "- **Power:** a simplified hourly energy balance, not a thermal or electrical simulation; non-VIPER vehicles are assumptions.\n" +
  "- **Grid:** results are for a 2 m mast and the year 2027.";

export const TRUST =
  "Penumbra was checked against independent references, with tolerances fixed before any result existed:\n\n" +
  "- **NASA PGDA 69** sunlight and Earth maps, 17 points: average error 1.61 points (Sun) and 0.62 (Earth), limit 2. PASS.\n" +
  "- **Gläser et al. 2018**, 7 published points: 6 within 3 points, needed 5. PASS.\n" +
  "- **JPL Horizons**, Sun and Earth positions: within 0.1 arcseconds, limit 10. PASS.\n\n" +
  "Terrain comes from NASA PGDA 78 (5 m) and LOLA; Sun, Earth and DSN geometry from JPL SPICE kernels. Details are in **05 Science** and the **Data** dialog.";

export const INTRO =
  "I'm the built-in guide: I can show you how Penumbra works, walk you through planning a landing, explain your results and run a few quick comparisons. I work offline and only use numbers the app computes. Pick a topic or type a question.";

/** Technical words that become tappable in the guide's answers (each opens its plain explanation). */
export const TERM_LINKS: { match: RegExp; id: TermId }[] = [
  { match: /\bP(?:50|20|10|05)\b/, id: "percentile" },
  { match: /robust aim/i, id: "robust" },
  { match: /brightest point/i, id: "robust" },
  { match: /landing (?:zone|uncertainty|accuracy)/i, id: "uncertainty" },
  { match: /\bDSN\b|Deep Space Network/, id: "dsn" },
  { match: /hibernat\w*/i, id: "endurance" },
  { match: /mission window/i, id: "window" },
  { match: /longest darkness/i, id: "darkness" },
  { match: /\bnominal\b/i, id: "sunlight" },
  { match: /Earth visibility/i, id: "earth" },
];
