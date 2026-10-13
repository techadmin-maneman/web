// Answering in the Care inbox (src/domain/care/replies.ts, src/routes/ops/conversations.ts;
// docs/decisions/0130-replies-from-the-care-inbox.md): a reply sent from our number and kept whether it went or not,
// a note never sent, and a thread closed with what it was about. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { MessagingProvider, SendResult } from "../../../src/providers/messaging/index.ts";
import type { Settings } from "../../../src/config/settings.ts";
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

const THREAD = "8c1d9f4b-5e6a-4b7c-9d8e-3f4a5b6c7d8e";

interface Thread {
  conversation: { state: string };
  items: { kind: string; text?: string | null; delivery?: string | null }[];
}

/** A provider that records each reply, answering `result`; without `reply` at all where `replies` is false. */
function provider(result: SendResult = { ok: true, providerMessageId: "wa-9" }, replies = true) {
  const sent: { to: string; text: string }[] = [];
  const messaging: MessagingProvider = {
    send: () => Promise.resolve({ ok: true, providerMessageId: "wa-1" }),
    connection: () => Promise.resolve({ open: true }),
    ...(replies
      ? {
          reply: (to: string, text: string) => {
            sent.push({ to, text });
            return Promise.resolve(result);
          },
        }
      : {}),
  };
  return { messaging, sent };
}

let crmQueue: ReturnType<typeof fakeQueue>;

const post = (
  messaging: MessagingProvider,
  path: string,
  body: unknown,
  settings: Partial<Settings["messaging"]> = {},
) =>
  request(
    appFor(
      "local",
      fakeDependencies({ messaging }),
      { messaging: { ...LOCAL_SETTINGS.messaging, ...settings } },
      "ops",
    ),
    path,
    {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { CRM_QUEUE: crmQueue },
  );

beforeEach(async () => {
  captureLogs();
  crmQueue = fakeQueue();
  await markDatabase();
  await insertPerson("p1", "+919810000001", "Arjun Mehta");
  await env.DB.prepare(
    `INSERT INTO conversations (id, person_id, mobile_e164, state, opened_at, last_message_at, last_inbound_at,
       created_at, updated_at)
     VALUES (?1, 'p1', '+919810000001', 'open', ?2, ?2, ?2, ?2, ?2)`,
  )
    .bind(THREAD, NOW.toISOString())
    .run();
});

describe("a reply", () => {
  it("goes from our number, is kept in the thread as sent, and leaves the thread waiting on the client", async () => {
    const { messaging, sent } = provider();
    const answer = await post(messaging, `/api/conversations/${THREAD}/replies`, { text: "Yes, 6 pm works. Booked." });
    expect(answer.status).toBe(200);
    expect(sent).toEqual([{ to: "+919810000001", text: "Yes, 6 pm works. Booked." }]);
    const thread = await answer.json<Thread>();
    expect(thread.conversation.state).toBe("waiting");
    expect(thread.items).toEqual([
      expect.objectContaining({ kind: "out", text: "Yes, 6 pm works. Booked.", delivery: "sent" }),
    ]);
  });

  it("is kept as failed, with why, when WhatsApp refuses it, and the thread still waits on us", async () => {
    const { messaging } = provider({ ok: false, transient: false, detail: "HTTP 400 not on WhatsApp" });
    const thread = await (
      await post(messaging, `/api/conversations/${THREAD}/replies`, { text: "Hello" })
    ).json<Thread>();
    expect(thread.conversation.state).toBe("open");
    expect(thread.items).toEqual([expect.objectContaining({ kind: "out", delivery: "failed" })]);
    const row = await env.DB.prepare("SELECT failure FROM chat_messages").first();
    expect(row).toEqual({ failure: "HTTP 400 not on WhatsApp" });
  });

  it("is kept unsent, with why, while messaging is off", async () => {
    const { messaging, sent } = provider();
    await post(messaging, `/api/conversations/${THREAD}/replies`, { text: "Hello" }, { enabled: false });
    expect(sent).toEqual([]);
    const row = await env.DB.prepare("SELECT delivery, failure FROM chat_messages").first();
    expect(row).toEqual({ delivery: "failed", failure: "Not sent: messaging is off." });
  });

  it("is held back to a test record off staging's allowlist, and goes to one on it", async () => {
    await env.DB.prepare("UPDATE people SET test_record = 1 WHERE id = 'p1'").run();
    const { messaging, sent } = provider();
    await post(messaging, `/api/conversations/${THREAD}/replies`, { text: "Hello" }, { allowlist: ["+919810000099"] });
    expect(sent).toEqual([]);
    await post(
      messaging,
      `/api/conversations/${THREAD}/replies`,
      { text: "Hello again" },
      { allowlist: ["+919810000001"] },
    );
    expect(sent).toEqual([{ to: "+919810000001", text: "Hello again" }]);
  });

  it("cannot go where the provider sends no free text, or to an erased client's thread", async () => {
    expect(
      (await post(provider(undefined, false).messaging, `/api/conversations/${THREAD}/replies`, { text: "Hi" })).status,
    ).toBe(503);
    await env.DB.prepare("UPDATE conversations SET mobile_e164 = 'erased:' || id").run();
    const { messaging, sent } = provider();
    expect((await post(messaging, `/api/conversations/${THREAD}/replies`, { text: "Hi" })).status).toBe(404);
    expect(sent).toEqual([]);
  });
});

describe("a note and closing", () => {
  it("keeps a note for staff, never sending it", async () => {
    const { messaging, sent } = provider();
    const thread = await (
      await post(messaging, `/api/conversations/${THREAD}/notes`, { text: "Prefers calls after 6" })
    ).json<Thread>();
    expect(thread.items).toEqual([expect.objectContaining({ kind: "note", text: "Prefers calls after 6" })]);
    expect(sent).toEqual([]);
  });

  it("closes the thread with what it was about, audited by the thread alone", async () => {
    const { messaging } = provider();
    const thread = await (
      await post(messaging, `/api/conversations/${THREAD}/close`, { reason: "move_or_cancel" })
    ).json<Thread>();
    expect(thread.conversation.state).toBe("closed");
    const row = await env.DB.prepare("SELECT close_reason FROM conversations").first();
    expect(row).toEqual({ close_reason: "move_or_cancel" });
    const { results } = await env.DB.prepare(
      "SELECT action, subject_id, detail FROM audit_log WHERE action LIKE 'chat.%'",
    ).all();
    expect(results).toEqual([
      { action: "chat.close", subject_id: THREAD, detail: JSON.stringify({ reason: "move_or_cancel" }) },
    ]);
    // The client's CRM lead is told when they were last in touch, and what about (ADR 0137).
    expect(crmQueue.sent).toMatchObject([{ update_person_id: "p1" }]);
  });

  it("knows no thread it does not have", async () => {
    const { messaging } = provider();
    expect((await post(messaging, `/api/conversations/${crypto.randomUUID()}/notes`, { text: "x" })).status).toBe(404);
    expect((await post(messaging, `/api/conversations/${crypto.randomUUID()}/close`, { reason: "other" })).status).toBe(
      404,
    );
  });
});
