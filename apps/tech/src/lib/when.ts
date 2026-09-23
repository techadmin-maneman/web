// The day the technician is working, and the clock the boards write.

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

/** "3.1 km" beside a job's sector, or the sector alone when the distance is not known. */
export function where(sector: string, km: number | null): string {
  return km === null ? sector : `${sector} · ${km.toFixed(1)} km`;
}
