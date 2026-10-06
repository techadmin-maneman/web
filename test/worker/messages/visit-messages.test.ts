// A client's messages about their visits (src/domain/messages/visit-messages.ts and the messaging consumer): what each
// says, when it is sent or skipped, the day-before reminders, and that a booking, a move and a cancel queue theirs.
// NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { renderMessage, type TemplateName } from "../../../src/config/message-templates.ts";
import type { Settings } from "../../../src/config/settings.ts";
import { confirmBooking } from "../../../src/domain/booking/bookings.ts";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { queueReminders, REMINDER_DAY_MOVED, visitMessage } from "../../../src/domain/messages/visit-messages.ts";
import { composeVisitMessage } from "../../../src/domain/messages/visit-message-text.ts";
import type { StaticConfig } from "../../../src/guard.ts";
import { createLogger } from "../../../src/log.ts";
import type { MessagingProvider, OutboundMessage } from "../../../src/providers/messaging/index.ts";
import { createStubPayments } from "../../../src/providers/payments/stub.ts";
import { sendMessage } from "../../../src/queues/messaging.ts";
import { CRON_JOBS, runCronJobs } from "../../../src/scheduled/cron.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  fakeQueue,
  LOCAL_CONFIG,
  LOCAL_SETTINGS,
  markDatabase,
  NOW,
  request,
  savedAddress,
} from "../helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const VISIT = "22222222-2222-4222-8222-222222222222";
const PAYMENT = "33333333-3333-4333-8333-333333333333";
/** Thursday 24 September, noon in India. */
const THURSDAY_NOON = "2026-09-24T06:30:00.000Z";

const log = createLogger();

function config(messaging: Partial<Settings["messaging"]> = {}): StaticConfig {
  return { ...LOCAL_CONFIG, settings: { ...LOCAL_SETTINGS, messaging: { ...LOCAL_SETTINGS.messaging, ...messaging } } };
}

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

async function consent(granted: boolean, at = NOW.toISOString()) {
  await env.DB.prepare(
    `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
     VALUES (?1, ?2, 'whatsapp_visits', 'whatsapp-visits-v1', ?3, ?4)`,
  )
    .bind(crypto.randomUUID(), PERSON, granted ? 1 : 0, at)
    .run();
}

