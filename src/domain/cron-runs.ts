// The five-minute cron's run record, the one row of cron_runs. Cloudflare stops a run that overruns its limits
// without a word, and every job after the point it stopped goes unrun. So each run notes when it starts and when it
// finishes, and a run that finds the one before it never finished tells ops once.

import { HOUR_MS } from "../lib/durations.ts";
import type { AlertOnce, ResolveAlert } from "./alerts.ts";

export const CUT_SHORT_ALERT = "cron_run_cut_short";

/** Runs finishing for this long after a cut-short one close its alert, so the next is told again. */
const CUT_SHORT_CLEARS_AFTER_MS = HOUR_MS;

interface RunRow {
  readonly started_at: string;
  readonly completed_at: string | null;
}

/** Both times are ISO strings in UTC, which sort as the instants do. */
function finished(run: RunRow): boolean {
  return run.completed_at !== null && run.completed_at >= run.started_at;
}

/** Notes the run as started, and tells ops if the run before it never finished. */
export async function startRun(deps: { db: D1Database; alertOnce: AlertOnce }, startedAt: string): Promise<void> {
  const { db, alertOnce } = deps;
  const [lastRun] = await db.batch<RunRow>([
    db.prepare("SELECT started_at, completed_at FROM cron_runs WHERE id = 1"),
    db
      .prepare(
        `INSERT INTO cron_runs (id, started_at) VALUES (1, ?1)
         ON CONFLICT (id) DO UPDATE SET started_at = excluded.started_at`,
      )
      .bind(startedAt),
  ]);
  const previous = lastRun?.results[0];
  if (previous === undefined || finished(previous)) return;

  await db.prepare("UPDATE cron_runs SET cut_short_at = ?1 WHERE id = 1").bind(startedAt).run();
  await alertOnce({
    key: CUT_SHORT_ALERT,
    message:
      `The cron run started at ${previous.started_at} never finished, so the jobs after where it stopped did not ` +
      `run. Cloudflare may have stopped it for its CPU time: runbook, "A cron run cut short".`,
  });
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
