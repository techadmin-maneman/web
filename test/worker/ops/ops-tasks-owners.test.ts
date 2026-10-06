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
import { NEXT_VISIT_DAYS } from "../../../src/policy/next-visit.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import {
  PERSON,
  REFERRED,
  OTHER,
  VISIT,
  CONSULTATION,
  GRIEVANCE,
  asServiceToken,
  person,
  grievance,
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

beforeEach(async () => {
  captureLogs();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await markDatabase();
  await person(PERSON, "Rohit Malhotra", "+919810000001");
  await person(REFERRED, "Vikram Sethi", "+919810000002");
});

// Whose each task is (docs/decisions/0092-task-owners.md): ops take one, give it to another member of staff by their
// Access e-mail, or hand it back. Kept by the task's group and the id of its row, never as a copy of the task.
describe("PUT /api/tasks/{group}/{id}/owner", () => {
  const ORIGIN = { Origin: "https://maneman.test", "Content-Type": "application/json" };
  /** Signed in locally as Access's stand-in, whom every call to the console logs (src/http/audit.ts). */
  const ME = "ops@localhost";
  const PRIYA = "priya@maneman.in";

  const ownerOf = (group: string, id: string, owner: string | null) =>
    request(ops, `/api/tasks/${group}/${id}/owner`, {
      method: "PUT",
      headers: ORIGIN,
      body: JSON.stringify({ owner }),
    });

  /** A member of staff who has signed in to the console before, yesterday unless `at` says: the log says so. */
  async function signedIn(email: string, at = "2026-09-20T06:00:00.000Z") {
    await env.DB.prepare(
      `INSERT INTO audit_log (at, surface, actor_kind, actor, action, request_id, detail)
       VALUES (?2, 'ops', 'staff', ?1, 'ops.call', 'r', '{}')`,
    )
      .bind(email, at)
      .run();
  }

  const ownersIn = async (group: string) => tasksIn(await tasks(), group).map((task) => task.owner);

  const audited = async () =>
    (
      await env.DB.prepare(
        "SELECT actor, action, subject_kind, subject_id, detail FROM audit_log WHERE action LIKE 'task.%' ORDER BY id",
      ).all()
    ).results;

  it("names nobody until ops make a task someone's, and lists the staff who have signed in", async () => {
    await grievance(GRIEVANCE);
    await signedIn(PRIYA);
    const body = await tasks();
    expect(tasksIn(body, "grievance")).toMatchObject([{ id: GRIEVANCE, owner: null }]);
    expect(body.staff).toEqual([ME, PRIYA]);
  });

  it("makes a task theirs who takes it, says so on the board, and audits it", async () => {
    await grievance(GRIEVANCE);
    const answer = await ownerOf("grievance", GRIEVANCE, ME);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ owner: ME });
    expect(await ownersIn("grievance")).toEqual([ME]);
    expect(await audited()).toEqual([
      {
        actor: ME,
        action: "task.assign",
        subject_kind: "task",
        subject_id: GRIEVANCE,
        detail: JSON.stringify({ group: "grievance", owner: ME }),
      },
    ]);
  });

  it("gives a task to another member of staff who has signed in, in whatever case it is typed", async () => {
    await grievance(GRIEVANCE);
    await signedIn(PRIYA);
    expect((await ownerOf("grievance", GRIEVANCE, "Priya@Maneman.in")).status).toBe(200);
    expect(await ownersIn("grievance")).toEqual([PRIYA]);
    // Given again, to the same member of staff: nothing changes, and nothing more is logged.
    expect((await ownerOf("grievance", GRIEVANCE, PRIYA)).status).toBe(200);
    expect(await audited()).toHaveLength(1);
  });

  it("refuses an e-mail nobody has signed in to the console with, which would make the task nobody's", async () => {
    await grievance(GRIEVANCE);
    const answer = await ownerOf("grievance", GRIEVANCE, "priya@maneman.com");
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["owner"] } });
    expect(await ownersIn("grievance")).toEqual([null]);
  });

  it("hands a task back, to nobody, and audits it", async () => {
    await grievance(GRIEVANCE);
    await ownerOf("grievance", GRIEVANCE, ME);
    const answer = await ownerOf("grievance", GRIEVANCE, null);
    expect(await answer.json()).toEqual({ owner: null });
    expect(await ownersIn("grievance")).toEqual([null]);
    expect((await audited()).map((entry) => entry.action)).toEqual(["task.assign", "task.hand_back"]);
  });

  it("refuses a task that is not on the board, done already or never there", async () => {
    await grievance(GRIEVANCE);
    await env.DB.prepare("UPDATE grievances SET state = 'resolved'").run();
    expect((await ownerOf("grievance", GRIEVANCE, ME)).status).toBe(404);
    expect((await ownerOf("referral_review", GRIEVANCE, ME)).status).toBe(404);
    expect(await audited()).toEqual([]);
  });

  // One visit can be two tasks, as a job on a day off with no address is: each has its own owner.
  it("gives an owner to the one task, not to another about the same row", async () => {
    await person(OTHER, "Karan Bhatia", "+919810000003");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t9', 'fsm-t9', 'Chetan Arora', 'CA', 1, ?1)",
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, technician_id, status,
           fsm_status, fsm_modified_at, synced_at)
         VALUES (?1, 'fsm-appt-11', ?2, 'service', '2026-09-23T05:00:00.000Z', '2026-09-23T06:30:00.000Z',
           't9', 'scheduled', 'Scheduled', ?3, ?3)`,
      ).bind(VISIT, OTHER, NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO technician_leave (id, technician_id, from_date, to_date, actor, created_at)
         VALUES ('leave-1', 't9', '2026-09-23', '2026-09-23', 'ops@localhost', ?1)`,
      ).bind(NOW.toISOString()),
    ]);
    await ownerOf("leave_conflict", VISIT, ME);
    expect(await ownersIn("leave_conflict")).toEqual([ME]);
    expect(await ownersIn("address_to_confirm")).toEqual([null]);
  });

  // Staff who have left keep their e-mail in the log for ever; only those seen lately may be given a task.
  it("offers only the staff seen in the last 90 days, and keeps an older owner until the task is handed on", async () => {
    await grievance(GRIEVANCE);
    await signedIn(PRIYA);
    await signedIn("anil@maneman.in", "2026-06-20T06:00:00.000Z"); // 93 days before NOW
    expect((await tasks()).staff).toEqual([ME, PRIYA]);
    expect((await ownerOf("grievance", GRIEVANCE, "anil@maneman.in")).status).toBe(400);

    // Given to Anil while he was about, the task still says so, and may be handed on or back.
    await env.DB.prepare(
      `INSERT INTO task_owners (task_group, subject_id, episode, owner, assigned_by, assigned_at)
       VALUES ('grievance', ?1, '', 'anil@maneman.in', 'ops@localhost', '2026-06-20T06:00:00.000Z')`,
    )
      .bind(GRIEVANCE)
      .run();
    expect(await ownersIn("grievance")).toEqual(["anil@maneman.in"]);
    expect((await ownerOf("grievance", GRIEVANCE, PRIYA)).status).toBe(200);
    expect(await ownersIn("grievance")).toEqual([PRIYA]);
  });

  // A service token is let in by Access, and names no member of staff to keep a task under.
  it("gives or hands back nothing for a service token", async () => {
    await grievance(GRIEVANCE);
    const answer = await request(asServiceToken(), `/api/tasks/grievance/${GRIEVANCE}/owner`, {
      method: "PUT",
      headers: ORIGIN,
      body: JSON.stringify({ owner: ME }),
    });
    expect(answer.status).toBe(403);
    expect(await answer.json()).toMatchObject({ error: { code: "access_required" } });
    expect(await ownersIn("grievance")).toEqual([null]);
  });

  // Where a task's row can be a task again once it has left, the one after is a new task, and nobody's
  // (docs/decisions/0092-task-owners.md).
  describe("a new task on a row that was a task before", () => {
    const LATER = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString();

    async function leave(id: string, day: string, at: string) {
      await env.DB.prepare(
        `INSERT INTO technician_leave (id, technician_id, from_date, to_date, actor, created_at)
         VALUES (?1, 't9', ?2, ?2, 'ops@localhost', ?3)`,
      )
        .bind(id, day, at)
        .run();
    }

    async function visitOf(id: string, type: string, start: string, status = "completed") {
      await env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, status, fsm_status,
           fsm_modified_at, synced_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?6, ?7, ?7)`,
      )
        .bind(id, `fsm-${id}`, PERSON, type, start, status, NOW.toISOString())
        .run();
    }

    it("a moved job's new conflict has no owner", async () => {
      await person(OTHER, "Karan Bhatia", "+919810000003");
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t9', 'fsm-t9', 'Chetan Arora', 'CA', 1, ?1)",
        ).bind(NOW.toISOString()),
        env.DB.prepare(
          `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, technician_id, status,
             fsm_status, fsm_modified_at, synced_at)
           VALUES (?1, 'fsm-appt-11', ?2, 'service', '2026-09-23T05:00:00.000Z', '2026-09-23T06:30:00.000Z',
             't9', 'scheduled', 'Scheduled', ?3, ?3)`,
        ).bind(VISIT, OTHER, NOW.toISOString()),
      ]);
      await leave("leave-1", "2026-09-23", NOW.toISOString());
      await ownerOf("leave_conflict", VISIT, ME);
      expect(await ownersIn("leave_conflict")).toEqual([ME]);

      // Ops move the job to the 26th, and the task leaves; leave Chetan takes on the 26th later is a new conflict.
      await env.DB.prepare(
        "UPDATE appointments SET window_start = '2026-09-26T05:00:00.000Z', window_end = '2026-09-26T06:30:00.000Z'",
      ).run();
      expect(groupNames(await tasks())).not.toContain("leave_conflict");
      await leave("leave-2", "2026-09-26", LATER);
      expect(await ownersIn("leave_conflict")).toEqual([null]);
    });

    // Its start moves with the days ops set, and it is still the same consultation to follow up.
    it("keeps the owner of a first fit to book when ops change the days it waits", async () => {
      await visitOf(CONSULTATION, "consultation", "2026-09-10T04:30:00.000Z");
      await ownerOf("first_fit_to_book", PERSON, ME);
      expect(await ownersIn("first_fit_to_book")).toEqual([ME]);

      await env.DB.prepare(
        "INSERT INTO ops_settings (name, value, set_by, set_at) VALUES ('booking_days', ?1, 'ops@localhost', ?2)",
      )
        .bind(JSON.stringify({ ...NEXT_VISIT_DAYS, first_fit_to_book: 3 }), NOW.toISOString())
        .run();
      const freshConsole = appFor("local", fakeDependencies(), {}, "ops");
      const board = await (await request(freshConsole, "/api/tasks")).json<Body>();
      expect(tasksIn(board, "first_fit_to_book")).toMatchObject([
        { id: PERSON, owner: ME, since: "2026-09-12T18:30:00.000Z" },
      ]);
    });

    // Moved to another time or another day under the same leave, the job still clashes with it: the same conflict.
    it("keeps the owner of a job moved within the leave it clashes with", async () => {
      await person(OTHER, "Karan Bhatia", "+919810000003");
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t9', 'fsm-t9', 'Chetan Arora', 'CA', 1, ?1)",
        ).bind(NOW.toISOString()),
        env.DB.prepare(
          `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, technician_id, status,
             fsm_status, fsm_modified_at, synced_at)
           VALUES (?1, 'fsm-appt-11', ?2, 'service', '2026-09-23T05:00:00.000Z', '2026-09-23T06:30:00.000Z',
             't9', 'scheduled', 'Scheduled', ?3, ?3)`,
        ).bind(VISIT, OTHER, NOW.toISOString()),
        env.DB.prepare(
          `INSERT INTO technician_leave (id, technician_id, from_date, to_date, actor, created_at)
           VALUES ('leave-1', 't9', '2026-09-23', '2026-09-27', 'ops@localhost', ?1)`,
        ).bind(NOW.toISOString()),
      ]);
      await ownerOf("leave_conflict", VISIT, ME);

      // From 10:30 to 2:30 pm the same day, then to the 26th, all within Chetan's leave of the 23rd to the 27th.
      for (const [start, end] of [
        ["2026-09-23T09:00:00.000Z", "2026-09-23T10:30:00.000Z"],
        ["2026-09-26T05:00:00.000Z", "2026-09-26T06:30:00.000Z"],
      ]) {
        await env.DB.prepare("UPDATE appointments SET window_start = ?1, window_end = ?2").bind(start, end).run();
        expect(await ownersIn("leave_conflict")).toEqual([ME]);
      }
    });

    it("a first fit to book after a later consultation has no owner", async () => {
      await visitOf(CONSULTATION, "consultation", "2026-08-01T04:30:00.000Z");
      await ownerOf("first_fit_to_book", PERSON, ME);

      // Fitted, the task leaves; consulted again and not fitted since, the client is a new task.
      await visitOf("the-fit", "first_fit", "2026-08-10T04:30:00.000Z");
      expect(groupNames(await tasks())).not.toContain("first_fit_to_book");
      await visitOf("consulted-again", "consultation", "2026-09-10T04:30:00.000Z");
      expect(tasksIn(await tasks(), "first_fit_to_book")).toMatchObject([{ id: PERSON, owner: null }]);
    });

    // Its thing undone, a task comes back as it was: a booking called off leaves the client at risk from the same visit.
    it("keeps the owner of a task that comes back when its thing is undone", async () => {
      await visitOf(VISIT, "service", "2026-08-01T04:30:00.000Z");
      await ownerOf("at_risk_client", VISIT, ME);
      await visitOf("booked", "service", "2026-09-25T04:30:00.000Z", "scheduled");
      expect(groupNames(await tasks())).not.toContain("at_risk_client");
      await env.DB.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = 'booked'").run();
      expect(await ownersIn("at_risk_client")).toEqual([ME]);
    });
  });

  it("belongs to the ops surface alone", async () => {
    const client = appFor("local", fakeDependencies(), {}, "client");
    const answer = await request(client, `/api/tasks/grievance/${GRIEVANCE}/owner`, {
      method: "PUT",
      headers: ORIGIN,
      body: JSON.stringify({ owner: ME }),
    });
    expect(answer.status).toBe(404);
  });
});
