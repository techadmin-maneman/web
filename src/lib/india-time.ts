// Dates as the customer sees them: India Standard Time, UTC+05:30, with no
// daylight saving. Dates are "YYYY-MM-DD" strings, which compare and sort
// correctly as plain text.

import { DAY_MS, MINUTE_MS } from "./durations.ts";

const IST_OFFSET_MS = (5 * 60 + 30) * MINUTE_MS;

/** The calendar date in India at `instant`. */
export function indiaDate(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The India clock hour at `instant`, as "YYYY-MM-DDTHH". */
export function indiaHour(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 13);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** True for Saturday and Sunday. */
export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 is Sunday, 6 is Saturday
  return day === 0 || day === 6;
}

/** The instant a date and a clock time in India fall on: "2026-09-24", "12:00" → 06:30 UTC. */
export function indiaInstant(date: string, time: string): Date {
  return new Date(Date.parse(`${date}T${time}:00Z`) - IST_OFFSET_MS);
}

/** The India clock time at `instant`, as "HH:MM". */
export function indiaTime(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(11, 16);
}
