// Evolution's delivery receipts (docs/decisions/0041-outbound-messages-for-phase-2.md):
// the webhook marks our messages delivered and read, withdraws a sender's WhatsApp
// consents on a STOP reply, refuses a wrong token, and never logs the body, which
// names the recipient and carries Evolution's API key. The payloads follow
// Evolution v2's messages.update and messages.upsert; every value in them is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Settings } from "../../src/config/settings.ts";
import { appFor, captureLogs, fakeDependencies, fakeQueue, LOCAL_SETTINGS, markDatabase, request } from "./helpers.ts";
import { insertPerson } from "./tryon-fixtures.ts";

const TOKEN = "a-webhook-token-of-at-least-thirty-two-chars";
const EVOLUTION: NonNullable<Settings["messaging"]["evolution"]> = {
  baseUrl: "https://bridge.example",
  apiKey: "evolution-instance-key",
  instance: "maneman",
  webhookToken: TOKEN,
};
const MOBILE = "+919810000001";

let logs: ReturnType<typeof captureLogs>;

beforeEach(async () => {
  logs = captureLogs();
  await markDatabase();
  await insertPerson("p1", MOBILE);
  await env.DB.prepare(
    `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state, provider_message_id, sent_at)
     VALUES ('m1', '2026-09-22T04:00:00Z', 'p1', 'tryon_result', 'job-1', 'sent', '3EB0C0FFEE', '2026-09-22T04:00:01Z')`,
  ).run();
});

function app(evolution: Settings["messaging"]["evolution"] = EVOLUTION) {
  return appFor("local", fakeDependencies(), { messaging: { ...LOCAL_SETTINGS.messaging, evolution } });
}

/** A messages.update event as Evolution v2 posts it. */
function receipt(status: string, overrides: object = {}) {
  return {
    event: "messages.update",
    instance: "maneman",
    data: {
      messageId: "cm1abc",
      keyId: "3EB0C0FFEE",
      remoteJid: "919810000001@s.whatsapp.net",
      fromMe: true,
      participant: "919810000001@s.whatsapp.net",
      status,
      instanceId: "a1b2c3",
      ...overrides,
    },
    destination: `https://staging.maneman.in/api/hooks/evolution/${TOKEN}`,
    date_time: "2026-09-22T09:30:05.000Z",
    sender: "919999900000@s.whatsapp.net",
    server_url: "https://bridge.example",
    apikey: "evolution-instance-key",
  };
}

