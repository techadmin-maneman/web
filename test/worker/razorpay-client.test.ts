// The Razorpay client (src/providers/razorpay.ts) against Razorpay's own
// replies, in the shapes its API documents: an order, a refund, and a refusal.
// Nothing called the real client before (TCD-03); the stub stood in everywhere.

import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/log.ts";
import { createPaymentsProvider } from "../../src/providers/payments.ts";
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

  it("refunds a payment at normal speed, by its ID in the path, and answers the refund's ID", async () => {
    const { payments, calls } = razorpay({
      [`${API}/payments/pay_1/refund`]: () => json({ id: "rfnd_9", entity: "refund", amount: 100000 }),
    });

    expect(await payments.refund("pay_1", { amount: 100000, notes: { reason: "cancelled" } })).toEqual({
      id: "rfnd_9",
    });
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
      amount: 100000,
      notes: { reason: "cancelled" },
      speed: "normal",
    });
  });

  it("names Razorpay's own code and description when it refuses", async () => {
    const { payments } = razorpay({
      [`${API}/payments/pay_1/refund`]: () =>
        json({ error: { code: "BAD_REQUEST_ERROR", description: "The refund amount exceeds the payment" } }, 400),
    });

    const refused = payments.refund("pay_1", { amount: 999999, notes: {} });

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
});

// A consultation and fit in one visit is paid by a link, which Razorpay texts to the client itself
// (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
describe("Razorpay: payment links", () => {
  const LINK = {
    amount: 4500000,
    reference: "visit-1",
    description: "Mane Man Natural, fitted Mon 21 Sep",
    customer: { name: "Rohit Malhotra", contact: "+919810000001" },
    notes: { appointment_id: "visit-1", person_id: "person-1" },
  };

  it("makes a link for the whole amount, under our reference, which Razorpay texts the client and reminds them of", async () => {
    const { payments, calls } = razorpay({
      [`${API}/payment_links`]: () =>
        json({ id: "plink_9", short_url: "https://rzp.io/i/abc", status: "created", reference_id: "visit-1" }),
    });

    expect(await payments.createPaymentLink(LINK)).toEqual({ id: "plink_9", shortUrl: "https://rzp.io/i/abc" });
    expect(calls[0]?.headers.get("Authorization")).toBe(`Basic ${btoa("rzp_test_abc:key-secret")}`);
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
      amount: 4500000,
      currency: "INR",
      accept_partial: false,
      reference_id: "visit-1",
      description: "Mane Man Natural, fitted Mon 21 Sep",
      customer: { name: "Rohit Malhotra", contact: "+919810000001" },
      notify: { sms: true, email: false },
      reminder_enable: true,
      notes: { appointment_id: "visit-1", person_id: "person-1" },
    });
  });

  it("names Razorpay's refusal as a refusal, so ops are told rather than the close sent again", async () => {
    const { payments } = razorpay({
      [`${API}/payment_links`]: () =>
        json({ error: { code: "BAD_REQUEST_ERROR", description: "reference_id already exists" } }, 400),
    });
    const refused = payments.createPaymentLink(LINK);
    await expect(refused).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST_ERROR", refusal: true });
  });

  it("fails loudly on a link it cannot read, rather than keeping one with no address", async () => {
    const { payments } = razorpay({ [`${API}/payment_links`]: () => json({ id: "plink_9" }) });
    await expect(payments.createPaymentLink(LINK)).rejects.toThrow();
  });
});

describe("payments where none is connected", () => {
  it("refuses to make an order or a refund, saying why, and reaches nothing", async () => {
    const { calls } = razorpay({});
    const none = createPaymentsProvider("none", null, { fetch: fakeFetch({}).fetch, log: createLogger() });

    await expect(none.createOrder({ amount: 1, receipt: "r", notes: {} })).rejects.toThrow(/PAYMENTS_PROVIDER is none/);
    await expect(none.refund("pay_1", { amount: 1, notes: {} })).rejects.toThrow(/PAYMENTS_PROVIDER is none/);
    await expect(
      none.createPaymentLink({
        amount: 1,
        reference: "r",
        description: "d",
        customer: { name: "", contact: "" },
        notes: {},
      }),
    ).rejects.toThrow(/PAYMENTS_PROVIDER is none/);
    expect(calls).toEqual([]);
  });
});
