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
    "/api/hooks/evolution",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    },
    { MESSAGE_QUEUE: fakeQueue() },
  );

interface Listed {
  conversations: {
    id: string;
    person: { name: string } | null;
    mobile: string;
    last_line: string | null;
    waiting_since: string | null;
    reply_by: string | null;
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
    // Written at noon, in the Care hours, it is due within the hour.
    expect(Date.parse(thread?.reply_by ?? "") - Date.parse(thread?.waiting_since ?? "")).toBe(60 * 60 * 1000);

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

describe("the Care inbox's list, a page at a time", () => {
  interface Page {
    conversations: { mobile: string; person: { name: string } | null }[];
    next_cursor: string | null;
  }

  const page = async (query: string) =>
    (await (await request(ops, `/api/conversations?view=all&${query}`)).json<Page>()) satisfies Page;

  /** Sixty threads, each a minute later than the one before; the last is Arjun's. */
  async function sixtyThreads(): Promise<void> {
    await env.DB.batch(
      Array.from({ length: 60 }, (_, index) => {
        const at = new Date(Date.parse("2026-09-20T04:00:00Z") + index * 60_000).toISOString();
        const mobile = index === 59 ? "+919810000001" : `+91981100${String(index).padStart(4, "0")}`;
        return env.DB.prepare(
          `INSERT INTO conversations (id, person_id, mobile_e164, state, opened_at, last_message_at, created_at, updated_at)
           VALUES (?1, (SELECT id FROM people WHERE mobile_e164 = ?2), ?2, 'open', ?3, ?3, ?3, ?3)`,
        ).bind(crypto.randomUUID(), mobile, at);
      }),
    );
  }

  it("lists the latest fifty, then the rest from where the page ended, each once", async () => {
    await sixtyThreads();
    const first = await page("");
    expect(first.conversations).toHaveLength(50);
    expect(first.conversations[0]?.mobile).toBe("+919810000001");
    expect(first.next_cursor).not.toBeNull();

    const rest = await page(`cursor=${first.next_cursor ?? ""}`);
    expect(rest.conversations).toHaveLength(10);
    expect(rest.next_cursor).toBeNull();
    const all = [...first.conversations, ...rest.conversations].map((each) => each.mobile);
    expect(new Set(all).size).toBe(60);
    expect(all.at(-1)).toBe("+919811000000");
  });

  it("finds a chat by the client's name, or by part of a number", async () => {
    await sixtyThreads();
    expect((await page("search=arjun")).conversations).toEqual([
      expect.objectContaining({ person: { id: "p1", name: "Arjun Mehta" } }),
    ]);
    expect((await page("search=11000%20042")).conversations.map((each) => each.mobile)).toEqual(["+919811000042"]);
    expect((await page("search=nobody")).conversations).toEqual([]);
  });
});
