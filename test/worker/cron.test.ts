import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GST_REGISTRATION } from "../../src/config/gst.ts";
import { CUT_SHORT_ALERT, finishRun, lastCompletedAt, startRun } from "../../src/domain/cron-runs.ts";
import type { StaticConfig } from "../../src/guard.ts";
import { createLogger } from "../../src/log.ts";
import {
  CRON_CALLS,
  CRON_JOBS,
  booksSyncOptions,
  runCron,
  runCronJobs,
  type CronJob,
} from "../../src/scheduled/cron.ts";
import { LOCAL_CONFIG, NOW, captureLogs, fakeDependencies, fakeFetch } from "./helpers.ts";

let logs: ReturnType<typeof captureLogs>;
beforeEach(() => {
  logs = captureLogs();
});

const WITHOUT_BOOKS: StaticConfig = {
  ...LOCAL_CONFIG,
  providers: { ...LOCAL_CONFIG.providers, BOOKS_PROVIDER: "none" },
};

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
    const jobs = [
      job("fsm", "fsm"),
      job("fsm_and_books", "fsm_and_books"),
      job("books", "books"),
      job("always", "nothing"),
    ];

    const outcomes = await runCronJobs(jobs, {
      env,
      deps: fakeDependencies(),
      config: WITHOUT_BOOKS,
      log: createLogger(),
    });

    expect(ran).toEqual(["fsm", "always"]);
    expect(outcomes.map((outcome) => outcome.job)).toEqual(["fsm", "always"]);
  });

  it("runs a job for Books without FSM only where D1, not FSM, is the record", async () => {
    const { ran, job } = recorder();
    const jobs = [job("books", "books"), job("books_without_fsm", "books_without_fsm")];
    const ours: StaticConfig = { ...LOCAL_CONFIG, providers: { ...LOCAL_CONFIG.providers, FSM_PROVIDER: "none" } };

    await runCronJobs(jobs, { env, deps: fakeDependencies(), config: LOCAL_CONFIG, log: createLogger() });
    expect(ran).toEqual(["books"]);
    await runCronJobs(jobs, { env, deps: fakeDependencies(), config: ours, log: createLogger() });
    expect(ran).toEqual(["books", "books", "books_without_fsm"]);
  });

  // LIFE-17: the stub remembers no appointment, so locally the repair read every visit it looked at as one FSM had
  // deleted, and each run took two more off the local mirror.
  it("repairs the FSM mirror only against the real FSM, which is a record; the stub holds none", async () => {
    const { ran, job } = recorder();
    const jobs = [job("fsm_reconcile", "fsm_record"), job("fsm_catalogue", "fsm")];
    const zoho: StaticConfig = { ...LOCAL_CONFIG, providers: { ...LOCAL_CONFIG.providers, FSM_PROVIDER: "zoho" } };

    await runCronJobs(jobs, { env, deps: fakeDependencies(), config: LOCAL_CONFIG, log: createLogger() });
    expect(ran).toEqual(["fsm_catalogue"]);

    await runCronJobs(jobs, { env, deps: fakeDependencies(), config: zoho, log: createLogger() });
    expect(ran).toEqual(["fsm_catalogue", "fsm_reconcile", "fsm_catalogue"]);
    expect(CRON_JOBS.find((each) => each.name === "fsm_reconcile")?.needs).toBe("fsm_record");
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

  // PLAT-11: every job's count was written on every run, sixteen writes a run for counts that were almost never set.
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
  const MINUTE_MS = 60_000;
  const at = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE_MS);
  const nothing: CronJob = { name: "nothing", needs: "nothing", run: () => Promise.resolve() };
  const broken: CronJob = { name: "broken", needs: "nothing", run: () => Promise.reject(new Error("down")) };

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

  // PLAT-11: a run cut short for its CPU left no row and no alert, and the jobs after where it stopped went unrun.
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
    for (const minutes of [0, 5, 10]) await runAt(minutes, told);
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

// PLAT-42: every alert was sent from inside mm-api, so a cron that stopped running altogether told nobody.
describe("the heartbeat after a run", () => {
  const CHECK = "https://hc-ping.com/0b9f1a52-7c0b-4f5b-9a0e-2f4f6f2b1a01";
  const WITH_CHECK: StaticConfig = { ...LOCAL_CONFIG, settings: { ...LOCAL_CONFIG.settings, heartbeatUrl: CHECK } };

  it("pings the outside monitor after every run, and its /fail naming the jobs that failed", async () => {
    const { job } = recorder();
    const outside = fakeFetch({ [CHECK]: () => new Response("OK") });
    const run = { env, deps: fakeDependencies({ fetch: outside.fetch }), config: WITH_CHECK, log: createLogger() };

    await runCron([job("first", "nothing")], run);
    await runCron([job("first", "nothing"), job("second", "nothing", true), job("third", "nothing", true)], run);

    expect(outside.calls.map((call) => [call.url, call.body])).toEqual([
      [CHECK, ""],
      [`${CHECK}/fail`, "second, third"],
    ]);
  });

  it("pings nothing where no monitor is set", async () => {
    const { job } = recorder();
    const outside = fakeFetch({});

    await runCron([job("first", "nothing")], {
      env,
      deps: fakeDependencies({ fetch: outside.fetch }),
      config: LOCAL_CONFIG,
      log: createLogger(),
    });

    expect(outside.calls).toEqual([]);
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
      "unbooked_holds",
      "erased_files",
      "fsm_reconcile",
      "fsm_catalogue",
      "deletion_alerts",
      "storage_meter",
      "daily_allowances",
      "whatsapp_bridge",
      "dispatch_utilisation",
      "referrals",
      "visit_reminders",
      "next_service_reminders",
      "payment_links",
      "books_items",
      "invoices",
      "asked_windows",
      "books_sync",
    ]);
  });

  it("without FSM, bills and settles in Books and checks its items, and runs none of FSM's jobs", async () => {
    const ours: StaticConfig = {
      ...LOCAL_CONFIG,
      providers: { ...LOCAL_CONFIG.providers, FSM_PROVIDER: "none", BOOKS_PROVIDER: "stub" },
    };
    const outcomes = await runCronJobs(CRON_JOBS, { env, deps: fakeDependencies(), config: ours, log: createLogger() });
    const ran = outcomes.map((outcome) => outcome.job);
    expect(ran).toEqual(expect.arrayContaining(["books_items", "invoices", "books_sync"]));
    for (const fsmOnly of ["unbooked_holds", "fsm_reconcile", "fsm_catalogue", "asked_windows"]) {
      expect(ran, fsmOnly).not.toContain(fsmOnly);
    }
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([]);
  });

  it("on FSM's path, raises invoices through FSM and leaves Books' items to FSM", async () => {
    const outcomes = await runCronJobs(CRON_JOBS, {
      env,
      deps: fakeDependencies(),
      config: LOCAL_CONFIG,
      log: createLogger(),
    });
    const ran = outcomes.map((outcome) => outcome.job);
    expect(ran).toEqual(expect.arrayContaining(["invoices", "books_sync", "fsm_catalogue"]));
    expect(ran).not.toContain("books_items");
  });

  it("tells ops once when the photographs fill half their share of R2, however many runs see it", async () => {
    await env.DB.prepare("UPDATE storage_meter SET bytes = 2.1e9").run();
    const deps = fakeDependencies();
    const job = CRON_JOBS.filter((cronJob) => cronJob.name === "storage_meter");
    for (let run = 0; run < 3; run += 1) {
      await runCronJobs(job, { env, deps, config: LOCAL_CONFIG, log: createLogger() });
    }
    expect(deps.alerts).toEqual([expect.stringContaining("2.10 GB in R2, half of their 4 GB share")]);
  });

  // NOW is half past the hour in UTC. The share fills over months; the hour's other checks run on the hour.
  it("looks at the storage meter once an hour, on the half hour, and reads nothing on the other runs", async () => {
    await env.DB.prepare("UPDATE storage_meter SET bytes = 2.1e9").run();
    const job = CRON_JOBS.filter((cronJob) => cronJob.name === "storage_meter");
    const at = (minutes: number) => fakeDependencies({ now: () => new Date(NOW.getTime() + minutes * 60_000) });

    for (const minutes of [-30, 5, 25]) {
      const deps = at(minutes);
      await runCronJobs(job, { env, deps, config: LOCAL_CONFIG, log: createLogger() });
      expect(deps.alerts, `${String(minutes)} minutes from half past`).toEqual([]);
    }
    const onTheHalfHour = at(0);
    await runCronJobs(job, { env, deps: onTheHalfHour, config: LOCAL_CONFIG, log: createLogger() });
    expect(onTheHalfHour.alerts).toHaveLength(1);
  });

  // NOW is half past the hour in UTC, so a quarter past is 15 minutes before it.
  it("reads the account's usage once an hour, at a quarter past, and only where the analytics token is set", async () => {
    const job = CRON_JOBS.filter((cronJob) => cronJob.name === "daily_allowances");
    const graphql = "https://api.cloudflare.com/client/v4/graphql";
    const withToken: StaticConfig = {
      ...LOCAL_CONFIG,
      settings: { ...LOCAL_CONFIG.settings, analyticsToken: "token" },
    };
    const runAt = async (minutes: number, config: StaticConfig) => {
      const { fetch, calls } = fakeFetch({ [graphql]: () => new Response("Bad Gateway", { status: 502 }) });
      const now = new Date(NOW.getTime() + minutes * 60_000);
      await runCronJobs(job, { env, deps: fakeDependencies({ fetch, now: () => now }), config, log: createLogger() });
      return calls.length;
    };

    expect(await runAt(-15, LOCAL_CONFIG)).toBe(0);
    for (const minutes of [-16, -10, 0, 25]) {
      expect(await runAt(minutes, withToken), `${String(minutes)} minutes from half past`).toBe(0);
    }
    expect(await runAt(-15, withToken)).toBe(1);
  });
});

