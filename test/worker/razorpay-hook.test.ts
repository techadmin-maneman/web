import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { outstandingTasks } from "../../src/domain/tasks.ts";
import { TASK_SLA_HOURS } from "../../src/policy/tasks.ts";
import { saltedHash } from "../../src/lib/hash.ts";
import { LOCAL_SETTINGS, NOW, captureLogs, deliverRazorpay, markDatabase } from "./helpers.ts";

function paymentEvent(event: string, overrides: Record<string, unknown> = {}) {
  return {
    entity: "event",
    event,
    contains: ["payment"],
    payload: {
      payment: {
        entity: {
          id: "pay_1",
          entity: "payment",
          amount: 3540000,
          currency: "INR",
          status: event === "payment.failed" ? "failed" : event === "payment.authorized" ? "authorized" : "captured",
          order_id: "order_1",
          method: "upi",
          vpa: "Rohit.M@okaxis",
          contact: "+919810000001",
          notes: [],
          created_at: 1790067435,
          ...overrides,
        },
      },
    },
    created_at: 1790067436,
  };
}

function refundEvent(event: string, amount: number, id = "rfnd_1", payment?: Record<string, unknown>) {
  return {
    entity: "event",
    event,
    contains: payment === undefined ? ["refund"] : ["refund", "payment"],
    payload: {
      ...(payment === undefined ? {} : { payment: { entity: payment } }),
      refund: {
        entity: {
          id,
          entity: "refund",
          amount,
          payment_id: "pay_1",
          status: event === "refund.processed" ? "processed" : event === "refund.failed" ? "failed" : "pending",
          speed_processed: "normal",
          created_at: 1790067500,
        },
      },
    },
  };
}

const deliver = (
  event: object | string,
  eventId: string | null,
  options: { secret?: string | null; settings?: object } = {},
) => deliverRazorpay(event, { eventId, ...options });

const payment = () => env.DB.prepare("SELECT * FROM payments WHERE razorpay_payment_id = 'pay_1'").first();

async function person(mobile: string) {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, 'Rohit Malhotra')")
    .bind(id, NOW.toISOString(), mobile)
    .run();
  return id;
}

beforeEach(async () => {
  await markDatabase();
});

describe("Razorpay's webhook: trust", () => {
  it("does not exist without a webhook secret", async () => {
    const response = await deliver(paymentEvent("payment.captured"), "evt_1", { settings: { razorpay: null } });
    expect(response.status).toBe(404);
  });

  it("refuses an event signed with another secret, and records nothing", async () => {
    const response = await deliver(paymentEvent("payment.captured"), "evt_1", { secret: "someone-else" });
    expect(response.status).toBe(401);
    expect(await payment()).toBeNull();
  });

  it("refuses an event that carries no signature, and records nothing", async () => {
    const response = await deliver(paymentEvent("payment.captured"), "evt_1", { secret: null });
    expect(response.status).toBe(401);
    expect(await payment()).toBeNull();
  });
});

describe("Razorpay's webhook: what it cannot use", () => {
  const seenEvents = () => env.DB.prepare("SELECT COUNT(*) AS n FROM razorpay_events").first<{ n: number }>();

  it("takes a signed body that is not JSON, and does nothing with it", async () => {
    expect((await deliver("not json", "evt_1")).status).toBe(200);
    expect(await seenEvents()).toEqual({ n: 0 });
  });

  it("keeps an event it does not act on as seen, and does nothing else", async () => {
    const event = { entity: "event", event: "subscription.charged", payload: {} };

    expect((await deliver(event, "evt_1")).status).toBe(200);
    expect(await seenEvents()).toEqual({ n: 1 });
    expect(await payment()).toBeNull();
  });

  // Razorpay always names its event; a delivery that does not is known by its body, so a resend is still applied once.
  it("knows a delivery with no event ID by its body, and applies the same body once", async () => {
    await person("+919810000001");

    expect((await deliver(paymentEvent("payment.captured"), null)).status).toBe(200);
    expect((await deliver(paymentEvent("payment.captured"), null)).status).toBe(200);
    expect(await seenEvents()).toEqual({ n: 1 });
    expect(await payment()).toMatchObject({ reference: "MM-2026-0001" });
  });
});

