// Two budgets. R2's: the worst case the try-on can store and ask of it, from the ceilings in each environment's config,
// plus the share set aside for Phase 2. R2 bills past its free allowance (docs/decisions/0009, 0093), so
// test/node/tooling/free-tier-budget.test.ts holds them under 80% of it, and no ceiling can be raised into Phase 2's
// share without the build failing. And the reads: what one request to a route, one console board or one cron run may
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
import { PHASE_2_SHARE_BYTES } from "../../src/policy/storage-share.ts";

/** R2's free allowance, per Cloudflare's pricing pages (read 21 September 2026). */
export const FREE_TIER = {
  /** 10 GB-month, counted in decimal gigabytes, which is the smaller reading. */
  r2StorageBytes: 10 * 1e9,
  r2ClassAPerMonth: 1_000_000,
  r2ClassBPerMonth: 10_000_000,
} as const;

export const HEADROOM = 0.8;

/**
 * Phase 2's share of the same allowance (docs/decisions/0039-phase-2-budget.md).
 * Nothing in Phase 2 has a ceiling in config yet, so its share is set aside here.
 */
export const PHASE_2_ALLOWANCE = {
  /** Clients' photographs, which are never deleted, and referral cards: the storage meter's share. */
  r2StorageBytes: PHASE_2_SHARE_BYTES,
  r2ClassAPerMonth: 100_000,
  r2ClassBPerMonth: 1_000_000,
} as const;

/**
 * Every job with nothing to do: measured at about 70 rows, and 100 in the evening, when the reminders look for
 * tomorrow's visits and the next services falling due, however long the tables grow. Every query on the cron's path
 * searches an index that holds only the rows still waiting (test/node/database/query-plans.test.ts), and
 * test/worker/jobs/cron-reads.test.ts measures every job against a history, and against twice that history. Taken as
 * 150, so a statement added to the cron is not failed for the one row it reads.
 */
export const CRON_ROWS_READ_PER_QUIET_RUN = 150;
/**
 * The most statements one minute's run may send D1, its own record's included. The free plan stops a run past 10 ms of
 * CPU, and on staging an invocation cost about 1 ms and 0.35 ms more for each statement (docs/decisions/0009, "the
 * cron's CPU time"). 16 come to about 6.6 ms, leaving a third of the 10 for code a run meets for the first time.
 * test/worker/jobs/cron-reads.test.ts holds every minute of the hour to it, over a history.
 */
export const CRON_STATEMENTS_PER_RUN = 16;

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
 * How many visits fit in Phase 2's R2 share, after the referral cards. A client keeps one try-on, and every client
 * has booked a visit, so at worst each visit is a new client's and brings one kept try-on with its photographs.
 */
export function photoRunwayVisits(keptTryOnBytes: number = KEPT_TRY_ON_BYTES): number {
  const perVisit = PHOTOS_PER_VISIT * (PHOTO_BYTES + THUMBNAIL_BYTES) + keptTryOnBytes;
  return Math.floor((PHASE_2_ALLOWANCE.r2StorageBytes - REFERRAL_CARDS_BYTES) / perVisit);
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
    // for good, so it is paid from Phase 2's share (photoRunwayVisits).
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

/**
 * Each use over 80% of its allowance once Phase 2's share is added, as a
 * readable line; empty when all fit.
 */
export function overBudget(usage: Usage, reserved: Usage = PHASE_2_ALLOWANCE): string[] {
  const lines: string[] = [];
  const check = (name: string, used: number, set: number, allowance: number): void => {
    if (used + set > allowance * HEADROOM) {
      lines.push(
        `${name}: ${String(Math.round(used))}, with Phase 2's ${String(set)}, is over 80% of the free ${String(allowance)}`,
      );
    }
  };
  check("R2 storage (bytes)", usage.r2StorageBytes, reserved.r2StorageBytes, FREE_TIER.r2StorageBytes);
  check("R2 Class A operations a month", usage.r2ClassAPerMonth, reserved.r2ClassAPerMonth, FREE_TIER.r2ClassAPerMonth);
  check("R2 Class B operations a month", usage.r2ClassBPerMonth, reserved.r2ClassBPerMonth, FREE_TIER.r2ClassBPerMonth);
  return lines;
}
