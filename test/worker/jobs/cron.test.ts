import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CUT_SHORT_ALERT, finishRun, lastCompletedAt, startRun } from "../../../src/domain/platform/cron-runs.ts";
import type { StaticConfig } from "../../../src/guard.ts";
import { createLogger } from "../../../src/log.ts";
import { CRON_JOBS, runCronJobs, type CronJob } from "../../../src/scheduled/cron.ts";
import { LOCAL_CONFIG, NOW, captureLogs, fakeDependencies } from "../helpers.ts";
import { MINUTE_MS, job, recorder } from "./cron-fixtures.ts";

let logs: ReturnType<typeof captureLogs>;

beforeEach(() => {
  logs = captureLogs();
});

const WITHOUT_BOOKS: StaticConfig = {
  ...LOCAL_CONFIG,
  providers: { ...LOCAL_CONFIG.providers, BOOKS_PROVIDER: "none" },
};

describe("runCronJobs", () => {
  it("runs each job in order, past one that fails, and says which failed", async () => {
    const { ran, job } = recorder();
    const jobs = [job("first", "nothing"), job("second", "nothing", true), job("third", "nothing")];

    const outcomes = await runCronJobs(jobs, {
      env,
      deps: fakeDependencies(),
      config: LOCAL_CONFIG,
      log: createLogger(),
    });

    expect(ran).toEqual(["first", "second", "third"]);
    expect(outcomes).toEqual([
      { job: "first", ok: true },
      { job: "second", ok: false },
      { job: "third", ok: true },
    ]);
    const failed = logs.lines().filter((line) => line.event === "cron_job_failed");
    expect(failed).toEqual([expect.objectContaining({ level: "error", job: "second" })]);
  });

  it("names the job on every line it logs", async () => {
    const { job } = recorder();
    await runCronJobs([job("first", "nothing")], {
      env,
      deps: fakeDependencies(),
      config: LOCAL_CONFIG,
      log: createLogger({ job: "cron" }),
    });
    expect(logs.lines().filter((line) => line.event === "ran")).toEqual([expect.objectContaining({ job: "first" })]);
  });

  it("skips a job whose provider is not connected here", async () => {
    const { ran, job } = recorder();
    const jobs = [job("books", "books"), job("always", "nothing")];

    const outcomes = await runCronJobs(jobs, {
      env,
      deps: fakeDependencies(),
      config: WITHOUT_BOOKS,
      log: createLogger(),
    });

    expect(ran).toEqual(["always"]);
    expect(outcomes.map((outcome) => outcome.job)).toEqual(["always"]);
  });

  it("asks Razorpay what its webhook missed only where payments are connected", async () => {
    const { ran, job } = recorder();
    const jobs = [job("razorpay_catch_up", "payments")];
    const unpaid: StaticConfig = {
      ...LOCAL_CONFIG,
      providers: { ...LOCAL_CONFIG.providers, PAYMENTS_PROVIDER: "none" },
    };

    await runCronJobs(jobs, { env, deps: fakeDependencies(), config: unpaid, log: createLogger() });
    expect(ran).toEqual([]);
    await runCronJobs(jobs, { env, deps: fakeDependencies(), config: LOCAL_CONFIG, log: createLogger() });
    expect(ran).toEqual(["razorpay_catch_up"]);
    expect(CRON_JOBS.find((each) => each.name === "razorpay_catch_up")?.needs).toBe("payments");
  });
});

describe("a job that keeps failing", () => {
  const failing = (): CronJob => job("books_sync", () => Promise.reject(new Error("Books 500")));
  const working = (): CronJob => job("books_sync", () => Promise.resolve());

  const failedRuns = () =>
    env.DB.prepare("SELECT failed_runs, last_error FROM cron_jobs WHERE job = 'books_sync'").first<{
      failed_runs: number;
      last_error: string | null;
    }>();

  async function runs(times: number, each: CronJob, deps = fakeDependencies()) {
    for (let run = 0; run < times; run += 1) {
      await runCronJobs([each], { env, deps, config: LOCAL_CONFIG, log: createLogger() });
    }
    return deps;
  }

  it("counts its failed runs in a row, and alerts once on the third", async () => {
    const deps = await runs(2, failing());
    expect(await failedRuns()).toEqual({ failed_runs: 2, last_error: "Books 500" });
    expect(deps.alerts).toEqual([]);

    await runs(2, failing(), deps);
    expect(await failedRuns()).toMatchObject({ failed_runs: 4 });
    expect(deps.alerts).toEqual(["The cron's books_sync job has failed 3 runs in a row: Books 500."]);
  });

  it("starts counting afresh once it works, and closes its alert", async () => {
    const deps = await runs(3, failing());
    await runs(1, working(), deps);
    expect(await failedRuns()).toMatchObject({ failed_runs: 0 });
    const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM alerts WHERE resolved_at IS NULL").first<{
      n: number;
    }>();
    expect(open?.n).toBe(0);

    await runs(3, failing(), deps);
    expect(deps.alerts).toHaveLength(2);
  });

  // Every job's count was written on every run, sixteen writes a run for counts that were almost never set.
  it("reads which jobs are failing once a run, rather than writing each working job's count", async () => {
    const { job } = recorder();
    const prepared = vi.spyOn(env.DB, "prepare");

    await runCronJobs([job("first", "nothing"), job("second", "nothing"), job("third", "nothing")], {
      env,
      deps: fakeDependencies(),
      config: LOCAL_CONFIG,
      log: createLogger(),
    });

    const countStatements = prepared.mock.calls.filter(([sql]) => sql.includes("cron_jobs"));
    expect(countStatements).toEqual([["SELECT job FROM cron_jobs WHERE failed_runs > 0"]]);
  });
});