describe("Razorpay's webhook: payments", () => {
  it("records a captured payment with its reference, linked to the person who paid, with the UPI handle hashed", async () => {
    const payer = await person("+919810000001");
    expect((await deliver(paymentEvent("payment.captured"), "evt_1")).status).toBe(200);
    const row = await payment();
    expect(row).toMatchObject({
      person_id: payer,
      razorpay_order_id: "order_1",
      amount: 3540000,
      currency: "INR",
      method: "upi",
      status: "captured",
      reference: "MM-2026-0001",
      refunded_amount: 0,
    });
    expect(row?.vpa_hash).toBe(await saltedHash(LOCAL_SETTINGS.ipHashSalt, "rohit.m@okaxis"));
    expect(JSON.stringify(row)).not.toContain("okaxis");
  });

  it("numbers each captured payment of the year in turn", async () => {
    await deliver(paymentEvent("payment.captured"), "evt_1");
    await deliver(paymentEvent("payment.captured", { id: "pay_2" }), "evt_2");
    const second = await env.DB.prepare("SELECT reference FROM payments WHERE razorpay_payment_id = 'pay_2'").first();
    expect(second).toEqual({ reference: "MM-2026-0002" });
  });

  it("never moves a payment back: an authorization arriving after the capture changes nothing", async () => {
    await deliver(paymentEvent("payment.captured"), "evt_1");
    await deliver(paymentEvent("payment.authorized"), "evt_2");
    expect((await payment())?.status).toBe("captured");
  });

  it("lets a late authorization overtake a failure", async () => {
    await deliver(paymentEvent("payment.failed"), "evt_1");
    await deliver(paymentEvent("payment.authorized"), "evt_2");
    expect((await payment())?.status).toBe("authorized");
  });

  it("applies an event once, however often it is delivered", async () => {
    await deliver(paymentEvent("payment.captured"), "evt_1");
    await deliver(paymentEvent("payment.captured", { id: "pay_2" }), "evt_1");
    const { results } = await env.DB.prepare("SELECT razorpay_payment_id FROM payments").all();
    expect(results).toEqual([{ razorpay_payment_id: "pay_1" }]);
  });

  it("links no one when the number paid with is no one's", async () => {
    await deliver(paymentEvent("payment.captured"), "evt_1");
    expect((await payment())?.person_id).toBeNull();
  });
});

describe("Razorpay's webhook: refunds", () => {
  it("marks a payment partly, then fully, refunded as its refunds are processed", async () => {
    await deliver(paymentEvent("payment.captured"), "evt_1");
    await deliver(refundEvent("refund.created", 1000000), "evt_2");
    expect((await payment())?.status).toBe("captured");

    await deliver(refundEvent("refund.processed", 1000000), "evt_3");
    expect(await payment()).toMatchObject({ status: "partially_refunded", refunded_amount: 1000000 });

    await deliver(refundEvent("refund.processed", 2540000, "rfnd_2"), "evt_4");
    expect(await payment()).toMatchObject({ status: "refunded", refunded_amount: 3540000 });
    const refunds = await env.DB.prepare("SELECT status, speed FROM refunds ORDER BY amount").all();
    expect(refunds.results).toEqual([
      { status: "processed", speed: "normal" },
      { status: "processed", speed: "normal" },
    ]);
  });

  it("asks Razorpay to send again a refund of a payment not yet arrived that the event does not carry", async () => {
    const early = await deliver(refundEvent("refund.processed", 1000000), "evt_1");
    expect(early.status).toBe(409);
    await deliver(paymentEvent("payment.captured"), "evt_2");
    expect((await deliver(refundEvent("refund.processed", 1000000), "evt_1")).status).toBe(200);
    expect((await payment())?.status).toBe("partially_refunded");
  });

  it("takes nothing from a payment that is not Razorpay's shape, and leaves it for Razorpay to send again", async () => {
    captureLogs();
    const response = await deliver(paymentEvent("payment.captured", { amount: undefined }), "evt_1");

    expect(response.status).toBe(500);
    expect(await payment()).toBeNull();
    const seen = await env.DB.prepare("SELECT COUNT(*) AS n FROM razorpay_events").first<{ n: number }>();
    expect(seen?.n).toBe(0);
  });
});

