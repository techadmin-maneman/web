// A client's messages about their visits (src/domain/visit-messages.ts and the messaging consumer): what each
// says, when it is sent or skipped, the day-before reminders, and that a booking, a move and a cancel queue theirs.
// NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { renderMessage } from "../../src/config/message-templates.ts";
import type { Settings } from "../../src/config/settings.ts";
import { confirmBooking } from "../../src/domain/bookings.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { composeVisitMessage, queueReminders, visitMessage } from "../../src/domain/visit-messages.ts";
import type { StaticConfig } from "../../src/guard.ts";
import { createLogger } from "../../src/log.ts";
import { createStubFsm, EMPTY_FSM } from "../../src/providers/fsm.ts";
import type { MessagingProvider } from "../../src/providers/messaging.ts";
import { createStubPayments } from "../../src/providers/payments.ts";
import { sendMessage } from "../../src/queues/messaging.ts";
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
} from "./helpers.ts";

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
  const sent: { to: string; template: string; params: readonly string[]; mediaUrl: string | undefined }[] = [];
  const provider: MessagingProvider = {
    send: ({ to, template, params, mediaUrl }) => {
      sent.push({ to, template, params, mediaUrl });
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
    `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, status, fsm_status, window_start,
       window_end, technician_id, fsm_modified_at, synced_at)
     VALUES (?1, 'fsm-visit-1', 'fsm-order-1', ?2, ?3, ?4, 'Scheduled', ?5, ?5, 't1', ?6, ?6)`,
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
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'resource-1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name, fsm_contact_id)
     VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra', 'contact-1')`,
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
      "Hello Rohit, your service visit is booked for Thu 24 Sep, 12 to 4 pm, with Imran. Paid Rs. 2,000, " +
        "reference MM-2026-0841. The receipt is in the app.",
    );
  });

  it("confirms a consultation, reminds, and tells of a move", async () => {
    await consent(true);
    await visit("consultation", "2026-09-24T03:30:00.000Z");
    expect(await text("consultation_confirmation")).toBe(
      "Hello Rohit, your free consultation is booked for Thu 24 Sep, 9 am to 12 pm. We will see you then.",
    );
    expect(await text("visit_reminder")).toBe(
      "Hello Rohit, a reminder that your consultation is tomorrow, Thu 24 Sep, 9 am to 12 pm, with Imran.",
    );
    expect(await text("reschedule_confirmation")).toBe(
      "Hello Rohit, your consultation is now on Thu 24 Sep, 9 am to 12 pm, with Imran.",
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
      "Hello Rohit, your service visit on Thu 24 Sep is cancelled. Rs. 2,000 is on its way back to your UPI, " +
        "in 5 to 7 working days.",
    );
    await env.DB.prepare("UPDATE visit_changes SET refund_amount = 0").run();
    expect(await text("cancel_confirmation")).toBe("Hello Rohit, your service visit on Thu 24 Sep is cancelled.");
  });

  // The cancel sheet says "Cancel inside 24 hours and the credit is gone"; the confirmation said only that the visit
  // was cancelled, as though nothing were lost (LIFE-14).
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
        "Hello Rohit, your service visit on Thu 24 Sep is cancelled. Your visit credit is back.",
      );
    });

    it("says the credit is gone, when it was cancelled inside 24 hours", async () => {
      await cancelledOnCredit("late");
      expect(await text("cancel_confirmation")).toBe(
        "Hello Rohit, your service visit on Thu 24 Sep is cancelled. It was inside 24 hours, so the visit credit " +
          "it used is gone.",
      );
    });
  });

  it("sends nothing without the client's consent to WhatsApp about visits, or once it is switched off", async () => {
    await visit();
    await paid();
    expect(await text("payment_receipt")).toEqual({ skip: "no consent to WhatsApp about visits" });
    await consent(true, "2026-09-20T06:30:00.000Z");
    await consent(false);
    expect(await text("payment_receipt")).toEqual({ skip: "no consent to WhatsApp about visits" });
  });

  it("sends no reminder or move for a visit no longer booked", async () => {
    await consent(true);
    await visit("service", THURSDAY_NOON, "cancelled");
    expect(await text("visit_reminder")).toEqual({ skip: "the visit is no longer booked" });
    expect(await text("reschedule_confirmation")).toEqual({ skip: "the visit is no longer booked" });
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
    await sendMessage(
      env.DB,
      config({ allowlist: ["+919810000001"] }),
      fakeDependencies({ messaging: provider }),
      log,
      message.id,
    );
    expect(sent).toEqual([
      {
        to: "+919810000001",
        template: "visit_booked_v1",
        params: ["Rohit", "service visit", "Thu 24 Sep", "12 to 4 pm", "Imran", "Rs. 2,000", "MM-2026-0841", ""],
        mediaUrl: undefined,
      },
    ]);
    expect((await messages()).results).toEqual([{ kind: "payment_receipt", subject_id: VISIT, state: "sent" }]);
  });

  it("skips it, and says why, when the client has not consented", async () => {
    await visit();
    const message = visitMessage(env.DB, { personId: PERSON, appointmentId: VISIT, kind: "visit_reminder", now: NOW });
    await message.statement.run();
    const { provider, sent } = recordingProvider();
    await sendMessage(env.DB, config(), fakeDependencies({ messaging: provider }), log, message.id);
    expect(sent).toEqual([]);
    const row = await env.DB.prepare("SELECT state, last_error FROM outbound_messages").first();
    expect(row).toEqual({ state: "skipped", last_error: "no consent to WhatsApp about visits" });
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

  it("leaves out a visit the day after tomorrow, and one no longer booked", async () => {
    await visit("service", "2026-09-23T06:30:00.000Z");
    expect(await queueReminders(env.DB, new Date("2026-09-21T12:30:00Z"))).toEqual([]);
    await env.DB.prepare(
      "UPDATE appointments SET window_start = '2026-09-22T06:30:00.000Z', status = 'cancelled'",
    ).run();
    expect(await queueReminders(env.DB, new Date("2026-09-21T12:30:00Z"))).toEqual([]);
  });
});

describe("what queues a visit message", () => {
  it("a paid booking queues its receipt, and a free consultation its confirmation", async () => {
    const cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
    const app = appFor("local", fakeDependencies(), {}, "client");
    const answer = await request(app, "/api/holds", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify({ type: "consultation", date: "2026-09-22", window: "morning" }),
    });
    const hold = await answer.json<{ id: string }>();
    const fsm = createStubFsm({
      ...EMPTY_FSM,
      items: [{ id: "item-consult", name: "Consultation", type: "Service", price: null }],
    });
    const notified: string[] = [];
    const outcome = await confirmBooking(env.DB, fsm, createStubPayments(), hold.id, NOW, {
      labelAsTest: true,
      notify: (id) => {
        notified.push(id);
        return Promise.resolve();
      },
    });
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
