import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Settings } from "../../../src/config/settings.ts";
import type { StaticConfig } from "../../../src/guard.ts";
import { verifyToken } from "../../../src/lib/signed-token.ts";
import { createLogger } from "../../../src/log.ts";
import { createEvolutionMessaging, SEND_TIMEOUT_MS } from "../../../src/providers/messaging/evolution.ts";
import type { MessagingProvider, OutboundMessage, SendResult } from "../../../src/providers/messaging/index.ts";
import { MAX_SEND_ATTEMPTS } from "../../../src/config/pipeline.ts";
import { handleMessagingBatch, sendMessage } from "../../../src/queues/messaging.ts";
import {
  LOCAL_CONFIG,
  LOCAL_SETTINGS,
  NOW,
  captureLogs,
  fakeDependencies,
  fakeFetch,
  json,
  markDatabase,
} from "../helpers.ts";
import { fakeBatch } from "../batches.ts";
import { insertJob, insertPerson } from "../tryon-fixtures.ts";

const log = createLogger();

function config(messaging: Partial<Settings["messaging"]> = {}): StaticConfig {
  return { ...LOCAL_CONFIG, settings: { ...LOCAL_SETTINGS, messaging: { ...LOCAL_SETTINGS.messaging, ...messaging } } };
}

/** A messaging provider that records what it was asked to send and answers as told. */
function recordingProvider(answer: SendResult = { ok: true, providerMessageId: "wa-1" }) {
  const sent: { to: string; template: string; params: readonly string[]; media: OutboundMessage["media"] }[] = [];
  const provider: MessagingProvider = {
    send: ({ to, template, params, media }) => {
      sent.push({ to, template, params, media });
      return Promise.resolve(answer);
    },
    connection: () => Promise.resolve({ open: true }),
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

    expect(await sendMessage(env.DB, config(), fakeDependencies({ messaging: provider }), log, "m1")).toEqual({});

    expect(sent).toHaveLength(1);
    // Greeted by first name, with where to book the consultation that shows the look for real.
    expect(sent[0]).toMatchObject({
      to: "+919810000001",
      template: "tryon_result_v1",
      params: ["Arjun", "http://localhost:4321/book"],
    });
    expect(sent[0]?.media?.type).toBe("image/png");
    const link = new URL(sent[0]?.media?.url ?? "");
    // The site answers /api/* on its own origin, locally at :4321 as the browser tests serve it.
    expect(link.origin).toBe("http://localhost:4321");
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

  it("skips, sending nothing, when messaging is off", async () => {
    await queuedMessage();
    const { provider, sent } = recordingProvider();
    await sendMessage(env.DB, config({ enabled: false }), fakeDependencies({ messaging: provider }), log, "m1");
    expect(sent).toEqual([]);
    expect(await message()).toMatchObject({ state: "skipped", last_error: "messaging is off" });
  });

  // Owner ruling, 30 September 2026 ("logins open, reminders fenced", ADR 0025 item 84; ADR 0097): the try-on
  // result answers the person who just claimed it (MESSAGE_CLASSES.tryon_result is "answering"), so it reaches any
  // number even off staging's allowlist.
  it("sends the result to a number off the allowlist, since it answers the person who claimed it", async () => {
    await queuedMessage();
    const { provider, sent } = recordingProvider();
    await sendMessage(
      env.DB,
      config({ allowlist: ["+919810000099"] }),
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
    await sendMessage(env.DB, config(), fakeDependencies({ messaging: provider }), log, "m1");
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
    for (const id of ["m1", "m2", "m3", "m4"]) await sendMessage(env.DB, config(), deps, log, id);
    expect(sent).toHaveLength(3);
    expect(await message("m4")).toMatchObject({ state: "skipped", last_error: "daily message limit reached" });
  });

  it("leaves a message alone that is not queued, or is being sent by another delivery", async () => {
    await queuedMessage();
    const { provider, sent } = recordingProvider();
    await env.DB.prepare("UPDATE outbound_messages SET sending_at = ?").bind(NOW.toISOString()).run();
    await sendMessage(env.DB, config(), fakeDependencies({ messaging: provider }), log, "m1");
    await env.DB.prepare("UPDATE outbound_messages SET state = 'sent'").run();
    await sendMessage(env.DB, config(), fakeDependencies({ messaging: provider }), log, "m1");
    expect(await sendMessage(env.DB, config(), fakeDependencies(), log, "missing")).toEqual({});
    expect(sent).toEqual([]);
  });

  it("retries a transient failure three times, then fails and alerts", async () => {
    await queuedMessage();
    const { provider } = recordingProvider({ ok: false, transient: true, detail: "HTTP 503 +919810000001" });
    const deps = fakeDependencies({ messaging: provider });

    for (let attempt = 1; attempt < MAX_SEND_ATTEMPTS; attempt++) {
      expect(await sendMessage(env.DB, config(), deps, log, "m1")).toEqual({ retryAfterSeconds: 30 });
    }
    expect(await sendMessage(env.DB, config(), deps, log, "m1")).toEqual({});

    expect(await message()).toMatchObject({
      state: "failed",
      attempts: MAX_SEND_ATTEMPTS,
      last_error: "HTTP 503 [redacted]",
    });
    expect(deps.alerts).toEqual([expect.stringContaining("failed after 4 attempts") as string]);
    // Kept for Tasks, where ops may send it again, with the client's page to act from.
    expect(
      await env.DB.prepare("SELECT key, link FROM alerts WHERE resolved_at IS NULL")
        .all()
        .then((answer) => answer.results),
    ).toEqual([{ key: "message_failed:m1", link: "/clients/p" }]);
  });

  it("fails a permanent refusal at once", async () => {
    await queuedMessage();
    const { provider } = recordingProvider({ ok: false, transient: false, detail: "HTTP 400 BAD_REQUEST" });
    const deps = fakeDependencies({ messaging: provider });
    expect(await sendMessage(env.DB, config(), deps, log, "m1")).toEqual({});
    expect(await message()).toMatchObject({ state: "failed", attempts: 1 });
    expect(deps.alerts).toHaveLength(1);
  });

  it("keeps a message queued, with no alert, while the bridge is down, for the sweeper to send once it is back", async () => {
    await queuedMessage();
    const detail = 'the bridge has no instance named "mane man": wrong URL or port, or the instance was deleted';
    const { provider } = recordingProvider({ ok: false, transient: false, bridgeDown: true, detail });
    const deps = fakeDependencies({ messaging: provider });

    expect(await sendMessage(env.DB, config(), deps, log, "m1")).toEqual({});

    expect(await message()).toMatchObject({ state: "queued", attempts: 1, last_error: detail, sending_at: null });
    expect(deps.alerts).toEqual([]);
  });

  it("fails a message the bridge still refuses on its last attempt, though it read as open", async () => {
    await queuedMessage();
    await env.DB.prepare("UPDATE outbound_messages SET attempts = ?")
      .bind(MAX_SEND_ATTEMPTS - 1)
      .run();
    const { provider } = recordingProvider({ ok: false, transient: false, bridgeDown: true, detail: "HTTP 401" });
    const deps = fakeDependencies({ messaging: provider });

    expect(await sendMessage(env.DB, config(), deps, log, "m1")).toEqual({});

    expect(await message()).toMatchObject({ state: "failed", attempts: MAX_SEND_ATTEMPTS });
    expect(deps.alerts).toHaveLength(1);
  });

  it("takes a send that throws as a transient failure, so it fails in the end", async () => {
    await queuedMessage();
    const throwing: MessagingProvider = {
      send: () => Promise.reject(new Error("socket hang up")),
      connection: () => Promise.resolve({ open: true }),
    };
    const deps = fakeDependencies({ messaging: throwing });

    for (let attempt = 1; attempt < MAX_SEND_ATTEMPTS; attempt++) {
      expect(await sendMessage(env.DB, config(), deps, log, "m1")).toEqual({ retryAfterSeconds: 30 });
    }
    expect(await sendMessage(env.DB, config(), deps, log, "m1")).toEqual({});

    expect(await message()).toMatchObject({ state: "failed", attempts: MAX_SEND_ATTEMPTS, last_error: "threw Error" });
    expect(deps.alerts).toHaveLength(1);
  });
});

describe("messaging: the queue batch", () => {
  it("acks a sent message, retries a transient failure with a delay, and drops a malformed one", async () => {
    const id = "00000000-0000-4000-8000-00000000000a";
    await queuedMessage(id);
    const { provider } = recordingProvider({ ok: false, transient: true, detail: "HTTP 503" });
    const batch = fakeBatch("mm-messaging-local", [{ message_id: id, request_id: "r" }, { nope: true }], {
      timestamp: NOW,
    });
    const { messages } = batch;

    await handleMessagingBatch(batch, env.DB, config(), fakeDependencies({ messaging: provider }), log);

    expect(messages[0]?.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(messages[1]?.ack).toHaveBeenCalledOnce();
  });

  it("fails a message that throws on its fourth delivery, and tells ops", async () => {
    const id = "00000000-0000-4000-8000-00000000000b";
    await insertPerson("p", "+919810000001", "Arjun Mehta");
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
         VALUES ('c1', 'p', 'whatsapp_visits', 'whatsapp-visits-v1', 1, ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
           fsm_modified_at, synced_at)
         VALUES ('visit', 'fsm-visit', 'p', 'service', 'scheduled', 'Scheduled', 'not a date', 'not a date', ?1, ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at)
         VALUES (?1, ?2, 'p', 'consultation_confirmation', 'appointment', 'visit', 'queued', ?2)`,
      ).bind(id, NOW.toISOString()),
    ]);
    const deps = fakeDependencies();
    const delivery = (attempts: number) =>
      fakeBatch("mm-messaging-local", [{ message_id: id, request_id: "r" }], { attempts, timestamp: NOW });
    const deliver = (batch: ReturnType<typeof delivery>) => handleMessagingBatch(batch, env.DB, config(), deps, log);

    const third = delivery(MAX_SEND_ATTEMPTS - 1);
    await deliver(third);
    expect(third.messages[0]?.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(await message(id)).toMatchObject({ state: "queued" });

    const fourth = delivery(MAX_SEND_ATTEMPTS);
    await deliver(fourth);
    expect(fourth.messages[0]?.ack).toHaveBeenCalledOnce();
    expect(await message(id)).toMatchObject({ state: "failed", last_error: "could not be sent: Invalid time value" });
    expect(deps.alerts).toEqual([
      expect.stringContaining(`Message ${id} (consultation_confirmation) failed after 4 attempts`) as string,
    ]);
  });
});

describe("Evolution API", () => {
  const settings = { baseUrl: "https://bridge.example", apiKey: "evo-key", instance: "mane man", webhookToken: null };
  const SEND_MEDIA = "https://bridge.example/message/sendMedia/mane%20man";
  const SEND_TEXT = "https://bridge.example/message/sendText/mane%20man";

  it("sends an image with the template's text as its caption, to the digits of the number", async () => {
    const http = fakeFetch({ [SEND_MEDIA]: () => json({ key: { id: "3EB0ABC" }, status: "PENDING" }, 201) });
    const evolution = createEvolutionMessaging(settings, { fetch: http.fetch, log });

    const result = await evolution.send({
      to: "+919810000001",
      template: "tryon_result_v1",
      params: ["Arjun", "https://maneman.in/book"],
      media: { url: "https://x.test/r.png", type: "image/png" },
    });

    expect(result).toEqual({ ok: true, providerMessageId: "3EB0ABC" });
    expect(http.calls[0]?.headers.get("apikey")).toBe("evo-key");
    expect(JSON.parse(http.calls[0]?.body ?? "{}")).toEqual({
      number: "919810000001",
      mediatype: "image",
      mimetype: "image/png",
      caption: expect.stringMatching(/^Hi Arjun, here's your new look from Mane Man\./) as string,
      media: "https://x.test/r.png",
      fileName: "mane-man.png",
    });
  });

  // A render the provider returned as a JPEG was declared a PNG, which WhatsApp then refused or showed broken.
  it("declares the image as the type it was stored as", async () => {
    const http = fakeFetch({ [SEND_MEDIA]: () => json({ key: { id: "3EB0ABC" } }) });
    const evolution = createEvolutionMessaging(settings, { fetch: http.fetch, log });
    await evolution.send({
      to: "+919810000001",
      template: "tryon_result_v1",
      params: ["Arjun", "https://maneman.in/book"],
      media: { url: "https://x.test/r.jpg", type: "image/jpeg" },
    });
    expect(JSON.parse(http.calls[0]?.body ?? "{}")).toMatchObject({ mimetype: "image/jpeg", fileName: "mane-man.jpg" });
  });

  it("sends plain text when there is no image, and refuses an unknown template without calling out", async () => {
    const http = fakeFetch({ [SEND_TEXT]: () => json({ key: { id: "T1" } }) });
    const evolution = createEvolutionMessaging(settings, { fetch: http.fetch, log });
    expect(
      await evolution.send({
        to: "+919810000001",
        template: "tryon_result_v1",
        params: ["Arjun", "https://maneman.in/book"],
      }),
    ).toMatchObject({ ok: true });
    expect(await evolution.send({ to: "+919810000001", template: "tryon_result_v1", params: ["Arjun"] })).toMatchObject(
      {
        ok: false,
        transient: false,
      },
    );
    expect(http.calls).toHaveLength(1);
  });

  it("ends the text with the link that stops it, when the message carries one", async () => {
    const http = fakeFetch({ [SEND_TEXT]: () => json({ key: { id: "T1" } }) });
    const evolution = createEvolutionMessaging(settings, { fetch: http.fetch, log });
    await evolution.send({
      to: "+919810000001",
      template: "launch_alert_v1",
      params: ["Arjun", "Sector 65", "https://maneman.in/book"],
      stopLink: "https://maneman.in/stop#token",
    });
    const { text } = JSON.parse(http.calls[0]?.body ?? "{}") as { text: string };
    expect(text).toMatch(/^Hi Arjun, Mane Man now comes to Sector 65\./);
    expect(text).toMatch(/\n\nStop these messages: https:\/\/maneman\.in\/stop#token$/);
  });

  const sendImage = (evolution: MessagingProvider) =>
    evolution.send({
      to: "+919810000001",
      template: "tryon_result_v1",
      params: ["A", "https://maneman.in/book"],
      media: { url: "https://x.test/r.png", type: "image/png" },
    });

  it.each([
    [500, { error: { code: "INTERNAL_SERVER_ERROR" } }, true, "HTTP 500 INTERNAL_SERVER_ERROR"],
    [429, {}, true, "HTTP 429 "],
    [400, { error: "number 919810000001 does not exist" }, false, "HTTP 400 number ############ does not exist"],
  ])("classifies HTTP %i", async (status, body, transient, detail) => {
    const http = fakeFetch({ [SEND_MEDIA]: () => json(body, status) });
    const evolution = createEvolutionMessaging(settings, { fetch: http.fetch, log });
    expect(await sendImage(evolution)).toEqual({ ok: false, transient, detail });
  });

  it.each([
    [
      404,
      { status: 404, error: "Not Found", response: { message: ['The "mane man" instance does not exist'] } },
      'the bridge has no instance named "mane man": wrong URL or port, or the instance was deleted',
    ],
    [401, { error: { code: "UNAUTHORIZED" } }, "HTTP 401 UNAUTHORIZED"],
    [403, { error: "Forbidden" }, "HTTP 403 Forbidden"],
    [400, { error: "Connection Closed" }, "HTTP 400 Connection Closed"],
  ])("reads HTTP %i as the bridge being down, which is no fault of the message", async (status, body, detail) => {
    const http = fakeFetch({ [SEND_MEDIA]: () => json(body, status) });
    const evolution = createEvolutionMessaging(settings, { fetch: http.fetch, log });
    expect(await sendImage(evolution)).toEqual({ ok: false, transient: false, bridgeDown: true, detail });
  });

  it("treats an unreachable bridge as transient", async () => {
    const http = fakeFetch({
      [SEND_MEDIA]: () => {
        throw new TypeError("fetch failed");
      },
    });
    const evolution = createEvolutionMessaging(settings, { fetch: http.fetch, log });
    expect(
      await evolution.send({
        to: "+919810000001",
        template: "tryon_result_v1",
        params: ["A", "https://maneman.in/book"],
        media: { url: "https://x.test/r.png", type: "image/png" },
      }),
    ).toEqual({
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
    const evolution = createEvolutionMessaging(settings, { fetch: http.fetch, log });
    expect(
      await evolution.send({
        to: "+919810000001",
        template: "tryon_result_v1",
        params: ["A", "https://maneman.in/book"],
        media: { url: "https://x.test/r.png", type: "image/png" },
      }),
    ).toEqual({
      ok: false,
      transient: false,
      detail: "no reply within 60 s: delivery unconfirmed",
    });
  });

  it("gives a text 20 s, so a login code sent after the response is answered inside its 30 s", async () => {
    expect(SEND_TIMEOUT_MS.sendText).toBeLessThanOrEqual(20_000);
    const http = fakeFetch({
      [SEND_TEXT]: () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
    });
    const evolution = createEvolutionMessaging(settings, { fetch: http.fetch, log });
    expect(await evolution.send({ to: "+919810000001", template: "login_code_v1", params: ["123456"] })).toEqual({
      ok: false,
      transient: false,
      detail: "no reply within 20 s: delivery unconfirmed",
    });
  });

  describe("the bridge's connection to WhatsApp", () => {
    const STATE = "https://bridge.example/instance/connectionState/mane%20man";

    it.each([
      [json({ instance: { instanceName: "mane man", state: "open" } }), { open: true }],
      [
        json({ instance: { instanceName: "mane man", state: "close" } }),
        { open: false, fault: "logged_out", detail: "state close" },
      ],
      [json({ state: "connecting" }), { open: false, fault: "logged_out", detail: "state connecting" }],
      [json({ error: "Unauthorized" }, 401), { open: false, fault: "key_refused", detail: "HTTP 401" }],
      [
        json({ status: 404, error: "Not Found" }, 404),
        {
          open: false,
          fault: "no_instance",
          detail: 'the bridge has no instance named "mane man": wrong URL or port, or the instance was deleted',
        },
      ],
      [json({}, 502), { open: false, fault: "unreachable", detail: "HTTP 502" }],
    ])("is read, never written, from its connection state", async (answer, connection) => {
      const http = fakeFetch({ [STATE]: () => answer });
      const evolution = createEvolutionMessaging(settings, { fetch: http.fetch, log });
      expect(await evolution.connection()).toEqual(connection);
      expect(http.calls.map((call) => [call.method, call.headers.get("apikey")])).toEqual([["GET", "evo-key"]]);
    });

    it("is not open when the bridge cannot be reached", async () => {
      const http = fakeFetch({
        [STATE]: () => {
          throw new TypeError("fetch failed");
        },
      });
      const evolution = createEvolutionMessaging(settings, { fetch: http.fetch, log });
      expect(await evolution.connection()).toEqual({
        open: false,
        fault: "unreachable",
        detail: "unreachable: TypeError",
      });
    });
  });
});
