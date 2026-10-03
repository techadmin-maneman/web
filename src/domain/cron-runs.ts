// The cron's run record, the one row of cron_runs. Cloudflare stops a run that overruns its limits without a word,
// and the jobs it had not finished go unrun. So each run notes when it starts, and which jobs it runs, and when it
// finishes, and a run that finds the one before it never finished tells ops once, naming that run's jobs.

import { HOUR_MS } from "../lib/durations.ts";
import type { AlertOnce, ResolveAlert } from "./alerts.ts";

export const CUT_SHORT_ALERT = "cron_run_cut_short";

/** Runs finishing for this long after a cut-short one close its alert, so the next is told again. */
const CUT_SHORT_CLEARS_AFTER_MS = HOUR_MS;

interface RunRow {
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly jobs: string | null;
}

/** A run that never finished: when it started, and the jobs it was running. */
export interface CutShortRun {
  readonly startedAt: string;
  readonly jobs: readonly string[];
}

/** What a run learns as it starts. */
export interface RunStart {
  /** The run before it, if that one never finished. */
  readonly cutShort: CutShortRun | null;
  /** The jobs whose last run failed: only these have a count for a success to reset (src/scheduled/cron.ts). */
  readonly failing: ReadonlySet<string>;
}

/** Both times are ISO strings in UTC, which sort as the instants do. */
function finished(run: RunRow): boolean {
  return run.completed_at !== null && run.completed_at >= run.started_at;
}

function jobsOf(run: RunRow): string[] {
  if (run.jobs === null || run.jobs === "") return [];
  return run.jobs.split(",");
}

/**
 * Notes the run as started with its jobs, and tells ops if the run before it never finished. It also reads the failing
 * jobs, all in one round trip to D1: each trip costs every minute's run CPU time.
 */
export async function startRun(
  deps: { db: D1Database; alertOnce: AlertOnce },
  startedAt: string,
  jobs: readonly string[] = [],
): Promise<RunStart> {
  const { db, alertOnce } = deps;
  const [lastRun, , failingRows] = await db.batch<Record<string, unknown>>([
    db.prepare("SELECT started_at, completed_at, jobs FROM cron_runs WHERE id = 1"),
    db
      .prepare(
        `INSERT INTO cron_runs (id, started_at, jobs) VALUES (1, ?1, ?2)
         ON CONFLICT (id) DO UPDATE SET started_at = excluded.started_at, jobs = excluded.jobs`,
      )
      .bind(startedAt, jobs.join(",")),
    db.prepare("SELECT job FROM cron_jobs WHERE failed_runs > 0"),
  ]);
  const failing = new Set((failingRows?.results ?? []).map((row) => String(row.job)));
  const previous = lastRun?.results[0] as RunRow | undefined;
  if (previous === undefined || finished(previous)) return { cutShort: null, failing };

  const cutShort = { startedAt: previous.started_at, jobs: jobsOf(previous) };
  await db.prepare("UPDATE cron_runs SET cut_short_at = ?1 WHERE id = 1").bind(startedAt).run();
  await alertOnce({ key: CUT_SHORT_ALERT, message: cutShortMessage(cutShort) });
  return { cutShort, failing };
}

function cutShortMessage(run: CutShortRun): string {
  const running = run.jobs.length === 0 ? "" : ` (${run.jobs.join(", ")})`;
  return (
    `The cron run started at ${run.startedAt}${running} never finished, so the jobs after where it stopped did not ` +
    `run. Cloudflare may have stopped it for its CPU time: runbook, "A cron run cut short".`
  );
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
