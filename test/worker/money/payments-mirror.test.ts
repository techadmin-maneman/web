// The payments mirror's edges (src/domain/money/payments.ts): what Razorpay's
// webhook sends when a field is missing, and whom a payment is put against.
// test/worker/money/razorpay-hook.test.ts walks the webhook itself; these are the
// branches it leaves. NOW is Monday 21 September 2026, noon in India.

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { paymentStatusOf, recordPayment, recordRefund } from "../../../src/domain/money/payments.ts";
import type { RazorpayPayment } from "../../../src/providers/payments/razorpay.ts";
import { NOW } from "../helpers.ts";

const SALT = "test-salt-that-is-long-enough-000000";
const ROHIT = "11111111-1111-4111-8111-111111111111";

const payment = (overrides: Partial<RazorpayPayment> = {}): RazorpayPayment => ({
  id: "pay_1",
  amount: 200000,
  currency: "INR",
  status: "authorized",
  created_at: Math.floor(NOW.getTime() / 1000),
  ...overrides,
});

async function rohit(): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit')",
  )
    .bind(ROHIT, NOW.toISOString())
    .run();
}

const recorded = () =>
  env.DB.prepare(
    "SELECT person_id, razorpay_order_id, method, status, refunded_amount FROM payments WHERE razorpay_payment_id = 'pay_1'",
  ).first();

describe("a payment's state", () => {
  it("is the event's where the event names one, and the payment's own for any other event", () => {
    expect(paymentStatusOf("order.paid", payment())).toBe("captured");
    expect(paymentStatusOf("payment.authorized", payment({ status: "captured" }))).toBe("authorized");
    expect(paymentStatusOf("payment.dispute.created", payment({ status: "captured" }))).toBe("captured");
    expect(paymentStatusOf("payment.dispute.created", payment({ status: "failed" }))).toBe("failed");
    expect(paymentStatusOf("payment.dispute.created", payment({ status: "created" }))).toBeNull();
  });
});

describe("whom a payment is put against", () => {
  it("is nobody for a payment with no notes, no order, no method and no contact, and it is still kept", async () => {
    await recordPayment(env.DB, payment(), "authorized", SALT, NOW);
    expect(await recorded()).toEqual({
      person_id: null,
      razorpay_order_id: null,
      method: null,
      status: "authorized",
      refunded_amount: 0,
    });
  });

  it("is found by the mobile paid with when the noted person is not ours, and by nobody for a contact that is no mobile", async () => {
    await rohit();
    await recordPayment(
      env.DB,
      payment({ notes: { person_id: "someone-else" }, contact: "+919810000001" }),
      "authorized",
      SALT,
      NOW,
    );
    expect((await recorded())?.person_id).toBe(ROHIT);

    await recordPayment(env.DB, payment({ id: "pay_2", contact: "rohit@example.com" }), "authorized", SALT, NOW);
    const second = await env.DB.prepare("SELECT person_id FROM payments WHERE razorpay_payment_id = 'pay_2'").first();
    expect(second).toEqual({ person_id: null });
  });
});

describe("a refund", () => {
  it("of a payment not yet heard of is left for Razorpay to send again", async () => {
    const refund = { id: "rfnd_1", payment_id: "pay_unknown", amount: 1, status: "processed", created_at: 1 };
    expect(await recordRefund(env.DB, refund, NOW)).toBe(false);
  });

  it("that failed is kept as failed, with the speed asked for where none was processed, and refunds nothing", async () => {
    await recordPayment(env.DB, payment(), "captured", SALT, NOW);
    const refund = {
      id: "rfnd_1",
      payment_id: "pay_1",
      amount: 100000,
      status: "failed",
      speed_requested: "optimum",
      created_at: 1,
    };

    expect(await recordRefund(env.DB, refund, NOW)).toBe(true);

    const kept = await env.DB.prepare(
      "SELECT status, speed, processed_at FROM refunds WHERE razorpay_refund_id = 'rfnd_1'",
    ).first();
    expect(kept).toEqual({ status: "failed", speed: "optimum", processed_at: null });
    expect(await recorded()).toMatchObject({ status: "captured", refunded_amount: 0 });
  });
});
