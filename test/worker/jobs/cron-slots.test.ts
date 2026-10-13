// A job held to a slot of India's day or week (src/scheduled/schedule.ts, src/scheduled/cron-runner.ts;
// docs/decisions/0195-the-cron-a-job-at-a-time.md): due from its hour until it has run well, so a slot missed or failed
// is caught up by the next run, and counted a success only when it ran; and told as missed past its period.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../../../src/log.ts";
import { CRON_JOBS, type CronJob } from "../../../src/scheduled/cron.ts";
import { runCronJobs } from "../../../src/scheduled/cron-runner.ts";
import { lastSlotStart, missedAfterMs } from "../../../src/scheduled/schedule.ts";
import { LOCAL_CONFIG, fakeDependencies, markDatabase, type TestDependencies } from "../helpers.ts";

/** An instant given as India's clock: "2026-10-11 03:30". */
const india = (text: string) => new Date(`${text.replace(" ", "T")}:00+05:30`);

describe("a slot's start", () => {
  it("is today's hour once it has come, and yesterday's before it", () => {
    expect(lastSlotStart(india("2026-10-13 03:30"), { hour: 3 })).toEqual(india("2026-10-13 03:00"));
    expect(lastSlotStart(india("2026-10-13 02:59"), { hour: 3 })).toEqual(india("2026-10-12 03:00"));
  });

  it("is the week's day and hour for a weekly one, Sunday's 3 am for the backup", () => {
    expect(lastSlotStart(india("2026-10-11 03:00"), { hour: 3, weekday: 0 })).toEqual(india("2026-10-11 03:00"));
    expect(lastSlotStart(india("2026-10-13 21:00"), { hour: 3, weekday: 0 })).toEqual(india("2026-10-11 03:00"));
    expect(lastSlotStart(india("2026-10-11 02:00"), { hour: 3, weekday: 0 })).toEqual(india("2026-10-04 03:00"));
  });

  it("is missed past its period and two hours", () => {
    expect(missedAfterMs({ hour: 3 })).toBe(26 * 3_600_000);
    expect(missedAfterMs({ hour: 3, weekday: 0 })).toBe(7 * 24 * 3_600_000 + 2 * 3_600_000);
  });
});

describe("a job held to a slot", () => {
  let ran: string[];
  let failing: boolean;
  const nightly: CronJob = {
    name: "nightly",
    needs: "nothing",
    every: 60,
    at: 0,
    slot: { hour: 3 },
    run: ({ slot }) => {
      ran.push(slot?.date ?? "no slot");
      return failing ? Promise.reject(new Error("the copy broke")) : Promise.resolve();
    },
  };
  const runAt = (at: Date, jobs: readonly CronJob[] = [nightly], deps: TestDependencies = fakeDependencies()) =>
    runCronJobs(jobs, { env, deps: { ...deps, now: () => at }, config: LOCAL_CONFIG, log: createLogger() });

  beforeEach(async () => {
    await markDatabase();
    ran = [];
    failing = false;
  });

  it("runs once a slot, for the slot's date, catching up a first slot it never had", async () => {
    await runAt(india("2026-10-13 10:00"));
    await runAt(india("2026-10-13 11:00"));
    await runAt(india("2026-10-14 02:00"));
    await runAt(india("2026-10-14 03:00"));
    await runAt(india("2026-10-14 04:00"));
    expect(ran).toEqual(["2026-10-13", "2026-10-14"]);
  });

  it("tries again on the next run after it failed, and counts no success until it ran", async () => {
    failing = true;
    expect(await runAt(india("2026-10-13 03:00"))).toEqual([{ job: "nightly", ok: false }]);
    failing = false;
    expect(await runAt(india("2026-10-13 04:00"))).toEqual([{ job: "nightly", ok: true }]);
    expect(await runAt(india("2026-10-13 05:00"))).toEqual([]);
    expect(ran).toEqual(["2026-10-13", "2026-10-13"]);
  });

  it("is told as missed when it has not run well for a day and two hours, and closed when it next does", async () => {
    const missed = CRON_JOBS.filter((job) => job.name === "missed_jobs");
    const deps = fakeDependencies();
    await env.DB.prepare(
      `INSERT INTO cron_jobs (job, failed_runs, last_success_at, first_seen_at)
       VALUES ('analytics_nightly', 0, ?1, ?1), ('backup', 0, ?2, ?2)`,
    )
      .bind(india("2026-10-12 03:10").toISOString(), india("2026-10-11 03:10").toISOString())
      .run();
    await runAt(india("2026-10-13 05:30"), missed, deps);
    expect(deps.alerts).toEqual([
      expect.stringContaining(
        `The cron's analytics_nightly job has not run well since ${india("2026-10-12 03:10").toISOString()}`,
      ),
    ]);
  });
});
