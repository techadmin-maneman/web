// What ops still have to do, on the ops surface (src/routes/ops-tasks.ts), Ops
// Console D2. NOW is Monday 21 September 2026, 12 noon in India. Nothing here
// is a real person, number or piece.
//
// There is no tasks table: each group is a queue read at the moment ops look,
// so a task appears when its row starts waiting and is gone once the row is
// decided. The tests put rows in those queues and read the board back.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.ts";
import { MAX_SYNC_ATTEMPTS } from "../../src/queues/crm-sync.ts";
import { TASKS_SHOWN } from "../../src/routes/ops-tasks.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const REFERRED = "11111111-1111-4111-8111-111111111112";
const VISIT = "22222222-2222-4222-8222-222222222222";
const PIECE = "33333333-3333-4333-8333-333333333331";
const HELD = "33333333-3333-4333-8333-333333333332";
const CASE = "33333333-3333-4333-8333-333333333333";
const CHANGE = "33333333-3333-4333-8333-333333333334";
const ERASURE = "33333333-3333-4333-8333-333333333335";
const CHECK_IN = "44444444-4444-4444-8444-444444444441";
const REQUEST = "33333333-3333-4333-8333-333333333336";
const CONSULTATION = "22222222-2222-4222-8222-222222222223";
const GRIEVANCE = "33333333-3333-4333-8333-333333333337";

let ops: App;

interface Body {
  overdue: number;
  truncated: boolean;
  groups: { group: string; count: number; tasks: { id: string; person: unknown; detail: string | null }[] }[];
}

const tasks = async (): Promise<Body> => (await request(ops, "/api/tasks")).json<Body>();
const groupNames = (body: Body) => body.groups.map((each) => each.group);
const tasksIn = (body: Body, group: string) => body.groups.find((each) => each.group === group)?.tasks ?? [];

async function person(id: string, name: string, mobile: string) {
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, '2026-08-01T06:00:00.000Z', ?2, ?3)",
  )
    .bind(id, mobile, name)
    .run();
}

/** A piece fitted long enough ago that its replacement fell due on 1 September. */
async function pieceDue(due: string | null, failedAt: string | null = null) {
  await env.DB.prepare(
    `INSERT INTO pieces (id, fsm_id, person_id, piece_code, base, supplier_lot, fitted_at, replacement_due_at,
       failed_at, synced_at)
     VALUES (?1, 'fsm-asset-1', ?2, 'MM-STD-4417-C', 'Mono', 'L-2704', '2025-09-01', ?3, ?4, ?5)`,
  )
    .bind(PIECE, PERSON, due, failedAt, NOW.toISOString())
    .run();
}

/** A grant the fraud rules held for review, against the referrer's own code. */
async function heldGrant(signals: string) {
  await env.DB.prepare(
    "INSERT INTO referral_codes (code, person_id, created_at, updated_at) VALUES ('RM4417', ?1, ?2, ?2)",
  )
    .bind(PERSON, "2026-09-01T06:00:00.000Z")
    .run();
  await env.DB.prepare(
    `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, grant_state,
       fraud_signals, created_at, updated_at)
     VALUES (?1, 'RM4417', ?2, '2026-09-01T06:00:00.000Z', 'consultation', 'held', ?3,
       '2026-09-01T06:00:00.000Z', '2026-09-18T06:00:00.000Z')`,
  )
    .bind(HELD, REFERRED, signals)
    .run();
}

/** A job closed as a no-show, with the check-in the wait ran from, and nobody has ruled on it. */
async function noShowCase(decision: "undecided" | "charged") {
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'fsm-t1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
       technician_id, fsm_modified_at, synced_at)
     VALUES (?1, 'fsm-1', ?2, 'service', 'completed', 'Completed', '2026-09-19T04:30:00.000Z',
       '2026-09-19T07:30:00.000Z', 't1', ?3, ?3)`,
  )
    .bind(VISIT, PERSON, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO checkins (id, appointment_id, technician_id, at, lat, lng, distance_m, radius_m, passed, created_at)
     VALUES (?1, ?2, 't1', '2026-09-19T06:01:00.000Z', 28.4, 77.0, 240, 200, 1, '2026-09-19T06:01:00.000Z')`,
  )
    .bind(CHECK_IN, VISIT)
    .run();
  await env.DB.prepare(
    `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, closed_at,
       decision, created_at)
     VALUES (?1, ?2, ?3, '2026-09-19T06:01:00.000Z', '2026-09-19T06:16:00.000Z', '2026-09-19T06:17:00.000Z',
       ?4, '2026-09-19T06:17:00.000Z')`,
  )
    .bind(CASE, CHECK_IN, VISIT, decision)
    .run();
}

