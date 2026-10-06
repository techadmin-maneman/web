// What the cron reads from D1. Each job runs as often as every five minutes in
// each environment, and past 5 million rows read a day D1 refuses every query
// until midnight UTC (ADR 0009). So a job must read about what it has to do, not
// the history its tables have gathered: every try-on job, visit, payment and
// person ever made stays in D1. This seeds a finished history, runs every job,
// doubles the history, and runs them again. Each minute's run is held to a
// number of statements, which is what its CPU time goes on. The console's Tasks
// board and Stock page, read all day, are held to the same below.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOARD_ROWS_READ_FIXED,
  BOARD_ROWS_READ_PER_VISIT,
  BOARD_VERSION_ROWS_READ,
  CRON_ROWS_READ_PER_QUIET_RUN,
  CRON_STATEMENTS_PER_RUN,
} from "../../../scripts/lib/free-tier-budget.ts";
import type { StaticConfig } from "../../../src/guard.ts";
import { meterDatabase } from "../../../src/lib/d1-meter.ts";
import { createLogger } from "../../../src/log.ts";
import { CRON_JOBS, runCronJobs } from "../../../src/scheduled/cron.ts";
import { EVERY_MINUTE, jobsDue } from "../../../src/scheduled/schedule.ts";
import {
  LOCAL_CONFIG,
  NOW,
  appFor,
  captureLogs,
  countRowsRead,
  fakeDependencies,
  fakeQueue,
  markDatabase,
  request,
} from "../helpers.ts";
import { DAY_MS, AGO, IN_TWO_MONTHS, over, rowsReadBy } from "./cron-reads-fixtures.ts";

const AGO_PLUS_HOUR = new Date(NOW.getTime() - 60 * DAY_MS + 60 * 60 * 1000).toISOString();

/** NOW's day in India, as a counter's window names it. */
const TODAY = "2026-09-21";

