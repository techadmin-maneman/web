// What ops still have to do, on the ops surface (src/routes/ops/tasks.ts), Ops
// Console D2. NOW is Monday 21 September 2026, 12 noon in India. Nothing here
// is a real person, number or piece.
//
// There is no tasks table: each group is a queue read at the moment ops look,
// so a task appears when its row starts waiting and is gone once the row is
// decided. The tests put rows in those queues and read the board back.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import {
  PERSON,
  REFERRED,
  OTHER,
  VISIT,
  HELD,
  CASE,
  CHANGE,
  ERASURE,
  REQUEST,
  GRIEVANCE,
  person,
  heldGrant,
  noShowCase,
  numberChange,
  consultationRequest,
  consultationFor,
  grievance,
  erasureRequest,
} from "./ops-tasks-fixtures.ts";

const PIECE = "33333333-3333-4333-8333-333333333331";

const DISPUTE = "33333333-3333-4333-8333-333333333338";

let ops: App;

interface Body {
  overdue: number;
  truncated: boolean;
  staff: string[];
  groups: {
    group: string;
    count: number;
    closable: boolean;
    tasks: { id: string; person: unknown; detail: string | null; owner: string | null }[];
  }[];
}

const tasks = async (): Promise<Body> => (await request(ops, "/api/tasks")).json<Body>();

const groupNames = (body: Body) => body.groups.map((each) => each.group);

