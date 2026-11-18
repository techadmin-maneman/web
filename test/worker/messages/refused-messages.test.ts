// A message WhatsApp refused after MSG91 took it (docs/decisions/0276-a-message-whatsapp-refuses.md): MSG91's failed
// report marks it failed with WhatsApp's code, Care get a task to tell the client another way, the no-show evidence
// stops reading it as sent, and a refused look is still the client's to see in the app. Every value here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Settings } from "../../../src/config/settings.ts";
import { clientInboxOf } from "../../../src/domain/clients/app-alerts.ts";
import { evidenceMessage, messageStateOf } from "../../../src/domain/no-shows/no-shows.ts";
import { outstandingTasks } from "../../../src/domain/ops/tasks.ts";
import { TASK_SLA_HOURS } from "../../../src/policy/tasks.ts";
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
import { insertJob, insertPerson } from "../tryon-fixtures.ts";
import { asClient } from "../clients.ts";
import { erasePerson } from "../../../src/domain/privacy/erasure.ts";
import { expiredMessagesStatement } from "../../../src/domain/messages/queued-messages.ts";
import { createLogger } from "../../../src/log.ts";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";

const TOKEN = "an-msg91-webhook-token-of-thirty-two-chars";
const MSG91: NonNullable<Settings["messaging"]["msg91"]> = {
  authKey: "msg91-key",
  integratedNumber: "919800000000",
  webhookToken: TOKEN,
};
const CAP = "131049: This message was not delivered to maintain healthy ecosystem engagement.";
const M1 = "66666666-6666-4666-8666-000000000001";
const M2 = "66666666-6666-4666-8666-000000000002";
const LOOK = "66666666-6666-4666-8666-000000000003";
const JOB = "66666666-6666-4666-8666-000000000004";

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  await insertPerson("p1", "+919810000001");
});

/** A message sent through MSG91 under its request ID, as the send leaves it. */
const sent = (id: string, kind: string, requestId: string, subject = "a1") =>
  env.DB.prepare(
    `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state,
       provider_message_id, sent_at)
     VALUES (?1, '2026-09-22T04:00:00Z', 'p1', ?2, 'appointment', ?4, 'sent', ?3, '2026-09-22T04:00:01Z')`,
  )
    .bind(id, kind, requestId, subject)
    .run();

/** MSG91's outbound report for a request, with the reason it gives a failure. */
const report = (requestId: string, eventName: string, reason?: string) => ({
  companyId: "12345",
  customerNumber: "919810000001",
  requestId,
  eventName,
  reason,
  uuid: "wamid.HBgM",
  integratedNumber: "919800000000",
  direction: "1",
  ts: "2026-09-22T09:30:05+05:30",
});

function post(body: unknown) {
  return request(
    appFor("local", fakeDependencies(), { messaging: { ...LOCAL_SETTINGS.messaging, msg91: MSG91 } }),
    "/api/hooks/msg91",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    },
    { MESSAGE_QUEUE: fakeQueue() },
  );
}

const row = (id: string) =>
  env.DB.prepare("SELECT state, last_error, delivered_at FROM outbound_messages WHERE id = ?1")
    .bind(id)
    .first<{ state: string; last_error: string | null; delivered_at: string | null }>();

const undelivered = async () =>
  (await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS)).tasks.filter((task) => task.group === "message_undelivered");