/** 6:30 pm in India, when the evening's reminders go (DAY_BEFORE_REMINDER_HOUR, src/policy/job-visibility.ts). */
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
 * expired, and a referral granted from the person numbered before. Each visit
 * was booked in the app, but every tenth, which FSM refused five times running
 * and ops refunded (docs/decisions/0095-a-booking-fsm-refuses-is-held.md).
 * test/node/database/query-plans.test.ts fails while a growing table the cron's
 * statements name has no row here.
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
  `INSERT OR IGNORE INTO technicians (id, fsm_id, name, initials, active, updated_at)
   SELECT 't-history', 'resource-history', 'A Technician', 'AT', 1, '${AGO}' FROM n LIMIT 1`,
  `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount, amount_ex_gst,
     gst_percent, state, appointment_id, expires_at, created_at, updated_at, confirmed_at, queued_at, fsm_held_at,
     fsm_refusal)
   SELECT 'h-' || i, 'p-' || i, 'service', date('${AGO}'), 'morning', 't-history', 0, 200000, 200000, 0,
     iif(i % 10 = 0, 'released', 'booked'), iif(i % 10 = 0, NULL, 'a-' || i), '${AGO}', '${AGO}', '${AGO}',
     '${AGO}', '${AGO}', iif(i % 10 = 0, '${AGO}', NULL), iif(i % 10 = 0, 'Zoho 400 INVALID_DATA', NULL) FROM n`,
  // The dispatch board's utilisation, one day at a time.
  `INSERT INTO events (id, created_at, name, subject_id, payload_json)
   SELECT 'ev-' || i, '${AGO}', 'dispatch_utilisation', date('${AGO}', '-' || i || ' days'), '{}' FROM n`,
  // The visit's record: the address, the check-in, a no-show case ruled on and disputed, the technician's steps
  // written to FSM, the hair profile, a move told to the client, a change of time, a link paid and a piece fitted.
  `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
   SELECT 'ad-' || i, 'p-' || i, '${AGO}', 'House ' || i, 'Sector 49', 'Gurgaon', '122018' FROM n`,
  `INSERT INTO checkins (id, appointment_id, technician_id, address_id, at, radius_m, passed, created_at)
   SELECT 'ci-' || i, 'a-' || i, 't-history', 'ad-' || i, '${AGO}', 150, 1, '${AGO}' FROM n`,
  `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, closed_at, decision,
     decided_by, decided_at, created_at, charge, dispute_until)
   SELECT 'ns-' || i, 'ci-' || i, 'a-' || i, '${AGO}', '${AGO}', '${AGO}', 'waived', 'ops@localhost', '${AGO}',
     '${AGO}', 'nothing', '${AGO}' FROM n`,
  `INSERT INTO no_show_disputes (id, case_id, person_id, created_at, ruling, ruled_by, ruled_at)
   SELECT 'nd-' || i, 'ns-' || i, 'p-' || i, '${AGO}', 'upheld', 'ops@localhost', '${AGO}' FROM n`,
  `INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at,
     fsm_write_state, updated_at)
   SELECT 'je-' || i, 'a-' || i, 'event-' || i, 't-history', 'outcome', '{}', '${AGO}', '${AGO}', 'written', '${AGO}'
   FROM n`,
  `INSERT INTO hair_profiles (id, person_id, appointment_id, event_id, technician_id, created_at)
   SELECT 'hp-' || i, 'p-' || i, 'a-' || i, 'event-' || i, 't-history', '${AGO}' FROM n`,
  `INSERT INTO dispatch_moves (id, appointment_id, was_start, now_start, reason, actor, fsm_write_state, told_at,
     created_at, updated_at)
   SELECT 'mv-' || i, 'a-' || i, '${AGO}', '${AGO}', 'client_asked', 'ops@localhost', 'written', '${AGO}', '${AGO}',
     '${AGO}' FROM n`,
  `INSERT INTO slot_claims (technician_id, date, claim, hold_id)
   SELECT 't-history', date('${AGO}'), 'claim-' || i, 'h-' || i FROM n WHERE i % 10 <> 0`,
  `INSERT INTO visit_changes (id, appointment_id, person_id, kind, notice, was_start, now_start, created_at)
   SELECT 'vc-' || i, 'a-' || i, 'p-' || i, 'moved', 'free', '${AGO}', '${AGO}', '${AGO}' FROM n`,
  `INSERT INTO payment_links (id, appointment_id, tier, amount, amount_ex_gst, gst_percent, razorpay_link_id,
     short_url, sent_at, razorpay_payment_id, paid_at, created_at, updated_at)
   SELECT 'pl-' || i, 'a-' || i, 'standard', 200000, 200000, 0, 'plink_' || i, 'https://rzp.io/l/' || i, '${AGO}',
     'pay_link_' || i, '${AGO}', '${AGO}', '${AGO}' FROM n`,
  `INSERT INTO pieces (id, fsm_id, person_id, piece_code, fitted_at, appointment_id, synced_at)
   SELECT 'pc-' || i, 'fsm-pc-' || i, 'p-' || i, 'MM-' || i, '${AGO}', 'a-' || i, '${AGO}' FROM n`,
  // A code each client was given and used on the visit.
  `INSERT INTO discount_codes (id, code, kind, value, covers_first_fit, covers_service, covers_replacement, expires_on,
     once_per_client, created_by, created_at)
   SELECT 'dc-' || i, 'SAVE' || i, 'amount', 10000, 0, 1, 0, date('${AGO}'), 1, 'ops@localhost', '${AGO}' FROM n`,
  `INSERT INTO discount_code_uses (id, code_id, person_id, appointment_id, amount_off, given_by, given_by_id, created_at)
   SELECT 'du-' || i, 'dc-' || i, 'p-' || i, 'a-' || i, 10000, 'client', 'p-' || i, '${AGO}' FROM n`,
  // What each client agreed to, asked for and was answered on, all of it settled.
  `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
   SELECT 'co-' || i, 'p-' || i, 'whatsapp_visits', 'v1', 1, '${AGO}' FROM n`,
  `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, created_at)
   SELECT 'cr-' || i, 'p-' || i, '122018', date('${AGO}'), 'morning', '${AGO}' FROM n`,
  `UPDATE consultation_requests SET booked = 1 WHERE id IN (SELECT 'cr-' || i FROM n)`,
  `INSERT INTO first_fit_requests (id, person_id, preferred_window, created_at)
   SELECT 'ff-' || i, 'p-' || i, 'morning', '${AGO}' FROM n`,
  `INSERT INTO grievances (id, person_id, text, state, response, resolved_by, resolved_at, created_at)
   SELECT 'gr-' || i, 'p-' || i, 'Late', 'resolved', 'Sorry', 'ops@localhost', '${AGO}', '${AGO}' FROM n`,
  `INSERT INTO deletion_requests (id, person_id, created_at, state, decided_at, decided_by)
   SELECT 'dr-' || i, 'p-' || i, '${AGO}', iif(i % 10 = 0, 'done', 'rejected'), '${AGO}', 'ops@localhost' FROM n`,
  `INSERT INTO number_change_requests (id, person_id, created_at, new_mobile_e164, state)
   SELECT 'nc-' || i, 'p-' || i, '${AGO}', '+9179' || printf('%08d', i), 'withdrawn' FROM n`,
  `INSERT INTO waitlist_entries (id, pincode, person_id, contact_consent_at, created_at)
   SELECT 'wl-' || i, '560001', 'p-' || i, '${AGO}', '${AGO}' FROM n`,
  `INSERT INTO task_closures (id, task_group, subject_id, reason, closed_by, closed_at)
   SELECT 'tc-' || i, 'at_risk_client', 'p-' || i, 'Moved away', 'ops@localhost', '${AGO}' FROM n`,
  `INSERT INTO alerts (id, key, message, count, first_seen_at, last_seen_at, resolved_at)
   SELECT 'al-' || i, 'history:' || i, 'Dealt with', 1, '${AGO}', '${AGO}', '${AGO}' FROM n`,
  `INSERT INTO audit_log (at, surface, actor_kind, actor, action, subject_kind, subject_id, request_id, detail)
   SELECT '${AGO}', 'ops', 'staff', 'ops@localhost', 'client.view', 'person', 'p-' || i, 'r-' || i, '{}' FROM n`,
  `INSERT INTO stored_objects (key, bytes) SELECT 'visits/a-' || i || '/before-front.jpg', 250000 FROM n`,
  // Every kit's stock of one consumable, which the hourly look at low stock reads only for a place with an alert open.
  `INSERT OR IGNORE INTO consumables (code, name, unit, unit_cost, reorder_kit, created_at, updated_at)
   VALUES ('history_tape', 'History tape', 'strip', 100, 5, '${AGO}', '${AGO}')`,
  `INSERT INTO stock_balances (consumable_code, place, quantity) SELECT 'history_tape', 't-' || i, 10 FROM n`,
  // What the sweeper deletes once it has outlived its use, still in use: today's counts, the day's keys, a login code
  // and a site's number code proved, and a try-on session still open.
  `INSERT INTO counters (scope, key, window_start, count) SELECT 'login_code', 'k-' || i, '${TODAY}', 1 FROM n`,
  `INSERT INTO idempotency (key, route, request_hash, created_at)
   SELECT 'key-' || i, 'POST /api/book/hold', 'hash', '${NOW.toISOString()}' FROM n`,
  `INSERT INTO otp_challenges (id, created_at, person_id, purpose, channel, last_sent_at, expires_at, verified_at)
   SELECT 'otp-' || i, '${AGO}', 'p-' || i, 'login', 'whatsapp', '${AGO}', '${IN_TWO_MONTHS}', '${AGO}' FROM n`,
  `INSERT INTO number_codes (id, created_at, mobile_hash, code_hash, expires_at, verified_at)
   SELECT 'nco-' || i, '${AGO}', 'mobile-hash-' || i, 'code-hash-' || i, '${IN_TWO_MONTHS}', '${AGO}' FROM n`,
  `INSERT INTO tryon_sessions (id, person_id, created_at, expires_at)
   SELECT 'ts-' || i, 'p-' || i, '${AGO}', '${IN_TWO_MONTHS}' FROM n`,
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