const tasksIn = (body: Body, group: string) => body.groups.find((each) => each.group === group)?.tasks ?? [];

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
    // A visit Rohit was left partly done on, and another client's job, with no address, on Chetan's day off.
    await person(OTHER, "Karan Bhatia", "+919810000003");
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, status, fsm_status,
           fsm_modified_at, synced_at)
         VALUES ('partial-visit', 'fsm-appt-10', ?1, 'service', '2026-09-20T04:30:00.000Z',
           '2026-09-20T06:00:00.000Z', 'terminated', 'Terminated', ?2, ?2)`,
      ).bind(PERSON, NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO visits (id, appointment_id, outcome, partial_reason, updated_at)
         VALUES ('visit-row-10', 'partial-visit', 'partial', 'client_unwell', ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t9', 'fsm-t9', 'Chetan Arora', 'CA', 1, ?1)",
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, technician_id, status,
           fsm_status, fsm_modified_at, synced_at)
         VALUES ('leave-job', 'fsm-appt-11', ?1, 'service', '2026-09-23T05:00:00.000Z', '2026-09-23T06:30:00.000Z',
           't9', 'scheduled', 'Scheduled', ?2, ?2)`,
      ).bind(OTHER, NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO technician_leave (id, technician_id, from_date, to_date, actor, created_at)
         VALUES ('leave-1', 't9', '2026-09-23', '2026-09-23', 'ops@localhost', ?1)`,
      ).bind(NOW.toISOString()),
    ]);

    const body = await tasks();
    expect(groupNames(body)).toEqual([
      "leave_conflict",
      "address_to_confirm",
      "consultation_request",
      "replacement_order",
      "partial_visit",
      "referral_review",
      "no_show_decision",
      "number_change",
      "erasure_request",
      "grievance",
      "draft_invoice",
    ]);
    expect(body.groups.map((each) => each.count)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
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
        owner: null,
      },
    ]);
  });

  // Nothing closes a request: it goes when ops have booked the visit, which is
  // the whole of what they had to do (docs/decisions/0060-….md).
  it("drops a consultation request once that client has a consultation, unless it was cancelled", async () => {
    await consultationRequest();
    await consultationFor(PERSON, "scheduled");
    // The consultation's own address, which no one has given yet, is another task.
    expect(groupNames(await tasks())).not.toContain("consultation_request");

    await env.DB.prepare("UPDATE appointments SET status = 'cancelled'").run();
    expect(groupNames(await tasks())).toContain("consultation_request");

    // Somebody else's consultation is not theirs.
    await env.DB.prepare("UPDATE appointments SET status = 'scheduled', person_id = ?1").bind(REFERRED).run();
    expect(groupNames(await tasks())).toContain("consultation_request");
  });

  it("names the client, the piece and the day it falls due, waiting from the lead time before it", async () => {
    await pieceDue("2026-09-01");
    expect(tasksIn(await tasks(), "replacement_order")).toEqual([
      {
        id: PIECE,
        person: { id: PERSON, name: "Rohit Malhotra" },
        detail: "MM-STD-4417-C 2026-09-01",
        // India's midnight thirty days before it fell due, and two days later it was overdue.
        since: "2026-08-01T18:30:00.000Z",
        due: "2026-08-03T18:30:00.000Z",
        owner: null,
      },
    ]);
  });

  // A hair system made to measure was asked for on the day it fell due, with no time to order it.
  it("lists a piece falling due within the lead time, due by its own day at the latest", async () => {
    await pieceDue("2026-10-06");
    expect(tasksIn(await tasks(), "replacement_order")).toMatchObject([
      { detail: "MM-STD-4417-C 2026-10-06", since: "2026-09-05T18:30:00.000Z", due: "2026-09-07T18:30:00.000Z" },
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
    // The booked visit's own address, which this client has not given, is another task.
    expect(groupNames(await tasks())).not.toContain("replacement_order");

    await env.DB.prepare("UPDATE appointments SET status = 'cancelled'").run();
    expect(groupNames(await tasks())).toEqual(["replacement_order"]);
  });

  it("names the referrer and the first rule their grant met", async () => {
    await heldGrant('["shared_address","same_mobile"]');
    expect(tasksIn(await tasks(), "referral_review")).toMatchObject([
      { id: HELD, person: { id: PERSON, name: "Rohit Malhotra" }, detail: "shared_address" },
    ]);
  });

  // A no-show once named the technician alone, so its task led nowhere a client could be reached from.
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

  // A client's claim for money back once waited on No-shows alone: no Tasks row, no count, no link.
  it("waits on a disputed charge until ops rule on it, naming what the charge kept", async () => {
    await noShowCase("charged");
    await env.DB.batch([
      env.DB.prepare("UPDATE no_show_cases SET charge = 'visit', kept_amount = 200000, refund_amount = 0"),
      env.DB.prepare(
        `INSERT INTO no_show_disputes (id, case_id, person_id, reason, created_at)
         VALUES (?1, ?2, ?3, 'I was home all morning.', '2026-09-20T06:00:00.000Z')`,
      ).bind(DISPUTE, CASE, PERSON),
    ]);
    expect(tasksIn(await tasks(), "no_show_dispute")).toEqual([
      {
        id: DISPUTE,
        person: { id: PERSON, name: "Rohit Malhotra" },
        detail: "200000",
        since: "2026-09-20T06:00:00.000Z",
        due: "2026-09-22T06:00:00.000Z",
        owner: null,
      },
    ]);

    // Their record is gone once they are erased, and the charge still waits for a ruling.
    await env.DB.prepare("UPDATE people SET erased_at = ?1 WHERE id = ?2").bind(NOW.toISOString(), PERSON).run();
    expect(tasksIn(await tasks(), "no_show_dispute")).toMatchObject([{ id: DISPUTE, person: null }]);

    await env.DB.prepare("UPDATE no_show_disputes SET ruling = 'upheld', ruled_at = ?1").bind(NOW.toISOString()).run();
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

  it("holds an erasure request until it is decided, for the 30 days the client was promised", async () => {
    await erasureRequest("requested");
    // The Deletion requests section counts down to the same day.
    expect(tasksIn(await tasks(), "erasure_request")).toMatchObject([
      { id: ERASURE, detail: null, since: "2026-09-20T06:00:00.000Z", due: "2026-10-20T06:00:00.000Z" },
    ]);

    await env.DB.prepare("UPDATE deletion_requests SET state = 'rejected'").run();
    expect(groupNames(await tasks())).toEqual([]);
  });

  // A grievance was promised an answer within thirty days and waited on no board at all.
  it("holds an open grievance until it is answered, for the thirty days the client was promised", async () => {
    await grievance(GRIEVANCE);
    expect(tasksIn(await tasks(), "grievance")).toEqual([
      {
        id: GRIEVANCE,
        person: { id: PERSON, name: "Rohit Malhotra" },
        detail: null,
        since: "2026-09-20T06:00:00.000Z",
        due: "2026-10-20T06:00:00.000Z",
        owner: null,
      },
    ]);

    await env.DB.prepare("UPDATE grievances SET state = 'resolved'").run();
    expect(groupNames(await tasks())).toEqual([]);
  });
});
