// When the cron's jobs run (src/scheduled/cron.ts). The trigger fires every minute, and each run takes only the jobs
// due in that minute, so the work is spread over the hour.

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

/**
 * Outside calls a run may make: several records' worth, under Zoho Books' 100 calls a minute for the organisation,
 * which the requests and the CRM's sync share. A pass stops when it is refused, and the next run takes the records it
 * left.
 */
export const CRON_CALLS = 40;

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

/**
 * Whether the run pings the outside monitor even when every job worked. The ping is a vendor call too, so it goes once
 * in five minutes, the monitor's period; a run that finds something wrong pings /fail whatever its minute.
 */
export function pingsWhenWell(cron: string, scheduledTime: number): boolean {
  if (cron !== EVERY_MINUTE) return true;
  return new Date(scheduledTime).getUTCMinutes() % 5 === HEARTBEAT_AT;
}
