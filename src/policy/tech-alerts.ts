// When a technician is told (docs/prompts/tech-redesign.md, "Alerts"; docs/decisions/0250-guides-and-alerts.md):
// to leave, ten minutes before they need to set off; the day ahead, at 8 pm; and that a visit runs over, when it will
// make them late for the next. The phone's Today reads the running over by the same rule (apps/tech/src/lib/when.ts).

import { MINUTE_MS } from "../lib/durations.ts";

export const ALERT_KINDS = [
  "time_to_leave",
  "day_ahead",
  "job_moved",
  "job_cancelled",
  "job_reassigned",
  "running_over",
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/** What a technician turns on and off: the three job changes are one. */
export const ALERT_SETTINGS = ["time_to_leave", "day_ahead", "job_changes", "running_over"] as const;
export type AlertSetting = (typeof ALERT_SETTINGS)[number];

/** How far back the inbox goes; older alerts are deleted. */
export const INBOX_DAYS = 7;

/** How long before setting off the technician is told to leave. */
export const LEAVE_NOTICE_MINUTES = 10;

/** The hour of India's evening the next day's jobs are sent. */
export const DAY_AHEAD_HOUR = 20;

/** How long a push is kept by the push service for a phone that is off: a job's alert is stale after that. */
export const PUSH_TTL_SECONDS = 30 * 60;

/** Whether it is time to tell the technician to leave for a job not yet begun: within the notice, before the time. */
export function leaveDue(job: { readonly leave_by: string | null; readonly started: boolean }, now: Date): boolean {
  if (job.leave_by === null || job.started) return false;
  const left = Date.parse(job.leave_by) - now.getTime();
  return left > 0 && left <= LEAVE_NOTICE_MINUTES * MINUTE_MS;
}

/**
 * Whether a job under way runs into the next one: done, at its booked length or now if that is later, after the time
 * it must finish by to reach the next on time.
 */
export function runsOver(
  job: {
    readonly starts_at: string;
    readonly started_at: string | null;
    readonly minutes: number | null;
    readonly finish_by: string | null;
  },
  now: Date,
): boolean {
  if (job.finish_by === null || job.minutes === null) return false;
  const started = Date.parse(job.started_at ?? job.starts_at);
  const done = Math.max(now.getTime(), started + job.minutes * MINUTE_MS);
  return done > Date.parse(job.finish_by);
}
