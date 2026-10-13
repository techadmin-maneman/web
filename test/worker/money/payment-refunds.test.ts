// A payment refunded by ops, with why (src/routes/ops/payment-refunds.ts): what is left of it, asked of Razorpay once
// and audited. Every name, number and amount is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createStubPayments, type StubPayments } from "../../../src/providers/payments/stub.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const PAYMENT = "55555555-5555-4555-8555-000000000001";

let payments: StubPayments;

const refund = (reason = "Paid twice for the same fit") =>
  request(appFor("local", fakeDependencies({ payments }), {}, "ops"), `/api/payments/${PAYMENT}/refund`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
    body: JSON.stringify({ reason }),
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

  it("takes a reason", async () => {
    expect((await refund("")).status).toBe(400);
  });
});
