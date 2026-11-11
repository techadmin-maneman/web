// A technician's asks of ops from the phone (docs/decisions/0249-schedule-kit-and-me.md): what the kit is short of for
// the next seven days, and a visit to move, with why. Each is a task on the board until ops close it; a visit moved
// settles its own. NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { markDatabase, request } from "../helpers.ts";
import { IMRAN, JOB, SAMEER, working, type Working } from "../job-fixtures.ts";

let job: Working;

interface Task {
  readonly id: string;
  readonly facts: Record<string, unknown>;
}

const tasksOf = async (group: string): Promise<Task[]> => {
  const board = await (await request(job.ops, "/api/tasks")).json<{ groups: { group: string; tasks: Task[] }[] }>();
  return board.groups.find((each) => each.group === group)?.tasks ?? [];
};

const kit = async () => (await job.get("/api/tech/kit")).json<{ asked: unknown }>();
const card = async () => (await job.get(`/api/tech/jobs/${JOB}`)).json<{ reschedule_asked: unknown }>();

beforeEach(async () => {
  await markDatabase();
  job = await working("service");
});

describe("a kit request", () => {
  beforeEach(async () => {
    await job.opsPost("/api/consumables", { name: "Solvent", unit: "ml", unit_cost: 50 });
    await job.opsPost("/api/service-usage", {
      visit_type: "service",
      tier: "standard",
      items: [{ code: "solvent", quantity: 10 }],
    });
    await job.opsPost("/api/stock/counts", { consumable_code: "solvent", place_id: IMRAN, counted: 4 });
  });

  it("asks ops for what the week ahead finds short, once, and is a task until ops close it", async () => {
    const asked = await job.post("/api/tech/kit/requests", undefined, "kit-ask");
    expect(asked.status).toBe(200);
    expect((await asked.json<{ asked: unknown }>()).asked).toMatchObject({
      items: [{ name: "Solvent", unit: "ml", quantity: 6 }],
    });
    // A second tap is the same ask.
    await job.post("/api/tech/kit/requests", undefined, "kit-ask-2");
    const [task, ...more] = await tasksOf("kit_request");
    expect(more).toEqual([]);
    expect(task?.facts).toMatchObject({
      technician: "Imran Qureshi",
      items: [{ name: "Solvent", unit: "ml", quantity: 6 }],
    });

    const closed = await job.opsPost(`/api/tasks/kit_request/${task?.id ?? ""}/close`, {
      reason: "In Friday's transfer",
    });
    expect(closed.status).toBe(204);
    expect((await kit()).asked).toBeNull();
    expect(await tasksOf("kit_request")).toEqual([]);
  });

  it("is refused where the week ahead finds nothing short", async () => {
    await job.opsPost("/api/stock/counts", { consumable_code: "solvent", place_id: IMRAN, counted: 40 });
    expect((await job.post("/api/tech/kit/requests", undefined, "kit-ask")).status).toBe(409);
    expect((await kit()).asked).toBeNull();
  });
});

describe("an ask to reschedule", () => {
  const ask = (reason = "client_asked", event = "reschedule") =>
    job.post(`/api/tech/jobs/${JOB}/reschedule-request`, { reason }, event);

  it("is kept on the card and is a task for ops, once however often it is asked", async () => {
    const asked = await ask();
    expect(asked.status).toBe(200);
    expect(await asked.json()).toMatchObject({ reason: "client_asked" });
    expect((await ask("running_late", "reschedule-2")).status).toBe(200);
    expect((await card()).reschedule_asked).toMatchObject({ reason: "client_asked" });
    const [task, ...more] = await tasksOf("reschedule_request");
    expect(more).toEqual([]);
    expect(task?.facts).toMatchObject({ kind: "service", technician: "Imran Qureshi", reason: "client_asked" });
  });

  it("is settled once ops move the visit, or close the task", async () => {
    await ask();
    await env.DB.prepare("UPDATE appointments SET window_start = '2026-09-22T05:00:00.000Z' WHERE id = ?1")
      .bind(JOB)
      .run();
    expect((await card()).reschedule_asked).toBeNull();
    expect(await tasksOf("reschedule_request")).toEqual([]);

    await ask("kit_problem", "reschedule-2");
    const [task] = await tasksOf("reschedule_request");
    const closed = await job.opsPost(`/api/tasks/reschedule_request/${task?.id ?? ""}/close`, {
      reason: "Client keeps the time",
    });
    expect(closed.status).toBe(204);
    expect((await card()).reschedule_asked).toBeNull();
  });

  it("is settled once the visit is given to another technician, closed or called off", async () => {
    for (const change of [
      "technician_id = '33333333-3333-4333-8333-333333333332'",
      "status = 'completed'",
      "status = 'cancelled'",
    ]) {
      await env.DB.prepare(
        "UPDATE appointments SET technician_id = ?2, status = 'scheduled', window_start = '2026-09-21T07:30:00.000Z' WHERE id = ?1",
      )
        .bind(JOB, IMRAN)
        .run();
      await env.DB.prepare(
        "UPDATE reschedule_requests SET settled_at = '2026-09-21T06:00:00.000Z' WHERE settled_at IS NULL",
      ).run();
      expect((await ask("client_asked", `ask-${change}`)).status).toBe(200);
      await env.DB.prepare(`UPDATE appointments SET ${change} WHERE id = ?1`).bind(JOB).run();
      const { results } = await env.DB.prepare(
        "SELECT id FROM reschedule_requests WHERE appointment_id = ?1 AND settled_at IS NULL",
      )
        .bind(JOB)
        .all();
      expect(results, change).toEqual([]);
    }
  });

  it("is refused for a visit not the technician's, or one called off", async () => {
    await env.DB.prepare("UPDATE appointments SET technician_id = ?2 WHERE id = ?1").bind(JOB, SAMEER).run();
    expect((await ask()).status).toBe(404);
    await env.DB.prepare("UPDATE appointments SET technician_id = ?2, status = 'cancelled' WHERE id = ?1")
      .bind(JOB, IMRAN)
      .run();
    expect((await ask()).status).toBe(409);
  });
});
