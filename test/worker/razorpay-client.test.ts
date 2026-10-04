// The Razorpay client (src/providers/razorpay.ts) against Razorpay's own
// replies, in the shapes its API documents: an order, a refund, and a refusal.
// Nothing called the real client before (TCD-03); the stub stood in everywhere.

import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/log.ts";
import { createPaymentsProvider, createStubPayments, PaymentUnanswered } from "../../src/providers/payments.ts";
import { RazorpayError } from "../../src/providers/razorpay.ts";
import { fakeFetch, json } from "./helpers.ts";

const API = "https://api.razorpay.com/v1";
const SETTINGS = { keyId: "rzp_test_abc", keySecret: "key-secret", webhookSecret: null };

function razorpay(routes: Parameters<typeof fakeFetch>[0]) {
  const http = fakeFetch(routes);
  return {
    payments: createPaymentsProvider("razorpay", SETTINGS, { fetch: http.fetch, log: createLogger() }),
    calls: http.calls,
  };
}

describe("Razorpay: orders and refunds", () => {
  it("makes an order in rupees' paise, as INR, under the key's basic auth, and answers its ID", async () => {
    const { payments, calls } = razorpay({
      [`${API}/orders`]: () =>
        json({ id: "order_9", entity: "order", amount: 200000, currency: "INR", status: "created" }),
    });

    const order = await payments.createOrder({ amount: 200000, receipt: "hold-1", notes: { hold_id: "hold-1" } });

    expect(order).toEqual({ id: "order_9" });
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers.get("Authorization")).toBe(`Basic ${btoa("rzp_test_abc:key-secret")}`);
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
      amount: 200000,
      receipt: "hold-1",
      notes: { hold_id: "hold-1" },
      currency: "INR",
    });
  });

  it("refunds a payment at normal speed, by its ID in the path, under our receipt, and answers the refund's ID", async () => {
    const { payments, calls } = razorpay({
      [`${API}/payments/pay_1/refund`]: () => json({ id: "rfnd_9", entity: "refund", amount: 100000 }),
    });

    expect(await payments.refund("pay_1", { amount: 100000, notes: { reason: "cancelled" }, receipt: "c-1" })).toEqual({
      id: "rfnd_9",
    });
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
      amount: 100000,
      notes: { reason: "cancelled" },
      receipt: "c-1",
      speed: "normal",
    });
  });

  // Razorpay's idempotency for refunds (https://razorpay.com/docs/api/refunds/create-normal/, "Duplicate Receipt").
  it("answers no refund ID, and no refusal, where the receipt's refund was made before", async () => {
    const { payments } = razorpay({
      [`${API}/payments/pay_1/refund`]: () =>
        json(
          { error: { code: "BAD_REQUEST_ERROR", description: "Duplicate receipt found for this refund request." } },
          400,
        ),
    });
    expect(await payments.refund("pay_1", { amount: 100000, notes: {}, receipt: "c-1" })).toEqual({ id: null });
  });

  it.each([
    ["a timeout", () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError"))],
    ["a failure of Razorpay's own", () => json({ error: { code: "SERVER_ERROR", description: "down" } }, 500)],
    ["a success it cannot read", () => json({ entity: "refund" })],
  ])("cannot say whether a refund was made after %s", async (_case, reply) => {
    const { payments } = razorpay({ [`${API}/payments/pay_1/refund`]: reply });
    await expect(payments.refund("pay_1", { amount: 1, notes: {}, receipt: "c-1" })).rejects.toBeInstanceOf(
      PaymentUnanswered,
    );
  });

  it("names Razorpay's own code and description when it refuses", async () => {
    const { payments } = razorpay({
      [`${API}/payments/pay_1/refund`]: () =>
        json({ error: { code: "BAD_REQUEST_ERROR", description: "The refund amount exceeds the payment" } }, 400),
    });

    const refused = payments.refund("pay_1", { amount: 999999, notes: {}, receipt: "c-1" });

    await expect(refused).rejects.toBeInstanceOf(RazorpayError);
    await expect(refused).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST_ERROR" });
    await expect(refused).rejects.toThrow("Razorpay 400 BAD_REQUEST_ERROR: The refund amount exceeds the payment");
  });

  it.each([
    ["no body it can read", () => new Response("Bad Gateway", { status: 502 })],
    ["an error with neither code nor description", () => json({ error: {} }, 502)],
    ["an error that is not an object", () => json({ error: "down" }, 502)],
  ])("says so when a failure comes with %s", async (_case, reply) => {
    const { payments } = razorpay({ [`${API}/orders`]: reply });
    await expect(payments.createOrder({ amount: 1, receipt: "r", notes: {} })).rejects.toThrow(
      "Razorpay 502 UNKNOWN: no description",
    );
  });

  it("fails loudly on a success it cannot read, rather than recording an order with no ID", async () => {
    const { payments } = razorpay({ [`${API}/orders`]: () => json({ entity: "order" }) });
    await expect(payments.createOrder({ amount: 1, receipt: "r", notes: {} })).rejects.toThrow();
  });

  it("answers each payment on an order, as the mirror reads it, by a GET that sends no body", async () => {
    const made = { entity: "payment", amount: 200000, currency: "INR", order_id: "order_9", created_at: 1790058600 };
    const { payments, calls } = razorpay({
      [`${API}/orders/order_9/payments`]: () =>
        json({
          entity: "collection",
          count: 2,
          items: [
            { ...made, id: "pay_1", status: "failed", captured: false },
            { ...made, id: "pay_2", status: "captured", captured: true, method: "upi", notes: { hold_id: "hold-1" } },
          ],
        }),
    });

    const [failed, captured] = await payments.orderPayments("order_9");
    expect(failed).toMatchObject({ id: "pay_1", status: "failed" });
    expect(captured).toMatchObject({
      id: "pay_2",
      status: "captured",
      amount: 200000,
      order_id: "order_9",
      notes: { hold_id: "hold-1" },
      created_at: 1790058600,
    });
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.body).toBe("");
  });

  it("fails loudly on a list of an order's payments it cannot read, rather than say none was made", async () => {
    const { payments } = razorpay({ [`${API}/orders/order_9/payments`]: () => json({ entity: "collection" }) });
    await expect(payments.orderPayments("order_9")).rejects.toThrow();
  });
});

