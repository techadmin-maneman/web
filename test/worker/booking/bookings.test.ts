// Booking a held window (src/domain/bookings.ts): Checkout's order, the visit
// written once Razorpay confirms the capture, and the refund when the payment
// came too late. NOW is Monday 21 September 2026, 12 noon in India. Every name
// and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { autoRefundsOf, composeBookingRefunded } from "../../../src/domain/auto-refunds.ts";
import { confirmBooking } from "../../../src/domain/bookings.ts";
import { createStubPayments } from "../../../src/providers/payments/stub.ts";
import { openSession } from "../../../src/domain/sessions.ts";
import {
  appFor,
  fakeDependencies,
  fakeQueue,
  leaseRefused,
  markDatabase,
  NOW,
  request,
  savedAddress,
  deliverRazorpay,
} from "../helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
let cookie: string;

beforeEach(async () => {
  await markDatabase();
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name)
     VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  await savedAddress(PERSON);
  // Fitted: a service visit done with Imran.
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id, synced_at)
     VALUES ('past', 'past', ?1, 'service', 'completed', '2026-09-01T06:30:00.000Z', '2026-09-01T08:00:00.000Z', 't1',
       ?2)`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
});

const post = (app: ReturnType<typeof appFor>, path: string, body: object, bindings = {}) =>
  request(
    app,
    path,
    {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify(body),
    },
    bindings,
  );

async function heldService(app = appFor("local", fakeDependencies(), {}, "client")): Promise<string> {
  const answer = await post(app, "/api/holds", { type: "service", date: "2026-09-22", window: "afternoon" });
  return (await answer.json<{ id: string }>()).id;
}

/** The visit a hold booked, by its hold. */
const visitOf = (holdId: string) =>
  env.DB.prepare(
    `SELECT a.id, a.fsm_id, a.type, a.tier, a.status, a.technician_id, a.window_start, a.window_end
     FROM appointments a JOIN slot_holds h ON h.appointment_id = a.id WHERE h.id = ?1`,
  )
    .bind(holdId)
    .first<{ id: string; fsm_id: string; window_end: string }>();

/** Razorpay's capture of the hold's order, as the webhook records it. */
async function captured(holdId: string, capturedAt = NOW.toISOString()) {
  await env.DB.prepare(
    `INSERT INTO payments (id, person_id, razorpay_order_id, razorpay_payment_id, amount, currency, method, status,
       captured_at, created_at, updated_at)
     SELECT ?1, person_id, razorpay_order_id, 'pay_1', amount, 'INR', 'upi', 'captured', ?2, ?2, ?2
     FROM slot_holds WHERE id = ?3`,
  )
    .bind(crypto.randomUUID(), capturedAt, holdId)
    .run();
}

describe("POST /api/bookings", () => {
  it("makes one Razorpay order for a paid hold, with what Checkout opens with", async () => {
    const payments = createStubPayments();
    const app = appFor("local", fakeDependencies({ payments }), {}, "client");
    const holdId = await heldService(app);
    const answer = await post(app, "/api/bookings", { hold_id: holdId });
    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({
      hold_id: holdId,
      checkout: {
        key_id: "",
        order_id: expect.stringMatching(/^order_stub_/) as string,
        amount: 200000,
        currency: "INR",
        name: "Mane Man",
        // The day as the app writes it, never "2026-09-22".
        description: "Service visit · Tue 22 Sep",
        prefill: { name: "Rohit Malhotra", contact: "+919810000001" },
      },
    });
    expect(payments.made.orders).toEqual([
      { amount: 200000, receipt: holdId, notes: { hold_id: holdId, person_id: PERSON } },
    ]);
    // Asked again, the same order.
    await post(app, "/api/bookings", { hold_id: holdId });
    expect(payments.made.orders).toHaveLength(1);
  });

  it("makes one order for two bookings of the same hold at the same moment", async () => {
    const payments = createStubPayments();
    const app = appFor("local", fakeDependencies({ payments }), {}, "client");
    const holdId = await heldService(app);
    // Both taps are in flight together, as they are when a client taps Retry twice on board C6.
    const both = await Promise.all([
      post(app, "/api/bookings", { hold_id: holdId }),
      post(app, "/api/bookings", { hold_id: holdId }),
    ]);
    expect(both.map((answer) => answer.status)).toEqual([201, 201]);
    const orders = await Promise.all(
      both.map(async (answer) => (await answer.json<{ checkout: { order_id: string } }>()).checkout.order_id),
    );
    // Both taps are answered with the one order the hold names. The other, which the race made and
    // no client is ever told about, is the only one Checkout cannot be opened on (ADR 0057).
    expect(orders[0]).toBe(orders[1]);
    expect(await env.DB.prepare("SELECT razorpay_order_id FROM slot_holds WHERE id = ?1").bind(holdId).first()).toEqual(
      { razorpay_order_id: orders[0] },
    );
    expect(payments.made.orders.map((order) => order.receipt)).toEqual([holdId, holdId]);
  });

  it("books a free consultation straight away, and refuses a hold that has lapsed", async () => {
    await env.DB.prepare("DELETE FROM appointments").run(); // a lead: a consultation is what they may book
    const app = appFor("local", fakeDependencies(), {}, "client");
    const consult = await (
      await post(app, "/api/holds", { type: "consultation", date: "2026-09-22", window: "morning" })
    ).json<{ id: string }>();
    const answer = await post(app, "/api/bookings", { hold_id: consult.id }, { MESSAGE_QUEUE: fakeQueue() });
    expect(await answer.json()).toEqual({ hold_id: consult.id, checkout: null });
    expect(await visitOf(consult.id)).toMatchObject({ type: "consultation", status: "scheduled" });

    const later = appFor("local", fakeDependencies({ now: () => new Date(NOW.getTime() + 11 * 60_000) }), {}, "client");
    const lapsed = await post(later, "/api/bookings", { hold_id: consult.id });
    expect(lapsed.status).toBe(409);
  });
});

describe("confirmBooking", () => {
  it("books a paid hold with its technician and times, its own ID its FSM ID, and links the payment", async () => {
    const app = appFor("local", fakeDependencies(), {}, "client");
    const holdId = await heldService(app);
    await post(app, "/api/bookings", { hold_id: holdId });
    const payments = createStubPayments();
    expect(await confirmBooking(env.DB, payments, holdId, NOW, {})).toBe("not_paid");

    await captured(holdId);
    expect(await confirmBooking(env.DB, payments, holdId, NOW, {})).toBe("booked");
    const visit = await visitOf(holdId);
    expect(visit).toMatchObject({
      type: "service",
      status: "scheduled",
      technician_id: "t1",
      window_start: "2026-09-22T06:30:00.000Z",
      window_end: "2026-09-22T08:00:00.000Z",
    });
    expect(visit?.fsm_id).toBe(visit?.id);
    const paid = await env.DB.prepare(
      "SELECT appointment_id FROM payments WHERE razorpay_payment_id = 'pay_1'",
    ).first();
    expect(paid).toEqual({ appointment_id: visit?.id });
    const claims = await env.DB.prepare("SELECT COUNT(*) AS n FROM slot_claims").first();
    expect(claims).toEqual({ n: 0 });

    const hold = await request(app, `/api/holds/${holdId}`, { headers: { Cookie: cookie } });
    expect(await hold.json()).toMatchObject({ state: "booked", paid: true, visit_id: visit?.id });
    // Told again, it books nothing twice.
    expect(await confirmBooking(env.DB, payments, holdId, NOW, {})).toBe("already_booked");
    const visits = await env.DB.prepare("SELECT COUNT(*) AS n FROM appointments WHERE type = 'service'").first();
    expect(visits).toEqual({ n: 2 });
  });

  it("refunds, once, a payment made after its hold had lapsed and the two minutes' grace after it", async () => {
    const app = appFor("local", fakeDependencies(), {}, "client");
    const holdId = await heldService(app);
    await post(app, "/api/bookings", { hold_id: holdId });
    await captured(holdId, new Date(NOW.getTime() + 13 * 60_000).toISOString());
    const payments = createStubPayments();
    const later = new Date(NOW.getTime() + 13 * 60_000);
    expect(await confirmBooking(env.DB, payments, holdId, later, {})).toBe("refunded");
    expect(await confirmBooking(env.DB, payments, holdId, later, {})).toBe("refunded");
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_1", amount: 200000 }]);
    expect(await visitOf(holdId)).toBeNull();
  });

  // A lapse refund sent no message and showed nowhere in the console.
  it("tells the client of a refund made because the hold had lapsed, once, without their visits consent", async () => {
    const app = appFor("local", fakeDependencies(), {}, "client");
    const holdId = await heldService(app);
    await post(app, "/api/bookings", { hold_id: holdId });
    const later = new Date(NOW.getTime() + 13 * 60_000);
    await captured(holdId, later.toISOString());
    const notified: string[] = [];
    const options = {
      notify: (messageId: string) => {
        notified.push(messageId);
        return Promise.resolve();
      },
    };
    const payments = createStubPayments();
    expect(await confirmBooking(env.DB, payments, holdId, later, options)).toBe("refunded");
    expect(await confirmBooking(env.DB, payments, holdId, later, options)).toBe("refunded");

    const { results } = await env.DB.prepare(
      "SELECT id, kind, subject_kind, subject_id, state FROM outbound_messages WHERE person_id = ?1",
    )
      .bind(PERSON)
      .all();
    expect(results).toEqual([
      { id: notified[0], kind: "booking_refunded", subject_kind: "slot_hold", subject_id: holdId, state: "queued" },
    ]);
    expect(notified).toHaveLength(1);
    expect(await composeBookingRefunded(env.DB, holdId, PERSON)).toEqual({
      template: "booking_refunded_v1",
      params: ["Rohit", "service visit", "Tue 22 Sep", "", "", "Rs. 2,000", "", "UPI"],
    });
    expect(await autoRefundsOf(env.DB, PERSON)).toEqual([
      {
        holdId,
        type: "service",
        serviceName: "Service visit",
        date: "2026-09-22",
        amount: 200000,
        reason: "lapsed",
        refundedAt: later.toISOString(),
      },
    ]);
  });

  it("tells no one, and lists nothing as refunded, when a lapsed hold took no payment", async () => {
    await env.DB.prepare("DELETE FROM appointments").run(); // a lead: a consultation is what they may book
    const app = appFor("local", fakeDependencies(), {}, "client");
    const consult = await (
      await post(app, "/api/holds", { type: "consultation", date: "2026-09-22", window: "morning" })
    ).json<{ id: string }>();
    // Confirmed, and its booking lost with the request, as the half-hour pass finds it.
    await post(app, "/api/bookings", { hold_id: consult.id }, { DB: leaseRefused(env.DB) });
    await env.DB.prepare("UPDATE slot_holds SET state = 'released' WHERE id = ?1").bind(consult.id).run();
    const later = new Date(NOW.getTime() + 13 * 60_000);
    expect(await confirmBooking(env.DB, createStubPayments(), consult.id, later)).toBe("lapsed");
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM outbound_messages").first()).toEqual({ n: 0 });
    expect(await autoRefundsOf(env.DB, PERSON)).toEqual([]);
  });
});

/**
 * A service ops added to a kind (docs/decisions/0085-services-ops-can-edit.md): a premium service visit of two hours
 * at Rs. 2,500, priced from January.
 */
async function premiumService(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
       VALUES ('service', 'premium', 'Premium service', 120, 1, 'ops@localhost', ?1)`,
    ).bind(NOW.toISOString()),
    env.DB.prepare(
      "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES ('service', 'premium', 250000, 0, '2026-01-01')",
    ),
  ]);
}

