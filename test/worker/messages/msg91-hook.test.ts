// MSG91's WhatsApp webhook (src/routes/hooks/msg91.ts; docs/decisions/0197-one-inbound-port.md), with payloads shaped
// as MSG91's webhook guide documents them: an outbound report marks our message delivered and read, an inbound
// message is filed in the Care inbox, a STOP, typed or pressed as a quick reply, withdraws the sender's WhatsApp
// consents, and a wrong token, or one in the path, is refused. Every value here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Settings } from "../../../src/config/settings.ts";
import { appFor, captureLogs, fakeDependencies, fakeQueue, LOCAL_SETTINGS, markDatabase, request } from "../helpers.ts";
import { insertPerson } from "../tryon-fixtures.ts";

const TOKEN = "an-msg91-webhook-token-of-thirty-two-chars";
const MSG91: NonNullable<Settings["messaging"]["msg91"]> = {
  authKey: "msg91-key",
  integratedNumber: "919800000000",
  webhookToken: TOKEN,
};
const MOBILE = "+919810000001";

let logs: ReturnType<typeof captureLogs>;
let queue: ReturnType<typeof fakeQueue>;

beforeEach(async () => {
  logs = captureLogs();
  queue = fakeQueue();
  await markDatabase();
  await insertPerson("p1", MOBILE);
  await env.DB.prepare(
    `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state, provider_message_id, sent_at)
     VALUES ('m1', '2026-09-22T04:00:00Z', 'p1', 'visit_reminder', 'a1', 'sent', 'msg91-req-1', '2026-09-22T04:00:01Z')`,
  ).run();
});

function post(body: unknown, token = TOKEN, msg91: Settings["messaging"]["msg91"] = MSG91) {
  return request(
    appFor("local", fakeDependencies(), { messaging: { ...LOCAL_SETTINGS.messaging, msg91 } }),
    "/api/hooks/msg91",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    },
    { MESSAGE_QUEUE: queue },
  );
}

/** An outbound report as MSG91 posts it. */
const report = (eventName: string) => ({
  crqid: "",
  companyId: "12345",
  customerNumber: "919810000001",
  requestId: "msg91-req-1",
  eventName,
  uuid: "wamid.HBgM",
  integratedNumber: "919800000000",
  direction: "1",
  templateName: "visit_reminder_v1",
  ts: "2026-09-22T09:30:05+05:30",
});

/** An inbound message as MSG91 posts it: its words in `text`, or in the stringified fields given. */
const inbound = (fields: object) => ({
  companyId: "12345",
  customerNumber: "919810000001",
  customerName: "Arjun",
  eventName: "",
  uuid: "wamid.INBOUND",
  integratedNumber: "919800000000",
  direction: "0",
  contentType: "text",
  ts: "2026-09-22T09:31:00+05:30",
  ...fields,
});

const delivery = () =>
  env.DB.prepare("SELECT delivered_at, read_at FROM outbound_messages WHERE id = 'm1'").first<{
    delivered_at: string | null;
    read_at: string | null;
  }>();

describe("POST /api/hooks/msg91", () => {
  it("marks our message delivered, then read, from MSG91's reports, by the request it was sent under", async () => {
    expect((await post(report("delivered"))).status).toBe(204);
    expect(await delivery()).toMatchObject({ delivered_at: expect.any(String) as string, read_at: null });
    await post([report("read"), report("failed")]);
    expect((await delivery())?.read_at).not.toBeNull();
  });

  it("files a message to our number in the client's thread", async () => {
    await post(inbound({ text: "Can my visit move to the evening?" }));
    const thread = await env.DB.prepare(
      "SELECT c.person_id, m.text FROM conversations c JOIN chat_messages m ON m.conversation_id = c.id",
    ).first();
    expect(thread).toEqual({ person_id: "p1", text: "Can my visit move to the evening?" });
  });

  it("reads the words from the stringified content, or the messages list", async () => {
    await post(inbound({ content: JSON.stringify({ text: "From content" }) }));
    await post(
      inbound({ uuid: "wamid.TWO", messages: JSON.stringify([{ id: "wamid.TWO", text: { body: "From messages" } }]) }),
    );
    const { results } = await env.DB.prepare("SELECT text FROM chat_messages ORDER BY sent_at, text").all();
    expect(results.map((row) => row.text)).toEqual(["From content", "From messages"]);
  });

  it("stops our messages on a STOP pressed as a quick reply, and answers once", async () => {
    await env.DB.prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, source)
       VALUES ('c1', 'p1', 'whatsapp_visits', 'v1', 1, '2026-09-01T00:00:00Z', 'app_profile')`,
    ).run();
    await post(inbound({ contentType: "button", button: JSON.stringify({ payload: "Stop", text: "Stop" }) }));
    const latest = await env.DB.prepare(
      "SELECT granted, source FROM consents WHERE purpose = 'whatsapp_visits' ORDER BY created_at DESC LIMIT 1",
    ).first();
    expect(latest).toEqual({ granted: 0, source: "whatsapp_stop" });
    expect(queue.sent).toHaveLength(1);
  });

  it("refuses a wrong token, and answers 404 until a token is set", async () => {
    expect((await post(report("delivered"), "a-wrong-token-of-thirty-two-characters")).status).toBe(401);
    expect((await post(report("delivered"), TOKEN, { ...MSG91, webhookToken: null })).status).toBe(404);
    expect((await post(report("delivered"), TOKEN, null)).status).toBe(404);
    expect((await delivery())?.delivered_at).toBeNull();
  });

  // A token in the path sits in every proxy log on the way.
  it("takes the token only as an Authorization header, never in the path", async () => {
    const app = appFor("local", fakeDependencies(), { messaging: { ...LOCAL_SETTINGS.messaging, msg91: MSG91 } });
    const send = (path: string) =>
      request(app, path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report("delivered")),
      });
    expect((await send(`/api/hooks/msg91/${TOKEN}`)).status).toBe(404);
    expect((await send("/api/hooks/msg91")).status).toBe(401);
    expect((await delivery())?.delivered_at).toBeNull();
    expect(JSON.stringify(logs.lines())).not.toContain(TOKEN);
  });

  it("logs no number, no words and no token", async () => {
    await post(inbound({ text: "My number is 9810000001" }));
    const written = JSON.stringify(logs.lines());
    expect(written).toContain("msg91_inbound");
    for (const secret of ["9810000001", "My number", TOKEN]) expect(written).not.toContain(secret);
  });
});
