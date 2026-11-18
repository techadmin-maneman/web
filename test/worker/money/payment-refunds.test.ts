// A payment refunded by ops, with why (src/routes/ops/payment-refunds.ts): what is left of it, asked of Razorpay once
// and audited. Every name, number and amount is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createStubPayments, type StubPayments } from "../../../src/providers/payments/stub.ts";
import { aVisit } from "../fixtures/index.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const PAYMENT = "55555555-5555-4555-8555-000000000001";

let payments: StubPayments;

/** The key a console drawer makes once, when it opens, for the part refunds asked from it. */
const DRAWER = "77777777-7777-4777-8777-000000000001";

const refund = (reason = "Paid twice for the same fit", part?: { amount: number; key?: string }) =>
  request(appFor("local", fakeDependencies({ payments }), {}, "ops"), `/api/payments/${PAYMENT}/refund`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
    body: JSON.stringify(part === undefined ? { reason } : { reason, ...part }),
  });

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  payments = createStubPayments();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Bharat Singh')",
    ).bind(PERSON, NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO payments (id, person_id, razorpay_payment_id, amount, currency, status, refunded_amount,
         captured_at, created_at, updated_at)
       VALUES (?1, ?2, 'pay_twice', 3_200_000, 'INR', 'partially_refunded', 200_000, ?3, ?3, ?3)`,
    ).bind(PAYMENT, PERSON, NOW.toISOString()),
  ]);
});

describe("POST /api/payments/{id}/refund", () => {
  it("asks back what is left of the payment, once, and audits why", async () => {
    const answer = await refund();
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ amount: 3_000_000 });
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_twice", amount: 3_000_000 }]);

    const audit = await env.DB.prepare(
      "SELECT subject_id, detail FROM audit_log WHERE action = 'payment.refund'",
    ).first<{
      subject_id: string;
      detail: string;
    }>();
    expect(audit?.subject_id).toBe(PERSON);
    expect(JSON.parse(audit?.detail ?? "{}")).toEqual({
      payment: PAYMENT,
      amount: 3_000_000,
      reason: "Paid twice for the same fit",
    });
  });

  it("says a second press before Razorpay's webhook is refunded already, and audits the refund once", async () => {
    expect((await refund()).status).toBe(200);
    // Razorpay answers the payment's receipt with the refund it made: nothing more goes back.
    const again = await refund();
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "refund_not_due" } });
    expect(payments.made.refunds).toHaveLength(1);
    const audited = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'payment.refund'").first<{
      n: number;
    }>();
    expect(audited?.n).toBe(1);
  });

  it("refuses a payment whose refund is on its way, and one we do not have", async () => {
    await env.DB.prepare(
      `INSERT INTO refunds (id, payment_id, razorpay_refund_id, amount, status, created_at, updated_at)
       VALUES ('r1', ?1, 'rfnd_1', 3_000_000, 'created', ?2, ?2)`,
    )
      .bind(PAYMENT, NOW.toISOString())
      .run();
    const owed = await refund();
    expect(owed.status).toBe(409);
    expect(await owed.json()).toMatchObject({ error: { code: "refund_not_due" } });

    await env.DB.prepare("DELETE FROM refunds").run();
    await env.DB.prepare("DELETE FROM payments").run();
    expect((await refund()).status).toBe(404);
    expect(payments.made.refunds).toEqual([]);
  });

  // A refund asked is on its way from the moment Razorpay takes it, not only once its webhook lands.
  it("records the refund it asked as on its way at once", async () => {
    expect((await refund()).status).toBe(200);
    const asked = await env.DB.prepare("SELECT payment_id, amount, status FROM refunds").all();
    expect(asked.results).toEqual([{ payment_id: PAYMENT, amount: 3_000_000, status: "created" }]);
  });

  // A late cancel keeps its late fee and owes the client the rest: until that refund is asked of Razorpay, only the fee
  // is left to give back here.
  it("leaves only what a cancel kept while the cancel's own refund is still owed", async () => {
    await aVisit({ id: "visit-1", person_id: PERSON, type: "first_fit", status: "cancelled" });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO visit_changes (id, appointment_id, person_id, kind, notice, was_start, refund_amount, kept_amount,
           payment_id, created_at)
         VALUES ('change-1', 'visit-1', ?1, 'cancelled', 'late', ?2, 2_600_000, 400_000, ?3, ?2)`,
      ).bind(PERSON, NOW.toISOString(), PAYMENT),
    ]);
    const answer = await refund();
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ amount: 400_000 });
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_twice", amount: 400_000 }]);
  });

  // A no-show ruling owes the client part of the visit's payment back: until that refund is asked of Razorpay, it is
  // not what is left here either.
  it("leaves out a no-show ruling's refund still owed", async () => {
    await aVisit({ id: "visit-2", person_id: PERSON, status: "terminated" });
    await env.DB.batch([
      env.DB.prepare("UPDATE payments SET appointment_id = 'visit-2' WHERE id = ?1").bind(PAYMENT),
      env.DB.prepare(
        `INSERT INTO no_show_refunds (id, appointment_id, why, amount, created_at)
         VALUES ('nsr-1', 'visit-2', 'waived', 2_900_000, ?1)`,
      ).bind(NOW.toISOString()),
    ]);
    const answer = await refund();
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ amount: 100_000 });
  });

  // The ruling's refund comes from the visit's own payment, so a late fee paid for the same visit is all still left.
  it("leaves a late fee of the visit whole while its no-show ruling's refund is owed", async () => {
    await aVisit({ id: "visit-3", person_id: PERSON, status: "terminated" });
    await env.DB.batch([
      env.DB.prepare("UPDATE payments SET appointment_id = 'visit-3', kind = 'late_fee' WHERE id = ?1").bind(PAYMENT),
      env.DB.prepare(
        `INSERT INTO no_show_refunds (id, appointment_id, why, amount, created_at)
         VALUES ('nsr-2', 'visit-3', 'waived', 2_900_000, ?1)`,
      ).bind(NOW.toISOString()),
    ]);
    const answer = await refund();
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ amount: 3_000_000 });
  });

  // A goodwill or part refund: Finance give back an amount up to what is left, and the rest stays refundable.
  it("refunds part of a payment, then the rest, each under a receipt of its own", async () => {
    const part = await refund("Visit cut short", { amount: 500_000, key: DRAWER });
    expect(part.status).toBe(200);
    expect(await part.json()).toEqual({ amount: 500_000 });
    const rest = await refund("The rest, as agreed");
    expect(rest.status).toBe(200);
    expect(await rest.json()).toEqual({ amount: 2_500_000 });
    expect(payments.made.refunds).toEqual([
      { paymentId: "pay_twice", amount: 500_000 },
      { paymentId: "pay_twice", amount: 2_500_000 },
    ]);
  });

  // The answer to a part refund was lost and Finance press again from the same drawer: its key keeps the receipt, so
  // Razorpay makes it once.
  it("makes a part refund pressed again from the same drawer once", async () => {
    expect((await refund("Visit cut short", { amount: 500_000, key: DRAWER })).status).toBe(200);
    const again = await refund("Visit cut short", { amount: 500_000, key: DRAWER });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "refund_not_due" } });
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_twice", amount: 500_000 }]);
  });

  it("refuses an amount above what is left, one of nothing, and a part with no drawer's key", async () => {
    const tooMuch = await refund("Goodwill", { amount: 3_000_001, key: DRAWER });
    expect(tooMuch.status).toBe(400);
    expect(await tooMuch.json()).toMatchObject({ error: { code: "invalid_request", fields: ["amount"] } });
    expect((await refund("Goodwill", { amount: 0, key: DRAWER })).status).toBe(400);
    const keyless = await refund("Goodwill", { amount: 500_000 });
    expect(keyless.status).toBe(400);
    expect(await keyless.json()).toMatchObject({ error: { code: "invalid_request", fields: ["key"] } });
    expect(payments.made.refunds).toEqual([]);
  });

  it("takes a reason", async () => {
    expect((await refund("")).status).toBe(400);
  });
});
