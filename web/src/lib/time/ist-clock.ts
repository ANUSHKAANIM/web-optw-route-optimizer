/** Shared IST (Asia/Kolkata) clock helpers -- used both server-side (to
 * compute each Delhi place's opening/closing window relative to a session's
 * start) and client-side (to render the game clock). Pure functions, safe
 * in either environment. */

export type Weekday =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

export function istHourOfDay(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour + minute / 60;
}

export function istWeekday(date: Date): Weekday {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
  }).format(date);
  return weekday.toLowerCase() as Weekday;
}

/** Formats an hours-from-midnight value (may exceed 24 or be fractional) as
 * a wrapped HH:MM clock string. */
export function formatHoursClock(hoursFromMidnight: number): string {
  const wrapped = ((hoursFromMidnight % 24) + 24) % 24;
  const h = Math.floor(wrapped);
  const m = Math.round((wrapped - h) * 60);
  return `${String(m === 60 ? h + 1 : h).padStart(2, "0")}:${String(m === 60 ? 0 : m).padStart(2, "0")}`;
}

/** Formats a duration in hours as HH:MM:SS. */
export function formatDurationClock(hours: number): string {
  const totalSeconds = Math.max(0, Math.round(hours * 3600));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
