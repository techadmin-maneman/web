import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../../src/config/settings.ts";
import type { StaticConfig } from "../../src/guard.ts";
import { verifyToken } from "../../src/lib/signed-token.ts";
import { createLogger } from "../../src/log.ts";
import { createEvolutionMessaging } from "../../src/providers/evolution.ts";
import type { MessagingProvider, SendResult } from "../../src/providers/messaging.ts";
import { MAX_SEND_ATTEMPTS } from "../../src/config/pipeline.ts";
import { handleMessagingBatch, sendResultMessage } from "../../src/queues/messaging.ts";
import {
  LOCAL_CONFIG,
  LOCAL_SETTINGS,
  NOW,
  captureLogs,
  fakeDependencies,
  fakeFetch,
  json,
  markDatabase,
} from "./helpers.ts";
import { insertJob, insertPerson } from "./tryon-fixtures.ts";

const log = createLogger();

function config(messaging: Partial<Settings["messaging"]> = {}): StaticConfig {
  return { ...LOCAL_CONFIG, settings: { ...LOCAL_SETTINGS, messaging: { ...LOCAL_SETTINGS.messaging, ...messaging } } };
}

/** A messaging provider that records what it was asked to send and answers as told. */
function recordingProvider(answer: SendResult = { ok: true, providerMessageId: "wa-1" }) {
  const sent: { to: string; template: string; params: readonly string[]; mediaUrl: string | undefined }[] = [];
  const provider: MessagingProvider = {
    sendTemplate: (to, template, params, mediaUrl) => {
      sent.push({ to, template, params, mediaUrl });
      return Promise.resolve(answer);
    },
  };
  return { provider, sent };
}

async function queuedMessage(id = "m1", jobState = "ready"): Promise<void> {
  await insertPerson("p", "+919810000001", "Arjun Mehta");
  await insertJob({ id: "job", state: jobState, result_key: "results/job.png" });
  await env.DB.prepare(
    `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state, queued_at)
     VALUES (?, ?, 'p', 'tryon_result', 'job', 'queued', ?)`,
  )
    .bind(id, NOW.toISOString(), NOW.toISOString())
    .run();
}

function message(id = "m1") {
  return env.DB.prepare(
    "SELECT state, attempts, provider_message_id, last_error, sent_at, sending_at FROM outbound_messages WHERE id = ?",
  )
    .bind(id)
    .first();
}

beforeEach(async () => {
  await markDatabase();
  captureLogs();
});

