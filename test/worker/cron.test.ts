import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../../src/log.ts";
import { CRON_CALLS, CRON_JOBS, runCronJobs, type CronJob } from "../../src/scheduled/cron.ts";
import { LOCAL_CONFIG, captureLogs, fakeDependencies } from "./helpers.ts";

let logs: ReturnType<typeof captureLogs>;
beforeEach(() => {
  logs = captureLogs();
});

const WITHOUT_BOOKS = { ...LOCAL_CONFIG, providers: { ...LOCAL_CONFIG.providers, BOOKS_PROVIDER: "none" } };

function recorder() {
  const ran: string[] = [];
  const job = (name: string, needs: CronJob["needs"], fails = false): CronJob => ({
    name,
    needs,
    run: ({ log }) => {
      ran.push(name);
      log.info("ran");
      return fails ? Promise.reject(new Error(`${name} broke`)) : Promise.resolve();
    },
  });
  return { ran, job };
}

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
    const jobs = [job("fsm", "fsm"), job("books", "fsm_and_books"), job("always", "nothing")];

    const outcomes = await runCronJobs(jobs, {
      env,
      deps: fakeDependencies(),
      config: WITHOUT_BOOKS,
      log: createLogger(),
    });

    expect(ran).toEqual(["fsm", "always"]);
    expect(outcomes.map((outcome) => outcome.job)).toEqual(["fsm", "always"]);
  });
});

describe("a job that keeps failing", () => {
  const failing = (): CronJob => ({
    name: "books_sync",
    needs: "nothing",
    run: () => Promise.reject(new Error("Books 500")),
  });
  const working = (): CronJob => ({ name: "books_sync", needs: "nothing", run: () => Promise.resolve() });

  const failedRuns = () =>
    env.DB.prepare("SELECT failed_runs, last_error FROM cron_jobs WHERE job = 'books_sync'").first<{
      failed_runs: number;
      last_error: string | null;
    }>();

  async function runs(times: number, job: CronJob, deps = fakeDependencies()) {
    for (let run = 0; run < times; run += 1) {
      await runCronJobs([job], { env, deps, config: LOCAL_CONFIG, log: createLogger() });
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
});

describe("the run's outside calls", () => {
  it("are one budget, shared by every job in the run and fresh for the next", async () => {
    const seen: { job: string; granted: boolean; left: number }[] = [];
    const spender = (name: string, calls: number): CronJob => ({
      name,
      needs: "nothing",
      run: ({ budget }) => {
        seen.push({ job: name, granted: budget.spend(calls), left: budget.left() });
        return Promise.resolve();
      },
    });
    const jobs = [spender("first", CRON_CALLS - 5), spender("second", 10), spender("third", 5)];

    await runCronJobs(jobs, { env, deps: fakeDependencies(), config: LOCAL_CONFIG, log: createLogger() });
    expect(seen).toEqual([
      { job: "first", granted: true, left: 5 },
      { job: "second", granted: false, left: 5 },
      { job: "third", granted: true, left: 0 },
    ]);
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "cron_calls_spent" }));

    seen.length = 0;
    await runCronJobs([spender("next run", CRON_CALLS)], {
      env,
      deps: fakeDependencies(),
      config: LOCAL_CONFIG,
      log: createLogger(),
    });
    expect(seen).toEqual([{ job: "next run", granted: true, left: 0 }]);
  });

  it("leave room under the free plan's 50 for token refreshes and alerts", () => {
    expect(CRON_CALLS).toBeLessThanOrEqual(40);
  });
});

describe("CRON_JOBS", () => {
  it("sweeps first and settles Books last, after the invoices it applies advances to", () => {
    expect(CRON_JOBS.map((job) => job.name)).toEqual([
      "sweeper",
      "erased_files",
      "fsm_reconcile",
      "deletion_alerts",
      "whatsapp_bridge",
      "dispatch_utilisation",
      "referrals",
      "visit_reminders",
      "invoices",
      "asked_windows",
      "books_sync",
    ]);
  });
});
