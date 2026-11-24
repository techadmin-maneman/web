// Touches that arrive other than by a page, and the console's say over them (ADR 0288): a WhatsApp message carrying
// a visitor's reference, or Meta's click-to-WhatsApp referral; a lead Care take on a call, under the channel they
// pick; what a client told ops, and their asking us to stop sharing; and a campaign link made, listed and retired.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Settings } from "../../../src/config/settings.ts";
import type { App } from "../../../src/http/context.ts";
import {
  appFor,
  captureLogs,
  eraseByMobile,
  fakeDependencies,
  fakeQueue,
  LOCAL_SETTINGS,
  markDatabase,
  NOW,
  request,
} from "../helpers.ts";
import { listStaff, opsAs, person } from "../ops/staff-fixtures.ts";
import { site } from "../site/consultations-fixtures.ts";
import { insertPerson } from "../tryon-fixtures.ts";

const CARE = "care@maneman.test";
const GROWTH = "growth@maneman.test";
const KNOWN = "11111111-1111-4111-8111-111111111111";
const VISITOR = "0f8c2b1e-1111-4111-8111-111111111111";
const TOKEN = "an-msg91-webhook-token-of-thirty-two-chars";
const MSG91: NonNullable<Settings["messaging"]["msg91"]> = {
  authKey: "msg91-key",
  integratedNumber: "919800000000",
  webhookToken: TOKEN,
};

const post = (app: App, path: string, body?: unknown) =>
  request(
    app,
    path,
    {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    { CRM_QUEUE: fakeQueue(), MESSAGE_QUEUE: fakeQueue() },
  );

const rows = async (sql: string) => (await env.DB.prepare(sql).all()).results;

/** A WhatsApp message to our number as MSG91 posts it, from the number given. */
function whatsApp(from: string, text: string, referral?: object) {
  return request(
    appFor("local", fakeDependencies(), { messaging: { ...LOCAL_SETTINGS.messaging, msg91: MSG91 } }),
    "/api/hooks/msg91",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        companyId: "12345",
        customerNumber: from,
        eventName: "",
        uuid: `wamid.${crypto.randomUUID()}`,
        integratedNumber: "919800000000",
        direction: "0",
        contentType: "text",
        ts: "2026-09-21T12:00:00+05:30",
        messages: JSON.stringify([{ id: "wamid.1", text: { body: text }, ...(referral ? { referral } : {}) }]),
      }),
    },
    { MESSAGE_QUEUE: fakeQueue() },
  );
}

const care = () => opsAs(person(CARE));
const growth = () => opsAs(person(GROWTH));

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  await listStaff(CARE, ["customer_care:manage:national"]);
  await listStaff(GROWTH, ["growth:manage:national"]);
  await insertPerson(KNOWN, "+919810000001", "Arjun Mehta");
});

