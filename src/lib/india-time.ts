// Dates as the customer sees them: India Standard Time, UTC+05:30, with no
// daylight saving. Dates are "YYYY-MM-DD" strings, which compare and sort
// correctly as plain text.

import { DAY_MS, MINUTE_MS } from "./durations.ts";

/** India's offset from UTC, in minutes. */
export const INDIA_OFFSET_MINUTES = 5 * 60 + 30;
const IST_OFFSET_MS = INDIA_OFFSET_MINUTES * MINUTE_MS;

/** In SQL, the India date of the instant in `column`, with any of SQLite's date modifiers after, as "'+1 day'". */
export const indiaDateSql = (column: string, ...modifiers: string[]): string =>
  `date(${[column, `'+${String(INDIA_OFFSET_MINUTES)} minutes'`, ...modifiers].join(", ")})`;

/** In SQL, the time of day in India of the instant in `column`, "HH:MM". */
export const indiaTimeSql = (column: string): string =>
  `strftime('%H:%M', ${column}, '+${String(INDIA_OFFSET_MINUTES)} minutes')`;

/** The calendar date in India at `instant`. */
export function indiaDate(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The India clock hour at `instant`, as "YYYY-MM-DDTHH". */
export function indiaHour(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 13);
}

/** A date's month, "YYYY-MM". */
export const monthOf = (date: string): string => date.slice(0, 7);

/** The month `months` after a month, or before it for a negative count, "YYYY-MM". */
export function addMonths(month: string, months: number): string {
  const first = new Date(`${month}-01T00:00:00Z`);
  first.setUTCMonth(first.getUTCMonth() + months);
  return first.toISOString().slice(0, 7);
}

/** The day `months` after a date, "YYYY-MM-DD": the same day of the month, or the month's last where it is shorter. */
export function monthsAfter(date: string, months: number): string {
  const month = addMonths(monthOf(date), months);
  const last = new Date(Date.parse(`${addMonths(month, 1)}-01T00:00:00Z`) - DAY_MS).getUTCDate();
  return `${month}-${String(Math.min(Number(date.slice(8, 10)), last)).padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** A date's day of the week: 0 for Sunday to 6 for Saturday. */
export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

/** True for Saturday and Sunday. */
export function isWeekend(date: string): boolean {
  const day = weekdayOf(date);
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