// A consultation and fit in one visit is paid by a link, which Razorpay texts to the client itself
// (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
describe("Razorpay: payment links", () => {
  const LINK = {
    amount: 4500000,
    reference: "MM-2026-0841",
    description: "Mane Man Natural hair system · fitted Mon 21 Sep",
    customer: { name: "Rohit Malhotra", contact: "+919810000001" },
    notes: { appointment_id: "visit-1", person_id: "person-1" },
    closesAt: new Date("2026-10-06T08:00:00.000Z"),
    notify: true,
  };

  /** What the link was made with. */
  async function linkMade(link = LINK): Promise<Record<string, unknown>> {
    const { payments, calls } = razorpay({
      [`${API}/payment_links`]: () =>
        json({ id: "plink_9", short_url: "https://rzp.io/i/abc", status: "created", reference_id: "MM-2026-0841" }),
    });
    expect(await payments.createPaymentLink(link)).toEqual({ id: "plink_9", shortUrl: "https://rzp.io/i/abc" });
    expect(calls[0]?.headers.get("Authorization")).toBe(`Basic ${btoa("rzp_test_abc:key-secret")}`);
    return JSON.parse(calls[0]?.body ?? "") as Record<string, unknown>;
  }

  it("makes a link for the whole amount, under our reference, which Razorpay texts the client and reminds them of", async () => {
    const made = await linkMade();
    expect(made).toMatchObject({
      amount: 4500000,
      currency: "INR",
      accept_partial: false,
      reference_id: "MM-2026-0841",
      description: "Mane Man Natural hair system · fitted Mon 21 Sep",
      customer: { name: "Rohit Malhotra", contact: "+919810000001" },
      notify: { sms: true, email: false },
      reminder_enable: true,
      notes: { appointment_id: "visit-1", person_id: "person-1" },
    });
  });

  // MON-30: the page read "Payment Request from" the account holder's own name, and "RECEIPT" over our reference.
  it("has Razorpay's page name us and label our reference as one", async () => {
    expect((await linkMade()).options).toEqual({
      checkout: { name: "Mane Man" },
      hosted_page: { label: { receipt: "REFERENCE" } },
    });
  });

  // MON-45, PS-47: no link ever closed.
  it("closes every link at the moment asked, in Unix seconds", async () => {
    const made = await linkMade({ ...LINK, closesAt: new Date("2026-09-22T06:30:00.000Z") });
    expect(made).toMatchObject({ expire_by: 1790058600 });
  });

  // MON-45, PS-46: every link was texted, and reminded of, whoever the number belonged to.
  it("texts neither the link nor reminders of it where asked not to", async () => {
    const made = await linkMade({ ...LINK, notify: false });
    expect(made).toMatchObject({ notify: { sms: false, email: false }, reminder_enable: false });
  });

  it("names Razorpay's refusal as a refusal, so ops are told rather than the close sent again", async () => {
    const { payments } = razorpay({
      [`${API}/payment_links`]: () =>
        json({ error: { code: "BAD_REQUEST_ERROR", description: "reference_id already exists" } }, 400),
    });
    const refused = payments.createPaymentLink(LINK);
    await expect(refused).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST_ERROR", refusal: true });
  });

  it("finds the link made under a reference, by a GET that sends no body, and answers none where there is none", async () => {
    const { payments, calls } = razorpay({
      [`${API}/payment_links?reference_id=visit-1`]: () =>
        json({ payment_links: [{ id: "plink_9", short_url: "https://rzp.io/i/abc", reference_id: "visit-1" }] }),
      [`${API}/payment_links?reference_id=visit-2`]: () => json({ payment_links: [] }),
    });

    expect(await payments.findPaymentLink("visit-1")).toEqual({ id: "plink_9", shortUrl: "https://rzp.io/i/abc" });
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.body).toBe("");
    expect(await payments.findPaymentLink("visit-2")).toBeNull();
  });

  it("fails loudly on a link it cannot read, rather than keeping one with no address", async () => {
    const { payments } = razorpay({ [`${API}/payment_links`]: () => json({ id: "plink_9" }) });
    await expect(payments.createPaymentLink(LINK)).rejects.toThrow();
  });

  it("reads a link by its ID, by a GET: how it stands, our reference, and the order its payment was made on", async () => {
    const { payments, calls } = razorpay({
      [`${API}/payment_links/plink_9`]: () =>
        json({
          id: "plink_9",
          status: "paid",
          reference_id: "MM-2026-0841",
          order_id: "order_7",
          amount_paid: 4500000,
          payments: [{ payment_id: "pay_7", status: "captured" }],
        }),
    });

    expect(await payments.paymentLink("plink_9")).toEqual({
      id: "plink_9",
      status: "paid",
      reference_id: "MM-2026-0841",
      order_id: "order_7",
    });
    expect(calls[0]?.method).toBe("GET");
  });

  it("cancels a link by its ID in the path, and names Razorpay's refusal of one already paid", async () => {
    const { payments, calls } = razorpay({
      [`${API}/payment_links/plink_9/cancel`]: () => json({ id: "plink_9", status: "cancelled" }),
      [`${API}/payment_links/plink_paid/cancel`]: () =>
        json({ error: { code: "BAD_REQUEST_ERROR", description: "Payment link cannot be cancelled" } }, 400),
    });

    await payments.cancelPaymentLink("plink_9");
    expect(calls[0]?.method).toBe("POST");
    await expect(payments.cancelPaymentLink("plink_paid")).rejects.toMatchObject({ status: 400, refusal: true });
  });
});

