// What the cron reads from D1. Each job runs as often as every five minutes in
// each environment, and past 5 million rows read a day D1 refuses every query
// until midnight UTC (ADR 0009). So a job must read about what it has to do, not
// the history its tables have gathered: every try-on job, visit, payment and
// person ever made stays in D1. This seeds a finished history, runs every job,
// doubles the history, and runs them again. Each minute's run is held to a
// number of statements, which is what its CPU time goes on. The console's Tasks
// board and Stock page, read all day, are held to the same below.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { TASKS_ROWS_READ_PER_LOOK } from "../../../scripts/lib/free-tier-budget.ts";
import { NOW, appFor, captureLogs, fakeDependencies, markDatabase, request } from "../helpers.ts";
import { DAY_MS, AGO, IN_TWO_MONTHS, over, rowsReadBy } from "./cron-reads-fixtures.ts";

beforeEach(async () => {
  await markDatabase();
  captureLogs();
});

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
