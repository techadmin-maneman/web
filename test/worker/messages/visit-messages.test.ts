// A client's messages about their visits (src/domain/messages/visit-messages.ts and the messaging consumer): what each
// says, when it is sent or skipped, the day-before reminders, and that a booking, a move and a cancel queue theirs.
// NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { renderMessage, type TemplateName } from "../../../src/config/message-templates.ts";
import { confirmBooking } from "../../../src/domain/booking/bookings.ts";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { queueReminders, REMINDER_DAY_MOVED, visitMessage } from "../../../src/domain/messages/visit-messages.ts";
import { createLogger } from "../../../src/log.ts";
import type { MessagingProvider, OutboundMessage } from "../../../src/providers/messaging/index.ts";
import { createStubPayments } from "../../../src/providers/payments/stub.ts";
import { sendMessage } from "../../../src/queues/messaging.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  fakeQueue,
  markDatabase,
  NOW,
  request,
  savedAddress,
} from "../helpers.ts";
import {
  PERSON,
  VISIT,
  THURSDAY_NOON,
  log,
  config,
  consent,
  visit,
  paid,
  messages,
} from "./visit-messages-fixtures.ts";

function recordingProvider() {
  const sent: { to: string; template: TemplateName; params: readonly string[]; media: OutboundMessage["media"] }[] = [];
  const provider: MessagingProvider = {
    send: ({ to, template, params, media }) => {
      sent.push({ to, template, params, media });
      return Promise.resolve({ ok: true, providerMessageId: "wa-1" });
    },
    connection: () => Promise.resolve({ open: true }),
  };
  return { provider, sent };
}

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
  )
    .bind(PERSON, NOW.toISOString())
    .run();
});