function post(body: unknown, token = TOKEN, target = app()) {
  return request(target, `/api/hooks/evolution/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function message() {
  return env.DB.prepare("SELECT delivered_at, read_at FROM outbound_messages WHERE id = 'm1'").first<{
    delivered_at: string | null;
    read_at: string | null;
  }>();
}

describe("POST /api/hooks/evolution/:token", () => {
  it("marks a message delivered", async () => {
    const res = await post(receipt("DELIVERY_ACK"));

    expect(res.status).toBe(204);
    expect(await message()).toEqual({ delivered_at: "2026-09-21T06:30:00.000Z", read_at: null });
  });

  it.each(["READ", "PLAYED"])("marks a message read, and delivered with it, on %s", async (status) => {
    await post(receipt(status));
    expect(await message()).toEqual({ delivered_at: "2026-09-21T06:30:00.000Z", read_at: "2026-09-21T06:30:00.000Z" });
  });

  it("keeps the first report of each, whatever arrives later", async () => {
    await post(receipt("DELIVERY_ACK"));
    const later = new Date("2026-09-21T07:00:00Z");
    const laterApp = appFor("local", fakeDependencies({ now: () => later }), {
      messaging: { ...LOCAL_SETTINGS.messaging, evolution: EVOLUTION },
    });
    await post(receipt("DELIVERY_ACK"), TOKEN, laterApp);
    await post(receipt("READ"), TOKEN, laterApp);
    await post(receipt("READ"), TOKEN, laterApp);

    expect(await message()).toEqual({ delivered_at: "2026-09-21T06:30:00.000Z", read_at: "2026-09-21T07:00:00.000Z" });
  });

  it("names the message the older way too, by key.id", async () => {
    await post(receipt("DELIVERY_ACK", { keyId: undefined, key: { id: "3EB0C0FFEE", fromMe: true } }));
    expect((await message())?.delivered_at).not.toBeNull();
  });

  it("reads each receipt in a batch", async () => {
    const body = { ...receipt("DELIVERY_ACK"), data: [receipt("SERVER_ACK").data, receipt("READ").data] };
    const res = await post(body);
    expect(res.status).toBe(204);
    expect((await message())?.read_at).not.toBeNull();
  });

  it.each<[string, unknown]>([
    ["a receipt that only says WhatsApp's servers have it", receipt("SERVER_ACK")],
    ["a receipt for a message someone sent us", receipt("READ", { fromMe: false })],
    ["a receipt for a message we did not send", receipt("READ", { keyId: "SOMEONE-ELSES" })],
    ["another event", { ...receipt("READ"), event: "contacts.update" }],
    ["a receipt sent as a new message", { ...receipt("READ"), event: "messages.upsert" }],
    ["a body that is not Evolution's", { hello: "world" }],
  ])("takes %s, and changes nothing", async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(204);
    expect(await message()).toEqual({ delivered_at: null, read_at: null });
  });

  it("takes the event name in Evolution's other spelling, MESSAGES_UPDATE", async () => {
    await post({ ...receipt("DELIVERY_ACK"), event: "MESSAGES_UPDATE" });
    expect((await message())?.delivered_at).not.toBeNull();
  });

  it("refuses a wrong token, and changes nothing", async () => {
    const res = await post(receipt("READ"), "not-the-token");
    expect(res.status).toBe(401);
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "evolution_hook_unauthorized" }));
    expect(await message()).toEqual({ delivered_at: null, read_at: null });
  });

  it("answers 404 until a webhook token is set", async () => {
    const res = await post(receipt("READ"), TOKEN, app({ ...EVOLUTION, webhookToken: null }));
    expect(res.status).toBe(404);
    const stub = await post(receipt("READ"), TOKEN, app(null));
    expect(stub.status).toBe(404);
  });

  it("logs no number, no API key and no token", async () => {
    await post(receipt("READ"));
    await post(receipt("READ"), "not-the-token");

    const logged = JSON.stringify(logs.lines());
    expect(logged).toContain("evolution_receipts");
    expect(logged).toContain("/api/hooks/evolution/:token");
    for (const secret of ["9810000001", "9999900000", "evolution-instance-key", TOKEN]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("answers only on the public host", async () => {
    for (const surface of ["client", "tech"] as const) {
      const target = appFor(
        "local",
        fakeDependencies(),
        { messaging: { ...LOCAL_SETTINGS.messaging, evolution: EVOLUTION } },
        surface,
      );
      const res = await request(target, `/api/hooks/evolution/${TOKEN}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
        body: JSON.stringify(receipt("READ")),
      });
      expect(res.status, surface).toBe(404);
    }
  });
});

/** A messages.upsert event: a message on our number, `text` from `from`'s chat. */
function incoming(text: string, key: object = {}) {
  return {
    event: "messages.upsert",
    instance: "maneman",
    data: {
      key: { remoteJid: "919810000001@s.whatsapp.net", fromMe: false, id: "3EB0INCOMING", ...key },
      pushName: "Arjun",
      message: { conversation: text },
      messageType: "conversation",
      messageTimestamp: 1758533405,
    },
    sender: "919999900000@s.whatsapp.net",
    apikey: "evolution-instance-key",
  };
}

