// Remedies (src/domain/care/remedies.ts, src/routes/ops/remedies.ts; docs/decisions/0143-remedies.md): free service
// visits Care give, at once within the limit ops set and a grant in the ledger; above it, awaiting a Customer Care
// manager on Tasks, who approves or declines. Every name and address here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { outstandingTasks } from "../../../src/domain/ops/tasks.ts";
import { TASK_SLA_HOURS } from "../../../src/policy/tasks.ts";
import { captureLogs, markDatabase, NOW, request } from "../helpers.ts";
import { insertPerson } from "../tryon-fixtures.ts";
import { enforce, listStaff, opsAs, person } from "../ops/staff-fixtures.ts";

const ARJUN = "11111111-1111-4111-8111-111111111111";
const CARE = "care@maneman.test";
const LEAD = "lead@maneman.test";

const post = (app: App, path: string, body?: unknown) =>
  request(app, path, {
    method: "POST",
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const give = (visits: number) =>
  post(opsAs(person(CARE)), `/api/clients/${ARJUN}/remedies`, {
    visits,
    reason: "fit_problem",
    note: "Edge lifting two days after the fit.",
  });

const granted = async () =>
  (
    await env.DB.prepare(
      "SELECT COALESCE(SUM(visits), 0) AS n FROM credit_ledger WHERE person_id = ?1 AND kind = 'grant'",
    )
      .bind(ARJUN)
      .first<{ n: number }>()
  )?.n;

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  await listStaff(CARE, ["customer_care:act:national"]);
  await listStaff(LEAD, ["customer_care:manage:national"]);
  await insertPerson(ARJUN, "+919810000001", "Arjun Mehta");
  await env.DB.prepare(
    `INSERT INTO conversations (id, person_id, mobile_e164, state, opened_at, last_message_at, last_inbound_at,
       created_at, updated_at)
     VALUES ('8c1d9f4b-5e6a-4b7c-9d8e-3f4a5b6c7d8e', ?1, '+919810000001', 'open', ?2, ?2, ?2, ?2, ?2)`,
  )
    .bind(ARJUN, NOW.toISOString())
    .run();
});

describe("a remedy", () => {
  it("within the limit is given at once, a grant in the ledger, and audited without the note", async () => {
    expect(await (await give(1)).json()).toMatchObject({ state: "given" });
    expect(await granted()).toBe(1);
    const { results } = await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'remedy.give'").all();
    expect(results).toEqual([{ detail: JSON.stringify({ visits: 1 }) }]);
  });

  it("above the limit awaits a manager on Tasks, who approves it, granting it and noting it in the chat", async () => {
    await give(1);
    const asked = await (await give(2)).json<{ id: string; state: string }>();
    expect(asked.state).toBe("awaiting");
    expect(await granted()).toBe(1);
    const tasks = (await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS)).tasks;
    expect(tasks.filter((task) => task.group === "remedy_approval")).toMatchObject([
      { id: asked.id, detail: "2 fit_problem" },
    ]);
    expect((await post(opsAs(person(LEAD)), `/api/remedies/${asked.id}/approve`)).status).toBe(200);
    expect(await granted()).toBe(3);
    const note = await env.DB.prepare("SELECT direction, text FROM chat_messages").first<{ text: string }>();
    expect(note).toMatchObject({ direction: "note" });
    expect(note?.text).toContain("2 free service visits");
    expect((await post(opsAs(person(LEAD)), `/api/remedies/${asked.id}/approve`)).status).toBe(404);
  });

  it("declined grants nothing", async () => {
    await give(1);
    const asked = await (await give(1)).json<{ id: string }>();
    expect((await post(opsAs(person(LEAD)), `/api/remedies/${asked.id}/decline`)).status).toBe(200);
    expect(await granted()).toBe(1);
    const listed = await (
      await request(opsAs(person(CARE)), "/api/remedies")
    ).json<{
      remedies: { id: string; state: string }[];
    }>();
    expect(listed.remedies.find((remedy) => remedy.id === asked.id)?.state).toBe("declined");
  });

  it("is a manager's to approve, once the Staff list is enforced, and refused for an erased client", async () => {
    await give(1);
    const asked = await (await give(1)).json<{ id: string }>();
    await enforce();
    expect((await post(opsAs(person(CARE)), `/api/remedies/${asked.id}/approve`)).status).toBe(403);
    await env.DB.prepare("UPDATE people SET erased_at = ?1 WHERE id = ?2").bind(NOW.toISOString(), ARJUN).run();
    expect((await give(1)).status).toBe(404);
  });
});
