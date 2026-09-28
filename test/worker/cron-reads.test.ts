// What one cron run reads from D1. It runs every five minutes in each
// environment, and past 5 million rows read a day D1 refuses every query until
// midnight UTC (ADR 0009). So a run must read about what it has to do, not the
// history its tables have gathered: every try-on job, visit, payment and
// person ever made stays in D1. This seeds a finished history, runs every job,
// doubles the history, and runs them again. The console's Tasks board and Stock
// page, read all day, are held to the same below.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CRON_ROWS_READ_PER_QUIET_RUN } from "../../scripts/lib/free-tier-budget.ts";
import { createLogger } from "../../src/log.ts";
import { CRON_JOBS, runCronJobs } from "../../src/scheduled/cron.ts";
import {
  LOCAL_CONFIG,
  NOW,
  appFor,
  captureLogs,
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

/** Counts every row D1 says each statement read, however the statement was run. */
function countRowsRead(): () => number {
  let read = 0;
  const counted = <T extends D1Result>(result: T): T => {
    read += result.meta.rows_read;
    return result;
  };
  const statement = Object.getPrototypeOf(env.DB.prepare("SELECT 1")) as D1PreparedStatement;
  const database = Object.getPrototypeOf(env.DB) as D1Database;
  // The real methods, each called below on the statement or database it belongs to.
  const real = {
    all: Reflect.get(statement, "all") as (this: D1PreparedStatement) => Promise<D1Result>,
    run: Reflect.get(statement, "run") as (this: D1PreparedStatement) => Promise<D1Result>,
    batch: Reflect.get(database, "batch") as (
      this: D1Database,
      statements: D1PreparedStatement[],
    ) => Promise<D1Result[]>,
  };
  vi.spyOn(statement, "all").mockImplementation(async function (this: D1PreparedStatement) {
    return counted(await real.all.call(this));
  });
  vi.spyOn(statement, "run").mockImplementation(async function (this: D1PreparedStatement) {
    return counted(await real.run.call(this));
  });
  // first() carries no meta, so it is answered from all().
  vi.spyOn(statement, "first").mockImplementation(async function (this: D1PreparedStatement, column?: string) {
    const [row] = counted(await real.all.call(this)).results as Record<string, unknown>[];
    if (row === undefined) return null;
    return column === undefined ? row : (row[column] ?? null);
  });
  vi.spyOn(database, "batch").mockImplementation(async function (this: D1Database, statements) {
    const results = await real.batch.call(this, statements);
    for (const result of results) counted(result);
    return results;
  });
  return () => read;
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

// The Tasks board and the Stock page are read all day, and each movement of stock checks its place for low stock.
// Their At-risk client and First fit to book read a summary of each client's last visits, kept as each visit closes,
// and the Stock page a balance for each place, kept with each movement: never the history behind either
// (docs/decisions/0086-the-next-visit-is-offered.md, 0087-consumables-and-stock.md; plan piece C27). Consultation
// request and First fit to book read only the requests that can still be a task, by flags kept as the visits behind
// them are written (docs/decisions/0092-task-owners.md).
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
   * The clients numbered 1 to CLIENTS, each consulted after asking for a first fit on the site's form, and every
   * other one with a service booked; the technicians who come; and five people more, consulted then and never
   * fitted, each a First fit to book.
   */
  const CLIENTS_SQL = [
    `INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at)
     SELECT ${TECHNICIAN}, 'fsm-t-' || i, 'Technician ' || i, 'T' || i, 1, '${AGO}' FROM n WHERE i <= 2`,
    `INSERT INTO people (id, created_at, mobile_e164, name)
     SELECT 'q-' || i, '${AGO}', '+9171' || printf('%08d', i), 'Client ' || i FROM n`,
    `INSERT INTO first_fit_requests (id, person_id, preferred_window, created_at)
     SELECT 'ff-' || i, 'q-' || i, NULL, '${AGO}' FROM n`,
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
    `INSERT INTO first_fit_requests (id, person_id, preferred_window, created_at)
     SELECT 'fr-' || i, 'r-' || i, 'morning', '${AGO}' FROM n WHERE i <= 5`,
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

  /** The statement over the numbers ?1 to ?2, with anything more it takes from ?3 on. */
  const over = (sql: string, from: number, to: number, ...more: (string | number)[]) =>
    env.DB.prepare(`WITH RECURSIVE n(i) AS (SELECT ?1 UNION ALL SELECT i + 1 FROM n WHERE i < ?2) ${sql}`).bind(
      from,
      to,
      ...more,
    );

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
  });

  /**
   * The leads numbered ?1 to ?2, each of whom asked on the site's form for a consultation and a first fit, had the
   * consultation, and was fitted after it: nothing any of them asked for is still a task.
   */
  const ANSWERED_LEADS_SQL = [
    `INSERT INTO people (id, created_at, mobile_e164, name)
     SELECT 'lead-' || i, '${AGO}', '+9173' || printf('%08d', i), 'Lead ' || i FROM n`,
    `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, created_at)
     SELECT 'cr-' || i, 'lead-' || i, '122018', date('${CONSULTED}'), 'morning', '${CONSULTED}' FROM n`,
    `INSERT INTO first_fit_requests (id, person_id, preferred_window, created_at)
     SELECT 'lead-ff-' || i, 'lead-' || i, 'morning', '${CONSULTED}' FROM n`,
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
