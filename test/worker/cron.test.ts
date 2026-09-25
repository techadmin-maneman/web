import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../../src/log.ts";
import { CRON_JOBS, runCronJobs, type CronJob } from "../../src/scheduled/cron.ts";
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

describe("CRON_JOBS", () => {
  it("sweeps first and settles Books last, after the invoices it applies advances to", () => {
    expect(CRON_JOBS.map((job) => job.name)).toEqual([
      "sweeper",
      "fsm_reconcile",
      "deletion_alerts",
      "dispatch_utilisation",
      "referrals",
      "visit_reminders",
      "invoices",
      "asked_windows",
      "books_sync",
    ]);
  });
});
