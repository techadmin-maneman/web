import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NO_GST } from "../../src/config/gst.ts";
import { CALLS_PER_VISIT as BOOKS_CALLS_PER_VISIT } from "../../src/domain/books-invoices.ts";
import { CUT_SHORT_ALERT, finishRun, lastCompletedAt, startRun } from "../../src/domain/cron-runs.ts";
import type { StaticConfig } from "../../src/guard.ts";
import { createLogger } from "../../src/log.ts";
import {
  CRON_CALLS_FOR_MS,
  CRON_JOBS,
  booksSyncOptions,
  runCron,
  runCronJobs,
  type CronJob,
} from "../../src/scheduled/cron.ts";
import {
  CALLS_EVERY_RUN,
  CRON_CALLS,
  EVERY_MINUTE,
  callsFor,
  isDueAt,
  jobsDue,
  pingsWhenWell,
} from "../../src/scheduled/schedule.ts";
import { LOCAL_CONFIG, NOW, captureLogs, fakeDependencies, fakeFetch } from "./helpers.ts";

let logs: ReturnType<typeof captureLogs>;
beforeEach(() => {
  logs = captureLogs();
});

const MINUTE_MS = 60_000;

const WITHOUT_BOOKS: StaticConfig = {
  ...LOCAL_CONFIG,
  providers: { ...LOCAL_CONFIG.providers, BOOKS_PROVIDER: "none" },
};

/** A job that runs every five minutes, in the first of them. */
const job = (name: string, run: CronJob["run"], needs: CronJob["needs"] = "nothing"): CronJob => ({
  name,
  needs,
  every: 5,
  at: 0,
  run,
});