describe("a WhatsApp message", () => {
  it("with a visitor's reference makes the visitor's touches the number's, and the person's once Care save them", async () => {
    const landed = await request(site(), "/api/landings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `mm_vid_local=${VISITOR}` },
      body: JSON.stringify({ landing_path: "/", gclid: "Cj0KCQ_test" }),
    });
    const { ref } = await landed.json<{ ref: string }>();
    await whatsApp("919811112222", `Hi, I’d like to know more. Ref ${ref}`);

    expect(await rows("SELECT via, visitor_id, mobile_e164, person_id, channel FROM touches ORDER BY rowid")).toEqual([
      { via: "site", visitor_id: VISITOR, mobile_e164: null, person_id: null, channel: "google_ads" },
      { via: "whatsapp", visitor_id: VISITOR, mobile_e164: "+919811112222", person_id: null, channel: "whatsapp" },
    ]);

    const chat = await env.DB.prepare("SELECT id FROM conversations").first<{ id: string }>();
    const saved = await post(care(), `/api/conversations/${chat?.id ?? ""}/save`, {
      name: "Meera Iyer",
      heard_from: "instagram_facebook",
    });
    const { person_id: personId } = await saved.json<{ person_id: string }>();
    // The landing, the chat, and the lead Care made from it.
    expect(await rows("SELECT COUNT(*) AS theirs FROM touches WHERE person_id IS NOT NULL")).toEqual([{ theirs: 3 }]);
    expect(
      await env.DB.prepare("SELECT attributed_channel, heard_from FROM person_attribution WHERE person_id = ?1")
        .bind(personId)
        .first(),
    ).toEqual({ attributed_channel: "google_ads", heard_from: "instagram_facebook" });
  });

  it("after the visitor declined the cookie bar brings none of what their landing kept for Meta to the person", async () => {
    const cookie = { "Content-Type": "application/json", Cookie: `mm_vid_local=${VISITOR}` };
    const landed = await request(site(), "/api/landings", {
      method: "POST",
      headers: cookie,
      body: JSON.stringify({ landing_path: "/", fbclid: "IwAR_test", fbp: "fb.1.1790000000000.123456789" }),
    });
    const { ref } = await landed.json<{ ref: string }>();
    expect((await request(site(), "/api/landings/declined", { method: "POST", headers: cookie })).status).toBe(204);
    await whatsApp("919811112222", `Hi. Ref ${ref}`);
    const chat = await env.DB.prepare("SELECT id FROM conversations").first<{ id: string }>();
    await post(care(), `/api/conversations/${chat?.id ?? ""}/save`, { name: "Meera Iyer" });

    expect(
      await rows("SELECT via, fbc, fbp, client_ip, user_agent, ad_consent FROM touches WHERE via = 'site'"),
    ).toEqual([{ via: "site", fbc: null, fbp: null, client_ip: null, user_agent: null, ad_consent: "denied" }]);
  });

  it("from Meta's click-to-WhatsApp ad is a Meta ads touch of the client who sent it", async () => {
    await whatsApp("919810000001", "Hello", {
      ctwa_clid: "ARAkLkA_test",
      source_id: "120200000000000",
      source_url: "https://fb.me/test",
    });

    expect(await rows("SELECT person_id, channel, ctwa_clid, ad_source_id, campaign_signal FROM touches")).toEqual([
      {
        person_id: KNOWN,
        channel: "meta_ads",
        ctwa_clid: "ARAkLkA_test",
        ad_source_id: "120200000000000",
        campaign_signal: 1,
      },
    ]);
  });

  it("with a referral that will not parse is still filed, its words read, the referral let go", async () => {
    await whatsApp("919810000001", "STOP", { ctwa_clid: "x".repeat(600) });

    expect(await rows("SELECT id FROM touches")).toEqual([]);
    expect(await rows("SELECT text FROM chat_messages")).toEqual([{ text: "STOP" }]);
  });

  it("with neither records nothing", async () => {
    await whatsApp("919810000001", "Can my visit move to the evening?");
    expect(await rows("SELECT id FROM touches")).toEqual([]);
  });
  it("from an ad becomes the person's, its number gone, once that number leaves a lead on /book", async () => {
    await whatsApp("919811112222", "Hello", { ctwa_clid: "ARAkLkA_test", source_id: "120200000000000" });
    await post(site(), "/api/lead", {
      name: "Meera Iyer",
      mobile: "9811112222",
      consent: true,
      terms: true,
      turnstile_token: "token",
    });

    expect(await rows("SELECT via, person_id IS NOT NULL AS theirs, mobile_e164 FROM touches ORDER BY rowid")).toEqual([
      { via: "whatsapp", theirs: 1, mobile_e164: null },
      { via: "site", theirs: 1, mobile_e164: null },
    ]);
    expect(await rows("SELECT attributed_channel FROM person_attribution")).toEqual([
      { attributed_channel: "meta_ads" },
    ]);
  });
});

describe("erasure", () => {
  it("makes a chat the number sent before we knew them theirs, and leaves nothing of the number in it", async () => {
    await whatsApp("919811112222", "Hello", { ctwa_clid: "ARAkLkA_test" });
    await insertPerson("22222222-2222-4222-8222-222222222222", "+919811112222", "Meera Iyer");
    expect(await rows("SELECT person_id FROM touches")).toEqual([{ person_id: null }]);

    await eraseByMobile("+919811112222");

    expect(await rows("SELECT person_id, mobile_e164, ctwa_clid, channel FROM touches")).toEqual([
      { person_id: "22222222-2222-4222-8222-222222222222", mobile_e164: null, ctwa_clid: null, channel: "meta_ads" },
    ]);
  });
});