describe("the Books pass's options", () => {
  const zohoBooks = {
    clientId: "1000.BOOKSCLIENT",
    clientSecret: "books-secret",
    refreshToken: "1000.books-refresh",
    accountsHost: "accounts.zoho.in",
    apiHost: "www.zohoapis.in",
    orgId: "60088931635",
    refundAccountId: "bank-7",
  };

  it("takes the refund account from Books' own settings, whatever FSM is, and makes customers only without it", () => {
    for (const [FSM_PROVIDER, record] of [
      ["zoho", "fsm"],
      ["none", "ours"],
    ] as const) {
      const config: StaticConfig = {
        ...LOCAL_CONFIG,
        environment: "staging",
        providers: { ...LOCAL_CONFIG.providers, FSM_PROVIDER, BOOKS_PROVIDER: "zoho" },
        settings: { ...LOCAL_CONFIG.settings, zohoBooks },
      };
      expect(booksSyncOptions(config), FSM_PROVIDER).toEqual({
        refundAccountId: "bank-7",
        labelAsTest: true,
        fieldRecord: record,
        gst: GST_REGISTRATION,
      });
    }
  });

  it("has no refund account without Books' settings, and labels nothing as a test in production", () => {
    expect(booksSyncOptions({ ...LOCAL_CONFIG, environment: "production" })).toMatchObject({
      refundAccountId: null,
      labelAsTest: false,
    });
  });
});
