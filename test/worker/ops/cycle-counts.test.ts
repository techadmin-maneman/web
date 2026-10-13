// Cycle counts (src/domain/field/cycle-counts.ts, src/routes/ops/count-tasks.ts; docs/decisions/0185-cycle-counts.md).
// NOW is Monday 21 September 2026, 12 noon in India.
//
// What these hold: a task is raised for each class a place holds once its period comes round, and none while one is
// open; a count shows no figure; a count within the tolerance goes into the ledger, one past it is counted again, and a
// recount that still differs waits for a manager's sign-off, ops told; a hair system held under labels is counted by
// them, the labels not scanned gone missing by name; ops start a count of one item; and ops set an item's class.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { raiseCountTasks } from "../../../src/domain/field/cycle-counts.ts";
import { NOW, markDatabase, request } from "../helpers.ts";
import { IMRAN, working, type Working } from "../job-fixtures.ts";
import { classDaysOf, CYCLE_COUNTS } from "../../../src/policy/cycle-counts.ts";

interface Tasks {
  tasks: { id: string; count_class: string; state: string }[];
  classes: { consumable_code: string; count_class: string; set: boolean }[];
}
interface Task {
  task: { state: string };
  items: Record<string, unknown>[];
}

/** The name a hair system's stock code is given from its spec. */
const NAME = "Mane Man Essential 8x10 1B, 20% grey, 100%";

let job: Working;
let code: string;

const tasks = async () => (await request(job.ops, "/api/count-tasks")).json<Tasks>();
const held = async (of: string) =>
  env.DB.prepare("SELECT quantity FROM stock_balances WHERE consumable_code = ?1 AND place = ?2")
    .bind(of, IMRAN)
    .first<number>("quantity");

beforeEach(async () => {
  await markDatabase();
  job = await working();
  await env.DB.prepare(
    `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
     VALUES ('first_fit', 'essential', 'Mane Man Essential', 120, 1, 'test', ?1)`,
  )
    .bind(NOW.toISOString())
    .run();
  await job.opsPost("/api/consumables", { name: "Solvent", unit: "ml", unit_cost: 50 });
  const added = await job.opsPost("/api/hair-systems", {
    product: "essential",
    base_width_in: 8,
    base_length_in: 10,
    colour: "1B",
    grey_percent: 20,
    density_percent: 100,
    unit_cost: 1_200_000,
  });
  code = (await added.json<{ code: string }>()).code;
  await job.opsPost("/api/stock/counts", { consumable_code: "solvent", place_id: IMRAN, counted: 100 });
  await job.opsPost("/api/stock/counts", { consumable_code: code, place_id: IMRAN, counted: 2 });
});

