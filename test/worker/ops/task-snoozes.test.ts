// A task snoozed on Tasks (docs/decisions/0303-snoozing-a-task.md): off the board and its counts until 10 am tomorrow
// in India, then back as it was; asked of Act in its department; still open for the night's spans. NOW is the
// helpers' fixed moment. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { outstandingTasks } from "../../../src/domain/ops/tasks.ts";
import type { App } from "../../../src/http/context.ts";
import { DAY_MS } from "../../../src/lib/durations.ts";
import { addDays, indiaDate, indiaInstant } from "../../../src/lib/india-time.ts";
import { TASK_SLA_HOURS } from "../../../src/policy/tasks.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { enforce, listStaff, opsAs, person as staffPerson, post } from "./staff-fixtures.ts";
import { PERSON, person } from "./ops-tasks-fixtures.ts";

const CARE = "farah.khan@maneman.in";
const MONEY = "dev.malik@maneman.in";
const GROUP = "staff_task_customer_care";

interface Board {
  readonly groups: readonly { readonly group: string; readonly tasks: readonly { id: string }[] }[];
}

const as = (email: string): App => opsAs(staffPerson(email));
const idsOnBoard = async (email: string): Promise<string[]> => {
  const board: Board = await (await request(as(email), "/api/tasks")).json();
  return board.groups.find((each) => each.group === GROUP)?.tasks.map((task) => task.id) ?? [];
};
const snooze = (email: string, id: string) => post(as(email), `/api/tasks/${GROUP}/${id}/snooze`, {});

async function written(): Promise<string> {
  const answer = await post(as(CARE), "/api/tasks", {
    what: "Call back about the evening slot",
    department: "customer_care",
    client: PERSON,
    city: null,
    due: new Date(NOW.getTime() + DAY_MS).toISOString(),
    owner: null,
  });
  return (await answer.json<{ id: string }>()).id;
}

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  appFor("local", fakeDependencies(), {}, "ops");
  await person(PERSON, "Rohit Malhotra", "+919810000001");
});

describe("a task snoozed", () => {
  it("leaves the board until 10 am tomorrow in India, then is back as it was", async () => {
    const id = await written();
    const snoozed = await snooze(CARE, id);
    expect(snoozed.status).toBe(200);
    const until = indiaInstant(addDays(indiaDate(NOW), 1), "10:00").toISOString();
    expect(await snoozed.json()).toEqual({ until });
    expect(await idsOnBoard(CARE)).toEqual([]);

    // The morning comes: the snooze has run out, and the task is there again.
    await env.DB.prepare("UPDATE task_snoozes SET until = ?1").bind(NOW.toISOString()).run();
    expect(await idsOnBoard(CARE)).toEqual([id]);
  });

  it("leaves a new task about the same row on the board, as one that started waiting since", async () => {
    const id = await written();
    await snooze(CARE, id);
    // As a chat the client wrote to again: the same row, waiting from another moment.
    await env.DB.prepare("UPDATE task_snoozes SET task_since = ?1").bind("2000-01-01T00:00:00.000Z").run();
    expect(await idsOnBoard(CARE)).toEqual([id]);
  });

  it("is still open for the night's spans, which read the board whole", async () => {
    const id = await written();
    await snooze(CARE, id);
    const { tasks } = await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS);
    expect(tasks.filter((task) => task.group === GROUP).map((task) => task.id)).toEqual([id]);
  });

  it("finds nothing to snooze where there is no such task on the board", async () => {
    expect((await snooze(CARE, "aa000000-0000-4000-8000-0000000000ff")).status).toBe(404);
  });

  it("asks Act in the department that decides it, once the Staff list is enforced", async () => {
    const id = await written();
    await enforce();
    await listStaff(CARE, ["customer_care:act:national"]);
    await listStaff(MONEY, ["finance:act:national"]);
    expect((await snooze(MONEY, id)).status).toBe(403);
    expect((await snooze(CARE, id)).status).toBe(200);
  });
});
