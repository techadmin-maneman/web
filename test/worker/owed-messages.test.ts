// The messages people are owed when something changes for them (docs/decisions/0074-hand-offs-and-messages.md):
// what each says, to whom, and when it is skipped. Each is sent by the messaging consumer, which writes the text
// as things stand when it sends. NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is
// made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { renderMessage } from "../../src/config/message-templates.ts";
import { createLogger } from "../../src/log.ts";
import type { MessagingProvider } from "../../src/providers/messaging/index.ts";
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
    expect(sent.text).toBe("Hi Karan, Imran is at your door for your service visit.");
  });

  it("still goes once the visit is under way, which the check-in itself may have moved it to", async () => {
    await visit("in_progress");
    await consent("whatsapp_visits", true);
    expect((await send(await queued("arrival_notice", "appointment", VISIT))).text).not.toBeNull();
  });

  it("is not sent once ten minutes have passed since the check-in reached us", async () => {
    await visit();
    await consent("whatsapp_visits", true);
    const messageId = await queued("arrival_notice", "appointment", VISIT);
    const { provider, sent } = recordingProvider();
    const elevenMinutesOn = new Date(NOW.getTime() + 11 * 60_000);
    await sendMessage(
      env.DB,
      LOCAL_CONFIG,
      fakeDependencies({ messaging: provider, now: () => elevenMinutesOn }),
      log,
      messageId,
    );
    expect(sent).toEqual([]);
    const row = await env.DB.prepare("SELECT state, last_error FROM outbound_messages").first();
    expect(row).toEqual({ state: "skipped", last_error: "too late to tell the client the technician had arrived" });
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

  const MISSED = "Hi Karan, Imran waited 15 minutes for your service visit on Mon 21 Sep but couldn't reach you.";

  // The no-show's charge is set apart from a late cancel's (docs/decisions/0088-every-policy-in-the-console.md), so the
  // texts no longer say "As with a late cancel": each says what the charge was, and that the client may dispute it in
  // the app (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
  const DISPUTE = "If you were home, dispute it in the Mane Man app.";

  /** The charge as the ruling recorded it, in paise. */
  const recorded = (charge: string, kept: number, refund: number) =>
    env.DB.prepare("UPDATE no_show_cases SET charge = ?1, kept_amount = ?2, refund_amount = ?3")
      .bind(charge, kept, refund)
      .run();

  /** The credit back in its grant, as a ruling that gives it back writes it where the grant can still take it. */
  const creditRestored = () =>
    env.DB.prepare(
      `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
       VALUES ('restore-1', ?1, 'restore', 1, 'grant-1', 'appointment', ?2, ?3)`,
    )
      .bind(PERSON, VISIT, NOW.toISOString())
      .run();

  // A ruling that gives the credit back finds its grant expired or clawed back since, and nothing comes back: the
  // message says what the ledger holds, not what the ruling meant to give (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
  const CREDIT_GONE = "the free service visit it used has expired, so we can't return it.";

  it("says a charge ruled before charges were recorded kept what was paid", async () => {
    expect((await send(await ruled("charged", "payment"))).text).toBe(
      `${MISSED} We've kept the Rs. 2,000 you paid as the no-show charge. ${DISPUTE}`,
    );
  });

  it("says a charge on a credit visit spent the credit", async () => {
    const message = await ruled("charged", "credit");
    await recorded("visit", 0, 0);
    expect((await send(message)).text).toBe(
      `${MISSED} The free service visit it used counts as the no-show charge. ${DISPUTE}`,
    );
  });

  it("says what a charge kept of the payment, and what is on its way back", async () => {
    const message = await ruled("charged", "payment");
    await recorded("late_fee", 50000, 150000);
    expect((await send(message)).text).toBe(
      `${MISSED} We've kept Rs. 500 as the no-show charge and refunded Rs. 1,500 to your UPI (5 to 7 working days). ` +
        DISPUTE,
    );
  });

  it("says a charge that kept the whole payment kept it", async () => {
    const message = await ruled("charged", "payment");
    await recorded("visit", 200000, 0);
    expect((await send(message)).text).toBe(
      `${MISSED} We've kept the Rs. 2,000 you paid as the no-show charge. ${DISPUTE}`,
    );
  });

  it("says a charge of nothing gives the payment back, as a waiver does", async () => {
    const message = await ruled("charged", "payment");
    await recorded("nothing", 0, 200000);
    expect((await send(message)).text).toBe(
      `${MISSED} There's no charge: we've refunded Rs. 2,000 to your UPI (5 to 7 working days).`,
    );
  });

  it("says a charge of nothing gives the credit back", async () => {
    const message = await ruled("charged", "credit");
    await recorded("nothing", 0, 0);
    await creditRestored();
    expect((await send(message)).text).toBe(`${MISSED} There's no charge, and your free service visit is back.`);
  });

  it("says the credit cannot come back, where a charge of nothing found nothing to give it back to", async () => {
    const message = await ruled("charged", "credit");
    await recorded("nothing", 0, 0);
    expect((await send(message)).text).toBe(`${MISSED} There's no charge, but ${CREDIT_GONE}`);
  });

  it("says only that nobody was home, of a visit nothing was paid for", async () => {
    expect((await send(await ruled("charged", "nothing"))).text).toBe(`${MISSED} Book a new time in the Mane Man app.`);
  });

  // A waiver gives back what the visit took, as the owner ruled on 27 September 2026 (BIZ-28).
  it("says a waiver charges nothing, and that the payment is on its way back", async () => {
    expect((await send(await ruled("waived", "payment"))).text).toBe(
      `${MISSED} There's no charge: we've refunded Rs. 2,000 to your UPI (5 to 7 working days).`,
    );
  });

  it("says a waiver of a credit visit gives the credit back", async () => {
    const message = await ruled("waived", "credit");
    await creditRestored();
    expect((await send(message)).text).toBe(`${MISSED} There's no charge, and your free service visit is back.`);
  });

  it("says the credit cannot come back, where a waiver found nothing to give it back to", async () => {
    expect((await send(await ruled("waived", "credit"))).text).toBe(`${MISSED} There's no charge, but ${CREDIT_GONE}`);
  });

  // What a waiver gives back is ops' to set, and each ruling keeps what it gave (docs/decisions/0088-every-policy-in-the-console.md).
  it("says a waiver kept the payment and the credit where the ruling kept them", async () => {
    const payment = await ruled("waived", "payment");
    await env.DB.prepare("UPDATE no_show_cases SET waiver_payment = 'kept', waiver_credit = 'spent'").run();
    expect((await send(payment)).text).toBe(`${MISSED} There's no charge. Message us about the Rs. 2,000 you paid.`);
  });

  it("says a waiver of a credit visit kept the credit where the ruling kept it", async () => {
    const credit = await ruled("waived", "credit");
    await env.DB.prepare("UPDATE no_show_cases SET waiver_payment = 'refunded', waiver_credit = 'spent'").run();
    expect((await send(credit)).text).not.toContain("your free service visit is back");
  });

  it("says a waiver of a visit nothing was paid for charges nothing", async () => {
    expect((await send(await ruled("waived", "nothing"))).text).toBe(
      `${MISSED} There's no charge. Book a new time in the Mane Man app.`,
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

  // The client disputes the charge in the app, ops rule Refund or Uphold, "and the client is told"
  // (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md). Never ops' reason.
  describe("the ruling on a disputed charge", () => {
    const LOOKED_AT = "Hi Karan, we've reviewed your dispute about your service visit on Mon 21 Sep";

    async function disputed(paid: "payment" | "credit", ruling: "refunded" | "upheld" | null) {
      await ruled("charged", paid);
      await recorded("visit", paid === "payment" ? 200000 : 0, 0);
      await env.DB.prepare(
        `INSERT INTO no_show_disputes (id, case_id, person_id, reason, created_at, ruling, ruled_by, ruled_at,
           ruling_reason)
         VALUES ('dispute-1', 'case-1', ?1, 'I was home', ?2, ?3, 'ops@localhost', ?2, 'The bell was broken')`,
      )
        .bind(PERSON, NOW.toISOString(), ruling)
        .run();
      return queued("no_show_dispute_ruled", "appointment", VISIT);
    }

    it("says a refund is on its way back", async () => {
      expect((await send(await disputed("payment", "refunded"))).text).toBe(
        `${LOOKED_AT} and refunded Rs. 2,000 to your UPI (5 to 7 working days).`,
      );
    });

    it("says the credit is back, where the charge spent it", async () => {
      const message = await disputed("credit", "refunded");
      await creditRestored();
      expect((await send(message)).text).toBe(`${LOOKED_AT} and returned your free service visit.`);
    });

    it("says the credit cannot come back, where the refund found nothing to give it back to", async () => {
      expect((await send(await disputed("credit", "refunded"))).text).toBe(
        `${LOOKED_AT}, and the charge shouldn't stand. The free service visit it used has expired, so we can't return it.`,
      );
    });

    it("says the charge stands, and never why", async () => {
      const text = (await send(await disputed("payment", "upheld"))).text;
      expect(text).toBe(`${LOOKED_AT}. The charge stands. Message us if you'd like to know why.`);
      expect(text).not.toContain("bell");
    });

    it("is not sent before ops have ruled", async () => {
      expect(await send(await disputed("payment", null))).toEqual({
        text: null,
        skipped: "ops have not ruled on the dispute",
      });
    });
  });
});

describe("the waitlist confirmation (REQ-03)", () => {
  /** Someone listed in Bandra, whose area ops have named unless `named` is false. */
  async function listed(launchAlert: boolean, named = true) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO serviceable_pincodes (pincode, area, city, served, area_named_by)
         VALUES ('400050', 'Bandra', 'Mumbai', 0, ?1)`,
      ).bind(named ? "ops@localhost" : null),
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
      "Hi Karan, you're on our list for Bandra. We'll WhatsApp you as soon as we start coming there.",
    );
  });

  // CP-25 of the audit, 2 October 2026: "you are on our list for 400050", a bare pincode.
  it("names the pincode as one until ops name the area", async () => {
    const sent = await send(await listed(false, false));
    expect(sent.text).toBe("Hi Karan, you're on our list for pincode 400050. We don't cover it yet.");
  });

  it("promises nothing more to one who did not ask to be told of the launch", async () => {
    const sent = await send(await listed(false));
    expect(sent.text).toBe("Hi Karan, you're on our list for Bandra. We don't cover it yet.");
  });

  it("promises nothing more once the launch alert was switched off", async () => {
    const message = await listed(true);
    await consent("whatsapp_launches", false, PERSON, "2026-09-21T06:31:00.000Z");
    expect((await send(message)).text).toBe("Hi Karan, you're on our list for Bandra. We don't cover it yet.");
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