async function numberChange(state: string) {
  await env.DB.prepare(
    `INSERT INTO number_change_requests (id, person_id, created_at, new_mobile_e164, old_verified_at,
       new_verified_at, state)
     VALUES (?1, ?2, '2026-09-19T06:00:00.000Z', '+919810000099', '2026-09-20T06:00:00.000Z',
       '2026-09-20T06:30:00.000Z', ?3)`,
  )
    .bind(CHANGE, PERSON, state)
    .run();
}

/** A consultation asked for while self-serve booking was off, which no slot was held for. */
async function consultationRequest() {
  await env.DB.prepare(
    `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, created_at)
     VALUES (?1, ?2, '122018', '2026-09-23', 'morning', '2026-09-20T06:00:00.000Z')`,
  )
    .bind(REQUEST, PERSON)
    .run();
}

/** The consultation ops booked for them, which takes the request off the board. */
async function consultationFor(personId: string, status: string) {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, status, fsm_status, fsm_modified_at,
       synced_at)
     VALUES (?1, 'fsm-appt-consult', ?2, 'consultation', '2026-09-23T03:30:00.000Z', ?3, 'Scheduled', ?4, ?4)`,
  )
    .bind(CONSULTATION, personId, status, NOW.toISOString())
    .run();
}

/** A finished visit whose invoice Books holds as a draft, which the client cannot open. */
async function draftInvoice() {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, fsm_invoice_id, person_id, type, window_start,
       window_end, status, fsm_status, fsm_modified_at, synced_at)
     VALUES (?1, 'fsm-appt-9', 'fsm-wo-9', 'books-inv-7', ?2, 'service', '2026-09-20T04:30:00.000Z',
       '2026-09-20T06:00:00.000Z', 'completed', 'Completed', ?3, ?3)`,
  )
    .bind(VISIT, PERSON, NOW.toISOString())
    .run();
}

/** A concern the client raised from their own app, which ops answer in the console. */
async function grievance(id: string, raisedAt = "2026-09-20T06:00:00.000Z") {
  await env.DB.prepare(
    `INSERT INTO grievances (id, person_id, text, state, created_at)
     VALUES (?1, ?2, 'Why do you keep my photographs?', 'open', ?3)`,
  )
    .bind(id, PERSON, raisedAt)
    .run();
}

async function erasureRequest(state: string) {
  await env.DB.prepare("INSERT INTO deletion_requests (id, person_id, created_at, state) VALUES (?1, ?2, ?3, ?4)")
    .bind(ERASURE, PERSON, "2026-09-20T06:00:00.000Z", state)
    .run();
}

beforeEach(async () => {
  captureLogs();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await markDatabase();
  await person(PERSON, "Rohit Malhotra", "+919810000001");
  await person(REFERRED, "Vikram Sethi", "+919810000002");
});

