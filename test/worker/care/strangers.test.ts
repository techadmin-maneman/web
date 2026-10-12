// A chat from a number we don't know (src/domain/care/strangers.ts, src/routes/ops/strangers.ts;
// docs/decisions/0138-strangers-in-the-inbox.md): linked to the client it turns out to be, or the person saved as someone
// new, and the chat theirs, with a Care person. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { captureLogs, fakeQueue, markDatabase, NOW, request } from "../helpers.ts";
import { insertPerson } from "../tryon-fixtures.ts";
import { listStaff, opsAs, person } from "../ops/staff-fixtures.ts";

const CHAT = "9d2e0a5c-6f7b-4c8d-8e9f-4a5b6c7d8e9f";
const ARJUN = "11111111-1111-4111-8111-111111111111";
const CARE = "care@maneman.test";

let crmQueue: ReturnType<typeof fakeQueue>;

const post = (app: App, path: string, body: unknown) =>
  request(
    app,
    path,
    {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { CRM_QUEUE: crmQueue },
  );

const care = () => opsAs(person(CARE));
const chatOwner = async () =>
  (await env.DB.prepare("SELECT person_id FROM conversations WHERE id = ?1").bind(CHAT).first<{ person_id: string }>())
    ?.person_id;

beforeEach(async () => {
  captureLogs();
  crmQueue = fakeQueue();
  await markDatabase();
  await listStaff(CARE, ["customer_care:act:national"]);
  await insertPerson(ARJUN, "+919810000001", "Arjun Mehta");
  await env.DB.prepare(
    `INSERT INTO conversations (id, person_id, mobile_e164, state, opened_at, last_message_at, last_inbound_at,
       created_at, updated_at)
     VALUES (?1, NULL, '+919811112222', 'open', ?2, ?2, ?2, ?2, ?2)`,
  )
    .bind(CHAT, NOW.toISOString())
    .run();
});

describe("a stranger's chat", () => {
  it("links to the client it turns out to be, who is given a Care person, audited", async () => {
    const answer = await post(care(), `/api/conversations/${CHAT}/link`, { person_id: ARJUN });
    expect(await answer.json()).toEqual({ person_id: ARJUN });
    expect(await chatOwner()).toBe(ARJUN);
    expect(await env.DB.prepare("SELECT email FROM care_owners WHERE person_id = ?1").bind(ARJUN).first()).toEqual({
      email: CARE,
    });
    const { results } = await env.DB.prepare(
      "SELECT action, subject_id, detail FROM audit_log WHERE action = 'chat.link'",
    ).all();
    expect(results).toEqual([{ action: "chat.link", subject_id: CHAT, detail: JSON.stringify({ person: ARJUN }) }]);
  });

  it("saves the person as someone new, by the name they gave, with a WhatsApp lead for the CRM", async () => {
    const answer = await post(care(), `/api/conversations/${CHAT}/save`, { name: " Meera Iyer " });
    const { person_id: personId } = await answer.json<{ person_id: string }>();
    expect(await chatOwner()).toBe(personId);
    expect(
      await env.DB.prepare("SELECT name, mobile_e164, contactable FROM people WHERE id = ?1").bind(personId).first(),
    ).toEqual({ name: "Meera Iyer", mobile_e164: "+919811112222", contactable: 0 });
    const lead = await env.DB.prepare("SELECT id, person_id, source, found_us FROM leads").first<{ id: string }>();
    expect(lead).toMatchObject({ person_id: personId, source: "whatsapp", found_us: null });
    expect(crmQueue.sent).toMatchObject([{ lead_id: lead?.id }]);
  });

  it("keeps how the person told Care they found us, one of the channels", async () => {
    await post(care(), `/api/conversations/${CHAT}/save`, { name: "Meera Iyer", found_us: "partner" });
    expect(await env.DB.prepare("SELECT found_us FROM leads").first()).toEqual({ found_us: "partner" });
    const refused = await post(care(), `/api/conversations/${CHAT}/save`, { name: "Meera Iyer", found_us: "a poster" });
    expect(refused.status).toBe(400);
  });

  it("is a client's once, and never saves a number one of our people has", async () => {
    await post(care(), `/api/conversations/${CHAT}/link`, { person_id: ARJUN });
    const again = await post(care(), `/api/conversations/${CHAT}/save`, { name: "Meera Iyer" });
    expect(await again.json()).toMatchObject({ error: { code: "invalid_request", fields: ["conversation"] } });
    await env.DB.prepare("UPDATE conversations SET person_id = NULL WHERE id = ?1").bind(CHAT).run();
    await env.DB.prepare("UPDATE people SET mobile_e164 = '+919811112222' WHERE id = ?1").bind(ARJUN).run();
    expect((await post(care(), `/api/conversations/${CHAT}/save`, { name: "Meera Iyer" })).status).toBe(409);
    expect(
      (await post(care(), `/api/conversations/${CHAT}/link`, { person_id: "33333333-3333-4333-8333-333333333333" }))
        .status,
    ).toBe(404);
  });
});