// MON-12: each such refund was answered 409 for a day, and on a quiet day Razorpay could disable the whole webhook.
describe("Razorpay's webhook: a refund of a payment whose own events never reached us", () => {
  /** The payment as a refund's event carries it. */
  const refundedPayment = (overrides: Record<string, unknown> = {}) =>
    paymentEvent("payment.captured", { status: "refunded", captured: true, ...overrides }).payload.payment.entity;
  const seenEvents = () => env.DB.prepare("SELECT COUNT(*) AS n FROM razorpay_events").first<{ n: number }>();
  const alertsKept = async () => (await env.DB.prepare("SELECT key, link, count FROM alerts").all()).results;

  it("records the payment from the refund's event, then the refund, and tells ops once", async () => {
    const payer = await person("+919810000001");
    const created = await deliver(refundEvent("refund.created", 3540000, "rfnd_1", refundedPayment()), "evt_1");
    expect(created.status).toBe(200);
    expect(await payment()).toMatchObject({ person_id: payer, status: "captured", reference: "MM-2026-0001" });

    const processed = await deliver(refundEvent("refund.processed", 3540000, "rfnd_1", refundedPayment()), "evt_2");
    expect(processed.status).toBe(200);
    expect(await payment()).toMatchObject({ status: "refunded", refunded_amount: 3540000 });
    expect((await seenEvents())?.n).toBe(2);
    expect(await alertsKept()).toEqual([
      { key: "razorpay_refund_unheard:pay_1", link: `/clients/${payer}/payments`, count: 1 },
    ]);
  });

  it("gives no reference to a refunded payment that was never captured", async () => {
    const refund = refundEvent("refund.processed", 3540000, "rfnd_1", refundedPayment({ captured: false }));
    expect((await deliver(refund, "evt_1")).status).toBe(200);
    expect(await payment()).toMatchObject({ status: "refunded", reference: null, captured_at: null });
  });

  it("takes nothing when the payment the event carries is another, and leaves it for Razorpay to send again", async () => {
    const refund = refundEvent("refund.processed", 3540000, "rfnd_1", refundedPayment({ id: "pay_other" }));
    expect((await deliver(refund, "evt_1")).status).toBe(409);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM payments").first()).toEqual({ n: 0 });
    expect((await seenEvents())?.n).toBe(0);
    expect(await alertsKept()).toEqual([]);
  });
});

// MON-13, MON-47: a refund Razorpay failed was kept silently, and a late event moved it back to "created"; a second
// payment on one order was neither refunded nor told.
describe("Razorpay's webhook: a refund that fails, and an order paid twice", () => {
  const alertsKept = async () => (await env.DB.prepare("SELECT key, link FROM alerts ORDER BY key").all()).results;
  const refundStatus = (id: string) =>
    env.DB.prepare("SELECT status FROM refunds WHERE razorpay_refund_id = ?1").bind(id).first<string>("status");
  const toRefund = async () =>
    (await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS)).tasks
      .filter((task) => task.group === "payment_to_refund")
      .map((task) => task.detail);

  it("keeps a failed refund failed whatever comes after, tells ops once, and lists the payment until a refund is made", async () => {
    const payer = await person("+919810000001");
    await deliver(paymentEvent("payment.captured"), "evt_1");
    await deliver(refundEvent("refund.created", 3540000), "evt_2");
    await deliver(refundEvent("refund.failed", 3540000), "evt_3");
    await deliver(refundEvent("refund.created", 3540000), "evt_4");

    expect(await refundStatus("rfnd_1")).toBe("failed");
    expect(await alertsKept()).toEqual([{ key: "refund_failed:rfnd_1", link: `/clients/${payer}/payments` }]);
    expect(await toRefund()).toEqual(["refund_failed 3540000 pay_1"]);

    await deliver(refundEvent("refund.processed", 3540000, "rfnd_2"), "evt_5");
    expect(await payment()).toMatchObject({ status: "refunded", refunded_amount: 3540000 });
    expect(await toRefund()).toEqual([]);
  });

  it("keeps a processed refund processed when a failure for it arrives late", async () => {
    await deliver(paymentEvent("payment.captured"), "evt_1");
    await deliver(refundEvent("refund.processed", 3540000), "evt_2");
    await deliver(refundEvent("refund.failed", 3540000), "evt_3");

    expect(await refundStatus("rfnd_1")).toBe("processed");
    expect(await alertsKept()).toEqual([]);
  });

  it("tells ops once of a second payment captured on the same order", async () => {
    const payer = await person("+919810000001");
    await deliver(paymentEvent("payment.captured"), "evt_1");
    await deliver(paymentEvent("payment.captured", { id: "pay_2" }), "evt_2");
    await deliver(paymentEvent("order.paid", { id: "pay_2" }), "evt_3");

    expect(await alertsKept()).toEqual([{ key: "second_capture:pay_2", link: `/clients/${payer}/payments` }]);
  });
});