describe("a lead taken on a call", () => {
  it("is a new person with a phone lead, under the channel Care picked", async () => {
    const answer = await post(care(), "/api/leads/call", {
      name: "Vikram Rao",
      mobile: "9811113333",
      channel: "partner",
    });

    expect(answer.status).toBe(200);
    const { person_id: personId, known } = await answer.json<{ person_id: string; known: boolean }>();
    expect(known).toBe(false);
    expect(await rows("SELECT source FROM leads")).toEqual([{ source: "phone" }]);
    expect(await rows("SELECT via, declared_channel, declared_by, channel FROM touches")).toEqual([
      { via: "call", declared_channel: "partner", declared_by: "ops", channel: "partner" },
    ]);
    const found = await (await request(care(), `/api/clients/${personId}/attribution`)).json();
    expect(found).toMatchObject({ attributed_channel: "partner", touches: 1, heard_from: null });
  });

  // The pincode asked on Add a client is their city until they give an address (docs/decisions/0307-the-people-rulings.md).
  it("keeps the pincode they gave, and leaves a number we hold as it was", async () => {
    const answer = await post(care(), "/api/leads/call", {
      name: "Vikram Rao",
      mobile: "9811113333",
      channel: "partner",
      pincode: "122018",
    });
    const { person_id: personId } = await answer.json<{ person_id: string }>();
    await post(care(), "/api/leads/call", {
      name: "Arjun",
      mobile: "9810000001",
      channel: "direct",
      pincode: "110001",
    });
    const pincodeOf = async (id: string) =>
      (await env.DB.prepare("SELECT pincode FROM people WHERE id = ?1").bind(id).first<{ pincode: string | null }>())
        ?.pincode;
    expect(await pincodeOf(personId)).toBe("122018");
    expect(await pincodeOf(KNOWN)).toBeNull();
    const refused = await post(care(), "/api/leads/call", {
      name: "Kabir",
      mobile: "9811114444",
      channel: "partner",
      pincode: "012345",
    });
    expect(refused.status).toBe(400);
  });

  it("from a number we hold adds a touch and makes no lead", async () => {
    const answer = await post(care(), "/api/leads/call", {
      name: "Arjun",
      mobile: "9810000001",
      channel: "google_ads",
    });

    expect(await answer.json()).toEqual({ person_id: KNOWN, known: true });
    expect(await rows("SELECT COUNT(*) AS n FROM leads")).toEqual([{ n: 0 }]);
    expect(await rows("SELECT person_id, channel FROM touches")).toEqual([{ person_id: KNOWN, channel: "google_ads" }]);
  });
});

describe("a client's page", () => {
  it("keeps what they told ops beside their channel, and stops their sharing, both audited", async () => {
    await post(care(), "/api/leads/call", { name: "Arjun", mobile: "9810000001", channel: "referral" });
    await env.DB.prepare(
      `INSERT INTO conversions (event_id, event, subject_id, person_id, occurred_at, attributed_channel,
         last_touch_channel, meta_state, google_state, created_at)
       VALUES ('e1', 'consult_booked', 'a1', ?1, '2026-09-21T06:00:00Z', 'referral', 'referral', 'pending', 'pending',
         '2026-09-21T06:00:00Z')`,
    )
      .bind(KNOWN)
      .run();

    expect(
      (await post(care(), `/api/clients/${KNOWN}/heard-from`, { heard_from: "other", heard_from_other: "A flyer" }))
        .status,
    ).toBe(204);
    expect((await post(care(), `/api/clients/${KNOWN}/heard-from`, { heard_from: "a poster" })).status).toBe(400);
    expect((await post(care(), `/api/clients/${KNOWN}/stop-sharing`)).status).toBe(204);

    expect(await (await request(care(), `/api/clients/${KNOWN}/attribution`)).json()).toMatchObject({
      attributed_channel: "referral",
      heard_from: "other",
      heard_from_other: "A flyer",
      sharing_stopped_at: expect.any(String) as string,
    });
    expect(await rows("SELECT meta_state, meta_error, google_state FROM conversions")).toEqual([
      { meta_state: "skipped", meta_error: "sharing_stopped", google_state: "skipped" },
    ]);
    expect(
      await rows(
        "SELECT action FROM audit_log WHERE action IN ('client.heard_from', 'client.sharing_stop') ORDER BY id",
      ),
    ).toEqual([{ action: "client.heard_from" }, { action: "client.sharing_stop" }]);
    expect((await post(care(), `/api/clients/${crypto.randomUUID()}/stop-sharing`)).status).toBe(404);
  });
});

