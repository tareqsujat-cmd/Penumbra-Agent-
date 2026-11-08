const en = {
  tagline: "Know your odds of light before you land",
  site: "Site",
  landingDate: "Landing date",
  mode: "Mode",
  simple: "Simple",
  planner: "Planner",
  data: "Data",
  export: "Export",
  viewMap: "Landing map",
  viewSky: "Skyline",
  viewCompare: "Compare",
  viewScience: "Science & validation",
  mission: "Mission card",
  nominal: "Nominal outcome",
  conservative: "Conservative outcome",
  uncertainty: "Landing uncertainty",
  findRobust: "Find robust aim",
  robustAim: "Penumbra robust aim",
  brightest: "Brightest point",
  reveal: "The brightest place is not necessarily the safest place to aim.",
  sunlight: "Sunlight",
  earthVis: "Earth visibility",
  dsn: "DSN geometric opportunity",
  darkness: "Major darkness period",
  endurance: "Energy endurance estimate",
  recommended: "Recommended aim",
  simpleIntro: "A rover landing here on this date has:",
  goodLight: "Good initial illumination",
  fairLight: "Moderate initial illumination",
  poorLight: "Poor initial illumination",
  lowRisk: "Low landing-position risk",
  modRisk: "Moderate landing-position risk",
  highRisk: "High landing-position risk",
  p10Illum: "Sunlight in 9 of 10 likely touchdowns, at least",
  earthGeo: "Earth geometrically visible",
  longestDark: "Longest darkness in the first",
  days: "days",
  hours: "h",
  of2027: "of 2027",
};

export const STRINGS = { en };

/** Format a number with grouping. */
export function num(v: number, digits = 0): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