// A job that loops over a table sends D1 a statement a row, which a history long enough shows.
describe("each minute's run", () => {
  async function statementsAt(minute: number, config: StaticConfig): Promise<number> {
    const scheduled = Date.UTC(2026, 8, 21, 6, minute);
    const meter = meterDatabase(env.DB);
    await runCronJobs(jobsDue(CRON_JOBS, EVERY_MINUTE, scheduled), {
      env: { ...env, DB: meter.db, CRM_QUEUE: fakeQueue(), RENDER_QUEUE: fakeQueue(), MESSAGE_QUEUE: fakeQueue() },
      deps: fakeDependencies({ now: () => new Date(scheduled) }),
      config,
      log: createLogger(),
      meter,
    });
    return meter.usage().queries;
  }

  it("sends D1 no more than its budget of statements in any minute of the hour, over a history", async () => {
    await history(1, 400);
    await rowsReadByOneRun(); // the day's once-only work: the reconciliation's pass, the utilisation
    const overBudget: string[] = [];
    for (let minute = 0; minute < 60; minute += 1) {
      const statements = await statementsAt(minute, LOCAL_CONFIG);
      if (statements > CRON_STATEMENTS_PER_RUN) overBudget.push(`minute ${String(minute)}: ${String(statements)}`);
    }
    expect(overBudget).toEqual([]);
  });
});

