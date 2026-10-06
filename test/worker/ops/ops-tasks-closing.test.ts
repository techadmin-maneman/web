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
import { enforce, listStaff, opsAs, person as staffPerson } from "./staff-fixtures.ts";
import {
  PERSON,
  REFERRED,
  VISIT,
  CASE,
  GRIEVANCE,
  asServiceToken,
  person,
  heldGrant,
  noShowCase,
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

// A visit left partly done waits for the visit that finishes it; the client may never want one, so ops close its
// task without a follow-up, with why, kept under who closed it (docs/decisions/0092-task-owners.md).
describe("POST /api/tasks/{group}/{id}/close", () => {
  const ORIGIN = { Origin: "https://maneman.test", "Content-Type": "application/json" };
  const LATER_VISIT = "22222222-2222-4222-8222-222222222229";
  const WHY = "Client does not want the rest done; asked us not to call again.";

  const close = (group: string, id: string, body: unknown) =>
    request(ops, `/api/tasks/${group}/${id}/close`, { method: "POST", headers: ORIGIN, body: JSON.stringify(body) });

  /** A service visit of Rohit's, closed partly done, its start `start`. */
  async function leftPartlyDone(id: string, start: string) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, status, fsm_status,
           fsm_modified_at, synced_at)
         VALUES (?1, ?2, ?3, 'service', ?4, ?4, 'terminated', 'Terminated', ?5, ?5)`,
      ).bind(id, `fsm-${id}`, PERSON, start, NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO visits (id, appointment_id, ended_at, outcome, partial_reason, updated_at)
         VALUES (?1, ?2, ?3, 'partial', 'client_unwell', ?3)`,
      ).bind(`visit-row-${id}`, id, start),
    ]);
  }

  const closures = async () =>
    (await env.DB.prepare("SELECT task_group, subject_id, reason, closed_by, closed_at FROM task_closures").all())
      .results;

  it("closes a visit left partly done, with why, kept under who closed it and audited", async () => {
    await leftPartlyDone(VISIT, "2026-09-20T04:30:00.000Z");
    const answer = await close("partial_visit", VISIT, { reason: `  ${WHY}  ` });
    expect(answer.status).toBe(204);
    expect(groupNames(await tasks())).toEqual([]);
    expect(await closures()).toEqual([
      {
        task_group: "partial_visit",
        subject_id: VISIT,
        reason: WHY,
        closed_by: "ops@localhost",
        closed_at: NOW.toISOString(),
      },
    ]);
    // The entry names the task; the reason, ops' words about the client, stays with the closing (ADR 0072).
    const entries = await env.DB.prepare(
      "SELECT actor, subject_kind, subject_id, detail FROM audit_log WHERE action = 'task.close'",
    ).all();
    expect(entries.results).toEqual([
      {
        actor: "ops@localhost",
        subject_kind: "task",
        subject_id: VISIT,
        detail: JSON.stringify({ group: "partial_visit" }),
      },
    ]);
  });

  it("refuses to close one without a reason, or with more than a sentence or two", async () => {
    await leftPartlyDone(VISIT, "2026-09-20T04:30:00.000Z");
    for (const body of [{}, { reason: "" }, { reason: "   " }, { reason: "x".repeat(301) }]) {
      const answer = await close("partial_visit", VISIT, body);
      expect(answer.status).toBe(400);
      expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["reason"] } });
    }
    expect(groupNames(await tasks())).toEqual(["partial_visit"]);
    expect(await closures()).toEqual([]);
  });

  it("closes nothing for a service token, which names no member of staff to keep the reason under", async () => {
    await leftPartlyDone(VISIT, "2026-09-20T04:30:00.000Z");
    const answer = await request(asServiceToken(), `/api/tasks/partial_visit/${VISIT}/close`, {
      method: "POST",
      headers: ORIGIN,
      body: JSON.stringify({ reason: WHY }),
    });
    expect(answer.status).toBe(403);
    expect(await closures()).toEqual([]);
  });

  it("closes no other group's task, which leaves only when its thing is done", async () => {
    await grievance(GRIEVANCE);
    expect((await close("grievance", GRIEVANCE, { reason: WHY })).status).toBe(400);
    expect(groupNames(await tasks())).toEqual(["grievance"]);
  });

  it("refuses a task no longer on the board, one closed already among them", async () => {
    await leftPartlyDone(VISIT, "2026-09-20T04:30:00.000Z");
    expect((await close("partial_visit", VISIT, { reason: WHY })).status).toBe(204);
    expect((await close("partial_visit", VISIT, { reason: "Again" })).status).toBe(404);
    expect(await closures()).toHaveLength(1);
  });

  it("stays closed, and a visit left partly done after it is a task of its own", async () => {
    await leftPartlyDone(VISIT, "2026-09-10T04:30:00.000Z");
    await close("partial_visit", VISIT, { reason: WHY });
    await leftPartlyDone(LATER_VISIT, "2026-09-20T04:30:00.000Z");
    expect(tasksIn(await tasks(), "partial_visit").map((task) => task.id)).toEqual([LATER_VISIT]);
  });
});

// Once the Staff list is enforced, each department sees the groups it decides, and takes a task only with Act there.
describe("the board by department, once the Staff list is enforced", () => {
  const CARE = "care@maneman.in";
  const MONEY = "money@maneman.in";

  const boardOf = async (email: string): Promise<Body> =>
    (await request(opsAs(staffPerson(email)), "/api/tasks")).json();

  const take = (email: string, group: string, id: string) =>
    request(opsAs(staffPerson(email)), `/api/tasks/${group}/${id}/owner`, {
      method: "PUT",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
      body: JSON.stringify({ owner: email }),
    });

  beforeEach(async () => {
    await enforce();
    await noShowCase("undecided");
    await grievance(GRIEVANCE);
    await heldGrant('["shared_address"]');
  });

  it("shows each person only the groups of the departments they hold", async () => {
    await listStaff(MONEY, ["finance:view:national"]);
    await listStaff(CARE, ["customer_care:act:national", "growth:view:national"]);

    expect(groupNames(await boardOf(MONEY))).toEqual(["no_show_decision"]);
    expect(groupNames(await boardOf(CARE))).toEqual(["referral_review", "grievance"]);
  });

  it("lets a task be taken with Act in its group's department, and refuses one of another department's", async () => {
    await listStaff(CARE, ["customer_care:act:national", "finance:view:national"]);

    expect((await take(CARE, "grievance", GRIEVANCE)).status).toBe(200);
    const refused = await take(CARE, "no_show_decision", CASE);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "not_permitted" } });
    expect(tasksIn(await boardOf(CARE), "grievance").map((task) => task.owner)).toEqual([CARE]);
  });

  it("refuses the board to a person on the list with no grant", async () => {
    await listStaff("new.joiner@maneman.in", []);
    expect((await request(opsAs(staffPerson("new.joiner@maneman.in")), "/api/tasks")).status).toBe(403);
  });
});
