import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { NO_GST } from "../../../src/config/gst.ts";
import { CALLS_PER_VISIT as BOOKS_CALLS_PER_VISIT } from "../../../src/domain/books/books-invoices.ts";
import { startRun } from "../../../src/domain/platform/cron-runs.ts";
import type { StaticConfig } from "../../../src/guard.ts";
import { createLogger } from "../../../src/log.ts";
import {
  CRON_CALLS_FOR_MS,
  CRON_JOBS,
  booksSyncOptions,
  runCron,
  runCronJobs,
  type CronJob,
} from "../../../src/scheduled/cron.ts";
import { CRON_CALLS, EVERY_MINUTE, isDueAt, jobsDue, pingsWhenWell } from "../../../src/scheduled/schedule.ts";
import { LOCAL_CONFIG, NOW, captureLogs, fakeDependencies, fakeFetch } from "../helpers.ts";
import { MINUTE_MS, job, recorder } from "./cron-fixtures.ts";

let logs: ReturnType<typeof captureLogs>;

beforeEach(() => {
  logs = captureLogs();
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

// Every alert was sent from inside mm-api, so a cron that stopped running altogether told nobody.
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

  // Cloudflare once stopped every staging run for ten hours, and nobody outside the Worker was told.
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

  // A finished visit's invoice in Books needs the most calls of any record.
  it("give a run several finished visits' invoices, under Zoho Books' 100 calls a minute", () => {
    expect(CRON_CALLS).toBeGreaterThanOrEqual(5 * BOOKS_CALLS_PER_VISIT);
    expect(CRON_CALLS).toBeLessThan(100);
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

  // Hourly jobs once ran only when the run's own clock said the first five minutes, so a late run skipped the
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

  it("raises a finished job's invoice before the Books pass that sets the client's advance against it", () => {
    const minuteOfJob = (name: string) => CRON_JOBS.find((each) => each.name === name)?.at ?? -1;
    expect(minuteOfJob("invoices")).toBeLessThan(minuteOfJob("books_sync"));
  });

  // checkBooksItems does nothing after the hour's first five minutes (src/domain/books/books-items.ts).
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

  // Nothing read the database's size before D1's limit stopped every write.
  it("tells ops once when the database reaches half of D1's limit, in the same hourly look", async () => {
    const deps = fakeDependencies();
    const meter = CRON_JOBS.filter((cronJob) => cronJob.name === "storage_meter");
    const halfFull = { ...env, DB: holding(env.DB, 5.2e9) };
    for (let run = 0; run < 2; run += 1) {
      await runCronJobs(meter, { env: halfFull, deps, config: LOCAL_CONFIG, log: createLogger() });
    }
    expect(deps.alerts).toEqual([expect.stringContaining("The database holds 5.20 GB, 50% of the 10 GB")]);
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