describe("messaging: sending a result", () => {
  it("sends the result template with the person's name and a one-hour signed link, and records the send", async () => {
    await queuedMessage();
    const { provider, sent } = recordingProvider();

    expect(await sendResultMessage(env.DB, config(), fakeDependencies({ messaging: provider }), log, "m1")).toEqual({});

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "+919810000001", template: "tryon_result_v1", params: ["Arjun Mehta"] });
    const link = new URL(sent[0]?.mediaUrl ?? "");
    expect(link.origin).toBe("http://localhost:8787");
    const token = link.pathname.replace("/api/result/", "");
    const key = LOCAL_SETTINGS.tryon.linkSigningKey;
    expect(await verifyToken(key, "result", token, new Date(NOW.getTime() + 59 * 60_000))).toBe("results/job.png");
    expect(await verifyToken(key, "result", token, new Date(NOW.getTime() + 61 * 60_000))).toBeNull();

    expect(await message()).toMatchObject({
      state: "sent",
      attempts: 1,
      provider_message_id: "wa-1",
      sent_at: NOW.toISOString(),
      sending_at: null,
    });
  });

  it.each([
    ["messaging is off", config({ enabled: false }), "messaging is off"],
    ["the number is not on the allowlist", config({ allowlist: ["+919810000099"] }), "number not on the allowlist"],
  ])("skips, sending nothing, when %s", async (_label, settings, reason) => {
    await queuedMessage();
    const { provider, sent } = recordingProvider();
    await sendResultMessage(env.DB, settings, fakeDependencies({ messaging: provider }), log, "m1");
    expect(sent).toEqual([]);
    expect(await message()).toMatchObject({ state: "skipped", last_error: reason });
  });

  it("sends to a number on the allowlist", async () => {
    await queuedMessage();
    const { provider, sent } = recordingProvider();
    await sendResultMessage(
      env.DB,
      config({ allowlist: ["+919810000001"] }),
      fakeDependencies({ messaging: provider }),
      log,
      "m1",
    );
    expect(sent).toHaveLength(1);
  });

  it("never sends to a person who has been erased, or without a result", async () => {
    await queuedMessage();
    await env.DB.prepare("UPDATE people SET erased_at = ?").bind(NOW.toISOString()).run();
    const { provider, sent } = recordingProvider();
    await sendResultMessage(env.DB, config(), fakeDependencies({ messaging: provider }), log, "m1");
    expect(sent).toEqual([]);
    expect(await message()).toMatchObject({ state: "skipped", last_error: "person erased" });
  });

  it("skips once the number has had its three result messages today", async () => {
    const { provider, sent } = recordingProvider();
    const deps = fakeDependencies({ messaging: provider });
    await queuedMessage("m1");
    for (const id of ["m2", "m3", "m4"]) {
      await env.DB.prepare(
        `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state, queued_at)
         VALUES (?, ?, 'p', 'tryon_result', 'job', 'queued', ?)`,
      )
        .bind(id, NOW.toISOString(), NOW.toISOString())
        .run();
    }
    for (const id of ["m1", "m2", "m3", "m4"]) await sendResultMessage(env.DB, config(), deps, log, id);
    expect(sent).toHaveLength(3);
    expect(await message("m4")).toMatchObject({ state: "skipped", last_error: "daily message limit reached" });
  });

  it("leaves a message alone that is not queued, or is being sent by another delivery", async () => {
    await queuedMessage();
    const { provider, sent } = recordingProvider();
    await env.DB.prepare("UPDATE outbound_messages SET sending_at = ?").bind(NOW.toISOString()).run();
    await sendResultMessage(env.DB, config(), fakeDependencies({ messaging: provider }), log, "m1");
    await env.DB.prepare("UPDATE outbound_messages SET state = 'sent'").run();
    await sendResultMessage(env.DB, config(), fakeDependencies({ messaging: provider }), log, "m1");
    expect(await sendResultMessage(env.DB, config(), fakeDependencies(), log, "missing")).toEqual({});
    expect(sent).toEqual([]);
  });

  it("retries a transient failure three times, then fails and alerts", async () => {
    await queuedMessage();
    const { provider } = recordingProvider({ ok: false, transient: true, detail: "HTTP 503 +919810000001" });
    const deps = fakeDependencies({ messaging: provider });

    for (let attempt = 1; attempt < MAX_SEND_ATTEMPTS; attempt++) {
      expect(await sendResultMessage(env.DB, config(), deps, log, "m1")).toEqual({ retryAfterSeconds: 30 });
    }
    expect(await sendResultMessage(env.DB, config(), deps, log, "m1")).toEqual({});

    expect(await message()).toMatchObject({
      state: "failed",
      attempts: MAX_SEND_ATTEMPTS,
      last_error: "HTTP 503 [redacted]",
    });
    expect(deps.alerts).toEqual([expect.stringContaining("failed after 4 attempts") as string]);
  });

  it("fails a permanent refusal at once", async () => {
    await queuedMessage();
    const { provider } = recordingProvider({ ok: false, transient: false, detail: "HTTP 400 BAD_REQUEST" });
    const deps = fakeDependencies({ messaging: provider });
    expect(await sendResultMessage(env.DB, config(), deps, log, "m1")).toEqual({});
    expect(await message()).toMatchObject({ state: "failed", attempts: 1 });
    expect(deps.alerts).toHaveLength(1);
  });
});

