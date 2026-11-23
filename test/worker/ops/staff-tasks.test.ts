// Tasks ops write themselves on Tasks (docs/decisions/0302-tasks-written-by-hand.md): written for a department, on its
// board as that department's group, due when written for, its words never in the log, and marked done by Act in that
// department. NOW is the helpers' fixed moment. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { DAY_MS } from "../../../src/lib/durations.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { enforce, listStaff, opsAs, person as staffPerson, post } from "./staff-fixtures.ts";
import { PERSON, person } from "./ops-tasks-fixtures.ts";

const CARE = "farah.khan@maneman.in";
const MONEY = "dev.malik@maneman.in";
const TOMORROW = new Date(NOW.getTime() + DAY_MS).toISOString();

interface Board {
  readonly groups: readonly {
    readonly group: string;
    readonly tasks: readonly { id: string; detail: string | null; due: string; owner: string | null }[];
  }[];
}

const as = (email: string): App => opsAs(staffPerson(email));
const boardOf = async (email: string): Promise<Board> => (await request(as(email), "/api/tasks")).json();
const tasksIn = (board: Board, group: string) => board.groups.find((each) => each.group === group)?.tasks ?? [];

const write = (email: string, body: Record<string, unknown>) =>
  post(as(email), "/api/tasks", {
    what: "Call back about the evening slot",
    department: "customer_care",
    client: PERSON,
    city: null,
    due: TOMORROW,
    owner: null,
    ...body,
  });

const done = (email: string, id: string) => post(as(email), `/api/tasks/staff/${id}/done`, {});

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  appFor("local", fakeDependencies(), {}, "ops");
  await person(PERSON, "Rohit Malhotra", "+919810000001");
});

describe("a task written by hand", () => {
  it("is on its department's board, its words its line, due when it was written for, and none of it in the log", async () => {
    const written = await write(CARE, {});
    expect(written.status).toBe(201);
    const { id } = await written.json<{ id: string }>();

    const [task] = tasksIn(await boardOf(CARE), "staff_task_customer_care");
    expect(task).toMatchObject({ id, detail: "Call back about the evening slot", due: TOMORROW, owner: null });
    const logged = await env.DB.prepare("SELECT action, detail FROM audit_log WHERE action = 'task.write'").all();
    expect(logged.results).toEqual([
      { action: "task.write", detail: JSON.stringify({ group: "staff_task_customer_care" }) },
    ]);
  });

  it("is theirs at once when written for someone who uses the console", async () => {
    await boardOf(CARE);
    const { id } = await (await write(CARE, { owner: CARE.toUpperCase() })).json<{ id: string }>();
    expect(tasksIn(await boardOf(CARE), "staff_task_customer_care")).toEqual([
      expect.objectContaining({ id, owner: CARE }),
    ]);
  });

  it("refuses a due time past, an owner who has not used the console, and words past their length", async () => {
    const past = await write(CARE, { due: new Date(NOW.getTime() - DAY_MS).toISOString() });
    expect(past.status).toBe(400);
    expect(await past.json()).toMatchObject({ error: { code: "invalid_request", fields: ["due"] } });

    const stranger = await write(CARE, { owner: "nobody@maneman.in" });
    expect(await stranger.json()).toMatchObject({ error: { code: "invalid_request", fields: ["owner"] } });

    expect((await write(CARE, { what: "x".repeat(201) })).status).toBe(400);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM staff_tasks").first("n")).toBe(0);
  });

  it("leaves the board once marked done, which a second time finds nothing to do", async () => {
    const { id } = await (await write(CARE, {})).json<{ id: string }>();
    expect((await done(CARE, id)).status).toBe(204);
    expect(tasksIn(await boardOf(CARE), "staff_task_customer_care")).toEqual([]);
    expect((await done(CARE, id)).status).toBe(404);
    const row = await env.DB.prepare("SELECT done_by FROM staff_tasks WHERE id = ?1").bind(id).first("done_by");
    expect(row).toBe(CARE);
  });

  it("is gone with an erased client", async () => {
    await write(CARE, {});
    await env.DB.prepare("UPDATE people SET erased_at = ?2 WHERE id = ?1").bind(PERSON, NOW.toISOString()).run();
    expect(tasksIn(await boardOf(CARE), "staff_task_customer_care")).toEqual([]);
  });
});

describe("once the Staff list is enforced", () => {
  beforeEach(async () => {
    await enforce();
    await listStaff(CARE, ["customer_care:act:national"]);
    await listStaff(MONEY, ["finance:view:national"]);
  });

  it("shows a task only to the department it is for, which alone may mark it done", async () => {
    const { id } = await (await write(MONEY, {})).json<{ id: string }>();
    expect(tasksIn(await boardOf(MONEY), "staff_task_customer_care")).toEqual([]);
    expect(tasksIn(await boardOf(CARE), "staff_task_customer_care").map((task) => task.id)).toEqual([id]);

    const refused = await done(MONEY, id);
    expect(refused.status).toBe(403);
    expect((await done(CARE, id)).status).toBe(204);
  });

  it("asks a city or a client of someone whose work reaches only some cities", async () => {
    await listStaff("city.head@maneman.in", ["operations:act:city:Gurgaon"]);
    const nowhere = await write("city.head@maneman.in", { client: null, city: null, department: "operations" });
    expect(await nowhere.json()).toMatchObject({ error: { code: "invalid_request", fields: ["city"] } });
  });
});