describe("the run record", () => {
  const at = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE_MS);
  const nothing = job("nothing", () => Promise.resolve());
  const broken = job("broken", () => Promise.reject(new Error("down")));

  /** A run at `minutes` past NOW; what it tells the chat joins `told`. */
  async function runAt(minutes: number, told: string[] = [], jobs = [nothing]) {
    const alert = (message: string) => {
      told.push(message);
      return Promise.resolve();
    };
    const deps = fakeDependencies({ now: () => at(minutes), alert });
    await runCronJobs(jobs, { env, deps, config: LOCAL_CONFIG, log: createLogger() });
    return told;
  }

  /** A run Cloudflare stopped: it noted its start, and never reached its end. */
  async function cutShortAt(minutes: number) {
    await startRun({ db: env.DB, alertOnce: fakeDependencies().alertOnce }, at(minutes).toISOString());
  }

  const record = () =>
    env.DB.prepare("SELECT started_at, completed_at, failed_jobs, cut_short_at FROM cron_runs").first();
  const openCutShortAlerts = () =>
    env.DB.prepare("SELECT COUNT(*) AS n FROM alerts WHERE key = ?1 AND resolved_at IS NULL")
      .bind(CUT_SHORT_ALERT)
      .first<number>("n");

  it("notes when each run started and finished, and how many of its jobs failed", async () => {
    await runAt(0, [], [nothing, broken]);

    expect(await record()).toEqual({
      started_at: at(0).toISOString(),
      completed_at: at(0).toISOString(),
      failed_jobs: 1,
      cut_short_at: null,
    });
    expect(await lastCompletedAt(env.DB)).toBe(at(0).toISOString());
  });

  // A run cut short for its CPU left no row and no alert, and the jobs after where it stopped went unrun.
  it("tells ops once when the run before never finished, however many runs see it", async () => {
    await runAt(0);
    await cutShortAt(5);

    const told = await runAt(10);
    await runAt(15, told);

    expect(told).toEqual([
      `The cron run started at ${at(5).toISOString()} never finished, so the jobs after where it stopped did not run. ` +
        `Cloudflare may have stopped it for its CPU time: runbook, "A cron run cut short".`,
    ]);
    expect(await record()).toMatchObject({ completed_at: at(15).toISOString(), cut_short_at: at(10).toISOString() });
  });

  it("says nothing on the first run, nor while every run finishes", async () => {
    const told: string[] = [];
    for (const minutes of [0, 1, 2]) await runAt(minutes, told);
    expect(told).toEqual([]);
  });

  it("closes the alert once runs have finished for an hour, so the next one is told again", async () => {
    await cutShortAt(0);
    const told = await runAt(5);
    await runAt(50, told);
    expect(await openCutShortAlerts()).toBe(1);

    await runAt(65, told);
    expect(await openCutShortAlerts()).toBe(0);
    expect(await record()).toMatchObject({ cut_short_at: null });

    await cutShortAt(70);
    await runAt(75, told);
    expect(told).toHaveLength(2);
  });

  it("leaves the record to a later run that started before this one finished", async () => {
    await cutShortAt(0);
    await cutShortAt(5);
    await finishRun(
      { db: env.DB, resolveAlert: fakeDependencies().resolveAlert },
      { startedAt: at(0).toISOString(), completedAt: at(6).toISOString(), failedJobs: 0 },
    );
    expect(await record()).toMatchObject({ started_at: at(5).toISOString(), completed_at: null });
  });

  it("runs every job even when the record cannot be kept", async () => {
    await env.DB.exec("DROP TABLE cron_runs");
    const { ran, job } = recorder();

    await runCronJobs([job("first", "nothing"), job("second", "nothing")], {
      env,
      deps: fakeDependencies(),
      config: LOCAL_CONFIG,
      log: createLogger(),
    });

    expect(ran).toEqual(["first", "second"]);
    expect(logs.lines().filter((line) => line.event === "cron_run_not_recorded")).toHaveLength(2);
  });
});