describe("a campaign link", () => {
  it("is made with its short link, listed with what it brought, and retired once, after which it lands nowhere", async () => {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO serviceable_pincodes (pincode, area, city, served) VALUES ('122002', 'DLF Phase 1', 'Gurgaon', 1)",
    ).run();
    const made = await post(growth(), "/api/campaign-links", {
      kind: "society",
      name: "Green Valley Towers",
      pincode: "122002",
      held_date: "2026-09-26",
      costs: [{ line: "collateral", amount: 150_000, note: "Standees" }],
    });

    expect(made.status).toBe(201);
    const link = await made.json<{ id: string; slug: string; short_link: string; city: string }>();
    expect(link).toMatchObject({ slug: "green-valley-towers", city: "Gurgaon" });
    expect(link.short_link).toMatch(/\/s\/green-valley-towers$/);
    const listed = await (await request(growth(), "/api/campaign-links")).json<{ links: { spent: number }[] }>();
    expect(listed.links).toMatchObject([{ spent: 150_000 }]);

    expect((await post(growth(), `/api/campaign-links/${link.id}/retire`)).status).toBe(204);
    expect((await post(growth(), `/api/campaign-links/${link.id}/retire`)).status).toBe(404);
    expect((await request(site(), `/api/links/s/${link.slug}`)).status).toBe(404);
  });

  it("refuses a pincode we cannot place", async () => {
    const refused = await post(growth(), "/api/campaign-links", {
      kind: "society",
      name: "Nowhere Heights",
      pincode: "999999",
      held_date: "2026-09-26",
      costs: [],
    });

    expect(await refused.json()).toMatchObject({ error: { fields: ["pincode"] } });
  });
});

describe("the Tasks board", () => {
  const heardTasks = async () => {
    const board = await (
      await request(care(), "/api/tasks")
    ).json<{
      groups: { group: string; tasks: { id: string; facts: unknown }[] }[];
    }>();
    return board.groups.find((each) => each.group === "heard_from_missing")?.tasks ?? [];
  };

  it("asks how a client heard of us once their first consultation is done, until ops keep the answer", async () => {
    await env.DB.prepare(
      `INSERT INTO conversions (event_id, event, subject_id, person_id, occurred_at, attributed_channel,
         last_touch_channel, meta_state, google_state, created_at)
       VALUES ('e2', 'consult_done', 'a1', ?1, '2026-09-20T05:00:00.000Z', 'direct', 'direct', 'pending', 'pending',
         '2026-09-20T05:00:00.000Z')`,
    )
      .bind(KNOWN)
      .run();

    expect(await heardTasks()).toEqual([
      expect.objectContaining({
        id: KNOWN,
        facts: { group: "heard_from_missing", consulted_at: "2026-09-20T05:00:00.000Z" },
      }),
    ]);
    await post(care(), `/api/clients/${KNOWN}/heard-from`, { heard_from: "youtube" });
    expect(await heardTasks()).toEqual([]);
  });

  it("asks no further back than the days ops set tasks to lapse after", async () => {
    await env.DB.prepare(
      `INSERT INTO conversions (event_id, event, subject_id, person_id, occurred_at, attributed_channel,
         last_touch_channel, meta_state, google_state, created_at)
       VALUES ('e3', 'consult_done', 'a1', ?1, '2026-07-13T05:00:00.000Z', 'direct', 'direct', 'pending', 'pending',
         '2026-07-13T05:00:00.000Z')`,
    )
      .bind(KNOWN)
      .run();
    expect(await heardTasks()).toEqual([]);

    await env.DB.prepare(
      "INSERT INTO ops_settings (name, value, set_by, set_at) VALUES ('task_lapse_days', '90', 'ops', ?1)",
    )
      .bind(NOW.toISOString())
      .run();
    expect(await heardTasks()).toEqual([expect.objectContaining({ id: KNOWN })]);
  });
});