describe("messaging: the queue batch", () => {
  it("acks a sent message, retries a transient failure with a delay, and drops a malformed one", async () => {
    const id = "00000000-0000-4000-8000-00000000000a";
    await queuedMessage(id);
    const { provider } = recordingProvider({ ok: false, transient: true, detail: "HTTP 503" });
    const messages = [{ message_id: id, request_id: "r" }, { nope: true }].map((body, index) => ({
      id: String(index),
      body,
      attempts: 1,
      timestamp: NOW,
      ack: vi.fn(),
      retry: vi.fn(),
    }));
    const batch = { queue: "mm-messaging-local", messages, ackAll: vi.fn(), retryAll: vi.fn() };

    await handleMessagingBatch(
      batch as unknown as MessageBatch,
      env.DB,
      config(),
      fakeDependencies({ messaging: provider }),
      log,
    );

    expect(messages[0]?.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(messages[1]?.ack).toHaveBeenCalledOnce();
  });
});

describe("Evolution API", () => {
  const settings = { baseUrl: "https://bridge.example", apiKey: "evo-key", instance: "mane man" };
  const SEND_MEDIA = "https://bridge.example/message/sendMedia/mane%20man";
  const SEND_TEXT = "https://bridge.example/message/sendText/mane%20man";

  it("sends an image with the template's text as its caption, to the digits of the number", async () => {
    const http = fakeFetch({ [SEND_MEDIA]: () => json({ key: { id: "3EB0ABC" }, status: "PENDING" }, 201) });
    const evolution = createEvolutionMessaging(settings, { fetch: http.fetch });

    const result = await evolution.sendTemplate("+919810000001", "tryon_result_v1", ["Arjun"], "https://x.test/r.png");

    expect(result).toEqual({ ok: true, providerMessageId: "3EB0ABC" });
    expect(http.calls[0]?.headers.get("apikey")).toBe("evo-key");
    expect(JSON.parse(http.calls[0]?.body ?? "{}")).toEqual({
      number: "919810000001",
      mediatype: "image",
      mimetype: "image/png",
      caption: expect.stringMatching(/^Hello Arjun, here is your Mane Man try-on\./) as string,
      media: "https://x.test/r.png",
      fileName: "mane-man.png",
    });
  });

  it("sends plain text when there is no image, and refuses an unknown template without calling out", async () => {
    const http = fakeFetch({ [SEND_TEXT]: () => json({ key: { id: "T1" } }) });
    const evolution = createEvolutionMessaging(settings, { fetch: http.fetch });
    expect(await evolution.sendTemplate("+919810000001", "tryon_result_v1", ["Arjun"])).toMatchObject({ ok: true });
    expect(await evolution.sendTemplate("+919810000001", "nope", ["Arjun"])).toMatchObject({
      ok: false,
      transient: false,
    });
    expect(http.calls).toHaveLength(1);
  });

  it.each([
    [500, { error: { code: "INTERNAL_SERVER_ERROR" } }, true, "HTTP 500 INTERNAL_SERVER_ERROR"],
    [429, {}, true, "HTTP 429 "],
    [400, { error: "Connection Closed" }, true, "HTTP 400 Connection Closed"],
    [401, { error: { code: "UNAUTHORIZED" } }, false, "HTTP 401 UNAUTHORIZED"],
    [400, { error: "number 919810000001 does not exist" }, false, "HTTP 400 number ############ does not exist"],
  ])("classifies HTTP %i", async (status, body, transient, detail) => {
    const http = fakeFetch({ [SEND_MEDIA]: () => json(body, status) });
    const evolution = createEvolutionMessaging(settings, { fetch: http.fetch });
    expect(await evolution.sendTemplate("+919810000001", "tryon_result_v1", ["A"], "https://x.test/r.png")).toEqual({
      ok: false,
      transient,
      detail,
    });
  });

  it("treats an unreachable bridge as transient", async () => {
    const http = fakeFetch({
      [SEND_MEDIA]: () => {
        throw new TypeError("fetch failed");
      },
    });
    const evolution = createEvolutionMessaging(settings, { fetch: http.fetch });
    expect(await evolution.sendTemplate("+919810000001", "tryon_result_v1", ["A"], "https://x.test/r.png")).toEqual({
      ok: false,
      transient: true,
      detail: "unreachable: TypeError",
    });
  });

  it("never retries a send that timed out, because it may already have been delivered", async () => {
    const http = fakeFetch({
      [SEND_MEDIA]: () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
    });
    const evolution = createEvolutionMessaging(settings, { fetch: http.fetch });
    expect(await evolution.sendTemplate("+919810000001", "tryon_result_v1", ["A"], "https://x.test/r.png")).toEqual({
      ok: false,
      transient: false,
      detail: "no reply within 60 s: delivery unconfirmed",
    });
  });
});
