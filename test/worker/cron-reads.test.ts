// What one cron run reads from D1. It runs every five minutes in each
// environment, and past 5 million rows read a day D1 refuses every query until
// midnight UTC (ADR 0009). So a run must read about what it has to do, not the
// history its tables have gathered: every try-on job, visit, payment and
// person ever made stays in D1. This seeds a finished history, runs every job,
// doubles the history, and runs them again.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CRON_ROWS_READ_PER_QUIET_RUN } from "../../scripts/lib/free-tier-budget.ts";
import { createLogger } from "../../src/log.ts";
import { CRON_JOBS, runCronJobs } from "../../src/scheduled/cron.ts";
import { LOCAL_CONFIG, NOW, captureLogs, countRowsRead, fakeDependencies, fakeQueue, markDatabase } from "./helpers.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Two months ago, when all of the history happened, and an hour later. */
const AGO = new Date(NOW.getTime() - 60 * DAY_MS).toISOString();
const AGO_PLUS_HOUR = new Date(NOW.getTime() - 60 * DAY_MS + 60 * 60 * 1000).toISOString();
const IN_TWO_MONTHS = new Date(NOW.getTime() + 60 * DAY_MS).toISOString();
/** 6:30 pm in India, when the evening's reminders go (src/domain/visit-messages.ts, REMINDERS_FROM). */
const EVENING = new Date(NOW.getTime() + 6.5 * 60 * 60 * 1000);
/** A visit 25 days ago, whose next service falls due within the reminder's week (ADR 0086), and an hour later. */
const DUE_SOON = new Date(NOW.getTime() - 25 * DAY_MS).toISOString();
const DUE_SOON_PLUS_HOUR = new Date(NOW.getTime() - 25 * DAY_MS + 60 * 60 * 1000).toISOString();
/** Every tenth person was erased, everywhere, long ago. */
const IF_ERASED = `CASE WHEN i % 10 = 0 THEN '${AGO}' END`;

/**
 * One row per person numbered i, all of it finished: leads in the CRM, messages
 * sent, try-ons expired with their photos deleted and kept for the client
 * (ADR 0084) with its look let go, visits done and photographed, invoiced and
 * reconciled, payments recorded and applied in Books, refunds recorded, credits
 * expired, and a referral granted from the person numbered before.
 */
const HISTORY = [
  `INSERT INTO people (id, created_at, mobile_e164, name, contactable, fsm_contact_id, erased_at, crm_erased_at,
     fsm_erased_at, files_erased_at)
   SELECT 'p-' || i, '${AGO}', '+9170' || printf('%08d', i), 'Client ' || i, 1, 'c-' || i, ${IF_ERASED},
     ${IF_ERASED}, ${IF_ERASED}, ${IF_ERASED} FROM n`,
  `INSERT INTO leads (id, person_id, created_at, source, city, loss_extent, sync_state, synced_at, request_id,
     fsm_request_id)
   SELECT 'l-' || i, 'p-' || i, '${AGO}', 'form', 'Gurgaon', 'crown', 'synced', '${AGO}', 'r', 'req-' || i FROM n`,
  `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at, sent_at)
   SELECT 'm-' || i, '${AGO}', 'p-' || i, 'visit_reminder', 'appointment', 'a-' || i, 'sent', '${AGO}', '${AGO}'
   FROM n`,
  `INSERT INTO tryon_jobs (id, created_at, upload_key, uploaded_at, upload_deleted_at, state, expires_at, person_id,
     photo_consent_version, photo_consent_at, ip_hash, request_id, copy_key, kept_at)
   SELECT 'j-' || i, '${AGO}', 'uploads/j-' || i, '${AGO}', '${AGO}', 'expired', '${AGO}', 'p-' || i, 'photo-v2',
     '${AGO}', 'h', 'r', 'tryons/j-' || i || '/before.jpg', '${AGO}' FROM n`,
  `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, window_start, window_end, status,
     fsm_status, fsm_modified_at, synced_at, reconciled_at, invoice_issued_at, fsm_invoice_id, asked_checked_at)
   SELECT 'a-' || i, 'fsm-' || i, 'wo-' || i, 'p-' || i, 'service', '${AGO}', '${AGO_PLUS_HOUR}', 'completed',
     'Completed', '${AGO}', '${AGO}', '${AGO}', '${AGO}', 'inv-' || i, '${AGO}' FROM n`,
  `INSERT INTO visits (id, appointment_id, outcome, updated_at) SELECT 'v-' || i, 'a-' || i, 'done', '${AGO}' FROM n`,
  `INSERT INTO photo_sets (id, appointment_id, phase, created_at) SELECT 'set-' || i, 'a-' || i, 'before', '${AGO}' FROM n`,
  `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, taken_at, created_at)
   SELECT 'ph-' || i, 'set-' || i, 'front', 'visits/a-' || i || '/before-front.jpg', 'image/jpeg', 250000, '${AGO}',
     '${AGO}' FROM n`,
  `INSERT INTO payments (id, person_id, appointment_id, razorpay_order_id, razorpay_payment_id, amount, currency,
     status, captured_at, created_at, updated_at, books_payment_id, books_applied_at)
   SELECT 'pay-' || i, 'p-' || i, 'a-' || i, 'order_' || i, 'pay_' || i, 200000, 'INR', 'captured', '${AGO}',
     '${AGO}', '${AGO}', 'bp-' || i, '${AGO}' FROM n`,
  `INSERT INTO refunds (id, payment_id, razorpay_refund_id, amount, status, created_at, processed_at, updated_at,
     books_refund_id)
   SELECT 'ref-' || i, 'pay-' || i, 'rfnd_' || i, 1000, 'processed', '${AGO}', '${AGO}', '${AGO}', 'br-' || i FROM n`,
  `INSERT INTO referral_codes (code, person_id, created_at, updated_at) SELECT 'CODE' || i, 'p-' || i, '${AGO}', '${AGO}'
   FROM n`,
  `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, first_fit_appointment_id,
     grant_state, created_at, updated_at)
   SELECT 'ra-' || i, 'CODE' || (i - 1), 'p-' || i, '${AGO}', 'consultation', 'a-' || i, 'granted', '${AGO}', '${AGO}'
   FROM n WHERE i > 1`,
  `INSERT INTO credit_ledger (id, person_id, kind, visits, source_kind, source_id, expires_at, created_at)
   SELECT 'g-' || i, 'p-' || i, 'grant', 3, 'referral', 'ra-' || i, '${AGO}', '${AGO}' FROM n`,
  `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
   SELECT 'e-' || i, 'p-' || i, 'expire', -3, 'g-' || i, 'referral', 'ra-' || i, '${AGO}' FROM n`,
  `INSERT INTO sessions (id, subject_kind, subject_id, created_at, last_seen_at, expires_at)
   SELECT 's-' || i, 'client', 'p-' || i, '${AGO}', '${AGO}', '${IN_TWO_MONTHS}' FROM n`,
  // The dispatch board's utilisation, one day at a time.
  `INSERT INTO events (id, created_at, name, subject_id, payload_json)
   SELECT 'ev-' || i, '${AGO}', 'dispatch_utilisation', date('${AGO}', '-' || i || ' days'), '{}' FROM n`,
];

