// The Care inbox (src/domain/care/inbox.ts, src/routes/ops/conversations.ts, src/routes/hooks/evolution.ts;
// docs/decisions/0129-the-care-inbox.md): what a client writes to our number lands in their thread, once, beside our
// automatic messages to them. Every name, number and message here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Settings } from "../../../src/config/settings.ts";
import type { App } from "../../../src/http/context.ts";
import { appFor, captureLogs, fakeDependencies, fakeQueue, LOCAL_SETTINGS, markDatabase, request } from "../helpers.ts";
import { insertPerson } from "../tryon-fixtures.ts";

const TOKEN = "a-webhook-token-of-at-least-thirty-two-chars";
const EVOLUTION: NonNullable<Settings["messaging"]["evolution"]> = {
  baseUrl: "https://bridge.example",
  apiKey: "evolution-instance-key",
  instance: "maneman",
  webhookToken: TOKEN,
};

let ops: App;

/** A message to our number, as the bridge posts it. */
function written(text: string, from = "919810000001", id = crypto.randomUUID()) {
  return {
    event: "messages.upsert",
    instance: "maneman",
    data: {
      key: { remoteJid: `${from}@s.whatsapp.net`, fromMe: false, id },
      pushName: "Arjun",
      message: { conversation: text },
      messageType: "conversation",
    },
  };
}

const post = (body: unknown) =>
  request(
    appFor("local", fakeDependencies(), { messaging: { ...LOCAL_SETTINGS.messaging, evolution: EVOLUTION } }),
    `/api/hooks/evolution/${TOKEN}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    { MESSAGE_QUEUE: fakeQueue() },
  );

interface Listed {
  conversations: {
    id: string;
    person: { name: string } | null;
    mobile: string;
    last_line: string | null;
    waiting_since: string | null;
  }[];
}

const listed = async (view = "open") =>
  (await (await request(ops, `/api/conversations?view=${view}`)).json<Listed>()).conversations;

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await insertPerson("p1", "+919810000001", "Arjun Mehta");
  await env.DB.prepare(
    `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state, provider_message_id, queued_at,
       sent_at, delivered_at)
     VALUES ('m1', '2026-09-20T04:00:00Z', 'p1', 'visit_reminder', 'a1', 'sent', 'wa-1', '2026-09-20T04:00:00Z',
       '2026-09-20T04:00:01Z', '2026-09-20T04:00:05Z')`,
  ).run();
});

describe("the Care inbox", () => {
  it("files what a client writes in their thread, beside our automatic messages to them", async () => {
    expect((await post(written("Can I move tomorrow's visit to the evening?"))).status).toBe(204);
    const [thread] = await listed();
    expect(thread).toMatchObject({
      person: { name: "Arjun Mehta" },
      mobile: "+919810000001",
      last_line: "Can I move tomorrow's visit to the evening?",
      waiting_since: expect.any(String) as string,
    });

    const opened = await (
      await request(ops, `/api/conversations/${thread?.id ?? ""}`)
    ).json<{
      items: { kind: string; text?: string; message?: string; delivered_at?: string | null }[];
    }>();
    expect(opened.items).toEqual([
      expect.objectContaining({ kind: "auto", message: "visit_reminder", delivered_at: "2026-09-20T04:00:05Z" }),
      expect.objectContaining({ kind: "in", text: "Can I move tomorrow's visit to the evening?" }),
    ]);
  });

  it("files a message the bridge reports twice once, and keeps one thread a number", async () => {
    const same = written("Hello", "919810000001", "3EB0SAME");
    await post(same);
    await post(same);
    await post(written("Are you there?"));
    expect(await listed()).toHaveLength(1);
    const { results } = await env.DB.prepare("SELECT text FROM chat_messages ORDER BY sent_at").all();
    expect(results).toEqual([{ text: "Hello" }, { text: "Are you there?" }]);
  });

  it("keeps a number we do not know as a thread of its own, with nobody's name", async () => {
    await post(written("Do you come to Noida?", "919811112222"));
    expect(await listed()).toMatchObject([{ person: null, mobile: "+919811112222" }]);
  });

  it("reopens a closed thread when the client writes again", async () => {
    await post(written("Thanks!"));
    await env.DB.prepare("UPDATE conversations SET state = 'closed', closed_at = '2026-09-21T06:00:00Z'").run();
    expect(await listed()).toEqual([]);
    expect(await listed("closed")).toHaveLength(1);
    await post(written("One more thing"));
    expect(await listed()).toMatchObject([{ last_line: "One more thing" }]);
  });

  it("still stops our messages on a STOP, and files it too", async () => {
    await post(written("STOP"));
    expect(await listed()).toMatchObject([{ last_line: "STOP" }]);
  });

  it("knows no thread it does not have", async () => {
    expect((await request(ops, `/api/conversations/${crypto.randomUUID()}`)).status).toBe(404);
  });
});
