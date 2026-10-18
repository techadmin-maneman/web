// Between a technician's jobs on a day (docs/decisions/0210-booking-by-start-time.md): the drive from each job to the
// next one still to do, by the free estimate, and when the job must be done to reach that one on time, its wrap-up and
// the drive after it. A job with no pin is reached in the shortest drive, as booking planned the day.

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

/** For each of the day's jobs, in time order: the next one still to do from it; null for none, or a job done. */
export function nextJobs(
  jobs: readonly DayJob[],
  rules: { readonly booking: BookingRules; readonly drive: DriveEstimate },
): (NextJob | null)[] {
  const wrap = rules.booking.wrap_up;
  return jobs.map((job, index) => {
    const next = jobs.slice(index + 1).find((later) => STILL_TO_DO.includes(later.status));
    if (next === undefined || !STILL_TO_DO.includes(job.status)) return null;
    const setsOff = new Date(Date.parse(job.startsAt) + ((job.minutes ?? 0) + wrap) * MINUTE_MS);
    const hour = Math.floor(minuteOf(indiaTime(setsOff)) / 60);
    const drive =
      job.pin === null || next.pin === null ? rules.drive.least : driveMinutes(job.pin, next.pin, hour, rules.drive);
    const finishBy = new Date(Date.parse(next.startsAt) - (drive + wrap) * MINUTE_MS);
    return { drive_minutes: drive, finish_by: finishBy.toISOString() };
  });
}