function recorder() {
  const ran: string[] = [];
  const recorded = (name: string, needs: CronJob["needs"], fails = false): CronJob =>
    job(
      name,
      ({ log }) => {
        ran.push(name);
        log.info("ran");
        return fails ? Promise.reject(new Error(`${name} broke`)) : Promise.resolve();
      },
      needs,
    );
  return { ran, job: recorded };
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

  // D-01 of 4 October 2026: Cloudflare stopped every staging run for ten hours, and nobody outside the Worker was told.
  it("pings /fail after a run that never finished, saying when it started", async () => {
    const { job } = recorder();
    const outside = fakeFetch({ [CHECK]: () => new Response("OK") });
    const run = { env, deps: fakeDependencies({ fetch: outside.fetch }), config: WITH_CHECK, log: createLogger() };
    const aMinuteAgo = new Date(NOW.getTime() - MINUTE_MS).toISOString();
    await startRun({ db: env.DB, alertOnce: fakeDependencies().alertOnce }, aMinuteAgo);

    await runCron([job("first", "nothing")], run);
    await runCron([job("first", "nothing")], run);

    expect(outside.calls.map((call) => [call.url, call.body])).toEqual([
      [`${CHECK}/fail`, `the run started at ${aMinuteAgo} never finished`],
      [CHECK, ""],
    ]);
  });

  // The ping is a vendor call, which costs a run CPU time: once in five minutes is the monitor's period.
  it("says all is well once in five minutes, and that something is wrong in any minute", async () => {
    const { job } = recorder();
    const outside = fakeFetch({ [CHECK]: () => new Response("OK") });
    const run = { env, deps: fakeDependencies({ fetch: outside.fetch }), config: WITH_CHECK, log: createLogger() };

    await runCron([job("first", "nothing")], run, false);
    await runCron([job("first", "nothing"), job("second", "nothing", true)], run, false);
    await runCron([job("first", "nothing")], run, true);

    expect(outside.calls.map((call) => [call.url, call.body])).toEqual([
      [`${CHECK}/fail`, "second"],
      [CHECK, ""],
    ]);
    const minute = (at: number) => Date.UTC(2026, 9, 4, 6, at);
    expect([0, 1, 2, 3, 4, 7, 12].map((at) => pingsWhenWell(EVERY_MINUTE, minute(at)))).toEqual([
      false,
      false,
      true,
      false,
      false,
      true,
      true,
    ]);
    expect(pingsWhenWell("*/5 * * * *", minute(0))).toBe(true);
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
  const spender = (name: string, calls: number, seen: { job: string; granted: boolean; left: number }[]) =>
    job(name, ({ budget }) => {
      seen.push({ job: name, granted: budget.spend(calls), left: budget.left() });
      return Promise.resolve();
    });

  it("are one budget, shared by every job in the run and fresh for the next", async () => {
    const seen: { job: string; granted: boolean; left: number }[] = [];
    const jobs = [spender("first", CRON_CALLS - 5, seen), spender("second", 10, seen), spender("third", 5, seen)];

    await runCronJobs(jobs, { env, deps: fakeDependencies(), config: LOCAL_CONFIG, log: createLogger() });
    expect(seen).toEqual([
      { job: "first", granted: true, left: 5 },
      { job: "second", granted: false, left: 5 },
      { job: "third", granted: true, left: 0 },
    ]);
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "cron_calls_spent" }));

    seen.length = 0;
    await runCronJobs([spender("next run", CRON_CALLS, seen)], {
      env,
      deps: fakeDependencies(),
      config: LOCAL_CONFIG,
      log: createLogger(),
    });
    expect(seen).toEqual([{ job: "next run", granted: true, left: 0 }]);
  });

  it("leave room under the free plan's 50 for token refreshes and alerts", () => {
    expect(callsFor("*/5 * * * *")).toBeLessThanOrEqual(40);
  });

  // Each call cost a staging run 3 to 5 ms of CPU: a minute's run takes one record's worth, a finished visit's invoice
  // in Books needing the most.
  it("give a minute's run one record's worth, and a run of every job at once as many as before", () => {
    expect(callsFor(EVERY_MINUTE)).toBe(CRON_CALLS);
    expect(CRON_CALLS).toBe(BOOKS_CALLS_PER_VISIT);
    expect(callsFor("*/5 * * * *")).toBe(40);
  });

  // A run still waiting on a slow vendor when the next minute's starts would be taken by the next for one cut short.
  it("are refused once the run is half a minute old, so it ends before the next minute's run", async () => {
    const seen: { job: string; granted: boolean; left: number }[] = [];
    let now = NOW;
    const slow = job("slow vendor", () => {
      now = new Date(NOW.getTime() + CRON_CALLS_FOR_MS);
      return Promise.resolve();
    });

    await runCronJobs([spender("first", 1, seen), slow, spender("after", 1, seen)], {
      env,
      deps: fakeDependencies({ now: () => now }),
      config: LOCAL_CONFIG,
      log: createLogger(),
    });

    expect(seen.map((each) => [each.job, each.granted])).toEqual([
      ["first", true],
      ["after", false],
    ]);
    expect(CRON_CALLS_FOR_MS).toBeLessThan(MINUTE_MS);
  });
});