// The open dispatch board asks for its version every minute and reads itself again when it has moved, so what one load
// reads, for the visits in its week, and what one look at the version reads, are what scripts/lib/free-tier-budget.ts
// counts the day's reads by.
describe("a load of the dispatch board", () => {
  const ops = appFor("local", fakeDependencies(), {}, "ops");
  const board = () => request(ops, "/api/dispatch");
  const version = () => request(ops, "/api/dispatch/version");
  const TECHNICIAN = "'55555555-5555-4555-8555-' || printf('%012d', 1 + i % 2)";
  /** Within the board's week from NOW's day: ?3 days and an hour on from NOW. */
  const IN_THE_WEEK = `strftime('%Y-%m-%dT%H:%M:%fZ', '${NOW.toISOString()}', '+' || (i % 7) || ' days', '+1 hour')`;

  /** Two technicians, and a client who has invited every client on the board. */
  const TEAM_SQL = [
    `INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at)
     SELECT ${TECHNICIAN}, 'fsm-b-' || i, 'Technician ' || i, 'T' || i, 1, '${AGO}' FROM n`,
    `INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('b-inviter', '${AGO}', '+917700000000', 'Inviter')`,
    `INSERT INTO referral_codes (code, person_id, created_at, updated_at) VALUES ('BINVITE', 'b-inviter', '${AGO}', '${AGO}')`,
  ];

  /**
   * The clients numbered ?1 to ?2, each with a service in the board's week, worked through, and all its card reads of
   * them: an address, two answers on each kind of message and photograph, the invite they came by, the hold it was
   * booked with, every step of the technician's and, for every other one, the credit that paid for it.
   */
  const WEEK_SQL = [
    `INSERT INTO people (id, created_at, mobile_e164, name) SELECT 'b-' || i, '${AGO}', '+9177' || printf('%08d', i),
       'Client ' || i FROM n`,
    `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
     SELECT 'b-ad-' || i, 'b-' || i, '${AGO}', 'House ' || i, 'Sector 49', 'Gurgaon', '122018' FROM n`,
    `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
     SELECT 'b-co-' || i || '-' || purpose.value || '-' || v, 'b-' || i, purpose.value, 'v' || v, v - 1, '${AGO}'
     FROM n
     CROSS JOIN json_each('["photos_own_record","photos_referral_cards","photos_marketing","whatsapp_visits",
       "whatsapp_launches"]') purpose
     CROSS JOIN (SELECT 1 AS v UNION ALL SELECT 2)`,
    `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, grant_state, created_at,
       updated_at)
     SELECT 'b-ra-' || i, 'BINVITE', 'b-' || i, '${AGO}', 'consultation', 'granted', '${AGO}', '${AGO}' FROM n`,
    `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, technician_id, status,
       fsm_status, service_city, service_pincode, fsm_modified_at, synced_at)
     SELECT 'b-v-' || i, 'fsm-b-v-' || i, 'b-' || i, 'service', ${IN_THE_WEEK}, ${IN_THE_WEEK}, ${TECHNICIAN},
       'scheduled', 'Scheduled', 'Gurgaon', '122018', '${AGO}', '${AGO}' FROM n`,
    `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount, amount_ex_gst,
       gst_percent, state, appointment_id, expires_at, created_at, updated_at, confirmed_at)
     SELECT 'b-h-' || i, 'b-' || i, 'service', date(${IN_THE_WEEK}), 'afternoon', ${TECHNICIAN}, i, 200000, 200000, 0,
       'booked', 'b-v-' || i, '${AGO}', '${AGO}', '${AGO}', '${AGO}' FROM n`,
    `INSERT INTO credit_ledger (id, person_id, kind, visits, source_kind, source_id, expires_at, created_at)
     SELECT 'b-g-' || i, 'b-' || i, 'grant', 1, 'referral', 'b-ra-' || i, '${IN_TWO_MONTHS}', '${AGO}' FROM n
     WHERE i % 2 = 0`,
    `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
     SELECT 'b-r-' || i, 'b-' || i, 'redeem', -1, 'b-g-' || i, 'appointment', 'b-v-' || i, '${AGO}' FROM n
     WHERE i % 2 = 0`,
    `INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at,
       fsm_write_state, updated_at)
     SELECT 'b-je-' || i || '-' || step.value, 'b-v-' || i, 'b-ev-' || i || '-' || step.value, ${TECHNICIAN},
       step.value, '{}', '${AGO}', '${AGO}', 'written', '${AGO}'
     FROM n CROSS JOIN json_each('["check_in","start","before_photos","checklist","consumables","piece",
       "after_photos","outcome"]') step`,
  ];

  it("reads no more than its budget for the visits in its week", async () => {
    await env.DB.batch(TEAM_SQL.map((sql) => over(sql, 1, 2)));
    await env.DB.batch(WEEK_SQL.map((sql) => over(sql, 1, 10)));
    await rowsReadBy(board); // the console's settings, read once and kept
    const ten = await rowsReadBy(board);
    const shown = await (await board()).json<{ technicians: { days: { blocks: unknown[] }[] }[] }>();
    expect(shown.technicians.flatMap((row) => row.days.flatMap((day) => day.blocks))).toHaveLength(10);

    await env.DB.batch(WEEK_SQL.map((sql) => over(sql, 11, 30)));
    const thirty = await rowsReadBy(board);

    const perVisit = (thirty - ten) / 20;
    expect(perVisit).toBeLessThanOrEqual(BOARD_ROWS_READ_PER_VISIT);
    expect(ten - 10 * perVisit).toBeLessThanOrEqual(BOARD_ROWS_READ_FIXED);
  });

  it("reads no more when the clients' history before the week doubles", async () => {
    await env.DB.batch(TEAM_SQL.map((sql) => over(sql, 1, 2)));
    await env.DB.batch(WEEK_SQL.map((sql) => over(sql, 1, 10)));
    await history(1, 400);
    await rowsReadBy(board); // the console's settings, read once and kept
    const before = await rowsReadBy(board);

    await history(401, 800);
    const after = await rowsReadBy(board);

    expect({ before, after }).toEqual({ before, after: before });
  });

  it("reads one look at its version in a few rows, however many visits its week holds", async () => {
    await env.DB.batch(TEAM_SQL.map((sql) => over(sql, 1, 2)));
    await env.DB.batch(WEEK_SQL.map((sql) => over(sql, 1, 30)));
    await rowsReadBy(version); // the console's settings, read once and kept

    expect(await rowsReadBy(version)).toBeLessThanOrEqual(BOARD_VERSION_ROWS_READ);
  });
});