describe("cycle counts", () => {
  it("are raised for each class a place holds once its period comes round, and not while one is open", async () => {
    expect(await raiseCountTasks(env.DB, "2026-09-21", NOW, classDaysOf(CYCLE_COUNTS))).toBe(2);
    expect(await raiseCountTasks(env.DB, "2026-09-22", NOW, classDaysOf(CYCLE_COUNTS))).toBe(0);
    const listed = await tasks();
    expect(listed.tasks.map((task) => task.count_class).sort()).toEqual(["quarterly", "weekly"]);
    expect(listed.classes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ consumable_code: "solvent", count_class: "quarterly", set: false }),
        expect.objectContaining({ consumable_code: code, count_class: "weekly", set: false }),
      ]),
    );
  });

  it("count blind, take what agrees, count again what differs, and leave what stands to a manager", async () => {
    await raiseCountTasks(env.DB, "2026-09-21", NOW, classDaysOf(CYCLE_COUNTS));
    const listed = await tasks();
    const weekly = listed.tasks.find((task) => task.count_class === "weekly")?.id ?? "";
    const quarterly = listed.tasks.find((task) => task.count_class === "quarterly")?.id ?? "";

    const shown = await (await request(job.ops, `/api/count-tasks/${weekly}`)).json<Task>();
    expect(shown.items).toEqual([
      { consumable_code: code, name: NAME, state: "to_count", labelled: false, unknown_labels: [] },
    ]);

    const lines = (counted: number) => ({ lines: [{ consumable_code: code, counted }] });
    const counted = await job.opsPost(`/api/count-tasks/${weekly}/counts`, lines(1));
    expect((await counted.json<Task>()).task.state).toBe("recount");
    expect((await job.opsPost(`/api/count-tasks/${weekly}/counts`, lines(1))).status).toBe(409);
    expect(await held(code)).toBe(2);

    const recounted = await job.opsPost(`/api/count-tasks/${weekly}/recounts`, lines(1));
    expect((await recounted.json<Task>()).task.state).toBe("sign_off");
    const alert = await env.DB.prepare("SELECT key FROM alerts WHERE key = ?1").bind(`count_differs:${weekly}`).first();
    expect(alert).not.toBeNull();
    const differs = await request(job.ops, `/api/count-tasks/${weekly}/differences`);
    expect((await differs.json<{ lines: unknown[] }>()).lines).toEqual([
      { consumable_code: code, name: NAME, held: 2, counted: 1, recounted: 1, missing_labels: [], unknown_labels: [] },
    ]);
    const signed = await job.opsPost(`/api/count-tasks/${weekly}/sign-off`, { note: "One piece not found" });
    expect((await signed.json<Task>()).task.state).toBe("done");
    expect(await held(code)).toBe(1);

    const wrong = await job.opsPost(`/api/count-tasks/${quarterly}/counts`, { lines: [] });
    expect(wrong.status).toBe(400);
    const within = await job.opsPost(`/api/count-tasks/${quarterly}/counts`, {
      lines: [{ consumable_code: "solvent", counted: 97 }],
    });
    expect((await within.json<Task>()).task.state).toBe("done");
    expect(await held("solvent")).toBe(97);
  });

  it("let ops set an item's class, and put it back", async () => {
    const set = await job.opsPost("/api/consumables/solvent/count-class", { count_class: "monthly" });
    const classes = (await set.json<Tasks>()).classes;
    expect(classes.find((item) => item.consumable_code === "solvent")).toMatchObject({
      count_class: "monthly",
      set: true,
    });
    const back = await job.opsPost("/api/consumables/solvent/count-class", { count_class: null });
    expect((await back.json<Tasks>()).classes.find((item) => item.consumable_code === "solvent")).toMatchObject({
      count_class: "quarterly",
      set: false,
    });
    expect((await job.opsPost("/api/consumables/nothing/count-class", { count_class: "weekly" })).status).toBe(404);
  });

  it("refuse a task that is not there, a step out of turn, and a recount of other items; a recount that agrees settles", async () => {
    expect((await request(job.ops, "/api/count-tasks/nothing")).status).toBe(404);
    expect((await request(job.ops, "/api/count-tasks/nothing/differences")).status).toBe(404);
    const lines = (counted: number) => ({ lines: [{ consumable_code: code, counted }] });
    expect((await job.opsPost("/api/count-tasks/nothing/counts", lines(1))).status).toBe(404);
    expect((await job.opsPost("/api/count-tasks/nothing/recounts", lines(1))).status).toBe(404);
    expect((await job.opsPost("/api/count-tasks/nothing/sign-off", { note: "None" })).status).toBe(404);

    await raiseCountTasks(env.DB, "2026-09-21", NOW, classDaysOf(CYCLE_COUNTS));
    const weekly = (await tasks()).tasks.find((task) => task.count_class === "weekly")?.id ?? "";
    expect((await job.opsPost(`/api/count-tasks/${weekly}/recounts`, lines(2))).status).toBe(409);
    expect((await job.opsPost(`/api/count-tasks/${weekly}/sign-off`, { note: "Too soon" })).status).toBe(409);

    await job.opsPost(`/api/count-tasks/${weekly}/counts`, lines(1));
    expect((await job.opsPost(`/api/count-tasks/${weekly}/recounts`, { lines: [] })).status).toBe(400);
    const agreed = await job.opsPost(`/api/count-tasks/${weekly}/recounts`, lines(2));
    expect((await agreed.json<Task>()).task.state).toBe("done");
    expect(await held(code)).toBe(2);
    const alert = await env.DB.prepare("SELECT key FROM alerts WHERE key = ?1").bind(`count_differs:${weekly}`).first();
    expect(alert).toBeNull();
  });

  it("count a hair system held under labels by scanning them: one not scanned goes missing by name", async () => {
    const labelled = await job.opsPost("/api/stock/units", { consumable_code: code, place_id: IMRAN, quantity: 2 });
    const labels = (await labelled.json<{ units: { code: string }[] }>()).units.map((unit) => unit.code).sort();
    const [kept = "", lost = ""] = labels;
    await raiseCountTasks(env.DB, "2026-09-21", NOW, classDaysOf(CYCLE_COUNTS));
    const weekly = (await tasks()).tasks.find((task) => task.count_class === "weekly")?.id ?? "";
    const shown = await (await request(job.ops, `/api/count-tasks/${weekly}`)).json<Task>();
    expect(shown.items[0]).toMatchObject({ labelled: true });

    const byNumber = await job.opsPost(`/api/count-tasks/${weekly}/counts`, {
      lines: [{ consumable_code: code, counted: 2 }],
    });
    expect(await byNumber.json()).toMatchObject({ error: { fields: ["lines.0.labels"] } });

    // The piece labelled first is there and the second is not; a label from elsewhere is scanned as well.
    const scanned = { consumable_code: code, counted: 2, labels: [kept, "MM-ESS-0009999-K"] };
    const counted = await job.opsPost(`/api/count-tasks/${weekly}/counts`, { lines: [scanned] });
    const answer = await counted.json<Task>();
    expect(answer.task.state).toBe("recount");
    expect(answer.items[0]).toMatchObject({ unknown_labels: ["MM-ESS-0009999-K"] });

    const again = { consumable_code: code, counted: 1, labels: [kept] };
    await job.opsPost(`/api/count-tasks/${weekly}/recounts`, { lines: [again] });
    const differs = await request(job.ops, `/api/count-tasks/${weekly}/differences`);
    expect((await differs.json<{ lines: unknown[] }>()).lines).toEqual([
      expect.objectContaining({ missing_labels: [lost], unknown_labels: [] }),
    ]);
    await job.opsPost(`/api/count-tasks/${weekly}/sign-off`, { note: "One piece not found" });
    expect(await held(code)).toBe(1);
    const states = await env.DB.prepare("SELECT code, state FROM stock_units ORDER BY code").all();
    expect(states.results).toEqual([
      { code: kept, state: "held" },
      { code: lost, state: "missing" },
    ]);
  });

  it("start a count of one item now, which the morning's tasks leave be", async () => {
    const start = (body: unknown) => job.opsPost("/api/count-tasks", body);
    const started = await start({ place_id: IMRAN, consumable_code: "solvent" });
    expect(started.status).toBe(201);
    const task = await started.json<Task & { task: { id: string; item: unknown } }>();
    expect(task.task.item).toEqual({ consumable_code: "solvent", name: "Solvent" });
    expect(task.items.map((item) => item.consumable_code)).toEqual(["solvent"]);
    expect((await (await start({ place_id: IMRAN, consumable_code: "solvent" })).json<typeof task>()).task.id).toBe(
      task.task.id,
    );

    await env.DB.prepare("UPDATE stock_balances SET quantity = 0 WHERE consumable_code = ?1").bind(code).run();
    expect((await start({ place_id: IMRAN, consumable_code: code })).status).toBe(400);
    expect((await start({ place_id: "nowhere", consumable_code: "solvent" })).status).toBe(404);

    // The quarterly task is raised as ever beside the one started.
    expect(await raiseCountTasks(env.DB, "2026-09-21", NOW, classDaysOf(CYCLE_COUNTS))).toBe(1);
  });
});