async function heldPremium(app: ReturnType<typeof appFor>): Promise<string> {
  const body = { type: "service", tier: "premium", date: "2026-09-22", window: "afternoon" };
  return (await (await post(app, "/api/holds", body)).json<{ id: string }>()).id;
}

describe("booking a service ops added", () => {
  it("holds it at its own price and length, and books it as its own service", async () => {
    await premiumService();
    const app = appFor("local", fakeDependencies(), {}, "client");
    const holdId = await heldPremium(app);
    const held = await env.DB.prepare("SELECT type, tier, minutes, amount FROM slot_holds WHERE id = ?1")
      .bind(holdId)
      .first();
    expect(held).toEqual({ type: "service", tier: "premium", minutes: 120, amount: 250000 });
    const started = await (await post(app, "/api/bookings", { hold_id: holdId })).json<{ checkout: object }>();
    expect(started.checkout).toMatchObject({ amount: 250000, description: "Premium service · Tue 22 Sep" });

    await captured(holdId);
    expect(await confirmBooking(env.DB, createStubPayments(), holdId, NOW, {})).toBe("booked");

    expect(await visitOf(holdId)).toMatchObject({
      type: "service",
      tier: "premium",
      window_start: "2026-09-22T06:30:00.000Z",
      window_end: "2026-09-22T08:30:00.000Z",
    });
  });

  // ADR 0068: what a client was sold stays sold, whatever ops change after.
  it("keeps the price and the length it was held at, whatever ops set after", async () => {
    await premiumService();
    const app = appFor("local", fakeDependencies(), {}, "client");
    const holdId = await heldPremium(app);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES ('service', 'premium', 300000, 0, '2026-09-21')",
      ),
      env.DB.prepare("UPDATE services SET minutes = 180 WHERE tier = 'premium'"),
    ]);
    await post(app, "/api/bookings", { hold_id: holdId });
    await captured(holdId);

    await confirmBooking(env.DB, createStubPayments(), holdId, NOW, {});

    expect((await visitOf(holdId))?.window_end).toBe("2026-09-22T08:30:00.000Z");
    const paid = await env.DB.prepare("SELECT amount FROM payments WHERE razorpay_payment_id = 'pay_1'").first();
    expect(paid).toEqual({ amount: 250000 });
  });
});