/** The history of the people numbered `from` to `to`. */
async function history(from: number, to: number): Promise<void> {
  await env.DB.batch(
    HISTORY.map((sql) =>
      env.DB.prepare(`WITH RECURSIVE n(i) AS (SELECT ?1 UNION ALL SELECT i + 1 FROM n WHERE i < ?2) ${sql}`).bind(
        from,
        to,
      ),
    ),
  );
}

async function rowsReadByOneRun(now = NOW): Promise<number> {
  const rowsRead = countRowsRead();
  const outcomes = await runCronJobs(CRON_JOBS, {
    env: { ...env, CRM_QUEUE: fakeQueue(), RENDER_QUEUE: fakeQueue(), MESSAGE_QUEUE: fakeQueue() },
    deps: fakeDependencies({ now: () => now }),
    config: LOCAL_CONFIG,
    log: createLogger(),
  });
  const read = rowsRead();
  vi.restoreAllMocks();
  captureLogs();
  expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([]);
  return read;
}

beforeEach(async () => {
  await markDatabase();
  captureLogs();
});

describe("one cron run", () => {
  it("reads no more when the tables hold twice the history", async () => {
    await history(1, 400);
    await rowsReadByOneRun(); // the day's once-only work: the reconciliation's pass, the utilisation
    const before = await rowsReadByOneRun();

    await history(401, 800);
    const after = await rowsReadByOneRun();

    expect({ before, after }).toEqual({ before, after: before });
    expect(after).toBeLessThanOrEqual(CRON_ROWS_READ_PER_QUIET_RUN);
  });

  // The next service's reminders run from the evening's reminder hour and read the week of last visits they cover,
  // through migration 0048's index, never the visits before it (docs/decisions/0086-the-next-visit-is-offered.md).
  it("reads no more in the evening, when the next service's reminders run, as the history doubles", async () => {
    await history(1, 400);
    // Three clients' last visits moved into the week whose next service is due (none of the first ten is erased).
    await env.DB.prepare(
      "UPDATE appointments SET window_start = ?1, window_end = ?2 WHERE rowid IN (SELECT rowid FROM appointments ORDER BY rowid LIMIT 3)",
    )
      .bind(DUE_SOON, DUE_SOON_PLUS_HOUR)
      .run();
    await rowsReadByOneRun(EVENING); // the day's once-only work, and the three reminders written
    const before = await rowsReadByOneRun(EVENING);

    await history(401, 800);
    const after = await rowsReadByOneRun(EVENING);

    expect({ before, after }).toEqual({ before, after: before });
    expect(after).toBeLessThanOrEqual(CRON_ROWS_READ_PER_QUIET_RUN);
    const reminders = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM outbound_messages WHERE kind = 'next_service_reminder'",
    ).first<{ n: number }>();
    expect(reminders?.n).toBe(3);
  });
});
