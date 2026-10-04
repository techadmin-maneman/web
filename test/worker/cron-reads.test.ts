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
  CRON_ROWS_READ_PER_QUIET_RUN,
  CRON_STATEMENTS_PER_RUN,
  TASKS_ROWS_READ_PER_LOOK,
} from "../../scripts/lib/free-tier-budget.ts";
import type { StaticConfig } from "../../src/guard.ts";
import { meterDatabase } from "../../src/lib/d1-meter.ts";
import { createLogger } from "../../src/log.ts";
import { CRON_JOBS, runCronJobs } from "../../src/scheduled/cron.ts";
import { EVERY_MINUTE, jobsDue } from "../../src/scheduled/schedule.ts";
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
} from "./helpers.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Two months ago, when all of the history happened, and an hour later. */
const AGO = new Date(NOW.getTime() - 60 * DAY_MS).toISOString();
const AGO_PLUS_HOUR = new Date(NOW.getTime() - 60 * DAY_MS + 60 * 60 * 1000).toISOString();
const IN_TWO_MONTHS = new Date(NOW.getTime() + 60 * DAY_MS).toISOString();
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
 * test/node/query-plans.test.ts fails while a growing table the cron's
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

// D-01 of 4 October 2026: one run of every job took 34 to 61 ms of CPU on staging, past the free plan's 10, and
// Cloudflare stopped every run for ten hours. Most of a run's CPU time goes on its calls to D1.
describe("each minute's run", () => {
  /** Where FSM is the record, as on staging, so the FSM mirror's repair runs; and without FSM, Books' items. */
  const WITH_FSM: StaticConfig = { ...LOCAL_CONFIG, providers: { ...LOCAL_CONFIG.providers, FSM_PROVIDER: "zoho" } };
  const WITHOUT_FSM: StaticConfig = { ...LOCAL_CONFIG, providers: { ...LOCAL_CONFIG.providers, FSM_PROVIDER: "none" } };

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
    for (const [name, config] of [
      ["with FSM", WITH_FSM],
      ["without FSM", WITHOUT_FSM],
    ] as const) {
      for (let minute = 0; minute < 60; minute += 1) {
        const statements = await statementsAt(minute, config);
        if (statements > CRON_STATEMENTS_PER_RUN)
          overBudget.push(`${name}, minute ${String(minute)}: ${String(statements)}`);
      }
    }
    expect(overBudget).toEqual([]);
  });
});

/** The statement over the numbers ?1 to ?2, with anything more it takes from ?3 on. */
const over = (sql: string, from: number, to: number, ...more: (string | number)[]) =>
  env.DB.prepare(`WITH RECURSIVE n(i) AS (SELECT ?1 UNION ALL SELECT i + 1 FROM n WHERE i < ?2) ${sql}`).bind(
    from,
    to,
    ...more,
  );

/** Rows read by one call the console makes. */
async function rowsReadBy(call: () => Promise<Response>): Promise<number> {
  const rowsRead = countRowsRead();
  const answer = await call();
  const read = rowsRead();
  vi.restoreAllMocks();
  captureLogs();
  expect(answer.status).toBe(200);
  return read;
}

