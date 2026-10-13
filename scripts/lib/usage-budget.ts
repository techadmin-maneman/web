// Two budgets. R2's: what the try-on can store and ask of it at the ceilings in each environment's config, with the
// share set aside for clients' photographs and referral cards, priced a month at R2's rates past its free allowance
// (docs/decisions/0194-the-build-on-workers-paid.md). test/node/tooling/usage-budget.test.ts holds it to
// R2_MONTHLY_BUDGET_USD, so a ceiling may rise if what it costs is accepted. And the reads: what one request to a route, one console board or one cron run may
// read, which the soak and test/worker/jobs/cron-reads.test.ts hold them to, so work grows with what it handles and
// not with the history behind it.
//
// Staging and production share one Cloudflare account, and so one allowance.

import {
  POLL_DELAY_SECONDS,
  POLL_SLOWDOWN_AFTER_MS,
  POLL_SLOW_AFTER_MS,
  RENDER_GIVE_UP_MS,
} from "../../src/config/pipeline.ts";
import { MAX_COPY_BYTES, MAX_RESULT_BYTES, MAX_UPLOAD_BYTES, PHOTO_RETENTION_MS } from "../../src/config/tryon.ts";
import { PHOTO_SHARE_BYTES } from "../../src/policy/storage-share.ts";

/** R2's free allowance of Standard storage, per Cloudflare's pricing pages. */
export const R2_FREE_ALLOWANCE = {
  /** 10 GB-month, counted in decimal gigabytes, which is the smaller reading. */
  r2StorageBytes: 10 * 1e9,
  r2ClassAPerMonth: 1_000_000,
  r2ClassBPerMonth: 10_000_000,
} as const;

/** What R2 bills past the allowance, in US dollars: a GB-month stored, and a million of each class of operation. */
export const R2_RATES = { storageGbMonth: 0.015, classAMillion: 4.5, classBMillion: 0.36 } as const;

/** What R2 may cost a month at every ceiling: half the account's $10 budget alert (docs/decisions/0112-workers-paid.md). */
export const R2_MONTHLY_BUDGET_USD = 5;

/**
 * The photographs' and cards' share of the same allowance (docs/decisions/0039-phase-2-budget.md).
 * They have no ceiling in config, so their share is set aside here.
 */
export const PHOTO_ALLOWANCE = {
  /** Clients' photographs, which are never deleted, and referral cards: the storage meter's share. */
  r2StorageBytes: PHOTO_SHARE_BYTES,
  r2ClassAPerMonth: 100_000,
  r2ClassBPerMonth: 1_000_000,
} as const;

/**
 * Every job with nothing to do: measured at about 70 rows, and 100 in the evening, when the reminders look for
 * tomorrow's visits and the next services falling due, however long the tables grow. Every query on the cron's path
 * searches an index that holds only the rows still waiting (test/node/database/query-plans.test.ts), and
 * test/worker/jobs/cron-reads.test.ts measures every job against a history, and against twice that history. Taken as
 * 150, so a statement added to the cron is not failed for the one row it reads; and beside it, each job's own record,
 * its lease taken and its outcome noted, and the hour's look for a job missed: about four rows a job, whatever the
 * history (docs/decisions/0195-the-cron-a-job-at-a-time.md).
 */
export const cronRowsReadPerQuietRun = (jobs: number): number => 150 + 4 * jobs;
/**
 * The most statements one minute's run may send D1, its own record's included: a fifth of the 1,000 an invocation may
 * send (docs/decisions/0112-workers-paid.md), so a job that loops over a table fails here before it fails in a run.
 * test/worker/jobs/cron-reads.test.ts holds every minute of the hour to it, over a history.
 */
export const CRON_STATEMENTS_PER_RUN = 200;

/**
 * What one load of each of the console's two boards reads. Measured on staging on 2 October 2026 with 31 visits in the
 * board's week: a board load read 484 rows, about 66 and 13.5 for each visit, and a look at Tasks 364.
 * test/worker/jobs/cron-reads.test.ts holds one load of each, and one look at the version, to the figures below. A visit
 * worked through, whose card has everything on it (two answers on each kind of message, an invite, a credit, every step
 * of the technician's), reads 17.5.
 */
export const BOARD_ROWS_READ_FIXED = 70;
export const BOARD_ROWS_READ_PER_VISIT = 18;
export const BOARD_VERSION_ROWS_READ = 10;
export const TASKS_ROWS_READ_PER_LOOK = 400;
/**
 * The most rows a request to a route may read, on average while a release soaks, before it is rolled back. The
 * dispatch board's is a load with 158 visits in its week: raise it as the week grows. A route not named has
 * OTHER_ROUTE_ROWS_READ, several times what the busiest of them read on 2 October 2026.
 */
export const ROUTE_ROWS_READ: Readonly<Record<string, number>> = {
  "/api/dispatch": 2_914,
  "/api/tasks": TASKS_ROWS_READ_PER_LOOK,
};
export const OTHER_ROUTE_ROWS_READ = 300;

