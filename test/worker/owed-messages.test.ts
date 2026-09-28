// The messages people are owed when something changes for them (docs/decisions/0074-hand-offs-and-messages.md):
// what each says, to whom, and when it is skipped. Each is sent by the messaging consumer, which writes the text
// as things stand when it sends. NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is
// made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { renderMessage } from "../../src/config/message-templates.ts";
import { createLogger } from "../../src/log.ts";
import type { MessagingProvider } from "../../src/providers/messaging.ts";
import { sendMessage } from "../../src/queues/messaging.ts";
import { captureLogs, fakeDependencies, LOCAL_CONFIG, markDatabase, NOW } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const ENTRY = "22222222-2222-4222-8222-222222222222";

const log = createLogger();

function recordingProvider() {
  const sent: string[] = [];
  const provider: MessagingProvider = {
    send: ({ template, params }) => {
      sent.push(renderMessage(template, params) ?? `unknown template ${template}`);
      return Promise.resolve({ ok: true, providerMessageId: "wa-1" });
    },
    connection: () => Promise.resolve({ open: true }),
  };
  return { provider, sent };
}

async function consent(purpose: string, granted: boolean, personId = PERSON, at = NOW.toISOString()) {
  await env.DB.prepare(
    `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
     VALUES (?1, ?2, ?3, 'test-notice', ?4, ?5)`,
  )
    .bind(crypto.randomUUID(), personId, purpose, granted ? 1 : 0, at)
    .run();
}

async function queued(kind: string, subjectKind: string, subjectId: string, personId = PERSON): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'queued', ?2)`,
  )
    .bind(id, NOW.toISOString(), personId, kind, subjectKind, subjectId)
    .run();
  return id;
}

/** Sends one queued message; what the client read, or why nothing went. */
async function send(messageId: string): Promise<{ text: string | null; skipped: string | null }> {
  const { provider, sent } = recordingProvider();
  await sendMessage(env.DB, LOCAL_CONFIG, fakeDependencies({ messaging: provider }), log, messageId);
  const row = await env.DB.prepare("SELECT state, last_error FROM outbound_messages WHERE id = ?1")
    .bind(messageId)
    .first<{ state: string; last_error: string | null }>();
  return { text: sent[0] ?? null, skipped: row?.state === "skipped" ? row.last_error : null };
}

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Karan Bhatia')",
  )
    .bind(PERSON, NOW.toISOString())
    .run();
});

const VISIT = "33333333-3333-4333-8333-333333333333";

/** A visit of Karan's with Imran, today at 1 pm in India. */
async function visit(status = "dispatched", type = "service") {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'resource-1', 'Imran Qureshi', 'IQ', 1, ?1)",
    ).bind(NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, status, fsm_status, window_start,
         window_end, technician_id, fsm_modified_at, synced_at)
       VALUES (?1, 'fsm-visit-1', 'fsm-order-1', ?2, ?3, ?4, 'Dispatched', '2026-09-21T07:30:00.000Z',
         '2026-09-21T09:00:00.000Z', 't1', ?5, ?5)`,
    ).bind(VISIT, PERSON, type, status, NOW.toISOString()),
  ]);
}

describe("the arrival notice (BIZ-22)", () => {
  it("tells the client his technician has arrived", async () => {
    await visit();
    await consent("whatsapp_visits", true);
    const sent = await send(await queued("arrival_notice", "appointment", VISIT));
    expect(sent.text).toBe("Hello Karan, Imran has arrived for your service visit.");
  });

  it("still goes once the visit is under way, which the check-in itself may have moved it to", async () => {
    await visit("in_progress");
    await consent("whatsapp_visits", true);
    expect((await send(await queued("arrival_notice", "appointment", VISIT))).text).not.toBeNull();
  });

  it("is not sent to a client who never agreed to WhatsApp about visits, and says so for the no-show evidence", async () => {
    await visit();
    expect(await send(await queued("arrival_notice", "appointment", VISIT))).toEqual({
      text: null,
      skipped: "no consent to WhatsApp about visits",
    });
  });
});