describe("sending a visit message", () => {
  it("sends it as text, with no image, to an allowed number", async () => {
    await consent(true);
    await visit();
    await paid();
    const message = visitMessage(env.DB, { personId: PERSON, appointmentId: VISIT, kind: "payment_receipt", now: NOW });
    await message.statement.run();
    const { provider, sent } = recordingProvider();
    await sendMessage({
      db: env.DB,
      config: config({ allowlist: ["+919810000001"] }),
      deps: fakeDependencies({ messaging: provider }),
      log,
      messageId: message.id,
    });
    expect(sent).toEqual([
      {
        to: "+919810000001",
        template: "visit_booked_v1",
        params: ["Rohit", "service visit", "Thu 24 Sep", "12 to 4 pm", "Imran", "Rs. 2,000", "MM-2026-0841", ""],
        media: undefined,
      },
    ]);
    expect((await messages()).results).toEqual([{ kind: "payment_receipt", subject_id: VISIT, state: "sent" }]);
  });

  it("does not send a day-before reminder once the visit's day has come", async () => {
    await consent(true);
    await visit("service", "2026-09-21T09:30:00.000Z");
    const yesterdayEvening = new Date("2026-09-20T13:00:00.000Z");
    const message = visitMessage(env.DB, {
      personId: PERSON,
      appointmentId: VISIT,
      kind: "visit_reminder",
      now: yesterdayEvening,
    });
    await message.statement.run();
    const { provider, sent } = recordingProvider();
    await sendMessage({
      db: env.DB,
      config: config(),
      deps: fakeDependencies({ messaging: provider }),
      log,
      messageId: message.id,
    });
    expect(sent).toEqual([]);
    const row = await env.DB.prepare("SELECT state, last_error FROM outbound_messages").first();
    expect(row).toEqual({ state: "skipped", last_error: "too late for a day-before reminder" });
  });

  describe("a visit moved after its reminder was written", () => {
    const mondayEvening = new Date("2026-09-21T12:30:00.000Z");
    const tuesdayEvening = new Date("2026-09-22T12:30:00.000Z");

    async function reminderWritten(at: Date) {
      const message = visitMessage(env.DB, { personId: PERSON, appointmentId: VISIT, kind: "visit_reminder", now: at });
      await message.statement.run();
      return message.id;
    }

    async function sendAt(at: Date, messageId: string) {
      const { provider, sent } = recordingProvider();
      await sendMessage({
        db: env.DB,
        config: config(),
        deps: fakeDependencies({ messaging: provider, now: () => at }),
        log,
        messageId,
      });
      return sent;
    }

    const stateOf = (messageId: string) =>
      env.DB.prepare("SELECT state, last_error FROM outbound_messages WHERE id = ?1").bind(messageId).first();

    it("does not say 'tomorrow' of a visit moved to a later day", async () => {
      await consent(true);
      await visit("consultation", "2026-09-22T06:30:00.000Z");
      const reminder = await reminderWritten(mondayEvening);
      await env.DB.prepare("UPDATE appointments SET window_start = ?1").bind(THURSDAY_NOON).run();
      expect(await sendAt(mondayEvening, reminder)).toEqual([]);
      expect(await stateOf(reminder)).toEqual({ state: "skipped", last_error: REMINDER_DAY_MOVED });
    });

    it("leaves the new day to its own reminder, though the old one is still waiting the evening before it", async () => {
      await consent(true);
      await visit("consultation", "2026-09-22T06:30:00.000Z");
      const stale = await reminderWritten(mondayEvening);
      await env.DB.prepare("UPDATE appointments SET window_start = '2026-09-23T06:30:00.000Z'").run();
      const [fresh] = await queueReminders(env.DB, tuesdayEvening);
      expect(await sendAt(tuesdayEvening, stale)).toEqual([]);
      expect(await stateOf(stale)).toEqual({ state: "skipped", last_error: REMINDER_DAY_MOVED });
      const sent = await sendAt(tuesdayEvening, fresh ?? "");
      expect(sent.map((message) => renderMessage(message.template, message.params))).toEqual([
        "Hi Rohit, see you tomorrow: your consultation is Wed 23 Sep, 12 to 4 pm, with Imran. Need to move it? Open the Mane Man app.",
      ]);
    });

    it("still reminds of a visit moved to another window on the same day", async () => {
      await consent(true);
      await visit("consultation", "2026-09-22T06:30:00.000Z");
      const reminder = await reminderWritten(mondayEvening);
      await env.DB.prepare("UPDATE appointments SET window_start = '2026-09-22T03:30:00.000Z'").run();
      const sent = await sendAt(mondayEvening, reminder);
      expect(sent.map((message) => renderMessage(message.template, message.params))).toEqual([
        "Hi Rohit, see you tomorrow: your consultation is Tue 22 Sep, 9 am to 12 pm, with Imran. Need to move it? Open the Mane Man app.",
      ]);
    });
  });

  it("sends only the latest of several moves still waiting to go", async () => {
    await consent(true);
    await visit();
    const moves = [0, 1, 2].map((minutes) =>
      visitMessage(env.DB, {
        personId: PERSON,
        appointmentId: VISIT,
        kind: minutes === 0 ? "reschedule_confirmation" : "visit_moved",
        now: new Date(NOW.getTime() + minutes * 60_000),
      }),
    );
    await env.DB.batch(moves.map((move) => move.statement));
    const { provider, sent } = recordingProvider();
    const deps = fakeDependencies({ messaging: provider });
    for (const move of moves) await sendMessage({ db: env.DB, config: config(), deps, log, messageId: move.id });
    expect(sent.map((message) => renderMessage(message.template, message.params))).toEqual([
      "Hi Rohit, your service visit is now on Thu 24 Sep, 12 to 4 pm, with Imran.",
    ]);
    const { results } = await env.DB.prepare(
      "SELECT state, last_error FROM outbound_messages ORDER BY created_at",
    ).all();
    expect(results).toEqual([
      { state: "skipped", last_error: "a later move's message tells the new window" },
      { state: "skipped", last_error: "a later move's message tells the new window" },
      { state: "sent", last_error: null },
    ]);
  });

  it("skips it, and says why, when the client has not consented", async () => {
    await visit();
    const message = visitMessage(env.DB, { personId: PERSON, appointmentId: VISIT, kind: "visit_reminder", now: NOW });
    await message.statement.run();
    const { provider, sent } = recordingProvider();
    await sendMessage({
      db: env.DB,
      config: config(),
      deps: fakeDependencies({ messaging: provider }),
      log,
      messageId: message.id,
    });
    expect(sent).toEqual([]);
    const row = await env.DB.prepare("SELECT state, last_error FROM outbound_messages").first();
    expect(row).toEqual({ state: "skipped", last_error: "no consent to WhatsApp about visits" });
  });

  // Logins open, reminders fenced (ADR 0097): a message that
  // answers the client's own booking, move or cancel reaches any number on staging; a reminder, which nobody just
  // asked for, still checks the allowlist.
  describe("staging's allowlist, since ADR 0097", () => {
    it("sends a booking confirmation off the allowlist, since it answers the client who booked", async () => {
      await consent(true);
      await visit();
      await paid();
      const message = visitMessage(env.DB, {
        personId: PERSON,
        appointmentId: VISIT,
        kind: "payment_receipt",
        now: NOW,
      });
      await message.statement.run();
      const { provider, sent } = recordingProvider();
      await sendMessage({
        db: env.DB,
        config: config({ allowlist: ["+919810000099"] }),
        deps: fakeDependencies({ messaging: provider }),
        log,
        messageId: message.id,
      });
      expect(sent).toHaveLength(1);
    });

    // A record one of our own scripts made stays fenced, whatever kind reaches everyone else (isStagingTestRecord,
    // src/policy/staging-test-records.ts).
    it("holds back a booking confirmation for a 'Staging test' record off the allowlist", async () => {
      await consent(true);
      await visit();
      await paid();
      await env.DB.prepare("UPDATE people SET name = 'Staging test', test_record = 1 WHERE id = ?1").bind(PERSON).run();
      const message = visitMessage(env.DB, {
        personId: PERSON,
        appointmentId: VISIT,
        kind: "payment_receipt",
        now: NOW,
      });
      await message.statement.run();
      const { provider, sent } = recordingProvider();
      await sendMessage({
        db: env.DB,
        config: config({ allowlist: ["+919810000099"] }),
        deps: fakeDependencies({ messaging: provider }),
        log,
        messageId: message.id,
      });
      expect(sent).toEqual([]);
      const row = await env.DB.prepare("SELECT state, last_error FROM outbound_messages").first();
      expect(row).toEqual({ state: "skipped", last_error: "number not on the allowlist" });
    });

    it("holds back a reminder off the allowlist, since nobody there just asked for it", async () => {
      await consent(true);
      await visit();
      const message = visitMessage(env.DB, {
        personId: PERSON,
        appointmentId: VISIT,
        kind: "visit_reminder",
        now: NOW,
      });
      await message.statement.run();
      const { provider, sent } = recordingProvider();
      await sendMessage({
        db: env.DB,
        config: config({ allowlist: ["+919810000099"] }),
        deps: fakeDependencies({ messaging: provider }),
        log,
        messageId: message.id,
      });
      expect(sent).toEqual([]);
      const row = await env.DB.prepare("SELECT state, last_error FROM outbound_messages").first();
      expect(row).toEqual({ state: "skipped", last_error: "number not on the allowlist" });
    });

    it("sends both kinds everywhere once there is no allowlist, as in production", async () => {
      await consent(true);
      await visit("service", "2026-09-22T06:30:00.000Z");
      await paid();
      const receipt = visitMessage(env.DB, {
        personId: PERSON,
        appointmentId: VISIT,
        kind: "payment_receipt",
        now: NOW,
      });
      await receipt.statement.run();
      const reminder = visitMessage(env.DB, {
        personId: PERSON,
        appointmentId: VISIT,
        kind: "visit_reminder",
        now: NOW,
      });
      await reminder.statement.run();
      const { provider, sent } = recordingProvider();
      const deps = fakeDependencies({ messaging: provider });
      await sendMessage({ db: env.DB, config: config(), deps, log, messageId: receipt.id });
      await sendMessage({ db: env.DB, config: config(), deps, log, messageId: reminder.id });
      expect(sent).toHaveLength(2);
    });

    it("sends a 'Staging test' record's message too, once there is no allowlist, as in production", async () => {
      await consent(true);
      await visit();
      await paid();
      await env.DB.prepare("UPDATE people SET name = 'Staging test', test_record = 1 WHERE id = ?1").bind(PERSON).run();
      const message = visitMessage(env.DB, {
        personId: PERSON,
        appointmentId: VISIT,
        kind: "payment_receipt",
        now: NOW,
      });
      await message.statement.run();
      const { provider, sent } = recordingProvider();
      await sendMessage({
        db: env.DB,
        config: config(),
        deps: fakeDependencies({ messaging: provider }),
        log,
        messageId: message.id,
      });
      expect(sent).toHaveLength(1);
    });
  });
});

