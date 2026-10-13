// Running the cron's jobs (./cron.ts): each switched on here, in order, each under a logger named for it and its own
// lease, on one budget of outside calls and one read of the figures ops set (docs/decisions/0195-the-cron-a-job-at-a-
// time.md). A job held to a slot runs once it is due and not since; any other runs whenever its minute comes.
//
// A job that throws is logged and counted, and the next one runs anyway. A job counts as run well only when it ran, so
// a daily job's hours of nothing to do never wipe out its failures. The run ends with one line saying what it cost D1.

import {
  finishRun,
  jobFailed,
  jobLetGo,
  jobRanWell,
  startRun,
  takeJobLease,
  type RunStart,
} from "../domain/platform/cron-runs.ts";
import { readOpsInputs, type OpsInputs } from "../domain/ops/ops-settings.ts";
import { indiaDate } from "../lib/india-time.ts";
import { createCallBudget } from "../lib/call-budget.ts";
import { meterDatabase, usageFields, usageSince, type MeteredDatabase } from "../lib/d1-meter.ts";
import { scrubString } from "../log.ts";
import { pingHeartbeat } from "../providers/heartbeat.ts";
import { isSwitchedOn, type CronContext, type CronJob, type CronRun } from "./cron.ts";
import { CRON_CALLS, lastSlotStart, STILL_RUNNING } from "./schedule.ts";

/** A run starts no outside call after this, so it ends before the next minute's run starts. */
export const CRON_CALLS_FOR_MS = 30_000;

/** One failed run is a blip; three in a row is not. */
const ALERT_AFTER_FAILED_RUNS = 3;

interface CronOutcome {
  readonly job: string;
  readonly ok: boolean;
}

/** What a run did, and when the run before it started if that one never finished. */
interface RunResult {
  readonly outcomes: CronOutcome[];
  readonly cutShortAt: string | null;
}

/** Runs each job switched on here, and says how each went: none for a job not due, or running in another run. */
export async function runCronJobs(jobs: readonly CronJob[], given: CronRun): Promise<CronOutcome[]> {
  return (await runJobs(jobs, given)).outcomes;
}

async function runJobs(jobs: readonly CronJob[], given: CronRun): Promise<RunResult> {
  const { run, meter } = metered(given);
  const startedAt = run.deps.now();
  const { overlapping, cutShortAt, failing } = await recordStart(run, startedAt.toISOString());
  if (overlapping !== null) run.log.warn("cron_run_overlapping", { running_since: overlapping });
  const budget = createCallBudget(run.calls ?? CRON_CALLS, {
    until: startedAt.getTime() + CRON_CALLS_FOR_MS,
    now: () => run.deps.now().getTime(),
  });
  const inputs = sharedInputs(run);
  const outcomes: CronOutcome[] = [];
  const rowsReadByJob: Record<string, number> = {};
  for (const job of jobs) {
    if (!isSwitchedOn(job.needs, run.config)) continue;
    const slotStart = job.slot === undefined ? null : lastSlotStart(startedAt, job.slot);
    if (!(await mayStart(run, job.name, { now: startedAt, dueSince: slotStart }))) continue;
    const slot = slotStart === null ? undefined : { start: slotStart, date: indiaDate(slotStart) };
    const context: CronContext = { ...run, log: run.log.child({ job: job.name }), budget, inputs, slot };
    const before = meter.usage();
    outcomes.push({ job: job.name, ok: await runOne(job, context, failing.has(job.name)) });
    rowsReadByJob[job.name] = usageSince(before, meter.usage()).rowsRead;
  }
  if (budget.ranOut()) run.log.warn("cron_calls_spent", { calls: run.calls ?? CRON_CALLS });
  await recordFinish(run, startedAt.toISOString(), failedJobs(outcomes).length);
  run.log.info("cron_run", {
    failed_jobs: failedJobs(outcomes),
    ...usageFields(meter.usage()),
    d1_rows_read_by_job: rowsReadByJob,
  });
  return { outcomes, cutShortAt };
}

/** Runs one job, and counts how it went; true unless it failed. A job whose work goes on elsewhere counts as nothing. */
async function runOne(job: CronJob, context: CronContext, wasFailing: boolean): Promise<boolean> {
  let answer: unknown;
  try {
    answer = await job.run(context);
  } catch (error) {
    context.log.error("cron_job_failed", { error });
    await countFailure(context, job.name, error);
    return false;
  }
  if (answer === STILL_RUNNING) await letGo(context, job.name);
  else await countSuccess(context, job, wasFailing);
  return true;
}

