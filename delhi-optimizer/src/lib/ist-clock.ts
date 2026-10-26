import type { Weekday } from "@/types/graph";

/** Shared IST (Asia/Kolkata) clock helpers -- an arbitrary but fixed real
 * timezone used purely to anchor the simulation's day/night and weekday
 * cycle; server-side game-start resolution and client-side display both
 * need "what weekday/time is it right now," and must agree on the answer.
 * Not tied to any in-simulation geography -- the evacuation scenario
 * itself has no real-world location. */

export function istMinutesOfDay(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

export function istWeekday(date: Date): Weekday {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
  }).format(date);
  return weekday.toLowerCase() as Weekday;
}

export function formatMinutesClock(minutesFromMidnight: number): string {
  const wrapped = ((minutesFromMidnight % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = Math.round(wrapped % 60);
  return `${String(m === 60 ? h + 1 : h).padStart(2, "0")}:${String(m === 60 ? 0 : m).padStart(2, "0")}`;
}

export function formatDurationClock(totalMinutes: number): string {
  const totalSeconds = Math.max(0, Math.round(totalMinutes * 60));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