describe("the no-show ruling (LIFE-07)", () => {
  /** Karan's service visit, which Imran waited 15 minutes at, closed as a no-show and ruled on. */
  async function ruled(decision: "undecided" | "charged" | "waived", paid: "payment" | "credit" | "nothing") {
    await visit("terminated");
    await consent("whatsapp_visits", true);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO checkins (id, appointment_id, technician_id, at, lat, lng, radius_m, passed, created_at)
         VALUES ('checkin-1', ?1, 't1', '2026-09-21T07:32:00.000Z', 28.4, 77.0, 200, 1, '2026-09-21T07:32:00.000Z')`,
      ).bind(VISIT),
      env.DB.prepare(
        `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, closed_at,
           decision, created_at)
         VALUES ('case-1', 'checkin-1', ?1, '2026-09-21T07:32:00.000Z', '2026-09-21T07:47:00.000Z',
           '2026-09-21T07:47:00.000Z', ?2, '2026-09-21T07:47:00.000Z')`,
      ).bind(VISIT, decision),
    ]);
    if (paid === "payment") {
      await env.DB.prepare(
        `INSERT INTO payments (id, reference, person_id, appointment_id, razorpay_payment_id, amount, currency, method,
           status, captured_at, created_at, updated_at)
         VALUES ('payment-1', 'MM-2026-0841', ?1, ?2, 'pay_visit', 200000, 'INR', 'upi', 'captured', ?3, ?3, ?3)`,
      )
        .bind(PERSON, VISIT, NOW.toISOString())
        .run();
    }
    if (paid === "credit") {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO credit_ledger (id, person_id, kind, visits, source_kind, source_id, expires_at, created_at)
           VALUES ('grant-1', ?1, 'grant', 3, 'referral', 'referral-1', '2027-09-21T06:30:00.000Z', ?2)`,
        ).bind(PERSON, NOW.toISOString()),
        env.DB.prepare(
          `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
           VALUES ('redeem-1', ?1, 'redeem', -1, 'grant-1', 'appointment', ?2, ?3)`,
        ).bind(PERSON, VISIT, NOW.toISOString()),
      ]);
    }
    return queued("no_show_decided", "appointment", VISIT);
  }

  const MISSED =
    "Hello Karan, we came for your service visit on Mon 21 Sep and waited 15 minutes, but nobody was home.";

  it("says a charge keeps what was paid, as a late cancel would", async () => {
    expect((await send(await ruled("charged", "payment"))).text).toBe(
      `${MISSED} As with a late cancel, the Rs. 2,000 you paid for it is kept. Message us if this is wrong.`,
    );
  });

  it("says a charge on a credit visit keeps the credit", async () => {
    expect((await send(await ruled("charged", "credit"))).text).toBe(
      `${MISSED} As with a late cancel, the visit credit it used is gone. Message us if this is wrong.`,
    );
  });

  it("says only that nobody was home, of a visit nothing was paid for", async () => {
    expect((await send(await ruled("charged", "nothing"))).text).toBe(
      `${MISSED} You can book again in the Mane Man app.`,
    );
  });

  // A waiver gives back what the visit took, as the owner ruled on 27 September 2026 (BIZ-28).
  it("says a waiver charges nothing, and that the payment is on its way back", async () => {
    expect((await send(await ruled("waived", "payment"))).text).toBe(
      `${MISSED} We are not charging you for it: Rs. 2,000 is on its way back to your UPI, in 5 to 7 working days.`,
    );
  });

  it("says a waiver of a credit visit gives the credit back", async () => {
    expect((await send(await ruled("waived", "credit"))).text).toBe(
      `${MISSED} We are not charging you for it, and your visit credit is back.`,
    );
  });

  // What a waiver gives back is ops' to set, and each ruling keeps what it gave (docs/decisions/0088-every-policy-in-the-console.md).
  it("says a waiver kept the payment and the credit where the ruling kept them", async () => {
    const payment = await ruled("waived", "payment");
    await env.DB.prepare("UPDATE no_show_cases SET waiver_payment = 'kept', waiver_credit = 'spent'").run();
    expect((await send(payment)).text).toBe(
      `${MISSED} We are not charging you for it. Message us about the Rs. 2,000 you paid for it.`,
    );
  });

  it("says a waiver of a credit visit kept the credit where the ruling kept it", async () => {
    const credit = await ruled("waived", "credit");
    await env.DB.prepare("UPDATE no_show_cases SET waiver_payment = 'refunded', waiver_credit = 'spent'").run();
    expect((await send(credit)).text).not.toContain("your visit credit is back");
  });

  it("says a waiver of a visit nothing was paid for charges nothing", async () => {
    expect((await send(await ruled("waived", "nothing"))).text).toBe(
      `${MISSED} We are not charging you for it. You can book again in the Mane Man app.`,
    );
  });

  it("is not sent before ops have ruled, or without the client's consent to WhatsApp about visits", async () => {
    expect(await send(await ruled("undecided", "nothing"))).toEqual({
      text: null,
      skipped: "ops have not ruled on it",
    });
    await consent("whatsapp_visits", false, PERSON, "2026-09-21T06:31:00.000Z");
    expect(await send(await queued("no_show_decided", "appointment", VISIT))).toEqual({
      text: null,
      skipped: "no consent to WhatsApp about visits",
    });
  });
});

describe("the waitlist confirmation (REQ-03)", () => {
  async function listed(launchAlert: boolean) {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES ('400050', 'Bandra', 'Mumbai', 0)",
      ),
      env.DB.prepare(
        `INSERT INTO waitlist_entries (id, pincode, person_id, contact_consent_at, launch_alert, created_at)
         VALUES (?1, '400050', ?2, ?3, ?4, ?3)`,
      ).bind(ENTRY, PERSON, NOW.toISOString(), launchAlert ? 1 : 0),
    ]);
    await consent("contact", true);
    if (launchAlert) await consent("whatsapp_launches", true);
    return queued("waitlist_confirmation", "waitlist_entry", ENTRY);
  }

  it("names the area, and promises word of the launch to one who asked for it", async () => {
    const sent = await send(await listed(true));
    expect(sent.text).toBe(
      "Hello Karan, you are on our list for Bandra. We will message you on WhatsApp when we come there.",
    );
  });

  it("promises nothing more to one who did not ask to be told of the launch", async () => {
    const sent = await send(await listed(false));
    expect(sent.text).toBe("Hello Karan, you are on our list for Bandra. We do not come there yet.");
  });

  it("promises nothing more once the launch alert was switched off", async () => {
    const message = await listed(true);
    await consent("whatsapp_launches", false, PERSON, "2026-09-21T06:31:00.000Z");
    expect((await send(message)).text).toBe("Hello Karan, you are on our list for Bandra. We do not come there yet.");
  });

  it("is not sent once the consent to be contacted about the request was withdrawn", async () => {
    const message = await listed(false);
    await consent("contact", false, PERSON, "2026-09-21T06:31:00.000Z");
    expect(await send(message)).toEqual({ text: null, skipped: "no consent to be contacted about the request" });
  });

  it("is not sent once the entry is gone", async () => {
    const message = await listed(false);
    await env.DB.prepare("DELETE FROM waitlist_entries").run();
    expect(await send(message)).toEqual({ text: null, skipped: "no longer on the waitlist" });
  });
});