describe("payments where none is connected", () => {
  it("refuses to make an order or a refund, saying why, and reaches nothing", async () => {
    const { calls } = razorpay({});
    const none = createPaymentsProvider("none", null, { fetch: fakeFetch({}).fetch, log: createLogger() });

    await expect(none.createOrder({ amount: 1, receipt: "r", notes: {} })).rejects.toThrow(/PAYMENTS_PROVIDER is none/);
    await expect(none.refund("pay_1", { amount: 1, notes: {}, receipt: "c-1" })).rejects.toThrow(
      /PAYMENTS_PROVIDER is none/,
    );
    await expect(
      none.createPaymentLink({
        amount: 1,
        reference: "r",
        description: "d",
        customer: { name: "", contact: "" },
        notes: {},
        closesAt: new Date("2026-10-06T08:00:00.000Z"),
        notify: true,
      }),
    ).rejects.toThrow(/PAYMENTS_PROVIDER is none/);
    await expect(none.findPaymentLink("visit-1")).rejects.toThrow(/PAYMENTS_PROVIDER is none/);
    await expect(none.cancelPaymentLink("plink_9")).rejects.toThrow(/PAYMENTS_PROVIDER is none/);
    await expect(none.orderPayments("order_9")).rejects.toThrow(/PAYMENTS_PROVIDER is none/);
    await expect(none.paymentLink("plink_9")).rejects.toThrow(/PAYMENTS_PROVIDER is none/);
    expect(calls).toEqual([]);
  });
});

describe("the stub's refunds", () => {
  it("refunds a payment once under a receipt, as Razorpay does", async () => {
    const stub = createStubPayments();
    expect((await stub.refund("pay_1", { amount: 100, notes: {}, receipt: "c-1" })).id).toMatch(/^rfnd_stub_/);
    expect(await stub.refund("pay_1", { amount: 100, notes: {}, receipt: "c-1" })).toEqual({ id: null });
    expect((await stub.refund("pay_2", { amount: 100, notes: {}, receipt: "c-1" })).id).toMatch(/^rfnd_stub_/);
    expect(stub.made.refunds).toEqual([
      { paymentId: "pay_1", amount: 100 },
      { paymentId: "pay_2", amount: 100 },
    ]);
  });
});