describe("what queues a visit message", () => {
  it("a paid booking queues its receipt, and a free consultation its confirmation", async () => {
    await savedAddress(PERSON);
    const cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
    const app = appFor("local", fakeDependencies(), {}, "client");
    const answer = await request(app, "/api/holds", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify({ type: "consultation", date: "2026-09-22", window: "morning" }),
    });
    const hold = await answer.json<{ id: string }>();
    const notified: string[] = [];
    const outcome = await confirmBooking(
      {
        db: env.DB,
        payments: createStubPayments(),
        now: NOW,
        notify: (id) => {
          notified.push(id);
          return Promise.resolve();
        },
        log: createLogger(),
      },
      hold.id,
    );
    expect(outcome).toBe("booked");
    const { results } = await messages();
    expect(results).toEqual([
      { kind: "consultation_confirmation", subject_id: expect.any(String) as string, state: "queued" },
    ]);
    expect(notified).toHaveLength(1);
  });

  it("a cancel queues its confirmation, and sends it to the messaging queue", async () => {
    await visit();
    await paid();
    const cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
    const app = appFor("local", fakeDependencies(), {}, "client");
    const queue = fakeQueue();
    await request(
      app,
      `/api/appointments/${VISIT}/cancel`,
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
        body: JSON.stringify({ confirm: true, notice: "free" }),
      },
      { MESSAGE_QUEUE: queue },
    );
    expect((await messages()).results).toEqual([{ kind: "cancel_confirmation", subject_id: VISIT, state: "queued" }]);
    expect(queue.sent).toEqual([
      { message_id: expect.any(String) as string, request_id: expect.any(String) as string },
    ]);
  });
});
