import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { confirmBooking } from "../../../src/domain/booking/bookings.ts";
import { sendUnsentLinks } from "../../../src/domain/money/payment-links.ts";
import { recordRefund } from "../../../src/domain/money/payments.ts";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import { createStubPayments, type StubPayments } from "../../../src/providers/payments/stub.ts";
import { captureLogs, fakeDependencies, LOCAL_CONFIG, markDatabase, NOW } from "../helpers.ts";
import { book, bookedVisit, erase, fittedVisitUnpaid, statusOf } from "./erasure-fixtures.ts";

beforeEach(async () => {
  await markDatabase();
  captureLogs();
});

/** A payment we captured and hold, with no visit behind it. */
async function paymentHeld(personId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO payments (id, reference, person_id, razorpay_payment_id, amount, currency, status, captured_at,
       created_at, updated_at)
     VALUES ('payment-1', 'MM-2026-0001', ?1, 'pay_1', 200000, 'INR', 'captured', ?2, ?2, ?2)`,
  )
    .bind(personId, NOW.toISOString())
    .run();
}

interface CancelOwing {
  /** In paise, of the Rs. 30,000 paid: what the cancel gives back, and what it keeps. */
  readonly refund: number;
  readonly kept: number;
  /** Whether the cancel's refund is settled: made, or refused by Razorpay and left to ops. */
  readonly settled: boolean;
  /** Our refund's ID, once Razorpay made it. */
  readonly refundId: string | null;
}

/** A first fit paid Rs. 30,000 and cancelled since, with the cancel's refund as given. */
async function cancelledFirstFit(personId: string, cancel: CancelOwing): Promise<void> {
  const at = NOW.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, synced_at)
       VALUES ('visit-cancelled', 'visit-cancelled', ?1, 'first_fit', 'cancelled', '2026-09-22T03:30:00.000Z', ?2)`,
    ).bind(personId, at),
    env.DB.prepare(
      `INSERT INTO payments (id, reference, person_id, appointment_id, razorpay_payment_id, amount, currency, status,
         captured_at, created_at, updated_at)
       VALUES ('payment-fit', 'MM-2026-0004', ?1, 'visit-cancelled', 'pay_fit', 3000000, 'INR', 'captured', ?2, ?2, ?2)`,
    ).bind(personId, at),
    env.DB.prepare(
      `INSERT INTO visit_changes (id, appointment_id, person_id, kind, notice, was_start, refund_amount, kept_amount,
         payment_id, created_at, refund_settled_at, razorpay_refund_id)
       VALUES ('change-1', 'visit-cancelled', ?1, 'cancelled', 'late', '2026-09-22T03:30:00.000Z', ?2, ?3,
         'payment-fit', ?4, ?5, ?6)`,
    ).bind(personId, cancel.refund, cancel.kept, at, cancel.settled ? at : null, cancel.refundId),
  ]);
}

/** Razorpay's webhook reporting a refund of the first fit's payment processed. */
const refundReported = (amount: number) =>
  recordRefund(
    env.DB,
    { id: "rfnd_fit", payment_id: "pay_fit", amount, status: "processed", created_at: NOW.getTime() / 1000 },
    NOW,
  );

