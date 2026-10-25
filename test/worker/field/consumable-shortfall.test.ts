// A job short of the consumables its service expects says why, and ops are given a task to check it against the kit
// (src/policy/consumable-shortfall.ts, ADR 0222). NOW is Monday 21 September 2026, 12 noon in India. Every name and
// number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { markDatabase, request } from "../helpers.ts";
import { JOB, working, type Working } from "../job-fixtures.ts";

let job: Working;

const step = (body: unknown, event = "event-consumables-01") =>
  job.post(`/api/tech/jobs/${JOB}/consumables`, body, event);

interface Task {
  readonly id: string;
  readonly facts: { reason?: string; technician?: string; short?: unknown[] };
}

const shortTasks = async (): Promise<Task[]> => {
  const board = await (await request(job.ops, "/api/tasks")).json<{ groups: { group: string; tasks: Task[] }[] }>();
  return board.groups.find((each) => each.group === "consumables_short")?.tasks ?? [];
};

beforeEach(async () => {
  await markDatabase();
  job = await working();
  for (const consumable of [
    { name: "Tape strips", unit: "strip", unit_cost: 1200 },
    { name: "Solvent", unit: "ml", unit_cost: 50 },
  ]) {
    expect((await job.opsPost("/api/consumables", consumable)).status).toBe(200);
  }
  await job.opsPost("/api/service-usage", {
    visit_type: "service",
    tier: "standard",
    items: [
      { code: "tape_strips", quantity: 4 },
      { code: "solvent", quantity: 10 },
    ],
  });
  await job.workTo("consumables");
});

describe("a job short of what its service expects", () => {
  it("is refused without a reason, and taken with one, which gives ops a task naming what was short", async () => {
    const short = { items: [{ code: "tape_strips", quantity: 4 }] };
    const refused = await step(short);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: { code: "invalid_request", fields: ["short_reason"] } });
    expect(await shortTasks()).toEqual([]);

    expect((await step({ ...short, short_reason: "ran_out" })).status).toBe(202);
    const [task] = await shortTasks();
    expect(task).toMatchObject({
      id: JOB,
      facts: { reason: "ran_out", short: [{ name: "Solvent", expected: 10, used: 0 }] },
    });
  });

  it("owes a reason for nothing used at all, and none for what was expected", async () => {
    expect((await step({ items: [] })).status).toBe(400);
    const asExpected = {
      items: [
        { code: "tape_strips", quantity: 4 },
        { code: "solvent", quantity: 10 },
      ],
    };
    expect((await step(asExpected)).status).toBe(202);
    expect(await shortTasks()).toEqual([]);
  });

  it("takes the task away when a corrected step is no longer short", async () => {
    await step({ items: [], short_reason: "client_supplies" });
    expect(await shortTasks()).toHaveLength(1);
    const corrected = {
      items: [
        { code: "tape_strips", quantity: 4 },
        { code: "solvent", quantity: 10 },
      ],
    };
    expect((await step(corrected, "event-consumables-02")).status).toBe(202);
    expect(await shortTasks()).toEqual([]);
  });

  it("leaves the board once ops close it, checked against the kit", async () => {
    await step({ items: [], short_reason: "other" });
    const closed = await job.opsPost(`/api/tasks/consumables_short/${JOB}/close`, { reason: "Kit counted, all there" });
    expect(closed.status).toBe(204);
    expect(await shortTasks()).toEqual([]);
    const row = await env.DB.prepare("SELECT settled_at FROM consumable_shortfalls WHERE appointment_id = ?1")
      .bind(JOB)
      .first<{ settled_at: string | null }>();
    expect(row?.settled_at).not.toBeNull();
  });
});