describe("the schedule", () => {
  /** The scheduled time of the run at `minute` past the hour. */
  const minuteOf = (minute: number) => Date.UTC(2026, 9, 4, 6, minute);
  const namesAt = (minute: number, jobs: readonly CronJob[] = CRON_JOBS) =>
    jobsDue(jobs, EVERY_MINUTE, minuteOf(minute)).map((each) => each.name);
  const HOUR = Array.from({ length: 60 }, (_, minute) => minute);

  it("gives every job a minute inside its period", () => {
    for (const each of CRON_JOBS) {
      expect(Number.isInteger(each.at), each.name).toBe(true);
      expect(each.at, each.name).toBeGreaterThanOrEqual(0);
      expect(each.at, each.name).toBeLessThan(each.every);
    }
    expect(new Set(CRON_JOBS.map((each) => each.name)).size).toBe(CRON_JOBS.length);
  });

  // PLAT-30: hourly jobs once ran only when the run's own clock said the first five minutes, so a late run skipped the
  // hour. A run is now due by the minute Cloudflare scheduled it for, however late it starts.
  it("runs each job as often as it says, in the same minutes every hour", () => {
    const runs = new Map<string, number[]>();
    for (const minute of HOUR) {
      for (const name of namesAt(minute)) runs.set(name, [...(runs.get(name) ?? []), minute]);
    }
    for (const each of CRON_JOBS) {
      const minutes = runs.get(each.name) ?? [];
      expect(minutes, each.name).toHaveLength(60 / each.every);
      expect(
        minutes.every((minute) => isDueAt(each, minute)),
        each.name,
      ).toBe(true);
    }
    expect(runs.get("visit_reminders")).toEqual([1, 16, 31, 46]);
  });

  it("is due by the minute scheduled, not when the run starts", () => {
    const scheduled = minuteOf(8);
    expect(jobsDue(CRON_JOBS, EVERY_MINUTE, scheduled + 59_000)).toEqual(jobsDue(CRON_JOBS, EVERY_MINUTE, scheduled));
  });

  // The five-minute trigger stays attached until an operator applies this one (docs/decisions/0010): until then each
  // of its runs does what a run did before, every job.
  it("runs every job on any other schedule: npm run tick, or the five-minute trigger", () => {
    expect(jobsDue(CRON_JOBS, "*/5 * * * *", minuteOf(3))).toEqual(CRON_JOBS);
  });

  // D-01 of 4 October 2026: one run of every job took 34 to 61 ms of CPU on staging, the free plan allows 10. Measured
  // a minute at a time, a job that calls a vendor cost several ms more than one that only reads D1.
  it("gives no minute more than three jobs, and a vendor's every-run caller one companion at most", () => {
    for (const minute of HOUR) {
      const names = namesAt(minute);
      const said = `minute ${String(minute)}: ${names.join(", ")}`;
      expect(names.length, said).toBeLessThanOrEqual(3);
      const callers = names.filter((name) => CALLS_EVERY_RUN.has(name));
      expect(callers.length, said).toBeLessThanOrEqual(1);
      if (callers.length === 1) expect(names.length, said).toBeLessThanOrEqual(2);
    }
  });

  it("names only jobs in the table as vendors' every-run callers", () => {
    const names = new Set(CRON_JOBS.map((each) => each.name));
    expect([...CALLS_EVERY_RUN].filter((name) => !names.has(name))).toEqual([]);
  });

  it("raises a finished job's invoice before the Books pass that sets the client's advance against it", () => {
    const minuteOfJob = (name: string) => CRON_JOBS.find((each) => each.name === name)?.at ?? -1;
    expect(minuteOfJob("invoices")).toBeLessThan(minuteOfJob("books_sync"));
  });

  // checkBooksItems does nothing after the hour's first five minutes (src/domain/books-items.ts).
  it("checks Books' items in the hour's first five minutes, the only ones its check works in", () => {
    const items = CRON_JOBS.find((each) => each.name === "books_items");
    expect(items).toMatchObject({ every: 60 });
    expect(items?.at).toBeLessThan(5);
  });
});

