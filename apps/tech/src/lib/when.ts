// The day the technician is working, the clock the boards write, and the two
// counts board B5 and board B4 show: what is left of the wait, and how long the
// job took.

import { indiaClock } from "@maneman/web-kit/dates";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's calendar date in India, YYYY-MM-DD: the day the app asks the backend for. */
export function todayInIndia(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

export function dayAfter(isoDate: string): string {
  return new Date(new Date(`${isoDate}T00:00:00Z`).getTime() + DAY_MS).toISOString().slice(0, 10);
}

/** "9:30 am", as the head of Today and a job's card write it. */
export const clock = indiaClock;

/** "9:30", "2:00": the time down the left of a job row (board A1), which never carries am or pm. */
export function clockShort(isoInstant: string): string {
  const india = new Date(new Date(isoInstant).getTime() + 330 * 60 * 1000);
  const hours = india.getUTCHours() % 12 === 0 ? 12 : india.getUTCHours() % 12;
  return `${String(hours)}:${String(india.getUTCMinutes()).padStart(2, "0")}`;
}

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