async function letGo({ env, log }: CronContext, job: string): Promise<void> {
  try {
    await jobLetGo(env.DB, job);
  } catch (error) {
    log.error("cron_outcome_not_counted", { error });
  }
}

function metered(run: CronRun): { run: CronRun; meter: MeteredDatabase } {
  if (run.meter !== undefined) return { run, meter: run.meter };
  const meter = meterDatabase(run.env.DB);
  return { run: { ...run, env: { ...run.env, DB: meter.db }, meter }, meter };
}

/**
 * The figures ops set, read by the first job that asks and shared by the rest of the run, so a run reads the store
 * once however many jobs use it; the committed ones if it cannot be read, which is said once in the log.
 */
function sharedInputs({ env, deps, log }: CronRun): () => Promise<OpsInputs> {
  let read: Promise<OpsInputs> | undefined;
  return () => {
    read ??= readOpsInputs(env.DB, deps.now(), (error) => {
      log.error("ops_settings_unreadable", { error });
    });
    return read;
  };
}

/**
 * A whole scheduled run: the jobs, then the heartbeat that tells the outside monitor the cron is running. It pings
 * /fail when a job failed, or when the run before never finished, saying so; with nothing wrong, it pings only when
 * `pingWhenWell` (pingsWhenWell, src/scheduled/schedule.ts).
 */
export async function runCron(jobs: readonly CronJob[], run: CronRun, pingWhenWell = true): Promise<void> {
  const { outcomes, cutShortAt } = await runJobs(jobs, run);
  const notFinished = cutShortAt === null ? [] : [`the run started at ${cutShortAt} never finished`];
  const wrong = [...notFinished, ...failedJobs(outcomes)];
  if (wrong.length === 0 && !pingWhenWell) return;
  const heartbeat = { url: run.config.settings.heartbeatUrl, fetch: run.deps.fetch, log: run.log };
  await pingHeartbeat(heartbeat, wrong);
}

function failedJobs(outcomes: readonly CronOutcome[]): string[] {
  return outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.job);
}

/**
 * Keeping the records must never stop the jobs, so a failure to is only logged, and a lease that cannot be taken lets
 * the job run. The alert providers are made only if a run was cut short: making them on every run cost CPU time.
 */
async function recordStart({ env, deps, log }: CronRun, startedAt: string): Promise<RunStart> {
  try {
    return await startRun({ db: env.DB, alertOnce: (alert) => deps.alertOnce(alert) }, startedAt);
  } catch (error) {
    log.error("cron_run_not_recorded", { error });
    return { overlapping: null, cutShortAt: null, failing: new Set() };
  }
}

async function mayStart({ env, log }: CronRun, job: string, at: { now: Date; dueSince: Date | null }) {
  try {
    return await takeJobLease(env.DB, job, at);
  } catch (error) {
    log.error("cron_lease_not_taken", { job, error });
    return true;
  }
}

async function recordFinish({ env, deps, log }: CronRun, startedAt: string, failedJobCount: number): Promise<void> {
  const run = { startedAt, completedAt: deps.now().toISOString(), failedJobs: failedJobCount };
  try {
    await finishRun({ db: env.DB, resolveAlert: (key) => deps.resolveAlert(key) }, run);
  } catch (error) {
    log.error("cron_run_not_recorded", { error });
  }
}

/** A job that ran well has its success noted; one that was failing starts afresh, and a missed slot is closed. */
async function countSuccess({ env, deps, log }: CronContext, job: CronJob, wasFailing: boolean): Promise<void> {
  try {
    await jobRanWell(env.DB, job.name, deps.now());
    if (wasFailing) await deps.resolveAlert(`cron_job:${job.name}`);
    if (job.slot !== undefined) await deps.resolveAlert(`cron_job_missed:${job.name}`);
  } catch (error) {
    log.error("cron_outcome_not_counted", { error });
  }
}

async function countFailure({ env, deps, log }: CronContext, job: string, error: unknown): Promise<void> {
  const reason = scrubString(error instanceof Error ? error.message : String(error)).slice(0, 300);
  try {
    const failedRuns = await jobFailed(env.DB, job, { at: deps.now(), reason });
    if (failedRuns < ALERT_AFTER_FAILED_RUNS) return;
    await deps.alertOnce({
      key: `cron_job:${job}`,
      message: `The cron's ${job} job has failed ${String(failedRuns)} runs in a row: ${reason}.`,
    });
  } catch (countingError) {
    log.error("cron_outcome_not_counted", { error: countingError });
  }
}