describe("Razorpay's capture of a hold's payment", () => {
  it("books the visit in the webhook's own request", async () => {
    const client = appFor("local", fakeDependencies(), {}, "client");
    const holdId = await heldService(client);
    const started = await post(client, "/api/bookings", { hold_id: holdId });
    const { checkout } = await started.json<{ checkout: { order_id: string } }>();
    const event = {
      entity: "event",
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_9",
            amount: 200000,
            currency: "INR",
            status: "captured",
            order_id: checkout.order_id,
            method: "upi",
            contact: "+919810000001",
            notes: { hold_id: holdId, person_id: PERSON },
            created_at: Math.floor(NOW.getTime() / 1000),
          },
        },
      },
    };
    const answer = await deliverRazorpay(event, { eventId: "evt_9", bindings: { MESSAGE_QUEUE: fakeQueue() } });
    expect(answer.status).toBe(200);
    expect(await visitOf(holdId)).toMatchObject({ type: "service", status: "scheduled" });
  });
});

// A booking a free service visit was to pay for told the client only that nothing was booked.
describe("the message a booking given back sends", () => {
  it("tells a client whose free service visit was to pay that it is still theirs", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount,
           amount_ex_gst, gst_percent, state, use_credit, expires_at, created_at, updated_at)
         VALUES ('hold-credit', ?1, 'service', '2026-09-22', 'morning', 't1', 0, 0, 0, 0, 'released', 1, ?2, ?2, ?2)`,
      ).bind(PERSON, NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
         VALUES ('c-visits', ?1, 'whatsapp_visits', 'whatsapp-visits-v1', 1, ?2)`,
      ).bind(PERSON, NOW.toISOString()),
    ]);
    expect(await composeBookingRefunded(env.DB, "hold-credit", PERSON)).toMatchObject({
      template: "booking_not_made_credit_v1",
    });
  });
});
