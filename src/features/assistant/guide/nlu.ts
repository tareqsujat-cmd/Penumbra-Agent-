/** Built-in guide: understanding typed messages without AI. Finds the things people name (site, date, landing accuracy,
 *  robustness level, mission window, section, vehicle) and the kind of message (a command, a "what if", a yes/no,
 *  "show me", thanks). engine.ts turns the result into an answer. */
import type { Mode } from "../../../state/store";
import type { Percentile, SiteId } from "../../../types";

export interface Entities {
  site?: SiteId;
  /** day of 2027, 0 = 1 Jan */
  day?: number;
  radius?: number;
  percentile?: Percentile;
  windowDays?: 14 | 30 | 90;
  mode?: Mode;
  view?: "map" | "sky";
  vehicle?: string;
  uncertainty?: "on" | "off";
  robust?: "find" | "command";
  dialog?: "export" | "data" | "vehicle";
}

export type Reaction = "affirm" | "deny" | "showme" | "thanks" | "greet" | "next" | "more";

const SITE_WORDS: [SiteId, string[]][] = [
  ["cr1", ["connecting ridge", "connecting", "ridge", "cr1"]],
  ["shk", ["shackleton rim", "shackleton", "shk"]],
  ["mal", ["malapert massif", "malapert", "mal"]],
  ["mou", ["mons mouton", "mouton", "leibnitz", "griffin", "mou"]],
  ["nob", ["nobile rim", "nobile", "nob"]],
];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DAYS_BEFORE = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]; // 2027 is not a leap year

/** Edit distance, for small typos in site names ("shakleton"). */
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export function normalise(raw: string): string {
  return ` ${raw.toLowerCase().replace(/[’']/g, "").replace(/[?!.,;:()]/g, " ").replace(/\s+/g, " ").trim()} `;
}

function findSite(t: string): SiteId | undefined {
  for (const [id, words] of SITE_WORDS) if (words.some((w) => t.includes(` ${w} `))) return id;
  // tolerate a typo in the longer names
  const tokens = t.trim().split(" ").filter((w) => w.length >= 5);
  for (const [id, words] of SITE_WORDS)
    for (const w of words.filter((x) => x.length >= 6 && !x.includes(" ")))
      if (tokens.some((tok) => editDistance(tok, w) <= (w.length >= 8 ? 2 : 1))) return id;
  return undefined;
}

function findDay(t: string): number | undefined {
  let m = t.match(/ 2027-(\d{1,2})-(\d{1,2}) /);
  let month: number | undefined;
  let date: number | undefined;
  if (m) [month, date] = [Number(m[1]) - 1, Number(m[2])];
  if (month === undefined) {
    m = t.match(new RegExp(` (\\d{1,2})(?:st|nd|rd|th)?(?: of)? ${MONTH_RE}(?: 2027)? `));
    if (m) [date, month] = [Number(m[1]), MONTHS.indexOf(m[2].slice(0, 3))];
  }
  if (month === undefined) {
    m = t.match(new RegExp(` ${MONTH_RE} (\\d{1,2})(?:st|nd|rd|th)?(?: 2027)? `));
    if (m) [month, date] = [MONTHS.indexOf(m[1].slice(0, 3)), Number(m[2])];
  }
  if (month === undefined || date === undefined || month < 0 || date < 1 || date > 31) return undefined;
  return DAYS_BEFORE[month] + date - 1;
}

