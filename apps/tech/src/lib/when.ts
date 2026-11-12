// The day the technician is working, the clock the boards write, and the two
// counts the evidence chain and the close-out show: what is left of the wait, and how long the
// job took.

import { distance } from "@maneman/web-kit/figures";
import { apiNow } from "@maneman/web-kit/clock";
import {
  addDays,
  dayMonth,
  indiaClock,
  indiaTimeOf,
  shortDate,
  todayInIndia as indiaToday,
} from "@maneman/web-kit/dates";
import { timeRange } from "@rules/lib/time-range.ts";
import { runsOver as runsInto } from "@rules/policy/tech-alerts.ts";
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

/** "Thu, 12 Nov": a day as Today's head and Leave's fields write it. */
export const dayDate = (isoDate: string): string => shortDate(isoDate).replace(" ", ", ");

/** Two days as a span's ends, the month written once where both share it: "12", "18 Nov"; or "28 Nov", "4 Dec". */
export function spanEnds(from: string, to: string): readonly [string, string] {
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return [sameMonth ? String(Number(from.slice(8, 10))) : dayMonth(from), dayMonth(to)];
}

/** "9:30 am", "4 pm": every time the app writes, the head of Today, a job's row and its card alike. */
export const clock = indiaClock;

/** When something was asked or done: its time today, or "12 Nov, 9:05 am" on an earlier day. */
export function stamp(instant: string, now: Date = apiDate()): string {
  const day = todayInIndia(new Date(instant));
  return day === todayInIndia(now) ? indiaClock(instant) : `${dayMonth(day)}, ${indiaClock(instant)}`;
}

/** "11:30 am–12 pm": when the technician is to arrive, from the start to the end of the client's arrival window. */
export const arrival = (job: { readonly starts_at: string; readonly arrives_by: string }): string =>
  timeRange(indiaTimeOf(job.starts_at), indiaTimeOf(job.arrives_by)).replace("–", " to ");

/** Whether a job under way runs into the next one, by the rule the API's running-over alert follows. */
export const runsOver = (job: JobSummary, now: Date): boolean =>
  runsInto(
    {
      starts_at: job.starts_at,
      started_at: job.progress.started_at,
      minutes: job.minutes,
      finish_by: job.next?.finish_by ?? null,
    },
    now,
  );

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