describe("GET /api/tasks", () => {
  it("reads every group from the queue behind it, in the policy's order", async () => {
    await consultationRequest();
    await pieceDue("2026-09-01");
    await heldGrant('["shared_address"]');
    await noShowCase("undecided");
    await numberChange("awaiting_ops");
    await erasureRequest("requested");
    await grievance(GRIEVANCE);
    await env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, fsm_invoice_id, person_id, type, window_end, status,
         fsm_status, fsm_modified_at, synced_at)
       VALUES ('22222222-2222-4222-8222-222222222224', 'fsm-appt-9', 'fsm-wo-9', 'books-inv-7', ?1, 'service', '2026-09-20T06:00:00.000Z',
         'completed', 'Completed', ?2, ?2)`,
    )
      .bind(PERSON, NOW.toISOString())
      .run();
    await env.DB.prepare(
      `UPDATE people SET erased_at = '2026-09-20T06:00:00.000Z', fsm_contact_id = 'fsm-contact-4',
         fsm_erasure_attempts = ?1 WHERE id = ?2`,
    )
      .bind(MAX_SYNC_ATTEMPTS, REFERRED)
      .run();

    const body = await tasks();
    expect(groupNames(body)).toEqual([
      "consultation_request",
      "replacement_order",
      "referral_review",
      "no_show_decision",
      "number_change",
      "erasure_request",
      "grievance",
      "draft_invoice",
      "erasure_unfinished",
    ]);
    expect(body.groups.map((each) => each.count)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("leaves out a group with nothing waiting, as the board draws none", async () => {
    await heldGrant('["shared_upi"]');
    expect(groupNames(await tasks())).toEqual(["referral_review"]);
  });

  it("names the client and the day and window they asked for", async () => {
    await consultationRequest();
    expect(tasksIn(await tasks(), "consultation_request")).toEqual([
      {
        id: REQUEST,
        person: { id: PERSON, name: "Rohit Malhotra" },
        detail: "2026-09-23 morning",
        since: "2026-09-20T06:00:00.000Z",
        due: "2026-09-22T06:00:00.000Z",
      },
    ]);
  });

  // Nothing closes a request: it goes when ops have booked the visit, which is
  // the whole of what they had to do (docs/decisions/0060-….md).
  it("drops a consultation request once that client has a consultation, unless it was cancelled", async () => {
    await consultationRequest();
    await consultationFor(PERSON, "scheduled");
    expect(groupNames(await tasks())).toEqual([]);

    await env.DB.prepare("UPDATE appointments SET status = 'cancelled'").run();
    expect(groupNames(await tasks())).toEqual(["consultation_request"]);

    // Somebody else's consultation is not theirs.
    await env.DB.prepare("UPDATE appointments SET status = 'scheduled', person_id = ?1").bind(REFERRED).run();
    expect(groupNames(await tasks())).toEqual(["consultation_request"]);
  });

  it("names the client, the piece and when the replacement fell due", async () => {
    await pieceDue("2026-09-01");
    expect(tasksIn(await tasks(), "replacement_order")).toEqual([
      {
        id: PIECE,
        person: { id: PERSON, name: "Rohit Malhotra" },
        detail: "MM-STD-4417-C",
        // India's midnight on the day it fell due, and two days later it was overdue.
        since: "2026-08-31T18:30:00.000Z",
        due: "2026-09-02T18:30:00.000Z",
      },
    ]);
  });

  it("leaves out a piece that has failed, one with no due date, and one not due yet", async () => {
    await pieceDue(null);
    expect(groupNames(await tasks())).toEqual([]);

    await env.DB.prepare("UPDATE pieces SET replacement_due_at = '2027-09-01'").run();
    expect(groupNames(await tasks())).toEqual([]);

    await env.DB.prepare("UPDATE pieces SET replacement_due_at = '2026-09-01', failed_at = ?1")
      .bind(NOW.toISOString())
      .run();
    expect(groupNames(await tasks())).toEqual([]);
  });

  it("leaves out a piece whose replacement is already booked, and keeps one whose visit was cancelled", async () => {
    await pieceDue("2026-09-01");
    await env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, fsm_modified_at,
         synced_at)
       VALUES (?1, 'fsm-2', ?2, 'replacement', 'scheduled', 'Scheduled', '2026-09-25T04:30:00.000Z', ?3, ?3)`,
    )
      .bind(VISIT, PERSON, NOW.toISOString())
      .run();
    expect(groupNames(await tasks())).toEqual([]);

    await env.DB.prepare("UPDATE appointments SET status = 'cancelled'").run();
    expect(groupNames(await tasks())).toEqual(["replacement_order"]);
  });

  it("names the referrer and the first rule their grant met", async () => {
    await heldGrant('["shared_address","same_mobile"]');
    expect(tasksIn(await tasks(), "referral_review")).toMatchObject([
      { id: HELD, person: { id: PERSON, name: "Rohit Malhotra" }, detail: "shared_address" },
    ]);
  });

  // A no-show once named the technician alone, so its task led nowhere a client could be reached from (OPS-05).
  it("names the client whose visit it was on a no-show, and the technician who attended", async () => {
    await noShowCase("undecided");
    expect(tasksIn(await tasks(), "no_show_decision")).toMatchObject([
      { id: CASE, person: { id: PERSON, name: "Rohit Malhotra" }, detail: "Imran Qureshi" },
    ]);

    // Their record is gone once they are erased, and the case still waits for a ruling.
    await env.DB.prepare("UPDATE people SET erased_at = ?1 WHERE id = ?2").bind(NOW.toISOString(), PERSON).run();
    expect(tasksIn(await tasks(), "no_show_decision")).toMatchObject([{ id: CASE, person: null }]);
  });

  it("drops a no-show once it has been ruled on", async () => {
    await noShowCase("charged");
    expect(groupNames(await tasks())).toEqual([]);
  });

  it("waits for ops on a number change only once both numbers are proven", async () => {
    await numberChange("verifying");
    expect(groupNames(await tasks())).toEqual([]);

    await env.DB.prepare("UPDATE number_change_requests SET state = 'awaiting_ops'").run();
    expect(tasksIn(await tasks(), "number_change")).toMatchObject([
      // It waits from the moment the second code was entered, not from when it was asked for.
      { id: CHANGE, person: { id: PERSON, name: "Rohit Malhotra" }, since: "2026-09-20T06:30:00.000Z" },
    ]);
  });

  it("holds an erasure request until it is decided, for the seven days the client was promised", async () => {
    await erasureRequest("requested");
    // The Deletion requests section counts down to the same day (OPS-08).
    expect(tasksIn(await tasks(), "erasure_request")).toMatchObject([
      { id: ERASURE, detail: null, since: "2026-09-20T06:00:00.000Z", due: "2026-09-27T06:00:00.000Z" },
    ]);

    await env.DB.prepare("UPDATE deletion_requests SET state = 'rejected'").run();
    expect(groupNames(await tasks())).toEqual([]);
  });

  // A grievance was promised an answer within thirty days and waited on no board at all (OPS-08).
  it("holds an open grievance until it is answered, for the thirty days the client was promised", async () => {
    await grievance(GRIEVANCE);
    expect(tasksIn(await tasks(), "grievance")).toEqual([
      {
        id: GRIEVANCE,
        person: { id: PERSON, name: "Rohit Malhotra" },
        detail: null,
        since: "2026-09-20T06:00:00.000Z",
        due: "2026-10-20T06:00:00.000Z",
      },
    ]);

    await env.DB.prepare("UPDATE grievances SET state = 'resolved'").run();
    expect(groupNames(await tasks())).toEqual([]);
  });

  // The count was cut at 200 tasks across every group, so a busy queue read as a quiet one (FEO-07).
  it("counts every task in a group, and lists the longest waits of it", async () => {
    const hour = 3_600_000;
    await env.DB.batch(
      Array.from({ length: TASKS_SHOWN + 10 }, (_, n) =>
        env.DB.prepare(
          "INSERT INTO grievances (id, person_id, text, state, created_at) VALUES (?1, ?2, 'Words', 'open', ?3)",
        ).bind(
          `55555555-5555-4555-8555-${String(n).padStart(12, "0")}`,
          PERSON,
          new Date(Date.parse("2026-09-01T06:00:00.000Z") + n * hour).toISOString(),
        ),
      ),
    );

    const body = await tasks();
    expect(body.truncated).toBe(false);
    expect(body.groups[0]?.count).toBe(TASKS_SHOWN + 10);
    const listed = tasksIn(body, "grievance");
    expect(listed).toHaveLength(TASKS_SHOWN);
    expect(listed[0]?.id).toBe("55555555-5555-4555-8555-000000000000");
  });

  it("lists a finished visit whose invoice is still a draft in Books, until it is sent", async () => {
    await draftInvoice();
    expect(tasksIn(await tasks(), "draft_invoice")).toEqual([
      {
        id: VISIT,
        person: { id: PERSON, name: "Rohit Malhotra" },
        detail: "books-inv-7",
        // It waits from the end of the visit, and two days later it is overdue.
        since: "2026-09-20T06:00:00.000Z",
        due: "2026-09-22T06:00:00.000Z",
      },
    ]);

    await env.DB.prepare("UPDATE appointments SET invoice_issued_at = ?1").bind(NOW.toISOString()).run();
    expect(groupNames(await tasks())).toEqual([]);
  });

  it("lists an erased client whose FSM contact the sweeper gave up on, until it is anonymised", async () => {
    const erased = (attempts: number) =>
      env.DB.prepare(
        `UPDATE people SET erased_at = '2026-09-20T06:00:00.000Z', fsm_contact_id = 'fsm-contact-4',
           fsm_erasure_attempts = ?1 WHERE id = ?2`,
      )
        .bind(attempts, PERSON)
        .run();

    // Still being asked: nothing for ops yet.
    await erased(MAX_SYNC_ATTEMPTS - 1);
    expect(groupNames(await tasks())).toEqual([]);

    await erased(MAX_SYNC_ATTEMPTS);
    expect(tasksIn(await tasks(), "erasure_unfinished")).toEqual([
      {
        id: PERSON,
        // Erased: the record is gone, and only FSM's contact is left to name.
        person: null,
        detail: "fsm-contact-4",
        since: "2026-09-20T06:00:00.000Z",
        due: "2026-09-22T06:00:00.000Z",
      },
    ]);

    await env.DB.prepare("UPDATE people SET fsm_erased_at = ?1").bind(NOW.toISOString()).run();
    expect(groupNames(await tasks())).toEqual([]);
  });

  it("counts the tasks whose day has passed, and no others", async () => {
    // Held on the 18th, so due on the 20th: yesterday. The erasure came yesterday and is due on the 27th.
    await heldGrant('["shared_address"]');
    await erasureRequest("requested");
    expect(await tasks()).toMatchObject({ overdue: 1 });
  });

  it("says nothing is waiting when no queue holds anything", async () => {
    expect(await tasks()).toEqual({ overdue: 0, truncated: false, groups: [] });
  });

  it("leaves out an erased person's tasks, whose record is gone", async () => {
    await heldGrant('["shared_address"]');
    await numberChange("awaiting_ops");
    await env.DB.prepare("UPDATE people SET erased_at = ?1 WHERE id = ?2").bind(NOW.toISOString(), PERSON).run();
    expect(groupNames(await tasks())).toEqual([]);
  });

  it("belongs to the ops surface alone", async () => {
    const client = appFor("local", fakeDependencies(), {}, "client");
    expect((await request(client, "/api/tasks")).status).toBe(404);
  });
});
