// A discount code entered on a booking (docs/decisions/0108-discount-codes.md): by the client at the app's pay step,
// on the site's form for a consultation and fit in one visit, and by the technician before the visit's payment link.
// Each takes the code off before GST, and the order, the link and the payment carry what is left. NOW is Monday 21
// September 2026, 12 noon in India; staging's book has a service visit at Rs. 2,000 and a first fit at Rs. 30,000,
// with no GST, from the 22nd. Every name, number and code here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { confirmBooking, startBooking } from "../../../src/domain/booking/bookings.ts";
import { grantCredits } from "../../../src/domain/money/credits.ts";
import { removeFromHold } from "../../../src/domain/money/discount-code-holds.ts";
import { composeVisitMessage } from "../../../src/domain/messages/visit-message-text.ts";
import { listCodes } from "../../../src/domain/money/discount-codes.ts";
import { type PaymentsProvider } from "../../../src/providers/payments/index.ts";
import { createStubPayments } from "../../../src/providers/payments/stub.ts";
import { captureLogs, markDatabase, NOW } from "../helpers.ts";
import { technician } from "../clients.ts";
import { createLogger } from "../../../src/log.ts";
import { PERSON, at, make, cookies, fittedClient, call, heldService, enter } from "./discount-code-entries-fixtures.ts";

const OTHER = "55555555-5555-4555-8555-555555555555";

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  cookies.clear();
});

