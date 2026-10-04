// The day the technician is working, the clock the boards write, and the two
// counts board B5 and board B4 show: what is left of the wait, and how long the
// job took.

import { fullDate, indiaClock, indiaDate } from "@maneman/web-kit/dates";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's calendar date in India, YYYY-MM-DD: the day the app asks the backend for. */
export function todayInIndia(now: Date = new Date()): string {
  return indiaDate(now.toISOString());
}

export function dayAfter(isoDate: string): string {
  return new Date(new Date(`${isoDate}T00:00:00Z`).getTime() + DAY_MS).toISOString().slice(0, 10);
}

/** "22 Aug", as board A3 dates the last visit. */
export function dayMonth(isoDate: string): string {
  const written = fullDate(isoDate);
  return written.slice(0, written.lastIndexOf(" "));
}

/** "9:30 am", "4 pm": every time the app writes, the head of Today, a job's row and its card alike. */
export const clock = indiaClock;

/** The sector beside a job, which is all the place a locked job carries. */
export const where = (sector: string | null): string => sector ?? "";

/** "1.4 km", "240 m": how far the check-in measured the phone from the door (board B5). */
export function metres(distance: number): string {
  return distance < 1000 ? `${String(Math.round(distance))} m` : `${(distance / 1000).toFixed(1)} km`;
}

/** "11:42", the minutes and seconds left of the no-show wait; "0:00" once it has run. */
export function countdown(msLeft: number): string {
  const left = Math.max(0, Math.ceil(msLeft / 1000));
  return `${String(Math.floor(left / 60))}:${String(left % 60).padStart(2, "0")}`;
}

/** A job's length in hours and minutes, from Start job to the outcome (board B4). */
export function lengthOf(fromMs: number, toMs: number): { hours: number; minutes: number } {
  const minutes = Math.max(0, Math.round((toMs - fromMs) / 60_000));
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}
