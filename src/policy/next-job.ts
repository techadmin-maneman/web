// Between a technician's jobs on a day (docs/decisions/0210-booking-by-start-time.md): the drive from each job to the
// next one still to do, by the free estimate, and when the job must be done to reach that one on time, its wrap-up and
// the drive after it; and the drive to each job, from the one before it or from home, and when to leave for it. A job
// with no pin is reached in the shortest drive, as booking planned the day.

import { MINUTE_MS } from "../lib/durations.ts";
import type { Pin } from "../lib/geo.ts";
import { indiaTime } from "../lib/india-time.ts";
import { minuteOf } from "./day-plan.ts";
import { driveMinutes, type DriveEstimate } from "./drive-estimate.ts";
import type { BookingRules } from "./start-times.ts";

/** The statuses of a job still to do, or under way. */
const STILL_TO_DO: readonly string[] = ["scheduled", "dispatched", "in_progress"];

export interface NextJob {
  /** The drive to the next job, in minutes. */
  readonly drive_minutes: number;
  /** When this job must be done, so its wrap-up and the drive still reach the next one by its start. */
  readonly finish_by: string;
}

interface DayJob {
  readonly startsAt: string;
  readonly minutes: number | null;
  readonly status: string;
  readonly pin: Pin | null;
}

/** The hour of the day in India a drive sets off in, 0 to 23. */
const hourOf = (setsOff: Date): number => Math.floor(minuteOf(indiaTime(setsOff)) / 60);

/** When a job and its wrap-up are done, which a drive from it sets off at. */
const doneAt = (job: DayJob, wrap: number): Date =>
  new Date(Date.parse(job.startsAt) + ((job.minutes ?? 0) + wrap) * MINUTE_MS);

/** For each of the day's jobs, in time order: the next one still to do from it; null for none, or a job done. */
export function nextJobs(
  jobs: readonly DayJob[],
  rules: { readonly booking: BookingRules; readonly drive: DriveEstimate },
): (NextJob | null)[] {
  const wrap = rules.booking.wrap_up;
  return jobs.map((job, index) => {
    const next = jobs.slice(index + 1).find((later) => STILL_TO_DO.includes(later.status));
    if (next === undefined || !STILL_TO_DO.includes(job.status)) return null;
    const hour = hourOf(doneAt(job, wrap));
    const drive =
      job.pin === null || next.pin === null ? rules.drive.least : driveMinutes(job.pin, next.pin, hour, rules.drive);
    const finishBy = new Date(Date.parse(next.startsAt) - (drive + wrap) * MINUTE_MS);
    return { drive_minutes: drive, finish_by: finishBy.toISOString() };
  });
}

export interface DriveTo {
  /** The drive to the job, in minutes: from the job before it, or from home for the day's first. */
  readonly drive_minutes: number;
  /** When to set off to reach it by its start. */
  readonly leave_by: string;
}

/**
 * For each of the day's jobs, in time order: the drive to it and when to leave for it; null for a job closed, and for
 * the day's first where the technician's home has no pin, as booking counts no drive from nowhere. The drive from the
 * job before sets off once that job and its wrap-up are done, and the drive from home at the hour the shortest drive
 * would leave in.
 */
export function drivesTo(
  jobs: readonly DayJob[],
  home: Pin | null,
  rules: { readonly booking: BookingRules; readonly drive: DriveEstimate },
): (DriveTo | null)[] {
  return jobs.map((job, index) => {
    if (!STILL_TO_DO.includes(job.status)) return null;
    const before = index === 0 ? undefined : jobs[index - 1];
    if (before === undefined && home === null) return null;
    const from = before === undefined ? home : before.pin;
    const setsOff =
      before === undefined
        ? new Date(Date.parse(job.startsAt) - rules.drive.least * MINUTE_MS)
        : doneAt(before, rules.booking.wrap_up);
    const drive =
      from === null || job.pin === null ? rules.drive.least : driveMinutes(from, job.pin, hourOf(setsOff), rules.drive);
    return { drive_minutes: drive, leave_by: new Date(Date.parse(job.startsAt) - drive * MINUTE_MS).toISOString() };
  });
}