describe("the client, at the app's pay step", () => {
  beforeEach(async () => {
    await technician();
    // A second, so a client's visits booked back to back can alternate: no technician takes two in a row.
    await technician("t2", "Sandeep Rawat", "SR");
    await fittedClient(PERSON, "+919810000001");
  });

  it("is never taken on a visit a referral credit pays for", async () => {
    await grantCredits(env.DB, { personId: PERSON, visits: 1, source: "ops", sourceId: "o1", now: NOW }).run();
    await make();
    const hold = await heldService(PERSON);
    const answer = await enter(PERSON, hold.id, "TENPC");
    expect(answer.status).toBe(422);
  });

  // "Discount codes can be applied once credit paid visits are over".
  it("waits for the client's credits to be spent: a service visit a credit could pay takes no code", async () => {
    await make();
    const hold = await heldService(PERSON);
    // The hold was made before the credit was given, so no credit pays it; one still could.
    await grantCredits(env.DB, { personId: PERSON, visits: 1, source: "ops", sourceId: "o1", now: NOW }).run();
    const answer = await enter(PERSON, hold.id, "TENPC");
    expect(answer.status).toBe(422);
    expect(await answer.json()).toMatchObject({ error: { code: "code_not_applicable" } });
  });

  it("takes a code on the next service visit once the client's last credit is spent on another", async () => {
    await grantCredits(env.DB, { personId: PERSON, visits: 1, source: "ops", sourceId: "o1", now: NOW }).run();
    await make();
    const onCredit = await heldService(PERSON);
    const booked = await call(PERSON, "/api/bookings", { method: "POST", body: { hold_id: onCredit.id } });
    expect(await booked.json()).toEqual({ hold_id: onCredit.id, checkout: null });
    const next = await heldService(PERSON, NOW, "morning");
    const answer = await enter(PERSON, next.id, "TENPC");
    expect(answer.status).toBe(200);
  });

  it("takes a code on a hold whose credit another device's booking took, and books it in money for what is left", async () => {
    await grantCredits(env.DB, { personId: PERSON, visits: 1, source: "ops", sourceId: "o1", now: NOW }).run();
    await make();
    const onCredit = await heldService(PERSON);
    await call(PERSON, "/api/bookings", { method: "POST", body: { hold_id: onCredit.id } });
    const next = await heldService(PERSON, NOW, "morning");
    // The other device read the balance just before the first booking was confirmed.
    await env.DB.prepare("UPDATE slot_holds SET use_credit = 1 WHERE id = ?1").bind(next.id).run();

    expect((await enter(PERSON, next.id, "TENPC")).status).toBe(200);
    const booked = await call(PERSON, "/api/bookings", { method: "POST", body: { hold_id: next.id } });
    expect(await booked.json()).toMatchObject({ checkout: { amount: 180_000 } });
    const hold = await env.DB.prepare("SELECT use_credit FROM slot_holds WHERE id = ?1").bind(next.id).first();
    expect(hold).toEqual({ use_credit: 0 });
  });

  // "send whatsapp message even when the code makes the visit free".
  it("books a visit a code makes free without Checkout, and tells the client on WhatsApp as a paid one is told", async () => {
    await make({ code: "ALLFREE", kind: "amount", value: 200_000 });
    await env.DB.prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, source)
       VALUES ('consent-w', ?1, 'whatsapp_visits', 'whatsapp-visits-v1', 1, ?2, 'app_profile')`,
    )
      .bind(PERSON, NOW.toISOString())
      .run();
    const hold = await heldService(PERSON);
    expect(await (await enter(PERSON, hold.id, "ALLFREE")).json()).toMatchObject({ price: { amount: 0 } });
    const started = await call(PERSON, "/api/bookings", { method: "POST", body: { hold_id: hold.id } });
    expect(await started.json()).toMatchObject({ checkout: null });

    const told = await env.DB.prepare("SELECT kind, subject_id FROM outbound_messages").first<{
      kind: string;
      subject_id: string;
    }>();
    expect(told?.kind).toBe("payment_receipt");
    const composed = await composeVisitMessage(env.DB, "payment_receipt", told?.subject_id ?? "", PERSON);
    expect(composed).toMatchObject({ template: "visit_booked_code_v1" });
  });

  // Review of #177: an order made for a price a code changed meanwhile was kept.
  it("makes Checkout's order again when a code comes off as the order is made, so the order is the hold's price", async () => {
    await make();
    const hold = await heldService(PERSON);
    await enter(PERSON, hold.id, "TENPC");
    const stub = createStubPayments();
    let first = true;
    const racing: PaymentsProvider = {
      ...stub,
      createOrder: async (order) => {
        const made = await stub.createOrder(order);
        if (first) {
          first = false;
          await removeFromHold(env.DB, stub, { holdId: hold.id, personId: PERSON }, NOW);
        }
        return made;
      },
    };
    const started = await startBooking({ db: env.DB, payments: racing, now: NOW }, hold.id, PERSON);
    expect(stub.made.orders.map((order) => order.amount)).toEqual([180_000, 200_000]);
    const kept = await env.DB.prepare("SELECT amount, razorpay_order_id FROM slot_holds WHERE id = ?1")
      .bind(hold.id)
      .first<{ amount: number; razorpay_order_id: string }>();
    expect(kept?.amount).toBe(200_000);
    expect(started).toEqual({ kind: "pay", orderId: kept?.razorpay_order_id });
  });

  it("is once per client while their booking stands", async () => {
    await make();
    const first = await heldService(PERSON);
    await enter(PERSON, first.id, "TENPC");
    // Paid for: the hold keeps its time until it is booked, and its code stands with it.
    await env.DB.prepare("UPDATE slot_holds SET confirmed_at = ?2 WHERE id = ?1")
      .bind(first.id, NOW.toISOString())
      .run();
    const second = await heldService(PERSON, NOW, "morning");
    expect((await enter(PERSON, second.id, "TENPC")).status).toBe(422);
  });

  it("is the client's again once a hold they let go took it", async () => {
    await make();
    const first = await heldService(PERSON);
    await enter(PERSON, first.id, "TENPC");
    // A second hold lets the first go, with the code it carried.
    const second = await heldService(PERSON, NOW, "morning");
    expect((await enter(PERSON, second.id, "TENPC")).status).toBe(200);
  });

  it("counts a code's last use only while its hold keeps its time unpaid", async () => {
    await make({ code: "UNQ5", oncePerClient: false, maxUses: 1 });
    await fittedClient(OTHER, "+919810000005");
    const mine = await heldService(PERSON);
    expect((await enter(PERSON, mine.id, "UNQ5")).status).toBe(200);
    const theirs = await heldService(OTHER, NOW, "morning");
    expect((await enter(OTHER, theirs.id, "UNQ5")).status).toBe(422);
    // Twenty minutes on, the first hold has lapsed unpaid: the use no longer stands.
    const later = await heldService(OTHER, at(20), "evening");
    expect((await enter(OTHER, later.id, "UNQ5", at(20))).status).toBe(200);
  });

  // After paying, the app's entry did not say the code was taken.
  it("names the code on the payment Checkout took, in the list and in the entry", async () => {
    await make();
    const hold = await heldService(PERSON);
    await enter(PERSON, hold.id, "TENPC");
    const started = await call(PERSON, "/api/bookings", { method: "POST", body: { hold_id: hold.id } });
    const { checkout } = await started.json<{ checkout: { order_id: string; amount: number } }>();
    await env.DB.prepare(
      `INSERT INTO payments (id, person_id, razorpay_order_id, razorpay_payment_id, amount, currency, status,
         captured_at, created_at, updated_at)
       VALUES ('34000000-0000-4000-8000-000000000001', ?1, ?2, 'pay_1', ?3, 'INR', 'captured', ?4, ?4, ?4)`,
    )
      .bind(PERSON, checkout.order_id, checkout.amount, NOW.toISOString())
      .run();

    const code = { code: "TENPC", amount_off: 20_000 };
    const listed = await (await call(PERSON, "/api/payments")).json();
    expect(listed).toMatchObject({ entries: [{ discount_code: code }] });
    const entry = await (await call(PERSON, "/api/payments/34000000-0000-4000-8000-000000000001")).json();
    expect(entry).toMatchObject({ discount_code: code });
  });

  it("refunds a discounted payment what was paid, and no more", async () => {
    await make();
    const hold = await heldService(PERSON);
    await enter(PERSON, hold.id, "TENPC");
    const started = await call(PERSON, "/api/bookings", { method: "POST", body: { hold_id: hold.id } });
    const { checkout } = await started.json<{ checkout: { order_id: string; amount: number } }>();
    // Razorpay made the payment twenty minutes on, after the hold and its grace had run out.
    await env.DB.prepare(
      `INSERT INTO payments (id, person_id, razorpay_order_id, razorpay_payment_id, amount, currency, status,
         captured_at, created_at, updated_at)
       VALUES ('pay-1', ?1, ?2, 'pay_late', ?3, 'INR', 'captured', ?4, ?4, ?4)`,
    )
      .bind(PERSON, checkout.order_id, checkout.amount, at(20).toISOString())
      .run();
    await env.DB.prepare("UPDATE slot_holds SET confirmed_at = ?2 WHERE id = ?1")
      .bind(hold.id, at(20).toISOString())
      .run();
    const payments = createStubPayments();
    expect(await confirmBooking({ db: env.DB, payments: payments, now: at(20), log: createLogger() }, hold.id)).toBe(
      "refunded",
    );
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_late", amount: 180_000 }]);
  });

  // A code's use comes back: a prepaid booking cancelled
  // and refunded kept its code's use, which nothing could then take off.
  it("gives a code's use back when the visit it booked is cancelled, though it was paid for and refunded", async () => {
    await make({ code: "UNQ5", oncePerClient: false, maxUses: 1 });
    await fittedClient(OTHER, "+919810000005");
    const hold = await heldService(PERSON);
    await enter(PERSON, hold.id, "UNQ5");
    const started = await call(PERSON, "/api/bookings", { method: "POST", body: { hold_id: hold.id } });
    const { checkout } = await started.json<{ checkout: { order_id: string; amount: number } }>();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO payments (id, person_id, razorpay_order_id, razorpay_payment_id, amount, currency, status,
           captured_at, created_at, updated_at)
         VALUES ('pay-1', ?1, ?2, 'pay_1', ?3, 'INR', 'captured', ?4, ?4, ?4)`,
      ).bind(PERSON, checkout.order_id, checkout.amount, NOW.toISOString()),
      env.DB.prepare("UPDATE slot_holds SET confirmed_at = ?2 WHERE id = ?1").bind(hold.id, NOW.toISOString()),
    ]);
    expect(
      await confirmBooking({ db: env.DB, payments: createStubPayments(), now: NOW, log: createLogger() }, hold.id),
    ).toBe("booked");
    const theirs = await heldService(OTHER, NOW, "morning");
    expect((await enter(OTHER, theirs.id, "UNQ5")).status).toBe(422);

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE appointments SET status = 'cancelled'
         WHERE id = (SELECT appointment_id FROM slot_holds WHERE id = ?1)`,
      ).bind(hold.id),
      env.DB.prepare("UPDATE payments SET status = 'refunded', refunded_amount = amount WHERE id = 'pay-1'"),
    ]);
    expect((await enter(OTHER, theirs.id, "UNQ5")).status).toBe(200);
    const [code] = await listCodes(env.DB, NOW, "UNQ5");
    expect(code?.uses).toBe(1);
  });

  it("is tried ten times a day, right or wrong", async () => {
    await make();
    const hold = await heldService(PERSON);
    for (let tries = 0; tries < 10; tries += 1) expect((await enter(PERSON, hold.id, "NOSUCH")).status).toBe(422);
    expect((await enter(PERSON, hold.id, "TENPC")).status).toBe(429);
  });
});