async function visit(type = "service", start = THURSDAY_NOON, status = "scheduled") {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id, synced_at)
     VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?5, 't1', ?6)`,
  )
    .bind(VISIT, PERSON, type, status, start, NOW.toISOString())
    .run();
}

async function paid() {
  await env.DB.prepare(
    `INSERT INTO payments (id, reference, person_id, appointment_id, razorpay_payment_id, amount, currency, method,
       status, captured_at, created_at, updated_at)
     VALUES (?1, 'MM-2026-0841', ?2, ?3, 'pay_visit', 200000, 'INR', 'upi', 'captured', ?4, ?4, ?4)`,
  )
    .bind(PAYMENT, PERSON, VISIT, NOW.toISOString())
    .run();
}

const text = async (kind: Parameters<typeof composeVisitMessage>[1]) => {
  const composed = await composeVisitMessage(env.DB, kind, VISIT, PERSON);
  return "skip" in composed ? composed : renderMessage(composed.template, composed.params);
};

const messages = () =>
  env.DB.prepare("SELECT kind, subject_id, state FROM outbound_messages ORDER BY created_at, rowid").all();

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

describe("what a visit message says", () => {
  it("confirms a paid booking with the visit, its window, the technician, the amount and the reference", async () => {
    await consent(true);
    await visit();
    await paid();
    expect(await text("payment_receipt")).toBe(
      "Hi Rohit, your service visit is booked for Thu 24 Sep, 12 to 4 pm, with Imran. We've received Rs. 2,000 (ref MM-2026-0841). Your receipt is in the app.",
    );
  });

  it("confirms a consultation, reminds, and tells of a move", async () => {
    await consent(true);
    await visit("consultation", "2026-09-24T03:30:00.000Z");
    expect(await text("consultation_confirmation")).toBe(
      "Hi Rohit, your free consultation is booked for Thu 24 Sep, 9 am to 12 pm. Your technician comes to you. To change it, open the Mane Man app.",
    );
    expect(await text("visit_reminder")).toBe(
      "Hi Rohit, see you tomorrow: your consultation is Thu 24 Sep, 9 am to 12 pm, with Imran. Need to move it? Open the Mane Man app.",
    );
    expect(await text("reschedule_confirmation")).toBe(
      "Hi Rohit, your consultation is now on Thu 24 Sep, 9 am to 12 pm, with Imran.",
    );
  });

  it("tells of a cancel, with the refund and where it goes", async () => {
    await consent(true);
    await visit("service", THURSDAY_NOON, "cancelled");
    await paid();
    await env.DB.prepare(
      `INSERT INTO visit_changes (id, appointment_id, person_id, kind, notice, was_start, refund_amount, payment_id,
         created_at)
       VALUES ('c1', ?1, ?2, 'cancelled', 'free', ?3, 200000, ?4, ?5)`,
    )
      .bind(VISIT, PERSON, THURSDAY_NOON, PAYMENT, NOW.toISOString())
      .run();
    expect(await text("cancel_confirmation")).toBe(
      "Hi Rohit, we've cancelled your service visit on Thu 24 Sep and refunded Rs. 2,000 to your UPI (5 to 7 working days).",
    );
    await env.DB.prepare("UPDATE visit_changes SET refund_amount = 0").run();
    expect(await text("cancel_confirmation")).toBe("Hi Rohit, we've cancelled your service visit on Thu 24 Sep.");
  });

  // The cancel sheet says "Cancel inside 24 hours and the credit is gone"; the confirmation said only that the visit
  // was cancelled, as though nothing were lost.
  describe("a cancel of a visit a credit paid for", () => {
    async function cancelledOnCredit(notice: "free" | "late") {
      await consent(true);
      await visit("service", THURSDAY_NOON, "cancelled");
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO credit_ledger (id, person_id, kind, visits, source_kind, source_id, expires_at, created_at)
           VALUES ('grant-1', ?1, 'grant', 3, 'referral', 'referral-1', '2027-09-21T06:30:00.000Z', ?2)`,
        ).bind(PERSON, NOW.toISOString()),
        env.DB.prepare(
          `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
           VALUES ('redeem-1', ?1, 'redeem', -1, 'grant-1', 'appointment', ?2, ?3)`,
        ).bind(PERSON, VISIT, NOW.toISOString()),
        env.DB.prepare(
          `INSERT INTO visit_changes (id, appointment_id, person_id, kind, notice, was_start, refund_amount, created_at)
           VALUES ('c1', ?1, ?2, 'cancelled', ?3, ?4, 0, ?5)`,
        ).bind(VISIT, PERSON, notice, THURSDAY_NOON, NOW.toISOString()),
      ]);
    }

    it("says the credit is back, when it was cancelled in time", async () => {
      await cancelledOnCredit("free");
      await env.DB.prepare(
        `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
         VALUES ('restore-1', ?1, 'restore', 1, 'grant-1', 'appointment', ?2, ?3)`,
      )
        .bind(PERSON, VISIT, NOW.toISOString())
        .run();
      expect(await text("cancel_confirmation")).toBe(
        "Hi Rohit, we've cancelled your service visit on Thu 24 Sep. Your free service visit is back.",
      );
    });

    // The notice is ops' to set, so the message does not name it (docs/decisions/0088-every-policy-in-the-console.md).
    it("says the credit is gone, when it was cancelled inside the notice", async () => {
      await cancelledOnCredit("late");
      expect(await text("cancel_confirmation")).toBe(
        "Hi Rohit, we've cancelled your service visit on Thu 24 Sep. As it was cancelled late, the free service visit it used can't be returned.",
      );
    });

    // Ops cancel free to the client, so a credit they could not give back was lost to its grant, not to the notice.
    it("says an expired credit cannot come back, when ops cancelled free inside the notice", async () => {
      await cancelledOnCredit("late");
      await env.DB.prepare("UPDATE visit_changes SET cancelled_by = 'ops@localhost', ops_terms = 'free'").run();
      expect(await text("visit_cancelled")).toBe(
        "Hi Rohit, we've cancelled your service visit on Thu 24 Sep. The free service visit it used has expired, so we can't return it.",
      );
    });

    it("says the credit is gone, when ops applied the client's late terms", async () => {
      await cancelledOnCredit("late");
      await env.DB.prepare("UPDATE visit_changes SET cancelled_by = 'ops@localhost', ops_terms = 'client'").run();
      expect(await text("visit_cancelled")).toBe(
        "Hi Rohit, we've cancelled your service visit on Thu 24 Sep. As it was cancelled late, the free service visit it used can't be returned.",
      );
    });
  });

  // A receipt or a refund is transactional, so it goes whatever the client's consent to visit messages.
  it("sends a receipt without the client's consent to WhatsApp about visits, and nothing else", async () => {
    await visit();
    await paid();
    expect(await text("payment_receipt")).toContain(
      "Hi Rohit, your service visit is booked for Thu 24 Sep, 12 to 4 pm, with Imran. We've received Rs. 2,000 (ref MM-2026-0841). Your receipt is in the app.",
    );
    expect(await text("visit_reminder")).toEqual({ skip: "no consent to WhatsApp about visits" });
    await consent(true, "2026-09-20T06:30:00.000Z");
    await consent(false);
    expect(await text("payment_receipt")).toContain(
      "Hi Rohit, your service visit is booked for Thu 24 Sep, 12 to 4 pm, with Imran. We've received Rs. 2,000 (ref MM-2026-0841). Your receipt is in the app.",
    );
    expect(await text("reschedule_confirmation")).toEqual({ skip: "no consent to WhatsApp about visits" });
  });

  it("tells of a cancel's refund without that consent, but not of a cancel with nothing to give back", async () => {
    await visit("service", THURSDAY_NOON, "cancelled");
    await paid();
    await env.DB.prepare(
      `INSERT INTO visit_changes (id, appointment_id, person_id, kind, notice, was_start, refund_amount, payment_id,
         created_at)
       VALUES ('c1', ?1, ?2, 'cancelled', 'free', ?3, 200000, ?4, ?5)`,
    )
      .bind(VISIT, PERSON, THURSDAY_NOON, PAYMENT, NOW.toISOString())
      .run();
    expect(await text("cancel_confirmation")).toContain(
      "Hi Rohit, we've cancelled your service visit on Thu 24 Sep and refunded Rs. 2,000 to your UPI (5 to 7 working days).",
    );
    await env.DB.prepare("UPDATE visit_changes SET refund_amount = 0").run();
    expect(await text("cancel_confirmation")).toEqual({ skip: "no consent to WhatsApp about visits" });
  });

  it("sends no reminder or move for a visit no longer booked", async () => {
    await consent(true);
    await visit("service", THURSDAY_NOON, "cancelled");
    expect(await text("visit_reminder")).toEqual({ skip: "the visit is no longer booked" });
    expect(await text("reschedule_confirmation")).toEqual({ skip: "the visit is no longer booked" });
  });

  // The audit's gate: a 4 pm visit checked in at 11:31 would have told the client "has arrived" hours before it.
  it("tells of no arrival, and no no-show's ruling, on a check-in before the earliest check-in", async () => {
    await consent(true);
    await visit();
    // A check-in that passed, as the job event it landed as.
    const checkIn = async (id: string, at: string) =>
      env.DB.batch([
        env.DB.prepare(
          `INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at,
             fsm_write_state, superseded, updated_at)
           VALUES (?1, ?2, ?1, 't1', 'check_in', '{}', ?3, ?3, 'written', 0, ?3)`,
        ).bind(`event-${id}`, VISIT, at),
        env.DB.prepare(
          `INSERT INTO checkins (id, appointment_id, technician_id, job_event_id, at, radius_m, passed, created_at)
           VALUES (?1, ?2, 't1', ?3, ?4, 200, 1, ?4)`,
        ).bind(id, VISIT, `event-${id}`, at),
      ]);

    // Two hours before Thursday's noon visit: an hour earlier than a technician may check in.
    await checkIn("ci-early", "2026-09-24T04:30:00.000Z");
    await env.DB.prepare(
      `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, closed_at, decision,
         decided_at, created_at)
       VALUES ('ns-early', 'ci-early', ?1, ?2, ?3, ?3, 'waived', ?3, ?3)`,
    )
      .bind(VISIT, "2026-09-24T04:30:00.000Z", "2026-09-24T04:45:00.000Z")
      .run();
    expect(await text("arrival_notice")).toEqual({ skip: "the check-in came before the earliest check-in" });
    expect(await text("no_show_decided")).toEqual({ skip: "the check-in came before the earliest check-in" });

    // Forty-five minutes before it, in time.
    await checkIn("ci-in-time", "2026-09-24T05:45:00.000Z");
    expect(await text("arrival_notice")).not.toHaveProperty("skip");
  });
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