describe("CRON_JOBS", () => {
  it("bills and settles in Books, checks its items and books unbooked holds", async () => {
    const withBooks: StaticConfig = {
      ...LOCAL_CONFIG,
      providers: { ...LOCAL_CONFIG.providers, BOOKS_PROVIDER: "stub" },
    };
    const outcomes = await runCronJobs(CRON_JOBS, {
      env,
      deps: fakeDependencies(),
      config: withBooks,
      log: createLogger(),
    });
    const ran = outcomes.map((outcome) => outcome.job);
    expect(ran).toEqual(expect.arrayContaining(["unbooked_holds", "books_items", "invoices", "books_sync"]));
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([]);
  });

  it("tells ops once when the photographs fill half their share of R2, however many runs see it", async () => {
    await env.DB.prepare("UPDATE storage_meter SET bytes = 0.21e9").run();
    const deps = fakeDependencies();
    const meter = CRON_JOBS.filter((cronJob) => cronJob.name === "storage_meter");
    for (let run = 0; run < 3; run += 1) {
      await runCronJobs(meter, { env, deps, config: LOCAL_CONFIG, log: createLogger() });
    }
    expect(deps.alerts).toEqual([
      expect.stringContaining("Photos and referral cards use 0.21 GB, half of their 0.4 GB of free storage"),
    ]);
  });

  // PLAT-16 of the audit, 2 October 2026: nothing read the database's size before D1's limit stopped every write.
  it("tells ops once when the database reaches half of D1's limit, in the same hourly look", async () => {
    const deps = fakeDependencies();
    const meter = CRON_JOBS.filter((cronJob) => cronJob.name === "storage_meter");
    const halfFull = { ...env, DB: holding(env.DB, 260e6) };
    for (let run = 0; run < 2; run += 1) {
      await runCronJobs(meter, { env: halfFull, deps, config: LOCAL_CONFIG, log: createLogger() });
    }
    expect(deps.alerts).toEqual([expect.stringContaining("The database holds 260 MB, 50% of the 500 MB")]);
  });

  it("reads the account's usage only where the analytics token is set", async () => {
    const allowances = CRON_JOBS.filter((cronJob) => cronJob.name === "daily_allowances");
    const graphql = "https://api.cloudflare.com/client/v4/graphql";
    const withToken: StaticConfig = {
      ...LOCAL_CONFIG,
      settings: { ...LOCAL_CONFIG.settings, analyticsToken: "token" },
    };
    const callsMade = async (config: StaticConfig) => {
      const { fetch, calls } = fakeFetch({ [graphql]: () => new Response("Bad Gateway", { status: 502 }) });
      await runCronJobs(allowances, { env, deps: fakeDependencies({ fetch }), config, log: createLogger() });
      return calls.length;
    };

    expect(await callsMade(LOCAL_CONFIG)).toBe(0);
    expect(await callsMade(withToken)).toBe(1);
  });
});

/** The database, saying it holds `bytes` whenever its size is read. */
function holding(db: D1Database, bytes: number): D1Database {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property !== "prepare") return Reflect.get(target, property, receiver) as unknown;
      return (sql: string) => {
        const statement = target.prepare(sql);
        if (sql !== "SELECT 1") return statement;
        return {
          run: async () => {
            const result = await statement.run();
            return { ...result, meta: { ...result.meta, size_after: bytes } };
          },
        };
      };
    },
  });
}

describe("the Books pass's options", () => {
  const zohoBooks = {
    clientId: "1000.BOOKSCLIENT",
    clientSecret: "books-secret",
    refreshToken: "1000.books-refresh",
    accountsHost: "accounts.zoho.in",
    apiHost: "www.zohoapis.in",
    orgId: "60088931635",
    refundAccountId: "bank-7",
    gst: { gstin: "06AAACM1234A1Z5", stateCode: "HR", sac: "999721" },
  };

  it("takes the refund account and GST from Books' own settings", () => {
    const config: StaticConfig = {
      ...LOCAL_CONFIG,
      environment: "staging",
      providers: { ...LOCAL_CONFIG.providers, BOOKS_PROVIDER: "zoho" },
      settings: { ...LOCAL_CONFIG.settings, zohoBooks },
    };
    expect(booksSyncOptions(config)).toEqual({ refundAccountId: "bank-7", labelAsTest: true, gst: zohoBooks.gst });
  });

  it("has no refund account or GST without Books' settings, and labels nothing as a test in production", () => {
    expect(booksSyncOptions({ ...LOCAL_CONFIG, environment: "production" })).toMatchObject({
      refundAccountId: null,
      labelAsTest: false,
      gst: NO_GST,
    });
  });
});