export function extractEntities(raw: string): Entities {
  const t = normalise(raw);
  const e: Entities = {};
  const site = findSite(t);
  if (site) e.site = site;
  const day = findDay(t);
  if (day !== undefined) e.day = day;
  const r = t.match(/ (?:±|\+\/-|plus or minus )?\s?(\d{2,3})\s?(?:m|meters?|metres?)\b/);
  if (r) e.radius = Number(r[1]);
  else if (/ (precise|tight) /.test(t)) e.radius = 50;
  else if (/ (loose|sloppy) /.test(t)) e.radius = 400;
  const p = t.match(/ p ?(50|20|10|05|5) /);
  if (p) e.percentile = Number(p[1]) as Percentile;
  const w = t.match(/ (14|30|90)[ -]?(?:days?|d) /);
  if (w) e.windowDays = Number(w[1]) as 14 | 30 | 90;
  if (/ (compare|comparison|ranking) (page|section|tab) | go to compare | open compare /.test(t)) e.mode = "compare";
  else if (/ briefing | simple (mode|view) /.test(t)) e.mode = "simple";
  else if (/ (globe|explore) /.test(t)) e.mode = "globe";
  else if (/ (science|validation) (page|section) /.test(t)) e.mode = "science";
  else if (/ (mission|planner) (page|section|view|mode) | the planner /.test(t)) e.mode = "planner";
  if (/ skyline | sky view | horizon /.test(t)) e.view = "sky";
  else if (/ (landing )?map /.test(t)) e.view = "map";
  if (/ viper /.test(t)) e.vehicle = "viper";
  else if (/ nova ?-?c /.test(t)) e.vehicle = "novac";
  else if (/ blue ?-?ghost /.test(t)) e.vehicle = "blueghost";
  if (/ (turn|switch) on (the )?(landing )?(uncertainty|ellipse|zone)| enable (landing )?uncertainty/.test(t)) e.uncertainty = "on";
  else if (/ (turn|switch) off (the )?(landing )?(uncertainty|ellipse|zone)| disable (landing )?uncertainty/.test(t)) e.uncertainty = "off";
  if (/ (command|use|aim at|move to|go to) (the )?robust/.test(t)) e.robust = "command";
  else if (/ (find|run|search|compute) (the )?robust/.test(t)) e.robust = "find";
  if (/ (open|show) (the )?export| export (it|this|my decision|the decision)/.test(t)) e.dialog = "export";
  return e;
}

export function hasEntities(e: Entities): boolean {
  return Object.keys(e).length > 0;
}

/** Short conversational replies: yes/no, "show me", thanks, hello, next. */
export function reaction(raw: string): Reaction | null {
  const t = normalise(raw);
  const short = t.trim().split(" ").length <= 5;
  if (short && /^ (yes|yeah|yep|yup|sure|ok|okay|alright|do it|go ahead|please|apply|apply it|sounds good|lets do it|lets go|yes please|ok do it|go for it) /.test(t)) return "affirm";
  if (short && /^ (no|nope|nah|not now|no thanks|skip|skip it|cancel|dismiss|never mind|nevermind) /.test(t)) return "deny";
  if (short && /^ (show me|where|where is it|point to it|highlight it|show me where) /.test(t)) return "showme";
  if (short && /^ (thanks|thank you|thx|cheers|great|perfect|nice|awesome|cool)( (thanks|a lot|so much))? /.test(t)) return "thanks";
  if (short && /^ (hi|hello|hey|good (morning|afternoon|evening))( there)? /.test(t)) return "greet";
  if (short && /^ (next|continue|go on|carry on|whats next|next step|keep going) /.test(t)) return "next";
  if (short && /^ (tell me more|more|more please|more detail|more details|explain more|in more detail|go deeper|details) $/.test(t)) return "more";
  return null;
}

/** Verb that asks for a change ("switch to", "set", "land on", "go to") rather than information. */
export function isCommand(raw: string): boolean {
  return /^ (please |can you |could you |pls )?(switch|change|set|go|open|take me|use|land|move|turn|enable|disable|pick|select|show|make|command|find|run) /.test(normalise(raw));
}

/** "what if", "what about", "and for", "compare with", "how about". */
export function isWhatIf(raw: string): boolean {
  return / what if | what about | how about | and (for|at|on|with) | instead | would | compare (it )?(with|to)| vs | versus | or /.test(normalise(raw));
}
