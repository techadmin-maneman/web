// The day the technician is working, the clock the boards write, and the two
// counts the evidence chain and the close-out show: what is left of the wait, and how long the
// job took.

import { distance } from "@maneman/web-kit/figures";
import { apiNow } from "@maneman/web-kit/clock";
import { addDays, indiaClock, indiaTimeOf, todayInIndia as indiaToday } from "@maneman/web-kit/dates";
import { timeRange } from "@rules/lib/time-range.ts";
// The schema rather than ../api.ts, so these can be read and tested in Node without the fetch client.
import type { components } from "../api-schema.ts";

type JobSummary = components["schemas"]["TechnicianDayJob"];

/** Now by the API's clock: the phone's own can be hours out. */
export const apiDate = (): Date => new Date(apiNow());

/** Today's calendar date in India by the API's clock, YYYY-MM-DD: the day the app asks the backend for. */
export const todayInIndia = (at: Date = apiDate()): string => indiaToday(at.getTime());

export const dayAfter = (isoDate: string): string => addDays(isoDate, 1);
export const dayBefore = (isoDate: string): string => addDays(isoDate, -1);

/** "22 Aug", as the job card dates the last visit. */
export { dayMonth } from "@maneman/web-kit/dates";

/** "9:30 am", "4 pm": every time the app writes, the head of Today, a job's row and its card alike. */
export const clock = indiaClock;

/** "11:30 am–12 pm": when the technician is to arrive, from the start to the end of the client's arrival window. */
export const arrival = (job: { readonly starts_at: string; readonly arrives_by: string }): string =>
  timeRange(indiaTimeOf(job.starts_at), indiaTimeOf(job.arrives_by));

/**
 * Whether a job under way runs into the next one: done, at its booked length or now if that is later, after the time
 * it must finish by to reach the next on time.
 */
export function runsOver(job: JobSummary, now: Date): boolean {
  if (job.next === null || job.minutes === null) return false;
  const started = Date.parse(job.progress.started_at ?? job.starts_at);
  const done = Math.max(now.getTime(), started + job.minutes * 60_000);
  return done > Date.parse(job.next.finish_by);
}

/** The sector beside a job, which is all the place a locked job carries. */
export const where = (sector: string | null): string => sector ?? "";

/** "1.4 km", "240 m": how far the check-in measured the phone from the door. */
export const metres = distance;

/** "11:42", the minutes and seconds left of the no-show wait; "0:00" once it has run. */
export function countdown(msLeft: number): string {
  const left = Math.max(0, Math.ceil(msLeft / 1000));
  return `${String(Math.floor(left / 60))}:${String(left % 60).padStart(2, "0")}`;
}

/** A job's length in hours and minutes, from Start job to the outcome. */
export function lengthOf(fromMs: number, toMs: number): { hours: number; minutes: number } {
  const minutes = Math.max(0, Math.round((toMs - fromMs) / 60_000));
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}
