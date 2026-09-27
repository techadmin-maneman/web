// Razorpay's orders and refunds (src/providers/razorpay.ts), against a fake of its HTTP API: what is asked, and how
// its answers and refusals are read. No request leaves the test.

import { describe, expect, it, vi } from "vitest";
import type { RazorpaySettings } from "../../src/config/settings.ts";
import { createLogger } from "../../src/log.ts";
import { createPaymentsProvider, RazorpayError } from "../../src/providers/razorpay.ts";

const SETTINGS: RazorpaySettings = { keyId: "rzp_test_made_up", keySecret: "made-up-secret", webhookSecret: null };

function razorpayAnswering(status: number, body: string) {
  const calls: { url: string; authorization: string | null; body: unknown }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    calls.push({
      url: request.url,
      authorization: request.headers.get("Authorization"),
      body: JSON.parse(await request.text()) as unknown,
    });
    return new Response(body, { status, headers: { "Content-Type": "application/json" } });
  };
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  return { calls, payments: createPaymentsProvider("razorpay", SETTINGS, { fetch, log: createLogger() }) };
}

describe("Razorpay", () => {
  it("makes an order in rupees' paise, signed with the key, and reads its ID", async () => {
    const { calls, payments } = razorpayAnswering(200, JSON.stringify({ id: "order_Made0Up", status: "created" }));

    const order = await payments.createOrder({ amount: 150_000, receipt: "hold-1", notes: { hold_id: "hold-1" } });

    expect(order).toEqual({ id: "order_Made0Up" });
    expect(calls).toEqual([
      {
        url: "https://api.razorpay.com/v1/orders",
        authorization: `Basic ${btoa("rzp_test_made_up:made-up-secret")}`,
        body: { amount: 150_000, receipt: "hold-1", notes: { hold_id: "hold-1" }, currency: "INR" },
      },
    ]);
  });

  it("gives a payment back at normal speed, and reads the refund's ID", async () => {
    const { calls, payments } = razorpayAnswering(200, JSON.stringify({ id: "rfnd_Made0Up" }));

    expect(await payments.refund("pay_Made0Up", { amount: 50_000, notes: {} })).toEqual({ id: "rfnd_Made0Up" });
    expect(calls[0]?.url).toBe("https://api.razorpay.com/v1/payments/pay_Made0Up/refund");
    expect(calls[0]?.body).toEqual({ amount: 50_000, notes: {}, speed: "normal" });
  });

  it("throws Razorpay's own code and description when it refuses", async () => {
    const refusal = { error: { code: "BAD_REQUEST_ERROR", description: "The amount must be at least INR 1.00" } };
    const { payments } = razorpayAnswering(400, JSON.stringify(refusal));

    const refused = await payments
      .createOrder({ amount: 0, receipt: "hold-2", notes: {} })
      .catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(RazorpayError);
    expect(refused).toMatchObject({
      status: 400,
      code: "BAD_REQUEST_ERROR",
      message: "Razorpay 400 BAD_REQUEST_ERROR: The amount must be at least INR 1.00",
    });
  });

  it.each([
    ["an answer that is not JSON", "<html>Bad gateway</html>"],
    ["an error with neither code nor description", JSON.stringify({ error: {} })],
    ["an error that is not an object", JSON.stringify({ error: "down" })],
  ])("names a refusal UNKNOWN when it gives no code: %s", async (_case, body) => {
    const { payments } = razorpayAnswering(502, body);

    await expect(payments.refund("pay_Made0Up", { amount: 1, notes: {} })).rejects.toMatchObject({
      status: 502,
      code: "UNKNOWN",
      message: "Razorpay 502 UNKNOWN: no description",
    });
  });

  it("refuses an answer with no ID rather than booking against nothing", async () => {
    const { payments } = razorpayAnswering(200, JSON.stringify({ status: "created" }));

    await expect(payments.createOrder({ amount: 100, receipt: "hold-3", notes: {} })).rejects.toThrow();
  });
});