describe("erasure while something is still owed", () => {
  it("refuses a client with a visit booked, and names the visit", async () => {
    const personId = await book();
    await bookedVisit(personId);

    const response = await erase(personId);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "visit_booked", request_id: expect.any(String) as string },
      visits: [{ id: "visit-live", type: "service", status: "scheduled", window_start: "2026-09-28T03:30:00.000Z" }],
      bookings: [],
      payments: [],
      links: [],
    });
    expect(await env.DB.prepare("SELECT erased_at FROM people WHERE id = ?1").bind(personId).first()).toEqual({
      erased_at: null,
    });
  });

  it("refuses a client whose payment we hold with no visit behind it, and names the payment", async () => {
    const personId = await book();
    await paymentHeld(personId);

    const response = await erase(personId);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "payment_held" },
      visits: [],
      payments: [{ id: "payment-1", reference: "MM-2026-0001", amount: 200000 }],
    });
  });

  it("refuses a client whose cancelled visit's refund is not yet made, names what it owes, and erases once made", async () => {
    const personId = await book();
    // A late cancel keeps the first fit's Rs. 4,000 late fee, and the cron is still asking for the rest.
    await cancelledFirstFit(personId, { refund: 2600000, kept: 400000, settled: false, refundId: null });
    const owed = {
      error: { code: "payment_held" },
      visits: [],
      payments: [{ id: "payment-fit", reference: "MM-2026-0004", amount: 2600000 }],
    };

    const pending = await erase(personId);
    expect(pending.status).toBe(409);
    expect(await pending.json()).toMatchObject(owed);

    // Razorpay refused it, so it waits for ops to refund by hand.
    await env.DB.prepare("UPDATE visit_changes SET refund_settled_at = ?1").bind(NOW.toISOString()).run();
    const leftToOps = await erase(personId);
    expect(leftToOps.status).toBe(409);
    expect(await leftToOps.json()).toMatchObject(owed);

    expect(await refundReported(2600000)).toBe(true);
    expect(await statusOf(personId)).toBe(200);
  });

  it("is not held up by a cancel that kept what was paid", async () => {
    const personId = await book();
    await cancelledFirstFit(personId, { refund: 0, kept: 3000000, settled: true, refundId: null });

    expect(await statusOf(personId)).toBe(200);
  });

  it("is not held up by a cancel's refund Razorpay made, before it reports the refund processed", async () => {
    const personId = await book();
    await cancelledFirstFit(personId, { refund: 3000000, kept: 0, settled: true, refundId: "rfnd_fit" });

    expect(await statusOf(personId)).toBe(200);
  });

  it("erases anyway when ops say they will settle both by hand today, and the log says so", async () => {
    const personId = await book();
    await bookedVisit(personId);
    await paymentHeld(personId);

    expect(await statusOf(personId, { body: { override_open_bookings: true } })).toBe(200);

    const entry = await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'person.erase'").first("detail");
    expect(entry).toBe(JSON.stringify({ settled_by_hand: true, visits: 1, bookings: 0, payments: 1, links: 0 }));
  });
});

/** Imran, whose Wednesday a booking holds. */
async function technician(): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
}

interface Holding {
  readonly id: string;
  readonly window?: "morning" | "afternoon";
  readonly amount: number;
  readonly confirmedAt: string | null;
  readonly expiresAt: string;
  readonly payByLink?: { readonly linkId: string; readonly reference: string };
  readonly orderId?: string;
}