// The Tasks board and the Stock page are read all day, and each movement of stock checks its place for low stock.
// Their At-risk client and First fit to book read a summary of each client's last visits, kept as each visit closes,
// and the Stock page a balance for each place, kept with each movement: never the history behind either
// (docs/decisions/0086-the-next-visit-is-offered.md, 0087-consumables-and-stock.md; plan piece C27). Consultation
// request reads only the requests that can still be a task, by a flag kept as the visits behind them are written
// (docs/decisions/0092-task-owners.md), and First fit to book only the clients not fitted since their consultation.
describe("a look at the Tasks board or the Stock page", () => {
  const ops = appFor("local", fakeDependencies(), {}, "ops");
  const CLIENTS = 30;
  /** `?3` days before NOW, in the form the mirror keeps a visit's start. */
  const DAYS_AGO = `strftime('%Y-%m-%dT%H:%M:%fZ', '${NOW.toISOString()}', '-' || ?3 || ' days')`;
  const CONSULTED = new Date(NOW.getTime() - 400 * DAY_MS).toISOString();
  /** Ten days ago: a first fit done then is not yet past its next service, so its client is not at risk. */
  const FITTED = new Date(NOW.getTime() - 10 * DAY_MS).toISOString();
  /** Two technicians, numbered as the clients are. */
  const TECHNICIAN = "'44444444-4444-4444-8444-' || printf('%012d', i)";
  const FIRST_TECHNICIAN = "44444444-4444-4444-8444-000000000001";
  /** One kit or the other, by the movement's number. */
  const KIT = "'44444444-4444-4444-8444-' || printf('%012d', 1 + i % 2)";

  /**
   * The clients numbered 1 to CLIENTS, each consulted, and every other one with a service booked; the technicians
   * who come; and five people more, consulted then and never fitted, each a First fit to book.
   */
  const CLIENTS_SQL = [
    `INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at)
     SELECT ${TECHNICIAN}, 'fsm-t-' || i, 'Technician ' || i, 'T' || i, 1, '${AGO}' FROM n WHERE i <= 2`,
    `INSERT INTO people (id, created_at, mobile_e164, name)
     SELECT 'q-' || i, '${AGO}', '+9171' || printf('%08d', i), 'Client ' || i FROM n`,
    `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, status, fsm_status,
       fsm_modified_at, synced_at)
     SELECT 'c-' || i, 'fsm-c-' || i, 'q-' || i, 'consultation', '${CONSULTED}', '${CONSULTED}', 'completed',
       'Completed', '${AGO}', '${AGO}' FROM n`,
    `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, technician_id, status,
       fsm_status, fsm_modified_at, synced_at)
     SELECT 'next-' || i, 'fsm-next-' || i, 'q-' || i, 'service', '${IN_TWO_MONTHS}', '${IN_TWO_MONTHS}',
       '${FIRST_TECHNICIAN}',
       'scheduled', 'Scheduled', '${AGO}', '${AGO}' FROM n WHERE i % 2 = 0`,
    `INSERT INTO people (id, created_at, mobile_e164, name)
     SELECT 'r-' || i, '${AGO}', '+9172' || printf('%08d', i), 'Lead ' || i FROM n WHERE i <= 5`,
    `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, status, fsm_status,
       fsm_modified_at, synced_at)
     SELECT 'rc-' || i, 'fsm-rc-' || i, 'r-' || i, 'consultation', '${CONSULTED}', '${CONSULTED}', 'completed',
       'Completed', '${AGO}', '${AGO}' FROM n WHERE i <= 5`,
  ];

  /** Each client's service visit numbered ?4, done ?3 days ago, with its record and the hold it was booked with. */
  const VISIT_SQL = [
    `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, technician_id, status,
       fsm_status, fsm_modified_at, synced_at)
     SELECT 'a-' || i || '-' || ?4, 'fsm-a-' || i || '-' || ?4, 'q-' || i, 'service', ${DAYS_AGO}, ${DAYS_AGO},
       '${FIRST_TECHNICIAN}',
       'completed', 'Completed', '${AGO}', '${AGO}' FROM n`,
    `INSERT INTO visits (id, appointment_id, outcome, updated_at)
     SELECT 'v-' || i || '-' || ?4, 'a-' || i || '-' || ?4, 'done', '${AGO}' FROM n`,
    `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount,
       amount_ex_gst, gst_percent, state, appointment_id, expires_at, created_at, updated_at, confirmed_at)
     SELECT 'h-' || i || '-' || ?4, 'q-' || i, 'service', date(${DAYS_AGO}), 'morning',
       '${FIRST_TECHNICIAN}', 0, 200000, 200000, 0,
       'booked', 'a-' || i || '-' || ?4, '${AGO}', '${AGO}', '${AGO}', '${AGO}' FROM n`,
  ];

  /**
   * The central store's deliveries numbered ?1 to ?2, each sent on to a technician's kit in a transfer, and a count
   * at that kit after: every place has a history of every kind of row ops write.
   */
  const MOVEMENTS_SQL = [
    `INSERT INTO stock_movements (id, consumable_code, location, quantity, reason, actor_kind, actor, created_at)
     SELECT 'in-' || i, 'tape_strips', 'central', 20, 'received', 'staff', 'ops@localhost', '${AGO}' FROM n`,
    `INSERT INTO stock_movements (id, consumable_code, location, quantity, reason, transfer_id, actor_kind, actor,
       created_at)
     SELECT 'out-' || i, 'tape_strips', 'central', -10, 'transferred', 'tr-' || i, 'staff', 'ops@localhost', '${AGO}'
     FROM n`,
    `INSERT INTO stock_movements (id, consumable_code, location, technician_id, quantity, reason, transfer_id,
       actor_kind, actor, created_at)
     SELECT 'kit-' || i, 'tape_strips', 'kit', ${KIT}, 10, 'transferred', 'tr-' || i, 'staff',
       'ops@localhost', '${AGO}' FROM n`,
    `INSERT INTO stock_movements (id, consumable_code, location, technician_id, quantity, reason, actor_kind, actor,
       created_at)
     SELECT 'count-' || i, 'tape_strips', 'kit', ${KIT}, -1, 'counted', 'staff', 'ops@localhost',
       '${AGO}' FROM n`,
  ];

  /** Every client's visits numbered `from` to `to`, a month apart, the first done 60 days ago. */
  async function visits(from: number, to: number): Promise<void> {
    const statements: D1PreparedStatement[] = [];
    for (let visit = from; visit <= to; visit += 1) {
      for (const sql of VISIT_SQL) statements.push(over(sql, 1, CLIENTS, 60 + 30 * (visit - 1), visit));
    }
    await env.DB.batch(statements);
  }

  async function movements(from: number, to: number): Promise<void> {
    await env.DB.batch(MOVEMENTS_SQL.map((sql) => over(sql, from, to)));
  }

  const tasks = () => request(ops, "/api/tasks");
  const stock = () => request(ops, "/api/stock");
  const count = () =>
    request(ops, "/api/stock/counts", {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
      body: JSON.stringify({ consumable_code: "tape_strips", technician_id: FIRST_TECHNICIAN, counted: 40 }),
    });

  it("reads no more for At-risk clients and First fits to book when every client has ten times the visits", async () => {
    await env.DB.batch(CLIENTS_SQL.map((sql) => over(sql, 1, CLIENTS)));
    await visits(1, 1);
    await rowsReadBy(tasks); // the console's settings, read once and kept
    const before = await rowsReadBy(tasks);
    const board = await (await tasks()).json<{ groups: { group: string; tasks: unknown[] }[] }>();
    expect(board.groups.map((group) => [group.group, group.tasks.length])).toEqual(
      expect.arrayContaining([
        ["at_risk_client", CLIENTS / 2],
        ["first_fit_to_book", 5],
      ]),
    );

    await visits(2, 10);
    const after = await rowsReadBy(tasks);

    expect({ before, after }).toEqual({ before, after: before });
    expect(after).toBeLessThanOrEqual(TASKS_ROWS_READ_PER_LOOK);
  });

  /**
   * The leads numbered ?1 to ?2, each of whom asked on the site's form for a consultation, had it, and was fitted
   * after it: nothing about any of them is still a task.
   */
  const ANSWERED_LEADS_SQL = [
    `INSERT INTO people (id, created_at, mobile_e164, name)
     SELECT 'lead-' || i, '${AGO}', '+9173' || printf('%08d', i), 'Lead ' || i FROM n`,
    `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, created_at)
     SELECT 'cr-' || i, 'lead-' || i, '122018', date('${CONSULTED}'), 'morning', '${CONSULTED}' FROM n`,
    `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, status, fsm_status,
       fsm_modified_at, synced_at)
     SELECT 'lead-c-' || i, 'fsm-lead-c-' || i, 'lead-' || i, 'consultation', '${CONSULTED}', '${CONSULTED}',
       'completed', 'Completed', '${AGO}', '${AGO}' FROM n`,
    `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, status, fsm_status,
       fsm_modified_at, synced_at)
     SELECT 'lead-fit-' || i, 'fsm-lead-fit-' || i, 'lead-' || i, 'first_fit', '${FITTED}', '${FITTED}', 'completed',
       'Completed', '${AGO}', '${AGO}' FROM n`,
  ];

  /** Three people whose consultation was asked for and never booked, each a Consultation request. */
  const WAITING_REQUESTS_SQL = [
    `INSERT INTO people (id, created_at, mobile_e164, name)
     SELECT 'asked-' || i, '${AGO}', '+9174' || printf('%08d', i), 'Asked ' || i FROM n`,
    `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, created_at)
     SELECT 'asked-cr-' || i, 'asked-' || i, '122018', date('${AGO}'), 'evening', '${AGO}' FROM n`,
  ];

  it("reads no more for Consultation requests and First fits to book when ten times the leads were answered", async () => {
    await env.DB.batch([
      ...CLIENTS_SQL.map((sql) => over(sql, 1, 5)),
      ...WAITING_REQUESTS_SQL.map((sql) => over(sql, 1, 3)),
      ...ANSWERED_LEADS_SQL.map((sql) => over(sql, 1, 20)),
    ]);
    await rowsReadBy(tasks); // the console's settings, read once and kept
    const before = await rowsReadBy(tasks);
    const board = await (await tasks()).json<{ groups: { group: string; tasks: unknown[] }[] }>();
    expect(board.groups.map((group) => [group.group, group.tasks.length])).toEqual(
      expect.arrayContaining([
        ["consultation_request", 3],
        // The clients consulted with nothing booked since, and the leads consulted and never fitted.
        ["first_fit_to_book", 3 + 5],
      ]),
    );

    await env.DB.batch(ANSWERED_LEADS_SQL.map((sql) => over(sql, 21, 200)));
    const after = await rowsReadBy(tasks);

    expect({ before, after }).toEqual({ before, after: before });
    expect(after).toBeLessThanOrEqual(TASKS_ROWS_READ_PER_LOOK);
  });

  /** Calls numbered ?1 to ?2 to the console, by three members of staff in turn, as the audit log keeps every one. */
  const CALLS_SQL = `INSERT INTO audit_log (at, surface, actor_kind, actor, action, request_id, detail)
     SELECT '${AGO}', 'ops', 'staff', printf('staff%d@maneman.in', i % 3), 'ops.call', 'r-' || i, '{}' FROM n`;

  // The staff a task may be given to are those who have signed in: the board finds them in the log of every call,
  // one row for each member of staff (docs/decisions/0092-task-owners.md).
  it("reads no more for the staff a task may be given to when the log holds ten times the calls", async () => {
    await over(CALLS_SQL, 1, 20).run();
    await rowsReadBy(tasks); // the console's settings, read once and kept
    const before = await rowsReadBy(tasks);
    const board = await (await tasks()).json<{ staff: string[] }>();
    expect(board.staff).toEqual(["ops@localhost", "staff0@maneman.in", "staff1@maneman.in", "staff2@maneman.in"]);

    await over(CALLS_SQL, 21, 200).run();
    const after = await rowsReadBy(tasks);

    expect({ before, after }).toEqual({ before, after: before });
    expect(after).toBeLessThanOrEqual(TASKS_ROWS_READ_PER_LOOK);
  });

  /**
   * The clients numbered ?1 to ?2, each with a service still to come, so none of them is at risk, and a code friends
   * can be invited with.
   */
  const KEPT_CLIENTS_SQL = [
    `INSERT INTO people (id, created_at, mobile_e164, name)
     SELECT 'kept-' || i, '${AGO}', '+9175' || printf('%08d', i), 'Kept ' || i FROM n`,
    `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, status, fsm_status,
       fsm_modified_at, synced_at)
     SELECT 'kept-next-' || i, 'fsm-kept-next-' || i, 'kept-' || i, 'service', '${IN_TWO_MONTHS}',
       '${IN_TWO_MONTHS}', 'scheduled', 'Scheduled', '${AGO}', '${AGO}' FROM n`,
    `INSERT INTO referral_codes (code, person_id, created_at, updated_at)
     SELECT 'KEPT' || i, 'kept-' || i, '${AGO}', '${AGO}' FROM n`,
  ];

  /** ?3 days before NOW, as the mirror keeps a visit's start. */
  const ITEM_DAY = `strftime('%Y-%m-%dT%H:%M:%fZ', '${NOW.toISOString()}', '-' || (400 - ?4 * 10) || ' days')`;

  /**
   * Each client's history item numbered ?4, all of it dealt with: a replacement visit, left partly done and
   * followed by the visits after it, which replaced a piece that fell due that day, and which ops moved and told
   * the client of; and a friend of theirs whose invite ops granted after review.
   */
  const DONE_WITH_SQL = [
    `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, status, fsm_status,
       fsm_modified_at, synced_at)
     SELECT 'done-' || i || '-' || ?4, 'fsm-done-' || i || '-' || ?4, 'kept-' || i, 'replacement', ${ITEM_DAY},
       ${ITEM_DAY}, 'completed', 'Completed', '${AGO}', '${AGO}' FROM n`,
    `INSERT INTO pieces (id, fsm_id, person_id, piece_code, fitted_at, replacement_due_at, synced_at)
     SELECT 'piece-' || i || '-' || ?4, 'fsm-piece-' || i || '-' || ?4, 'kept-' || i, 'MM-' || i || '-' || ?4,
       '${AGO}', ${ITEM_DAY}, '${AGO}' FROM n`,
    `INSERT INTO visits (id, appointment_id, outcome, partial_reason, updated_at)
     SELECT 'part-' || i || '-' || ?4, 'done-' || i || '-' || ?4, 'partial', 'time', '${AGO}' FROM n`,
    `INSERT INTO dispatch_moves (id, appointment_id, was_start, now_start, reason, actor, fsm_write_state, told_at,
       created_at, updated_at)
     SELECT 'move-' || i || '-' || ?4, 'done-' || i || '-' || ?4, '${AGO}', ${ITEM_DAY}, 'client_asked',
       'ops@localhost', 'written', '${AGO}', '${AGO}', '${AGO}' FROM n`,
    `INSERT INTO people (id, created_at, mobile_e164, name)
     SELECT 'friend-' || i || '-' || ?4, '${AGO}', '+9176' || printf('%04d', i) || printf('%04d', ?4),
       'Friend ' || i FROM n`,
    `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, grant_state, created_at,
       updated_at)
     SELECT 'ref-' || i || '-' || ?4, 'KEPT' || i, 'friend-' || i || '-' || ?4, '${AGO}', 'consultation', 'granted',
       '${AGO}', '${AGO}' FROM n`,
  ];

  /** Every kept client's history items numbered `from` to `to`. */
  async function doneWith(from: number, to: number): Promise<void> {
    const statements: D1PreparedStatement[] = [];
    for (let item = from; item <= to; item += 1) {
      for (const sql of DONE_WITH_SQL) statements.push(over(sql, 1, 20, 0, item));
    }
    await env.DB.batch(statements);
  }

  // Call about a move, Replacement order, Referral review and Visit left partly done each read only what can still
  // be a task, not every move, piece, invite or partial visit a client has ever had (migration 0060).
  it("reads no more for moves, pieces, invites and partial visits when each client has ten times their history", async () => {
    await env.DB.batch(KEPT_CLIENTS_SQL.map((sql) => over(sql, 1, 20)));
    await doneWith(1, 2);
    await rowsReadBy(tasks); // the console's settings, read once and kept
    const before = await rowsReadBy(tasks);
    const board = await (await tasks()).json<{ groups: { group: string; tasks: unknown[] }[] }>();
    const grown = ["untold_move", "replacement_order", "referral_review", "partial_visit", "at_risk_client"];
    expect(board.groups.filter((group) => grown.includes(group.group) && group.tasks.length > 0)).toEqual([]);

    await doneWith(3, 20);
    const after = await rowsReadBy(tasks);

    expect({ before, after }).toEqual({ before, after: before });
    expect(after).toBeLessThanOrEqual(TASKS_ROWS_READ_PER_LOOK);
  });

  it("reads no more for the Stock page, or a count, when the ledger holds ten times the movements", async () => {
    await env.DB.batch(CLIENTS_SQL.slice(0, 1).map((sql) => over(sql, 1, CLIENTS)));
    await env.DB.prepare(
      `INSERT INTO consumables (code, name, unit, unit_cost, reorder_kit, reorder_central, created_at, updated_at)
       VALUES ('tape_strips', 'Tape strips', 'strip', 1200, 5, 20, ?1, ?1),
              ('solvent', 'Solvent', 'ml', 50, NULL, NULL, ?1, ?1)`,
    )
      .bind(AGO)
      .run();
    await movements(1, 20);
    await rowsReadBy(stock); // the console's settings, read once and kept
    const before = { page: await rowsReadBy(stock), count: await rowsReadBy(count) };

    await movements(21, 200);
    const after = { page: await rowsReadBy(stock), count: await rowsReadBy(count) };

    expect(after).toEqual(before);
  });
});

// The dispatch board reads itself again every minute it is open, so what one load reads, for the visits in its week,
// is what scripts/lib/free-tier-budget.ts counts the day's reads by.
describe("a load of the dispatch board", () => {
  const ops = appFor("local", fakeDependencies(), {}, "ops");
  const board = () => request(ops, "/api/dispatch");
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
   * The clients numbered ?1 to ?2, each with a service in the board's week and all its card reads of them: an
   * address, two answers on WhatsApp messages, the invite they came by, the hold it was booked with and, for every
   * other one, the credit that paid for it.
   */
  const WEEK_SQL = [
    `INSERT INTO people (id, created_at, mobile_e164, name) SELECT 'b-' || i, '${AGO}', '+9177' || printf('%08d', i),
       'Client ' || i FROM n`,
    `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
     SELECT 'b-ad-' || i, 'b-' || i, '${AGO}', 'House ' || i, 'Sector 49', 'Gurgaon', '122018' FROM n`,
    `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
     SELECT 'b-co-' || i || '-' || v, 'b-' || i, 'whatsapp_visits', 'v' || v, v - 1, '${AGO}'
     FROM n CROSS JOIN (SELECT 1 AS v UNION ALL SELECT 2)`,
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
});
