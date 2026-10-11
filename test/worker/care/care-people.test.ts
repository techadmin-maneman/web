// Each client's Care person (src/domain/care/care-people.ts, src/routes/ops/care-people.ts;
// docs/decisions/0131-care-people.md): given at the first chat to whoever on the Care team has the fewest clients, the
// Care person's own chats as Mine, and a Customer Care manager moving a client. Every name and address is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Settings } from "../../../src/config/settings.ts";
import type { App } from "../../../src/http/context.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  fakeQueue,
  LOCAL_SETTINGS,
  markDatabase,
  NOW,
  request,
} from "../helpers.ts";
import { insertPerson } from "../tryon-fixtures.ts";
import { enforce, listStaff, opsAs, person } from "../ops/staff-fixtures.ts";

const TOKEN = "a-webhook-token-of-at-least-thirty-two-chars";
const EVOLUTION: NonNullable<Settings["messaging"]["evolution"]> = {
  baseUrl: "https://bridge.example",
  apiKey: "evolution-instance-key",
  instance: "maneman",
  webhookToken: TOKEN,
};
const ARJUN = "11111111-1111-4111-8111-111111111111";
const MEERA = "22222222-2222-4222-8222-222222222222";
const ASHA = "asha@maneman.test";
const RAVI = "ravi@maneman.test";
const LEAD = "lead@maneman.test";

/** A message to our number from `from`, as the bridge posts it. */
const written = (from: string) =>
  request(
    appFor("local", fakeDependencies(), { messaging: { ...LOCAL_SETTINGS.messaging, evolution: EVOLUTION } }),
    `/api/hooks/evolution/${TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "messages.upsert",
        instance: "maneman",
        data: {
          key: { remoteJid: `${from}@s.whatsapp.net`, fromMe: false, id: crypto.randomUUID() },
          message: { conversation: "Hello" },
          messageType: "conversation",
        },
      }),
    },
    { MESSAGE_QUEUE: fakeQueue() },
  );

const move = (app: App, personId: string, email: string) =>
  request(app, `/api/clients/${personId}/care-person`, {
    method: "POST",
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

const ownerOf = async (personId: string) =>
  env.DB.prepare("SELECT email, assigned_by FROM care_owners WHERE person_id = ?1").bind(personId).first();

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  await insertPerson(ARJUN, "+919810000001", "Arjun Mehta");
  await insertPerson(MEERA, "+919810000002", "Meera Iyer");
  await listStaff(ASHA, ["customer_care:act:national"]);
  await listStaff(RAVI, ["customer_care:manage:national"]);
  await listStaff(LEAD, ["customer_care:manage:national", "admin:manage:national"]);
  // Not the Care team: one city only, a viewer, and someone kept on the list but let in nowhere.
  await listStaff("delhi@maneman.test", ["customer_care:act:city:Delhi"]);
  await listStaff("viewer@maneman.test", ["customer_care:view:national"]);
  await listStaff("left@maneman.test", ["customer_care:act:national"], false);
});

describe("a client's Care person", () => {
  it("is given at their first chat: whoever on the Care team has the fewest clients, and kept after", async () => {
    await env.DB.prepare("INSERT INTO care_owners (person_id, email, since, assigned_by) VALUES (?1, ?2, ?3, 'system')")
      .bind(MEERA, ASHA, NOW.toISOString())
      .run();
    expect((await written("919810000001")).status).toBe(204);
    expect(await ownerOf(ARJUN)).toEqual({ email: LEAD, assigned_by: "system" });
    await written("919810000001");
    expect(await ownerOf(ARJUN)).toEqual({ email: LEAD, assigned_by: "system" });
  });

  it("is nobody's for a number we don't know", async () => {
    await written("919899999999");
    const { results } = await env.DB.prepare("SELECT person_id FROM care_owners").all();
    expect(results).toEqual([]);
  });

  it("lists the Care team, each with how many clients are theirs, the fewest first", async () => {
    // Between equals, the first by address: Asha.
    await written("919810000001");
    const answer = await request(opsAs(person(ASHA)), "/api/care-team");
    expect(await answer.json()).toEqual({
      team: [
        { email: LEAD, clients: 0 },
        { email: RAVI, clients: 0 },
        { email: ASHA, clients: 1 },
      ],
    });
  });

  it("shows on each chat, and a Care person's own open chats are theirs as Mine", async () => {
    await written("919810000001");
    const listed = async (email: string, view: string) =>
      (
        await (
          await request(opsAs(person(email)), `/api/conversations?view=${view}`)
        ).json<{
          conversations: { care_person: string | null }[];
        }>()
      ).conversations;
    expect(await listed(ASHA, "open")).toMatchObject([{ care_person: ASHA }]);
    expect(await listed(ASHA, "mine")).toHaveLength(1);
    expect(await listed(RAVI, "mine")).toEqual([]);
  });
});

describe("moving a client", () => {
  it("gives them another of the Care team, as the manager who moved them, audited with who they went to", async () => {
    await written("919810000001");
    const answer = await move(opsAs(person(LEAD)), ARJUN, ASHA);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ care_person: ASHA });
    expect(await ownerOf(ARJUN)).toEqual({ email: ASHA, assigned_by: LEAD });
    const { results } = await env.DB.prepare(
      "SELECT action, actor, subject_id, detail FROM audit_log WHERE action = 'care_person.move'",
    ).all();
    expect(results).toEqual([
      { action: "care_person.move", actor: LEAD, subject_id: ARJUN, detail: JSON.stringify({ to: ASHA }) },
    ]);
  });

  it("refuses someone not on the Care team, and a client erased or not ours", async () => {
    const lead = opsAs(person(LEAD));
    const refused = await move(lead, ARJUN, "delhi@maneman.test");
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: { code: "invalid_request", fields: ["email"] } });
    expect((await move(lead, "33333333-3333-4333-8333-333333333333", ASHA)).status).toBe(404);
    await env.DB.prepare("UPDATE people SET erased_at = ?1 WHERE id = ?2").bind(NOW.toISOString(), MEERA).run();
    expect((await move(lead, MEERA, ASHA)).status).toBe(404);
    expect(await ownerOf(MEERA)).toBeNull();
  });

  it("is for a Customer Care manager alone, once the Staff list is enforced", async () => {
    await enforce();
    expect((await move(opsAs(person(ASHA)), ARJUN, RAVI)).status).toBe(403);
    expect((await move(opsAs(person(RAVI)), ARJUN, ASHA)).status).toBe(200);
  });
});
