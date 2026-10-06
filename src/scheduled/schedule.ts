// When the cron's jobs run (src/scheduled/cron.ts). The trigger fires every minute, and each run takes only the jobs
// due in that minute, so no run passes the free plan's 10 ms of CPU (docs/decisions/0009, "the cron's CPU time"). What
// staging's runs cost Cloudflare sets the rules: a run's own record about 3 ms, a job that only reads D1 about half a
// millisecond more, and a job that calls a vendor several milliseconds.

/** The trigger in wrangler.jsonc: a run every minute. */
export const EVERY_MINUTE = "* * * * *";

/** How often a job runs, in minutes. Each divides an hour, so a job runs in the same minutes every hour. */
export type Every = 5 | 15 | 60;

/** When a job runs: every `every` minutes, in minute `at` of that period, from 0. */
export interface Timing {
  readonly every: Every;
  /** `every: 15, at: 2` runs at :02, :17, :32 and :47. */
  readonly at: number;
}

/** The jobs that call a vendor every time they run, whatever there is to do: each shares its minute with one job at most. */
export const CALLS_EVERY_RUN: ReadonlySet<string> = new Set(["whatsapp_bridge", "books_items", "ailab_credits"]);

/**
 * Outside calls a minute's run may make. Each cost a staging run 3 to 5 ms of CPU, so a run takes one record's worth:
 * at most six, a finished visit's invoice in Books (src/domain/books-invoices.ts); the next run takes the next record.
 */
export const CRON_CALLS = 6;

/**
 * Outside calls a run of every job at once may make, as `npm run tick` asks for: under the free plan's 50 fetch
 * subrequests, with room for a Zoho token refresh, the run's alerts and its heartbeat.
 */
const EVERY_JOB_CALLS = 40;

/** The minute of each five the heartbeat says all is well in, one with no vendor call due. */
const HEARTBEAT_AT = 2;

/** Whether a job runs in the minute of the hour given. */
export function isDueAt(job: Timing, minute: number): boolean {
  return minute % job.every === job.at;
}

/**
 * The jobs for a run: those due in the minute Cloudflare scheduled it for. A run on any other schedule runs every job:
 * `npm run tick`, and the five-minute trigger until an operator attaches this one (docs/decisions/0010).
 */
export function jobsDue<Job extends Timing>(jobs: readonly Job[], cron: string, scheduledTime: number): readonly Job[] {
  if (cron !== EVERY_MINUTE) return jobs;
  const minute = new Date(scheduledTime).getUTCMinutes();
  return jobs.filter((job) => isDueAt(job, minute));
}

/** The outside calls a run on this schedule may make. */
export function callsFor(cron: string): number {
  return cron === EVERY_MINUTE ? CRON_CALLS : EVERY_JOB_CALLS;
}

/**
 * Whether the run pings the outside monitor even when every job worked. The ping is a vendor call too, so it goes once
 * in five minutes, the monitor's period; a run that finds something wrong pings /fail whatever its minute.
 */
export function pingsWhenWell(cron: string, scheduledTime: number): boolean {
  if (cron !== EVERY_MINUTE) return true;
  return new Date(scheduledTime).getUTCMinutes() % 5 === HEARTBEAT_AT;
}
