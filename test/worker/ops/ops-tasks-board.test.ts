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
import { TASKS_SHOWN } from "../../../src/routes/ops/tasks.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import {
  PERSON,
  REFERRED,
  VISIT,
  CONSULTATION,
  GRIEVANCE,
  person,
  heldGrant,
  numberChange,
  consultationFor,
  erasureRequest,
} from "./ops-tasks-fixtures.ts";

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

beforeEach(async () => {
  captureLogs();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await markDatabase();
  await person(PERSON, "Rohit Malhotra", "+919810000001");
  await person(REFERRED, "Vikram Sethi", "+919810000002");
});

describe("GET /api/tasks", () => {
  // The count was cut at 200 tasks across every group, so a busy queue read as a quiet one.
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
        owner: null,
      },
    ]);

    await env.DB.prepare("UPDATE appointments SET invoice_issued_at = ?1").bind(NOW.toISOString()).run();
    expect(groupNames(await tasks())).toEqual([]);
  });

  it("lists the draft of a visit booked without FSM, which has no work order", async () => {
    await draftInvoice();
    await env.DB.prepare("UPDATE appointments SET fsm_id = id, fsm_work_order_id = NULL, fsm_status = NULL").run();
    expect(tasksIn(await tasks(), "draft_invoice")).toEqual([
      expect.objectContaining({ id: VISIT, detail: "books-inv-7" }),
    ]);
  });

  // The brief: "ops need the full set because these drive the task queue". A visit left partly done made no task
  // at all.
  describe("a visit left partly done", () => {
    async function closed(outcome: "partial" | "no_show", reason: string | null) {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, status, fsm_status,
             fsm_modified_at, synced_at)
           VALUES (?1, 'fsm-appt-5', ?2, 'service', '2026-09-20T04:30:00.000Z', '2026-09-20T06:00:00.000Z',
             'terminated', 'Terminated', ?3, ?3)`,
        ).bind(VISIT, PERSON, NOW.toISOString()),
        env.DB.prepare(
          `INSERT INTO visits (id, appointment_id, ended_at, outcome, partial_reason, updated_at)
           VALUES ('visit-row-1', ?1, '2026-09-20T05:40:00.000Z', ?2, ?3, ?4)`,
        ).bind(VISIT, outcome, reason, NOW.toISOString()),
      ]);
    }

    // In the words the reason has on the job sheet: the committed list's, until ops save their own
    // (docs/decisions/0087-consumables-and-stock.md).
    it("waits with the technician's reason, from when he closed it", async () => {
      await closed("partial", "piece_not_ready");
      expect(tasksIn(await tasks(), "partial_visit")).toEqual([
        {
          id: VISIT,
          person: { id: PERSON, name: "Rohit Malhotra" },
          detail: "Hair system not ready",
          since: "2026-09-20T05:40:00.000Z",
          due: "2026-09-22T05:40:00.000Z",
          owner: null,
        },
      ]);
    });

    it("leaves once the client has another visit booked after it, to finish what was left", async () => {
      await closed("partial", "more_time_needed");
      await consultationFor(PERSON, "cancelled");
      await env.DB.prepare("UPDATE appointments SET type = 'service' WHERE id = ?1").bind(CONSULTATION).run();
      expect(groupNames(await tasks())).toEqual(["partial_visit"]);

      await env.DB.prepare("UPDATE appointments SET status = 'scheduled' WHERE id = ?1").bind(CONSULTATION).run();
      expect(groupNames(await tasks())).not.toContain("partial_visit");
    });

    it("is not a no-show, which ops rule on in its own group", async () => {
      await closed("no_show", null);
      expect(groupNames(await tasks())).toEqual([]);
    });
  });

  // A site booking reaches the technician with no place, and the app tells the client "We confirm it with you
  // before your visit"; nobody owned that confirmation.
  describe("a visit to come whose client has given no address", () => {
    /** Booked for tomorrow at 10 am in India; the mirror first had it this morning. */
    async function booked(status = "scheduled", start = "2026-09-22T04:30:00.000Z") {
      await env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, status, fsm_status,
           fsm_modified_at, synced_at, first_seen_at)
         VALUES (?1, 'fsm-appt-6', ?2, 'consultation', ?3, ?3, ?4, 'Scheduled', ?5, ?5, '2026-09-21T03:00:00.000Z')`,
      )
        .bind(VISIT, PERSON, start, status, NOW.toISOString())
        .run();
    }

    it("waits from when we first had the visit, and falls due by the visit at the latest", async () => {
      await booked();
      expect(tasksIn(await tasks(), "address_to_confirm")).toEqual([
        {
          id: VISIT,
          person: { id: PERSON, name: "Rohit Malhotra" },
          detail: "2026-09-22T04:30:00.000Z",
          since: "2026-09-21T03:00:00.000Z",
          // Two days on would be after the visit: the technician needs the address before he sets out.
          due: "2026-09-22T04:30:00.000Z",
          owner: null,
        },
      ]);
    });

    it("leaves once the client has saved an address", async () => {
      await booked();
      await env.DB.prepare(
        `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
         VALUES ('address-1', ?1, ?2, 'House 7', 'Sector 65', 'Gurgaon', '122018')`,
      )
        .bind(PERSON, NOW.toISOString())
        .run();
      expect(groupNames(await tasks())).toEqual([]);
    });

    it("leaves out a visit cancelled, or one already past", async () => {
      await booked("cancelled");
      expect(groupNames(await tasks())).toEqual([]);
      await env.DB.prepare(
        "UPDATE appointments SET status = 'scheduled', window_start = '2026-09-19T04:30:00.000Z'",
      ).run();
      expect(groupNames(await tasks())).toEqual([]);
    });
  });

  // "Move it in Dispatch" opened this week's board with no drawer, wherever the job was.
  it("gives a job on its technician's day off its visit, so the task opens it on the board", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t9', 'fsm-t9', 'Chetan Arora', 'CA', 1, ?1)",
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, technician_id, status,
           fsm_status, fsm_modified_at, synced_at)
         VALUES (?1, 'fsm-appt-11', ?2, 'service', '2026-09-30T05:00:00.000Z', '2026-09-30T06:30:00.000Z',
           't9', 'scheduled', 'Scheduled', ?3, ?3)`,
      ).bind(VISIT, PERSON, NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO technician_leave (id, technician_id, from_date, to_date, actor, created_at)
         VALUES ('leave-1', 't9', '2026-09-30', '2026-09-30', 'ops@localhost', ?1)`,
      ).bind(NOW.toISOString()),
    ]);

    expect(tasksIn(await tasks(), "leave_conflict")).toEqual([
      expect.objectContaining({
        id: VISIT,
        // Only a move the client has not heard of carries the mobile.
        person: { id: PERSON, name: "Rohit Malhotra" },
        visit: { id: VISIT, starts_at: "2026-09-30T05:00:00.000Z" },
      }),
    ]);
  });

  it("counts the tasks whose day has passed, and no others", async () => {
    // Held on the 18th, so due on the 20th: yesterday. The erasure came yesterday and is due on the 27th.
    await heldGrant('["shared_address"]');
    await erasureRequest("requested");
    expect(await tasks()).toMatchObject({ overdue: 1 });
  });

  it("says nothing is waiting when no queue holds anything", async () => {
    // The look itself is logged under Access's stand-in, who has now signed in.
    expect(await tasks()).toEqual({
      overdue: 0,
      truncated: false,
      low_stock_places: 0,
      staff: ["ops@localhost"],
      groups: [],
    });
  });

  it("leaves out an erased person's tasks, whose record is gone", async () => {
    await heldGrant('["shared_address"]');
    await numberChange("awaiting_ops");
    await env.DB.prepare("UPDATE people SET erased_at = ?1 WHERE id = ?2").bind(NOW.toISOString(), PERSON).run();
    expect(groupNames(await tasks())).toEqual([]);
  });

  // A client's page showed nothing open for them while a task about them waited.
  it("lists one client's tasks alone when asked for them, counted as theirs", async () => {
    // Rohit's grant was held on the 18th, so it is overdue; his number change is not. Vikram's grievance is his own.
    await heldGrant('["shared_address"]');
    await numberChange("awaiting_ops");
    await env.DB.prepare(
      `INSERT INTO grievances (id, person_id, text, state, created_at)
       VALUES (?1, ?2, 'Who can see my number?', 'open', '2026-09-20T06:00:00.000Z')`,
    )
      .bind(GRIEVANCE, REFERRED)
      .run();

    const rohits = await (await request(ops, `/api/tasks?person=${PERSON}`)).json<Body>();
    expect(groupNames(rohits)).toEqual(["referral_review", "number_change"]);
    expect(rohits.overdue).toBe(1);
    expect(groupNames(await tasks())).toEqual(["referral_review", "number_change", "grievance"]);
  });

  it("refuses a client that is not named by their id", async () => {
    expect((await request(ops, "/api/tasks?person=rohit")).status).toBe(400);
  });

  it("belongs to the ops surface alone", async () => {
    const client = appFor("local", fakeDependencies(), {}, "client");
    expect((await request(client, "/api/tasks")).status).toBe(404);
  });
});
