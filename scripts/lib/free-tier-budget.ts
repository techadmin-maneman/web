// The worst case the try-on can cost Cloudflare, from the ceilings in each
// environment's config, plus the share set aside for Phase 2, and what the
// cron reads from D1. test/node/free-tier-budget.test.ts holds them under 80%
// of the free allowances, so no ceiling can be raised past the free tier, or
// into Phase 2's share, without the build failing
// (docs/decisions/0009-stay-inside-cloudflare-free-tier.md, 0039-phase-2-budget.md).
//
// Staging and production share one Cloudflare account, and so one allowance.

import {
  DOWNLOAD_QUEUE_RETRIES,
  MAX_SEND_ATTEMPTS,
  POLL_DELAY_SECONDS,
  POLL_SLOWDOWN_AFTER_MS,
  POLL_SLOW_AFTER_MS,
  RENDER_GIVE_UP_MS,
} from "../../src/config/pipeline.ts";
import { MAX_COPY_BYTES, MAX_RESULT_BYTES, MAX_UPLOAD_BYTES, PHOTO_RETENTION_MS } from "../../src/config/tryon.ts";
import { PHASE_2_SHARE_BYTES } from "../../src/policy/storage-share.ts";

/** The Workers Free plan, per Cloudflare's pricing pages (read 21 September 2026). */
export const FREE_TIER = {
  queueOperationsPerDay: 10_000,
  /** Past this the requests fail, so it is also the most work one day can ask of anything else. */
  workersRequestsPerDay: 100_000,
  /** Past this D1 refuses every query until midnight UTC (docs/decisions/0009). */
  d1RowsReadPerDay: 5_000_000,
  /** 10 GB-month, counted in decimal gigabytes, which is the smaller reading. */
  r2StorageBytes: 10 * 1e9,
  r2ClassAPerMonth: 1_000_000,
  r2ClassBPerMonth: 10_000_000,
} as const;

export const HEADROOM = 0.8;

/**
 * Phase 2's share of the same allowances (docs/decisions/0039-phase-2-budget.md).
 * Nothing in Phase 2 has a ceiling in config yet, so its share is set aside here.
 */
export const PHASE_2_ALLOWANCE = {
  /** FSM webhook hints read back from the queue, and the Phase 2 messages. */
  queueOperationsPerDay: 2_000,
  /** Clients' photographs, which are never deleted, and referral cards: the storage meter's share. */
  r2StorageBytes: PHASE_2_SHARE_BYTES,
  r2ClassAPerMonth: 100_000,
  r2ClassBPerMonth: 1_000_000,
} as const;

/**
 * The five-minute cron's D1 reads. Every query on its path searches an index
 * that holds only the rows still waiting (test/node/query-plans.test.ts), so a
 * run reads about the rows it handles and none of the history behind them
 * (test/worker/cron-reads.test.ts measures a run against a history, and against
 * twice that history).
 */
export const CRON_RUNS_PER_DAY = 24 * 12;
/**
 * A run with nothing to do, measured: about 70 rows, and 100 in the evening, when the reminders look for tomorrow's
 * visits and the next services falling due; however long the tables grow.
 */
export const CRON_ROWS_READ_PER_QUIET_RUN = 100;
/**
 * A run at its busiest, every lookup coming back full: the sweep's eight
 * lookups of 100 and what it expires and deletes (about 1,600); the
 * reconciliation's page of 50, and on the hour the photographs of three days'
 * visits (about 1,700); erased people's files, 5 at a time (about 150); and
 * the referral, reminder, next-service reminder, invoice, asked-window and
 * Books passes of 5 to 20 each, with their joins (about 700).
 */
export const CRON_ROWS_READ_PER_BUSY_RUN = 5_000;
/** The cron's share of the daily reads. The rest of the 80% is for requests. */
export const CRON_READ_SHARE = 0.4;

/** Production's cron as busy as it can be on every run, and staging's at rest. */
export function cronRowsReadPerDay(perBusyRun: number = CRON_ROWS_READ_PER_BUSY_RUN): number {
  return CRON_RUNS_PER_DAY * (perBusyRun + CRON_ROWS_READ_PER_QUIET_RUN);
}

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

/**
 * Queue operations the lead path may use, which no ceiling bounds: each lead
 * is a write, a read and a delete, sometimes a retry. Turnstile and the
 * per-number and per-address limits hold it down; 2,000 is about 500 leads a day.
 */
export const LEAD_OPERATIONS_RESERVE = 2_000;
/** Messages the sweeper re-sends when something has failed. */
export const SWEEPER_OPERATIONS_RESERVE = 500;

export interface Ceilings {
  readonly renderDaily: number;
  readonly uploadDaily: number;
  readonly resultReadDaily: number;
  readonly resultRetentionDays: number;
}

/**
 * The most queue operations one render can use. A message costs a write, a
 * read and a delete; each retry, and so each poll, is one more read.
 */
export function queueOperationsPerRender(): number {
  const earlyPolls = Math.ceil(POLL_SLOWDOWN_AFTER_MS / 1000 / POLL_DELAY_SECONDS.early);
  const latePolls = Math.ceil((POLL_SLOW_AFTER_MS - POLL_SLOWDOWN_AFTER_MS) / 1000 / POLL_DELAY_SECONDS.late);
  const slowPolls = Math.ceil((RENDER_GIVE_UP_MS - POLL_SLOW_AFTER_MS) / 1000 / POLL_DELAY_SECONDS.slow);
  const render = 3 + earlyPolls + latePolls + slowPolls + 1 + DOWNLOAD_QUEUE_RETRIES; // + the final poll past the give-up
  const message = 3 + (MAX_SEND_ATTEMPTS - 1);
  const crmSync = 3 + 1; // one quick retry
  return render + message + crmSync;
}

export interface Usage {
  readonly queueOperationsPerDay: number;
  readonly r2StorageBytes: number;
  readonly r2ClassAPerMonth: number;
  readonly r2ClassBPerMonth: number;
}

export function worstCaseUsage(environments: readonly Ceilings[]): Usage {
  let renders = 0;
  let storage = 0;
  let classA = 0;
  let classB = 0;
  for (const ceilings of environments) {
    renders += ceilings.renderDaily;
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
    queueOperationsPerDay: renders * queueOperationsPerRender() + LEAD_OPERATIONS_RESERVE + SWEEPER_OPERATIONS_RESERVE,
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
  check(
    "Queues operations a day",
    usage.queueOperationsPerDay,
    reserved.queueOperationsPerDay,
    FREE_TIER.queueOperationsPerDay,
  );
  check("R2 storage (bytes)", usage.r2StorageBytes, reserved.r2StorageBytes, FREE_TIER.r2StorageBytes);
  check("R2 Class A operations a month", usage.r2ClassAPerMonth, reserved.r2ClassAPerMonth, FREE_TIER.r2ClassAPerMonth);
  check("R2 Class B operations a month", usage.r2ClassBPerMonth, reserved.r2ClassBPerMonth, FREE_TIER.r2ClassBPerMonth);
  return lines;
}