describe("a message WhatsApp refused", () => {
  it("is marked failed with WhatsApp's code, and Care get a task to tell the client another way", async () => {
    await sent(M1, "visit_cancelled", "req-1");
    expect((await post(report("req-1", "failed", CAP))).status).toBe(204);
    expect(await row(M1)).toEqual({ state: "failed", last_error: "refused 131049", delivered_at: null });

    expect(await undelivered()).toEqual([
      expect.objectContaining({
        group: "message_undelivered",
        id: M1,
        person: expect.objectContaining({ id: "p1" }) as object,
        facts: { group: "message_undelivered", kind: "visit_cancelled", code: "131049" },
      }),
    ]);
  });

  it("changes nothing once the message was delivered, or when the report comes again", async () => {
    await sent(M1, "visit_cancelled", "req-1");
    await post(report("req-1", "delivered"));
    await post(report("req-1", "failed", CAP));
    expect(await row(M1)).toMatchObject({ state: "sent", last_error: null });

    await sent(M2, "visit_cancelled", "req-2", "a2");
    await post(report("req-2", "failed"));
    await post(report("req-2", "failed", CAP));
    // No code came with the first report; the second finds the message failed already.
    expect(await row(M2)).toMatchObject({ state: "failed", last_error: "refused" });
    expect((await undelivered()).map((task) => task.id)).toEqual([M2]);
  });

  it("leaves what offers rather than informs off Care's board, and goes once Care close it", async () => {
    await sent(M1, "launch_alert", "req-1");
    await sent(M2, "fit_aftercare", "req-2", "a2");
    await post([report("req-1", "failed", CAP), report("req-2", "failed", CAP)]);
    expect((await row(M1))?.state).toBe("failed");
    expect((await undelivered()).map((task) => task.id)).toEqual([M2]);

    const closed = await request(
      appFor("local", fakeDependencies(), {}, "ops"),
      `/api/tasks/message_undelivered/${M2}/close`,
      {
        method: "POST",
        headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Called; told them the care guide is in the app" }),
      },
    );
    expect(closed.status).toBe(204);
    expect(await undelivered()).toEqual([]);
  });

  // Ops rule a no-show on the reminder's receipt: one WhatsApp refused never reached the client.
  it("reads as not delivered in the no-show evidence", async () => {
    await sent(M1, "visit_reminder", "req-1");
    await post(report("req-1", "failed", CAP));
    expect(messageStateOf(await evidenceMessage(env.DB, "a1"))).toBe("not_delivered");
  });

  // The look is sent on WhatsApp alone; refused, the client still sees it in the app, where its alert opens Photos.
  it("leaves a refused look the client's alert in the app", async () => {
    await env.DB.prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state)
       VALUES (?1, '2026-09-22T04:00:00Z', 'p1', 'tryon_result', 'tryon_job', 'job-1', 'waiting')`,
    )
      .bind(LOOK)
      .run();
    await env.DB.prepare(
      "UPDATE outbound_messages SET state = 'queued', queued_at = '2026-09-22T04:00:30Z' WHERE id = ?1",
    )
      .bind(LOOK)
      .run();
    await env.DB.prepare(
      `UPDATE outbound_messages SET state = 'sent', provider_message_id = 'req-look', sent_at = '2026-09-22T04:00:31Z'
       WHERE id = ?1`,
    )
      .bind(LOOK)
      .run();
    await post(report("req-look", "failed", CAP));

    expect((await undelivered()).map((task) => task.facts)).toEqual([
      { group: "message_undelivered", kind: "tryon_result", code: "131049" },
    ]);
    const inbox = await clientInboxOf(env.DB, "p1", new Date("2026-09-22T05:00:00Z"));
    expect(inbox.map((alert) => alert.kind)).toEqual(["tryon_result"]);
  });

  // A look WhatsApp refused is shown once in the client app after sign-in.
  it("opens a refused look once in the app: Home names it until the app says it was shown", async () => {
    await insertJob({
      id: JOB,
      person_id: "p1",
      state: "ready",
      result_key: `results/${JOB}.jpg`,
      expires_at: new Date(NOW.getTime() + 86_400_000).toISOString(),
      number_proved_at: NOW.toISOString(),
    });
    await env.DB.prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state,
         provider_message_id, sent_at)
       VALUES (?1, ?2, 'p1', 'tryon_result', 'tryon_job', ?3, 'sent', 'req-look', ?2)`,
    )
      .bind(LOOK, NOW.toISOString(), JOB)
      .run();
    const cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: "p1", deviceLabel: null, now: NOW })}`;
    const home = async () =>
      (await (await asClient(cookie, "/api/me")).json<{ look_to_show: string | null }>()).look_to_show;

    // Sent and not refused: nothing to show beyond the alert.
    expect(await home()).toBeNull();
    await post(report("req-look", "failed", CAP));
    expect(await home()).toBe(JOB);

    expect((await asClient(cookie, `/api/photos/try-on/${JOB}/shown`, { method: "POST" })).status).toBe(204);
    expect(await home()).toBeNull();
    expect((await asClient(cookie, `/api/photos/try-on/${JOB}/shown`, { method: "POST" })).status).toBe(404);
  });

  // Care's words about the client go with the rest when they are erased: the message the closed task names is kept
  // past the two years sent messages are, so erasure can still find them.
  it("keeps a closed task's message past retention, and erasure blanks Care's words on it", async () => {
    await sent(M2, "fit_aftercare", "req-2", "a2");
    await post(report("req-2", "failed", CAP));
    const closed = await request(
      appFor("local", fakeDependencies(), {}, "ops"),
      `/api/tasks/message_undelivered/${M2}/close`,
      {
        method: "POST",
        headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Called Arjun; told them the guide is in the app" }),
      },
    );
    expect(closed.status).toBe(204);

    await expiredMessagesStatement(env.DB, "2099-01-01T00:00:00.000Z", 100).run();
    expect(await row(M2)).not.toBeNull();

    expect(await erasePerson({ env, personId: "p1", now: NOW, log: createLogger() })).not.toBeNull();
    const closing = await env.DB.prepare("SELECT reason FROM task_closures WHERE subject_id = ?1").bind(M2).first();
    expect(closing).toEqual({ reason: null });
  });
});
