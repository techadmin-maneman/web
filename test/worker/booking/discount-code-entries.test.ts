// A discount code entered on a booking (docs/decisions/0108-discount-codes.md): by the client at the app's pay step,
// on the site's form for a consultation and fit in one visit, and by the technician before the visit's payment link.
// Each takes the code off before GST, and the order, the link and the payment carry what is left. NOW is Monday 21
// September 2026, 12 noon in India; staging's book has a service visit at Rs. 2,000 and a first fit at Rs. 30,000,
// with no GST, from the 22nd. Every name, number and code here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createStubPayments, type StubPayments } from "../../../src/providers/payments/stub.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { technician } from "../clients.ts";
import {
  PERSON,
  make,
  cookies,
  fittedClient,
  call,
  type HoldAnswer,
  heldService,
  enter,
  uses,
} from "./discount-code-entries-fixtures.ts";

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

  it("takes the code off the price before GST, and Checkout's order is made for what is left", async () => {
    await make();
    const hold = await heldService(PERSON);
    const entered = await enter(PERSON, hold.id, " tenpc ");
    expect(entered.status).toBe(200);
    expect(await entered.json()).toMatchObject({
      id: hold.id,
      price: { amount_ex_gst: 180_000, amount: 180_000, gst_percent: 0 },
      discount: { code: "TENPC", amount_ex_gst: 20_000, list_price: { amount_ex_gst: 200_000, amount: 200_000 } },
    });

    const payments = createStubPayments();
    const started = await request(appFor("local", fakeDependencies({ payments }), {}, "client"), "/api/bookings", {
      method: "POST",
      headers: {
        Cookie: cookies.get(PERSON) ?? "",
        "Content-Type": "application/json",
        Origin: "https://maneman.test",
      },
      body: JSON.stringify({ hold_id: hold.id }),
    });
    expect(await started.json()).toMatchObject({ checkout: { amount: 180_000 } });
    expect(payments.made.orders).toMatchObject([{ amount: 180_000 }]);
    expect((await uses()).results).toEqual([
      { hold_id: hold.id, appointment_id: null, amount_off: 20_000, given_by: "client", removed: 0 },
    ]);
  });

  it("charges GST on what is left", async () => {
    await env.DB.prepare(
      "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES ('service', 'standard', 200000, 18, '2026-09-23')",
    ).run();
    await make();
    const hold = await heldService(PERSON);
    expect(hold.price).toEqual({ amount_ex_gst: 200_000, amount: 236_000, gst_percent: 18 });
    const entered = await (await enter(PERSON, hold.id, "TENPC")).json<HoldAnswer>();
    expect(entered.price).toEqual({ amount_ex_gst: 180_000, amount: 212_400, gst_percent: 18 });
  });

  it("says only that a code does not apply, whatever the reason, and changes nothing", async () => {
    await make({ code: "FT25", covers: ["first_fit"] });
    await make({ code: "EXP25", expiresOn: "2026-09-20" });
    const hold = await heldService(PERSON);
    for (const code of ["NOSUCH", "FT25", "EXP25"]) {
      const answer = await enter(PERSON, hold.id, code);
      expect(answer.status).toBe(422);
      expect(await answer.json()).toEqual({
        error: { code: "code_not_applicable", request_id: expect.any(String) as string },
      });
    }
    const unchanged = await (await call(PERSON, `/api/holds/${hold.id}`)).json<HoldAnswer>();
    expect(unchanged).toMatchObject({ price: { amount: 200_000 }, discount: null });
    expect((await uses()).results).toEqual([]);
  });

  it("takes one code a booking, and gives the price back when the code comes off", async () => {
    await make();
    await make({ code: "FVEPC", value: 5 });
    const hold = await heldService(PERSON);
    await enter(PERSON, hold.id, "TENPC");
    const second = await enter(PERSON, hold.id, "FVEPC");
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: { code: "already_discounted" } });

    const removed = await call(PERSON, `/api/holds/${hold.id}/discount-code`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({ price: { amount_ex_gst: 200_000, amount: 200_000 }, discount: null });
    expect((await enter(PERSON, hold.id, "FVEPC")).status).toBe(200);
    // The use taken off stays on record, marked removed.
    expect((await uses()).results).toEqual([
      expect.objectContaining({ amount_off: 20_000, removed: 1 }),
      expect.objectContaining({ amount_off: 10_000, removed: 0 }),
    ]);
  });

  describe("once Checkout has its order", () => {
    let payments: StubPayments;

    /** The client's app, with Razorpay as one stub throughout, so what it holds of an order carries over. */
    const withRazorpay = (path: string, init: { method: string; body?: object }) =>
      request(appFor("local", fakeDependencies({ payments }), {}, "client"), path, {
        method: init.method,
        headers: {
          Cookie: cookies.get(PERSON) ?? "",
          "Content-Type": "application/json",
          Origin: "https://maneman.test",
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    const pay = async (holdId: string) => {
      const started = await withRazorpay("/api/bookings", { method: "POST", body: { hold_id: holdId } });
      return (await started.json<{ checkout: { order_id: string; amount: number } }>()).checkout;
    };
    const orderOf = (holdId: string) =>
      env.DB.prepare("SELECT razorpay_order_id FROM slot_holds WHERE id = ?1").bind(holdId).first("razorpay_order_id");
    /** Razorpay holding a payment on the order in each status given. */
    const paymentsMade = (orderId: string, statuses: string[]) => {
      const made = statuses.map((status, index) => ({
        id: `pay_${String(index)}`,
        amount: 200_000,
        currency: "INR",
        status,
        order_id: orderId,
        created_at: Math.floor(NOW.getTime() / 1000),
      }));
      payments.paymentsOn.set(orderId, made);
    };

    beforeEach(() => {
      payments = createStubPayments();
    });

    // A client who closed Checkout without paying had to give up their hold to use a code.
    it("takes a code after Checkout was closed unpaid, and the next Pay makes an order for what is left", async () => {
      await make();
      const hold = await heldService(PERSON);
      const first = await pay(hold.id);
      expect(first.amount).toBe(200_000);

      const entered = await withRazorpay(`/api/holds/${hold.id}/discount-code`, {
        method: "POST",
        body: { code: "TENPC" },
      });
      expect(entered.status).toBe(200);
      expect(await orderOf(hold.id)).toBeNull();

      const second = await pay(hold.id);
      expect(second.amount).toBe(180_000);
      expect(second.order_id).not.toBe(first.order_id);
      expect(payments.made.orders.map((order) => order.amount)).toEqual([200_000, 180_000]);
    });

    it("takes a code off after a payment on the order failed, and makes the order again at the full price", async () => {
      await make();
      const hold = await heldService(PERSON);
      await enter(PERSON, hold.id, "TENPC");
      const first = await pay(hold.id);
      paymentsMade(first.order_id, ["failed"]);

      const removed = await withRazorpay(`/api/holds/${hold.id}/discount-code`, { method: "DELETE" });
      expect(removed.status).toBe(200);
      expect((await pay(hold.id)).amount).toBe(200_000);
    });

    it("is refused while a payment on the order may still go through, so the order and the price never part", async () => {
      await make();
      await make({ code: "FVEPC", value: 5 });
      const hold = await heldService(PERSON);
      await enter(PERSON, hold.id, "TENPC");
      const first = await pay(hold.id);
      for (const statuses of [["created"], ["failed", "authorized"], ["captured"]]) {
        paymentsMade(first.order_id, statuses);
        const removing = await withRazorpay(`/api/holds/${hold.id}/discount-code`, { method: "DELETE" });
        expect(removing.status).toBe(409);
        expect(await removing.json()).toMatchObject({ error: { code: "price_settled" } });
      }
      expect(await orderOf(hold.id)).toBe(first.order_id);
      expect((await uses()).results).toEqual([expect.objectContaining({ amount_off: 20_000, removed: 0 })]);
    });

    it("is refused when Razorpay cannot say what was paid on the order", async () => {
      await make();
      const hold = await heldService(PERSON);
      const first = await pay(hold.id);
      payments = { ...payments, orderPayments: () => Promise.reject(new Error("Razorpay 500 SERVER_ERROR")) };

      const entered = await withRazorpay(`/api/holds/${hold.id}/discount-code`, {
        method: "POST",
        body: { code: "TENPC" },
      });
      expect(entered.status).toBe(409);
      expect(await orderOf(hold.id)).toBe(first.order_id);
    });
  });
});
