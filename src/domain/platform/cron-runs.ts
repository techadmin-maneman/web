// The cron's records. The run's, the one row of cron_runs: Cloudflare stops a run that overruns its limits without a
// word, and the jobs it had not finished go unrun, so each run notes when it starts and when it finishes, and a run
// that finds the one before it never finished, past RUN_LEASE_MS, tells ops once.
//
// And each job's, a row of cron_jobs (docs/decisions/0195-the-cron-a-job-at-a-time.md): its own lease, so a job runs
// once at a time while every other job goes on, when it last ran well, and its failures in a row.

import { HOUR_MS, MINUTE_MS } from "../../lib/durations.ts";
import type { AlertOnce, ResolveAlert } from "./alerts.ts";
import { ALERT_WORDS } from "../../config/alert-words.ts";

export const CUT_SHORT_ALERT = "cron_run_cut_short";

/**
 * How long a run that has not finished is taken to be running still. A run's outside calls stop at 30 seconds
 * (src/scheduled/cron.ts), so one running for three minutes was stopped.
 */
const RUN_LEASE_MS = 3 * MINUTE_MS;

/** Runs finishing for this long after a cut-short one close its alert, so the next is told again. */
const CUT_SHORT_CLEARS_AFTER_MS = HOUR_MS;

interface RunRow {
  readonly started_at: string;
  readonly completed_at: string | null;
}

/** What a run learns as it starts. */
export interface RunStart {
  /** When the run before it started, if that one is running still beside it, each job under its own lease. */
  readonly overlapping: string | null;
  /** When the run before it started, if that one never finished; null when it finished, or there was none. */
  readonly cutShortAt: string | null;
  /** The jobs whose last run failed: only these have a count for a success to reset (src/scheduled/cron.ts). */
  readonly failing: ReadonlySet<string>;
}

/** Both times are ISO strings in UTC, which sort as the instants do. */
function finished(run: RunRow): boolean {
  return run.completed_at !== null && run.completed_at >= run.started_at;
}

/**
 * Notes the run as started, and tells ops if the run before it never finished. It also reads the failing jobs, all in
 * one round trip to D1. A run before it still within its lease is running still: this one runs beside it, each job
 * under its own lease, and leaves the record to it, so it can be told as cut short if it never finishes.
 */
export async function startRun(deps: { db: D1Database; alertOnce: AlertOnce }, startedAt: string): Promise<RunStart> {
  const { db, alertOnce } = deps;
  const leaseEndedFor = new Date(Date.parse(startedAt) - RUN_LEASE_MS).toISOString();
  const [lastRun, claimed, failingRows] = await db.batch<Record<string, unknown>>([
    db.prepare("SELECT started_at, completed_at FROM cron_runs WHERE id = 1"),
    db
      .prepare(
        `INSERT INTO cron_runs (id, started_at) VALUES (1, ?1)
         ON CONFLICT (id) DO UPDATE SET started_at = excluded.started_at
         WHERE cron_runs.completed_at >= cron_runs.started_at OR cron_runs.started_at <= ?2
         RETURNING started_at`,
      )
      .bind(startedAt, leaseEndedFor),
    db.prepare("SELECT job FROM cron_jobs INDEXED BY cron_jobs_failing WHERE failed_runs > 0"),
  ]);
  const failing = new Set((failingRows?.results ?? []).map((row) => String(row.job)));
  const previous = lastRun?.results[0] as RunRow | undefined;
  if (previous !== undefined && (claimed?.results.length ?? 0) === 0) {
    return { overlapping: previous.started_at, cutShortAt: null, failing };
  }
  if (previous === undefined || finished(previous)) return { overlapping: null, cutShortAt: null, failing };

  await db.prepare("UPDATE cron_runs SET cut_short_at = ?1 WHERE id = 1").bind(startedAt).run();
  await alertOnce({
    key: CUT_SHORT_ALERT,
    message: ALERT_WORDS.cron_run_cut_short({ started: previous.started_at }),
  });
  return { overlapping: null, cutShortAt: previous.started_at, failing };
}

