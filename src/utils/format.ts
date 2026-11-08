import { hourToDate } from "../state/store";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDate(idx: number, withTime = true): string {
  const d = hourToDate(idx);
  const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return withTime ? `${day}, ${String(d.getUTCHours()).padStart(2, "0")}:00 UTC` : day;
}

export function fmtIso(idx: number): string {
  return hourToDate(idx).toISOString().slice(0, 16) + "Z";
}

export function fmtHours(h: number): string {
  if (h < 48) return `${Math.round(h)} h`;
  return `${(h / 24).toFixed(1)} d`;
}

export function fmtOffset(x: number, y: number): string {
  const d = Math.hypot(x, y);
  if (d < 1) return "at the site reference point";
  const ang = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
  const dirs = ["grid-north", "grid-north-east", "grid-east", "grid-south-east", "grid-south", "grid-south-west", "grid-west", "grid-north-west"];
  return `${Math.round(d)} m ${dirs[Math.round(ang / 45) % 8]}`;
}

export { MONTHS };
