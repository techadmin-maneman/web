// City matters (src/domain/care/city-matters.ts, src/routes/ops/city-matters.ts; docs/decisions/0135-city-matters.md):
// Care send a matter from a chat to the client's city, it waits on the city's Tasks, and the city closes it with what was
// done. Every name, number and address here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { outstandingTasks } from "../../../src/domain/ops/tasks.ts";
import { TASK_SLA_HOURS } from "../../../src/policy/tasks.ts";
import { captureLogs, markDatabase, NOW, request } from "../helpers.ts";
import { insertPerson } from "../tryon-fixtures.ts";
import { listStaff, opsAs, person } from "../ops/staff-fixtures.ts";

const CHAT = "8c1d9f4b-5e6a-4b7c-9d8e-3f4a5b6c7d8e";
const STRANGER_CHAT = "9d2e0a5c-6f7b-4c8d-8e9f-4a5b6c7d8e9f";
const CARE = "care@maneman.test";
const GURGAON_OPS = "ops.gurgaon@maneman.test";

const post = (app: App, path: string, body: unknown) =>
  request(app, path, {
    method: "POST",
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const send = (note: string, chat = CHAT) =>
  post(opsAs(person(CARE)), `/api/conversations/${chat}/city-matter`, { note });

const matters = async () =>
  (await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS)).tasks.filter((task) => task.group === "city_matter");

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  await listStaff(CARE, ["customer_care:act:national"]);
  await listStaff(GURGAON_OPS, ["operations:act:city:Gurgaon"]);
  await insertPerson("p1", "+919810000001", "Arjun Mehta");
  const at = NOW.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at)
       VALUES ('122018', 'South City II', 'Gurgaon', 1, ?1)`,
    ).bind(at),
    env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
       VALUES ('ad1', 'p1', ?1, 'House 4417, Tower C', 'Sector 65', 'Gurgaon', '122018')`,
    ).bind(at),
    env.DB.prepare(
      `INSERT INTO conversations (id, person_id, mobile_e164, state, opened_at, last_message_at, last_inbound_at,
         created_at, updated_at)
       VALUES (?1, 'p1', '+919810000001', 'open', ?3, ?3, ?3, ?3, ?3),
              (?2, NULL, '+919811112222', 'open', ?3, ?3, ?3, ?3, ?3)`,
    ).bind(CHAT, STRANGER_CHAT, at),
  ]);
});

describe("a City matter", () => {
  it("goes from a chat to the client's city, onto its Tasks, audited by the city alone", async () => {
    const answer = await send("Hair system lifting at the front; needs a technician this week.");
    expect(await answer.json()).toEqual({ city: "Gurgaon" });
    expect(await matters()).toMatchObject([
      { person: { name: "Arjun Mehta" }, detail: "Hair system lifting at the front; needs a technician this week." },
    ]);
    const { results } = await env.DB.prepare(
      "SELECT action, subject_id, detail FROM audit_log WHERE action = 'city_matter.raise'",
    ).all();
    expect(results).toEqual([
      { action: "city_matter.raise", subject_id: "p1", detail: JSON.stringify({ city: "Gurgaon" }) },
    ]);
  });

  it("is closed by the city with what was done, and leaves its Tasks", async () => {
    await send("Needs a re-fit.");
    const [matter] = await matters();
    const closed = await post(opsAs(person(GURGAON_OPS)), `/api/tasks/city_matter/${matter?.id ?? ""}/close`, {
      reason: "Re-fit booked for Thursday.",
    });
    expect(closed.status).toBe(204);
    expect(await matters()).toEqual([]);
  });

  it("is refused for a client whose city we don't know, and a number we don't know", async () => {
    await env.DB.prepare("DELETE FROM addresses").run();
    const refused = await send("Needs a re-fit.");
    expect(await refused.json()).toMatchObject({ error: { code: "invalid_request", fields: ["city"] } });
    expect((await send("Who is this?", STRANGER_CHAT)).status).toBe(404);
  });
});
