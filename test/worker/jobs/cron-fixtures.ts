// What the cron tests share (cron*.test.ts): a minute, a job, and a recorder of what ran.

import { type CronJob } from "../../../src/scheduled/cron.ts";

export const MINUTE_MS = 60_000;

/** A job that runs every five minutes, in the first of them. */
export const job = (name: string, run: CronJob["run"], needs: CronJob["needs"] = "nothing"): CronJob => ({
  name,
  needs,
  every: 5,
  at: 0,
  run,
});

export function recorder() {
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