/** A booking of theirs not yet a visit, holding a window of Imran's Wednesday, the morning unless said. */
async function holding(personId: string, hold: Holding): Promise<void> {
  const at = NOW.toISOString();
  const window = hold.window ?? "morning";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount, amount_ex_gst,
         gst_percent, state, expires_at, created_at, updated_at, confirmed_at, queued_at, pay_by_link, payment_link_id,
         reference, razorpay_order_id)
       VALUES (?1, ?2, 'consultation', '2026-09-23', ?11, 't1', 0, ?3, ?3, 0, 'held', ?4, ?5, ?5, ?6, ?6, ?7, ?8, ?9,
         ?10)`,
    ).bind(
      hold.id,
      personId,
      hold.amount,
      hold.expiresAt,
      at,
      hold.confirmedAt,
      hold.payByLink === undefined ? 0 : 1,
      hold.payByLink?.linkId ?? null,
      hold.payByLink?.reference ?? null,
      hold.orderId ?? null,
      window,
    ),
    env.DB.prepare(
      "INSERT INTO slot_claims (technician_id, date, claim, hold_id) VALUES ('t1', '2026-09-23', ?1, ?2)",
    ).bind(`window:${window}`, hold.id),
  ]);
}

const AN_HOUR_ON = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString();

/** The audit's X10: a free consultation confirmed, and not yet a visit. */
const freeBooking = (personId: string) =>
  holding(personId, { id: "hold-free", amount: 0, confirmedAt: NOW.toISOString(), expiresAt: NOW.toISOString() });

/** A visit ops booked, its slot held while the payment link they sent is open. */
const bookingByLink = (personId: string, expiresAt = AN_HOUR_ON) =>
  holding(personId, {
    id: "hold-link",
    window: "afternoon",
    amount: 200000,
    confirmedAt: null,
    expiresAt,
    payByLink: { linkId: "plink_hold", reference: "MM-2026-0002" },
  });

const holdStates = async () => (await env.DB.prepare("SELECT id, state FROM slot_holds ORDER BY id").all()).results;

const claimsLeft = async () => (await env.DB.prepare("SELECT hold_id FROM slot_claims").all()).results;

const erasedAt = async (personId: string) =>
  env.DB.prepare("SELECT erased_at FROM people WHERE id = ?1").bind(personId).first("erased_at");

describe("erasure while a booking is not yet a visit, or a payment link is unpaid", () => {
  beforeEach(technician);

  it("refuses a client whose free consultation is confirmed but not yet a visit, names it, and keeps it", async () => {
    const personId = await book();
    await freeBooking(personId);

    const response = await erase(personId);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "visit_booked" },
      visits: [],
      bookings: [{ id: "hold-free", type: "consultation", date: "2026-09-23", window: "morning" }],
      links: [],
    });
    expect(await erasedAt(personId)).toBeNull();
    expect(await holdStates()).toEqual([{ id: "hold-free", state: "held" }]);
  });

  it("refuses a client whose fitted visit's payment link is unpaid, and names the link", async () => {
    const personId = await book();
    await fittedVisitUnpaid(personId);

    const response = await erase(personId);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "payment_owed" },
      links: [{ id: "link-1", reference: "MM-2026-0003", amount: 4500000 }],
    });
    expect(await erasedAt(personId)).toBeNull();
  });

  it("refuses a client with a payment link open for a booking, and names the booking's link", async () => {
    const personId = await book();
    await bookingByLink(personId);

    const response = await erase(personId);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "payment_owed" },
      bookings: [],
      links: [{ id: "hold-link", reference: "MM-2026-0002", amount: 200000 }],
    });
  });

  it("is not held up by a booking's link that has closed, and asks Razorpay to cancel nothing", async () => {
    const personId = await book();
    await bookingByLink(personId, NOW.toISOString());
    const deps = fakeDependencies();

    expect(await statusOf(personId, { deps })).toBe(200);

    expect((deps.payments as StubPayments).made.cancelledLinks).toEqual([]);
  });

  it("erases anyway when ops say so: lets go of the bookings and their time, and cancels the open links", async () => {
    const personId = await book();
    await freeBooking(personId);
    await bookingByLink(personId);
    await fittedVisitUnpaid(personId);
    const deps = fakeDependencies();

    expect(await statusOf(personId, { deps, body: { override_open_bookings: true } })).toBe(200);

    expect(await holdStates()).toEqual([
      { id: "hold-free", state: "released" },
      { id: "hold-link", state: "released" },
    ]);
    expect(await claimsLeft()).toEqual([]);
    expect((deps.payments as StubPayments).made.cancelledLinks).toEqual(["plink_visit", "plink_hold"]);
    const entry = await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'person.erase'").first("detail");
    expect(entry).toBe(JSON.stringify({ settled_by_hand: true, visits: 0, bookings: 1, payments: 0, links: 2 }));
  });

  it("still erases when Razorpay will not cancel a link, and tells ops its ID to cancel by hand", async () => {
    const personId = await book();
    await fittedVisitUnpaid(personId);
    const refusing = createStubPayments();
    const deps = fakeDependencies({
      payments: { ...refusing, cancelPaymentLink: () => Promise.reject(new Error("Razorpay 400 BAD_REQUEST_ERROR")) },
    });

    expect(await statusOf(personId, { deps, body: { override_open_bookings: true } })).toBe(200);

    expect(await erasedAt(personId)).not.toBeNull();
    expect(await env.DB.prepare("SELECT key FROM alerts WHERE resolved_at IS NULL").all()).toMatchObject({
      results: [{ key: "erased_link:plink_visit" }],
    });
    expect(deps.alerts.join("\n")).toContain("plink_visit");
  });
});

describe("a booking of a client erased since", () => {
  beforeEach(technician);

  it("is let go by the erasure, and a payment for it that comes in afterwards goes back rather than booking it", async () => {
    const personId = await book();
    await holding(personId, {
      id: "hold-paying",
      amount: 200000,
      confirmedAt: null,
      expiresAt: AN_HOUR_ON,
      orderId: "order_late",
    });
    expect(await statusOf(personId)).toBe(200);
    expect(await holdStates()).toEqual([{ id: "hold-paying", state: "released" }]);

    // Razorpay's webhook records the capture and confirms the hold, then asks for the booking.
    const at = NOW.toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO payments (id, person_id, razorpay_order_id, razorpay_payment_id, amount, currency, status,
           captured_at, created_at, updated_at)
         VALUES ('payment-late', ?1, 'order_late', 'pay_late', 200000, 'INR', 'captured', ?2, ?2, ?2)`,
      ).bind(personId, at),
      env.DB.prepare("UPDATE slot_holds SET confirmed_at = ?1 WHERE id = 'hold-paying'").bind(at),
    ]);
    const payments = createStubPayments();
    const outcome = await confirmBooking(
      { db: env.DB, payments: payments, now: NOW, log: createLogger() },
      "hold-paying",
    );

    expect(outcome).toBe("refunded");
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_late", amount: 200000 }]);
    expect(await env.DB.prepare("SELECT id FROM appointments WHERE person_id = ?1").bind(personId).all()).toMatchObject(
      {
        results: [],
      },
    );
    expect(await holdStates()).toEqual([{ id: "hold-paying", state: "released" }]);
  });

  it("is never booked, and is let go, when a try for it still comes", async () => {
    const personId = await book();
    await freeBooking(personId);
    await env.DB.prepare("UPDATE people SET erased_at = ?2 WHERE id = ?1").bind(personId, NOW.toISOString()).run();

    const outcome = await confirmBooking(
      { db: env.DB, payments: createStubPayments(), now: NOW, log: createLogger() },
      "hold-free",
    );

    expect(outcome).toBe("lapsed");
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM appointments WHERE person_id = ?1").bind(personId).first(),
    ).toEqual({
      n: 0,
    });
    expect(await holdStates()).toEqual([{ id: "hold-free", state: "released" }]);
    expect(await claimsLeft()).toEqual([]);
  });

  it("never has a payment link asked of Razorpay for it", async () => {
    const personId = await book();
    await fittedVisitUnpaid(personId);
    await env.DB.batch([
      env.DB.prepare("UPDATE payment_links SET razorpay_link_id = NULL, short_url = NULL, sent_at = NULL"),
      env.DB.prepare("UPDATE people SET erased_at = ?2 WHERE id = ?1").bind(personId, NOW.toISOString()),
    ]);
    const deps = fakeDependencies();

    const linkDeps = { ...deps, log: createLogger(), messagingSettings: LOCAL_CONFIG.settings.messaging };
    const sent = await sendUnsentLinks(env.DB, linkDeps, NOW, createCallBudget(10));

    expect(sent).toBe(0);
    expect((deps.payments as StubPayments).made.links).toEqual([]);
  });
});