describe("a STOP reply (messages.upsert)", () => {
  let queue: ReturnType<typeof fakeQueue>;

  beforeEach(async () => {
    queue = fakeQueue();
    for (const purpose of ["whatsapp_visits", "whatsapp_launches"]) {
      await env.DB.prepare(
        `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, source)
         VALUES (?1, 'p1', ?2, 'v1', 1, '2026-09-01T00:00:00Z', 'app_profile')`,
      )
        .bind(crypto.randomUUID(), purpose)
        .run();
    }
  });

  function postWithQueue(body: unknown) {
    return request(
      app(),
      `/api/hooks/evolution/${TOKEN}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      { MESSAGE_QUEUE: queue },
    );
  }

  async function latestConsents() {
    const rows = await env.DB.prepare(
      `SELECT purpose, granted, source FROM consents c WHERE person_id = 'p1' AND created_at = (
         SELECT MAX(created_at) FROM consents WHERE person_id = 'p1' AND purpose = c.purpose)
       ORDER BY purpose`,
    ).all();
    return rows.results;
  }

  const answers = async () =>
    (await env.DB.prepare("SELECT state FROM outbound_messages WHERE kind = 'messages_stopped'").all()).results;

  it.each(["STOP", "stop", "Stop.", " stop! ", "Unsubscribe"])(
    "withdraws both WhatsApp consents on %j, and queues one answer",
    async (text) => {
      const res = await postWithQueue(incoming(text));

      expect(res.status).toBe(204);
      expect(await latestConsents()).toEqual([
        { purpose: "whatsapp_launches", granted: 0, source: "whatsapp_stop" },
        { purpose: "whatsapp_visits", granted: 0, source: "whatsapp_stop" },
      ]);
      expect(await answers()).toEqual([{ state: "queued" }]);
      expect(queue.sent).toHaveLength(1);
    },
  );

  it("answers a second STOP with nothing, and records nothing more", async () => {
    await postWithQueue(incoming("STOP"));
    await postWithQueue(incoming("STOP"));

    expect(await answers()).toHaveLength(1);
    expect(queue.sent).toHaveLength(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM consents WHERE granted = 0").first("n")).toBe(2);
  });

  it("finds the sender's number where WhatsApp names the chat by its private address", async () => {
    await postWithQueue(
      incoming("STOP", { remoteJid: "84521796452451@lid", remoteJidAlt: MOBILE.slice(1) + "@s.whatsapp.net" }),
    );
    expect(await answers()).toHaveLength(1);
  });

  it.each<[string, unknown]>([
    ["a sentence with stop in it", incoming("Please stop by at 5")],
    ["our own message", incoming("STOP", { fromMe: true })],
    ["a group's message", incoming("STOP", { remoteJid: "120363025000000000@g.us" })],
    ["a number we do not know", incoming("STOP", { remoteJid: "919810000999@s.whatsapp.net" })],
    ["a message with no text", { ...incoming("STOP"), data: { ...incoming("STOP").data, message: null } }],
  ])("ignores %s", async (_label, body) => {
    const res = await postWithQueue(body);
    expect(res.status).toBe(204);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM consents WHERE granted = 0").first("n")).toBe(0);
    expect(await answers()).toEqual([]);
  });

  it("answers no one who had agreed to nothing", async () => {
    await insertPerson("p2", "+919810000002");
    await postWithQueue(incoming("STOP", { remoteJid: "919810000002@s.whatsapp.net" }));
    expect(await answers()).toEqual([]);
    expect(queue.sent).toEqual([]);
  });

  it("logs no number and no text", async () => {
    await postWithQueue(incoming("STOP"));
    const logged = JSON.stringify(logs.lines());
    expect(logged).toContain("evolution_replies");
    for (const secret of ["9810000001", "84521796452451", "evolution-instance-key", "STOP"]) {
      expect(logged).not.toContain(secret);
    }
  });
});

describe("outbound_messages after its rebuild", () => {
  it("still takes a message the way the Phase 1 code writes one, as about a try-on job", async () => {
    await env.DB.prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state, queued_at)
       VALUES ('m2', '2026-09-22T04:00:00Z', 'p1', 'tryon_result', 'job-2', 'queued', '2026-09-22T04:00:00Z')`,
    ).run();
    const row = await env.DB.prepare(
      "SELECT subject_kind, delivered_at FROM outbound_messages WHERE id = 'm2'",
    ).first();
    expect(row).toEqual({ subject_kind: "tryon_job", delivered_at: null });
  });

  it("takes a Phase 2 kind of message", async () => {
    await env.DB.prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state)
       VALUES ('m3', '2026-09-22T04:00:00Z', 'p1', 'visit_reminder', 'appointment', 'a-1', 'waiting')`,
    ).run();
    expect(await env.DB.prepare("SELECT kind FROM outbound_messages WHERE id = 'm3'").first("kind")).toBe(
      "visit_reminder",
    );
  });

  it("still refuses an unknown state", async () => {
    const insert = env.DB.prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state)
       VALUES ('m4', '2026-09-22T04:00:00Z', 'p1', 'tryon_result', 'job-4', 'delivered')`,
    );
    await expect(insert.run()).rejects.toThrow(/CHECK constraint failed/);
  });
});