/** Notes the run as finished, and closes the cut-short alert once runs have finished for an hour since. */
export async function finishRun(
  deps: { db: D1Database; resolveAlert: ResolveAlert },
  run: { startedAt: string; completedAt: string; failedJobs: number },
): Promise<void> {
  const { db, resolveAlert } = deps;
  // A later run that has started since owns the row now.
  const row = await db
    .prepare(
      `UPDATE cron_runs SET completed_at = ?2, failed_jobs = ?3 WHERE id = 1 AND started_at = ?1
       RETURNING cut_short_at`,
    )
    .bind(run.startedAt, run.completedAt, run.failedJobs)
    .first<{ cut_short_at: string | null }>();
  const cutShortAt = row?.cut_short_at ?? null;
  if (cutShortAt === null) return;
  if (Date.parse(run.completedAt) - Date.parse(cutShortAt) < CUT_SHORT_CLEARS_AFTER_MS) return;

  await resolveAlert(CUT_SHORT_ALERT);
  await db.prepare("UPDATE cron_runs SET cut_short_at = NULL WHERE id = 1").run();
}

/** When the cron last finished a run; null before its first. */
export async function lastCompletedAt(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare("SELECT completed_at FROM cron_runs WHERE id = 1")
    .first<{ completed_at: string | null }>();
  return row?.completed_at ?? null;
}

/** How long a job is taken to be running still: a run starts no outside call after 30 seconds. */
const JOB_LEASE_MS = 3 * MINUTE_MS;

/**
 * Takes the job's lease for this run: refused while another run holds it, and, for a job held to a slot, once it has
 * run well since `dueSince`. A job's first run notes when the cron first ran it.
 */
export async function takeJobLease(
  db: D1Database,
  job: string,
  at: { now: Date; dueSince: Date | null },
): Promise<boolean> {
  const now = at.now.toISOString();
  const row = await db
    .prepare(
      `INSERT INTO cron_jobs (job, first_seen_at, lease_until) VALUES (?1, ?2, ?3)
       ON CONFLICT (job) DO UPDATE SET lease_until = excluded.lease_until,
         first_seen_at = COALESCE(cron_jobs.first_seen_at, excluded.first_seen_at)
       WHERE (cron_jobs.lease_until IS NULL OR cron_jobs.lease_until <= ?2)
         AND (?4 IS NULL OR cron_jobs.last_success_at IS NULL OR cron_jobs.last_success_at < ?4)
       RETURNING job`,
    )
    .bind(job, now, new Date(at.now.getTime() + JOB_LEASE_MS).toISOString(), at.dueSince?.toISOString() ?? null)
    .first();
  return row !== null;
}

/** The job ran well: its lease let go, when noted, and its count of failures in a row ended. */
export async function jobRanWell(db: D1Database, job: string, now: Date): Promise<void> {
  await db
    .prepare("UPDATE cron_jobs SET lease_until = NULL, last_success_at = ?2, failed_runs = 0 WHERE job = ?1")
    .bind(job, now.toISOString())
    .run();
}

/** The job's work goes on elsewhere: its lease let go, and nothing noted. */
export async function jobLetGo(db: D1Database, job: string): Promise<void> {
  await db.prepare("UPDATE cron_jobs SET lease_until = NULL WHERE job = ?1").bind(job).run();
}

/** The job failed: its lease let go, and the failure counted. How many in a row it has failed now. */
export async function jobFailed(db: D1Database, job: string, failure: { at: Date; reason: string }): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO cron_jobs (job, failed_runs, last_failed_at, last_error, first_seen_at) VALUES (?1, 1, ?2, ?3, ?2)
       ON CONFLICT (job) DO UPDATE SET failed_runs = failed_runs + 1, last_failed_at = excluded.last_failed_at,
         last_error = excluded.last_error, lease_until = NULL
       RETURNING failed_runs`,
    )
    .bind(job, failure.at.toISOString(), failure.reason)
    .first<{ failed_runs: number }>();
  return row?.failed_runs ?? 1;
}

/** When each job last ran well, or, one that never has, when the cron first ran it. */
export async function jobsLastWell(db: D1Database): Promise<Map<string, string>> {
  const { results } = await db
    .prepare("SELECT job, COALESCE(last_success_at, first_seen_at) AS since FROM cron_jobs")
    .all<{ job: string; since: string | null }>();
  return new Map(results.flatMap((row) => (row.since === null ? [] : [[row.job, row.since] as const])));
}