describe("the day-before reminders", () => {
  it("queues one for each visit tomorrow, from 6 pm in India, once", async () => {
    await visit("service", "2026-09-22T06:30:00.000Z");
    expect(await queueReminders(env.DB, NOW)).toEqual([]);
    const evening = new Date("2026-09-21T12:30:00Z"); // 6 pm in India
    const queued = await queueReminders(env.DB, evening);
    expect(queued).toHaveLength(1);
    expect((await messages()).results).toEqual([{ kind: "visit_reminder", subject_id: VISIT, state: "queued" }]);
    expect(await queueReminders(env.DB, new Date("2026-09-21T15:00:00Z"))).toEqual([]);
  });

  it("reminds again of a visit moved to a later day after its reminder", async () => {
    await visit("service", "2026-09-22T06:30:00.000Z");
    expect(await queueReminders(env.DB, new Date("2026-09-21T12:30:00Z"))).toHaveLength(1);
    await env.DB.prepare("UPDATE appointments SET window_start = ?1").bind(THURSDAY_NOON).run();
    expect(await queueReminders(env.DB, new Date("2026-09-22T12:30:00Z"))).toEqual([]);
    expect(await queueReminders(env.DB, new Date("2026-09-23T12:30:00Z"))).toHaveLength(1);
    expect(await queueReminders(env.DB, new Date("2026-09-23T15:00:00Z"))).toEqual([]);
  });

  it("does not remind twice of a visit moved within tomorrow", async () => {
    await visit("service", "2026-09-22T06:30:00.000Z");
    expect(await queueReminders(env.DB, new Date("2026-09-21T12:30:00Z"))).toHaveLength(1);
    await env.DB.prepare("UPDATE appointments SET window_start = '2026-09-22T03:30:00.000Z'").run();
    expect(await queueReminders(env.DB, new Date("2026-09-21T13:00:00Z"))).toEqual([]);
  });

  it("leaves out a visit the day after tomorrow, and one no longer booked", async () => {
    await visit("service", "2026-09-23T06:30:00.000Z");
    expect(await queueReminders(env.DB, new Date("2026-09-21T12:30:00Z"))).toEqual([]);
    await env.DB.prepare(
      "UPDATE appointments SET window_start = '2026-09-22T06:30:00.000Z', status = 'cancelled'",
    ).run();
    expect(await queueReminders(env.DB, new Date("2026-09-21T12:30:00Z"))).toEqual([]);
  });

  // 6 pm is a console setting (docs/decisions/0088-every-policy-in-the-console.md).
  it("goes from the hour ops set, not before it", async () => {
    await visit("service", "2026-09-22T06:30:00.000Z");
    expect(await queueReminders(env.DB, new Date("2026-09-21T12:30:00Z"), 20)).toEqual([]); // 6 pm
    expect(await queueReminders(env.DB, new Date("2026-09-21T14:30:00Z"), 20)).toHaveLength(1); // 8 pm
  });

  it("goes from a morning hour, which has one figure before the colon", async () => {
    await visit("service", "2026-09-22T06:30:00.000Z");
    expect(await queueReminders(env.DB, new Date("2026-09-21T02:00:00Z"), 8)).toEqual([]); // 7:30 am
    expect(await queueReminders(env.DB, new Date("2026-09-21T03:00:00Z"), 8)).toHaveLength(1); // 8:30 am
  });

  it("is sent by the cron at the hour set in the console", async () => {
    await visit("service", "2026-09-22T06:30:00.000Z");
    await env.DB.prepare(
      "INSERT INTO ops_settings (name, value, set_by, set_at) VALUES ('reminder_hour', '20', 'ops', ?1)",
    )
      .bind(NOW.toISOString())
      .run();
    const run = (at: string) =>
      runCronJobs(
        CRON_JOBS.filter((job) => job.name === "visit_reminders"),
        {
          env: { ...env, MESSAGE_QUEUE: fakeQueue() },
          deps: fakeDependencies({ now: () => new Date(at) }),
          config: LOCAL_CONFIG,
          log,
        },
      );
    await run("2026-09-21T12:30:00Z"); // 6 pm
    expect((await messages()).results).toEqual([]);
    await run("2026-09-21T14:30:00Z"); // 8 pm
    expect((await messages()).results).toHaveLength(1);
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