/** A visit's photographs: five before and five after, each re-encoded on the phone to about 250 KB. */
export const PHOTOS_PER_VISIT = 10;
export const PHOTO_BYTES = 250_000;
/** Each photograph's thumbnail, which the phone encodes to about 32 KB (docs/decisions/0093-the-storage-meter.md). */
export const THUMBNAIL_BYTES = 32_000;
/** Referral cards: one 1200×630 JPEG of at most 300 KB per referrer, for up to a thousand referrers. */
export const REFERRAL_CARDS_BYTES = 1_000 * 300_000;
/**
 * A client's kept try-on (docs/decisions/0084-a-clients-try-on-is-kept.md): the small copy of their photograph, for
 * good, and the look until their first fit is photographed, which for a client never fitted is for good as well.
 */
export const KEPT_TRY_ON_BYTES = MAX_COPY_BYTES + MAX_RESULT_BYTES;

/**
 * How many visits fit in the photographs' R2 share, after the referral cards. A client keeps one try-on, and every client
 * has booked a visit, so at worst each visit is a new client's and brings one kept try-on with its photographs.
 */
export function photoRunwayVisits(keptTryOnBytes: number = KEPT_TRY_ON_BYTES): number {
  const perVisit = PHOTOS_PER_VISIT * (PHOTO_BYTES + THUMBNAIL_BYTES) + keptTryOnBytes;
  return Math.floor((PHOTO_ALLOWANCE.r2StorageBytes - REFERRAL_CARDS_BYTES) / perVisit);
}
const DAYS_PER_MONTH = 31;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The sweeper runs every 5 minutes, so a photo can outlive its retention by one run. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export interface Ceilings {
  readonly renderDaily: number;
  readonly uploadDaily: number;
  readonly resultReadDaily: number;
  readonly resultRetentionDays: number;
}

/** The polls of a render followed to its give-up time, without the final one past it. */
export function pollsPerRender(): number {
  const earlyPolls = Math.ceil(POLL_SLOWDOWN_AFTER_MS / 1000 / POLL_DELAY_SECONDS.early);
  const latePolls = Math.ceil((POLL_SLOW_AFTER_MS - POLL_SLOWDOWN_AFTER_MS) / 1000 / POLL_DELAY_SECONDS.late);
  const slowPolls = Math.ceil((RENDER_GIVE_UP_MS - POLL_SLOW_AFTER_MS) / 1000 / POLL_DELAY_SECONDS.slow);
  return earlyPolls + latePolls + slowPolls;
}

export interface Usage {
  readonly r2StorageBytes: number;
  readonly r2ClassAPerMonth: number;
  readonly r2ClassBPerMonth: number;
}

export function worstCaseUsage(environments: readonly Ceilings[]): Usage {
  let storage = 0;
  let classA = 0;
  let classB = 0;
  for (const ceilings of environments) {
    // Stored at any moment: each day's results for the retention period, each day's photos for about an hour, and
    // each photo's small copy for the hour and then as long as its look (ADR 0084). A client's kept try-on is held
    // for good, so it is paid from the photographs' share (photoRunwayVisits).
    const hour = PHOTO_RETENTION_MS + SWEEP_INTERVAL_MS;
    storage += ceilings.renderDaily * ceilings.resultRetentionDays * MAX_RESULT_BYTES;
    storage += (ceilings.uploadDaily * MAX_UPLOAD_BYTES * hour) / DAY_MS;
    storage += (ceilings.uploadDaily * MAX_COPY_BYTES * (ceilings.resultRetentionDays * DAY_MS + hour)) / DAY_MS;
    // Writes: one per photo, one per copy, one per result, and one per look kept by moving it. Reads: the photo once
    // per render, each result read, and each look kept.
    classA += DAYS_PER_MONTH * (2 * ceilings.uploadDaily + 2 * ceilings.renderDaily);
    classB += DAYS_PER_MONTH * (2 * ceilings.renderDaily + ceilings.resultReadDaily);
  }
  return {
    r2StorageBytes: storage,
    r2ClassAPerMonth: classA,
    r2ClassBPerMonth: classB,
  };
}

/** What a month of `usage` costs, in US dollars, with the photographs' share beside it: nothing within the allowance. */
export function monthlyCostUsd(usage: Usage, reserved: Usage = PHOTO_ALLOWANCE): number {
  const past = (used: number, set: number, allowance: number) => Math.max(0, used + set - allowance);
  const free = R2_FREE_ALLOWANCE;
  return (
    (past(usage.r2StorageBytes, reserved.r2StorageBytes, free.r2StorageBytes) / 1e9) * R2_RATES.storageGbMonth +
    (past(usage.r2ClassAPerMonth, reserved.r2ClassAPerMonth, free.r2ClassAPerMonth) / 1e6) * R2_RATES.classAMillion +
    (past(usage.r2ClassBPerMonth, reserved.r2ClassBPerMonth, free.r2ClassBPerMonth) / 1e6) * R2_RATES.classBMillion
  );
}

/** A line saying what the month would cost, where it is past the budget; empty within it. */
export function overBudget(usage: Usage, reserved: Usage = PHOTO_ALLOWANCE): string[] {
  const cost = monthlyCostUsd(usage, reserved);
  return cost <= R2_MONTHLY_BUDGET_USD
    ? []
    : [
        `R2 would cost $${cost.toFixed(2)} a month at the ceilings, past the budget of $${String(R2_MONTHLY_BUDGET_USD)}`,
      ];
}
