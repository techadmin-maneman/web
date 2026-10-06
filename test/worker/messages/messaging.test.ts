import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Settings } from "../../../src/config/settings.ts";
import type { StaticConfig } from "../../../src/guard.ts";
import { verifyToken } from "../../../src/lib/signed-token.ts";
import type { MessagingProvider, OutboundMessage, SendResult } from "../../../src/providers/messaging/index.ts";
import { MAX_SEND_ATTEMPTS } from "../../../src/config/pipeline.ts";
import { handleMessagingBatch, sendMessage } from "../../../src/queues/messaging.ts";
import { LOCAL_CONFIG, LOCAL_SETTINGS, NOW, captureLogs, fakeDependencies, markDatabase } from "../helpers.ts";
import { fakeBatch } from "../batches.ts";
import { insertJob, insertPerson } from "../tryon-fixtures.ts";
import { log, message } from "./messaging-fixtures.ts";

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

beforeEach(async () => {
  await markDatabase();
  captureLogs();
});

describe("messaging: sending a result", () => {
  it("sends the result template with the person's name and a one-hour signed link, and records the send", async () => {
    await queuedMessage();
    const { provider, sent } = recordingProvider();

    expect(
      await sendMessage({
        db: env.DB,
        config: config(),
        deps: fakeDependencies({ messaging: provider }),
        log,
        messageId: "m1",
      }),
    ).toEqual({});

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
    await sendMessage({
      db: env.DB,
      config: config({ enabled: false }),
      deps: fakeDependencies({ messaging: provider }),
      log,
      messageId: "m1",
    });
    expect(sent).toEqual([]);
    expect(await message()).toMatchObject({ state: "skipped", last_error: "messaging is off" });
  });

  // Logins open, reminders fenced (ADR 0097): the try-on
  // result answers the person who just claimed it (MESSAGE_CLASSES.tryon_result is "answering"), so it reaches any
  // number even off staging's allowlist.
  it("sends the result to a number off the allowlist, since it answers the person who claimed it", async () => {
    await queuedMessage();
    const { provider, sent } = recordingProvider();
    await sendMessage({
      db: env.DB,
      config: config({ allowlist: ["+919810000099"] }),
      deps: fakeDependencies({ messaging: provider }),
      log,
      messageId: "m1",
    });
    expect(sent).toHaveLength(1);
  });

  it("never sends to a person who has been erased, or without a result", async () => {
    await queuedMessage();
    await env.DB.prepare("UPDATE people SET erased_at = ?").bind(NOW.toISOString()).run();
    const { provider, sent } = recordingProvider();
    await sendMessage({
      db: env.DB,
      config: config(),
      deps: fakeDependencies({ messaging: provider }),
      log,
      messageId: "m1",
    });
    expect(sent).toEqual([]);
    expect(await message()).toMatchObject({ state: "skipped", last_error: "person erased" });
  });

  it("never sends to a record whose number a client took over", async () => {
    await queuedMessage();
    await env.DB.prepare("UPDATE people SET mobile_e164 = 'released:' || id").run();
    const { provider, sent } = recordingProvider();
    await sendMessage({
      db: env.DB,
      config: config(),
      deps: fakeDependencies({ messaging: provider }),
      log,
      messageId: "m1",
    });
    expect(sent).toEqual([]);
    expect(await message()).toMatchObject({ state: "skipped", last_error: "no number" });
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
    for (const id of ["m1", "m2", "m3", "m4"])
      await sendMessage({ db: env.DB, config: config(), deps, log, messageId: id });
    expect(sent).toHaveLength(3);
    expect(await message("m4")).toMatchObject({ state: "skipped", last_error: "daily message limit reached" });
  });

  it("leaves a message alone that is not queued, or is being sent by another delivery", async () => {
    await queuedMessage();
    const { provider, sent } = recordingProvider();
    await env.DB.prepare("UPDATE outbound_messages SET sending_at = ?").bind(NOW.toISOString()).run();
    await sendMessage({
      db: env.DB,
      config: config(),
      deps: fakeDependencies({ messaging: provider }),
      log,
      messageId: "m1",
    });
    await env.DB.prepare("UPDATE outbound_messages SET state = 'sent'").run();
    await sendMessage({
      db: env.DB,
      config: config(),
      deps: fakeDependencies({ messaging: provider }),
      log,
      messageId: "m1",
    });
    expect(
      await sendMessage({ db: env.DB, config: config(), deps: fakeDependencies(), log, messageId: "missing" }),
    ).toEqual({});
    expect(sent).toEqual([]);
  });

  it("retries a transient failure three times, then fails and alerts", async () => {
    await queuedMessage();
    const { provider } = recordingProvider({ ok: false, transient: true, detail: "HTTP 503 +919810000001" });
    const deps = fakeDependencies({ messaging: provider });

    for (let attempt = 1; attempt < MAX_SEND_ATTEMPTS; attempt++) {
      expect(await sendMessage({ db: env.DB, config: config(), deps, log, messageId: "m1" })).toEqual({
        retryAfterSeconds: 30,
      });
    }
    expect(await sendMessage({ db: env.DB, config: config(), deps, log, messageId: "m1" })).toEqual({});

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
    expect(await sendMessage({ db: env.DB, config: config(), deps, log, messageId: "m1" })).toEqual({});
    expect(await message()).toMatchObject({ state: "failed", attempts: 1 });
    expect(deps.alerts).toHaveLength(1);
  });

  it("keeps a message queued, with no alert, while the bridge is down, for the sweeper to send once it is back", async () => {
    await queuedMessage();
    const detail = 'the bridge has no instance named "mane man": wrong URL or port, or the instance was deleted';
    const { provider } = recordingProvider({ ok: false, transient: false, bridgeDown: true, detail });
    const deps = fakeDependencies({ messaging: provider });

    expect(await sendMessage({ db: env.DB, config: config(), deps, log, messageId: "m1" })).toEqual({});

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

    expect(await sendMessage({ db: env.DB, config: config(), deps, log, messageId: "m1" })).toEqual({});

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
      expect(await sendMessage({ db: env.DB, config: config(), deps, log, messageId: "m1" })).toEqual({
        retryAfterSeconds: 30,
      });
    }
    expect(await sendMessage({ db: env.DB, config: config(), deps, log, messageId: "m1" })).toEqual({});

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

    await handleMessagingBatch({
      batch,
      db: env.DB,
      config: config(),
      deps: fakeDependencies({ messaging: provider }),
      log,
    });

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
    const deliver = (batch: ReturnType<typeof delivery>) =>
      handleMessagingBatch({ batch, db: env.DB, config: config(), deps, log });

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
