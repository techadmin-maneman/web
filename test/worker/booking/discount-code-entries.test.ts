// A discount code entered on a booking (docs/decisions/0108-discount-codes.md): by the client at the app's pay step,
// on the site's form for a consultation and fit in one visit, and by the technician before the visit's payment link.
// Each takes the code off before GST, and the order, the link and the payment carry what is left. NOW is Monday 21
// September 2026, 12 noon in India; staging's book has a service visit at Rs. 2,000 and a first fit at Rs. 30,000,
// with no GST, from the 22nd. Every name, number and code here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { confirmBooking, startBooking } from "../../../src/domain/booking/bookings.ts";
import { paymentEntries, paymentEntry } from "../../../src/domain/money/client-payments.ts";
import { grantCredits } from "../../../src/domain/money/credits.ts";
import { codeOnHold, removeFromHold } from "../../../src/domain/money/discount-code-holds.ts";
import { priceAfterCode } from "../../../src/domain/money/discount-code-uses.ts";
import { removeFromVisit } from "../../../src/domain/money/discount-code-visits.ts";
import { composeVisitMessage } from "../../../src/domain/messages/visit-message-text.ts";
import { listCodes, makeCodes, type NewCodes } from "../../../src/domain/money/discount-codes.ts";
import { offeredProducts } from "../../../src/domain/booking/services.ts";
import { outstandingTasks } from "../../../src/domain/ops/tasks.ts";
import { TASK_SLA_HOURS } from "../../../src/policy/tasks.ts";
import { type PaymentsProvider } from "../../../src/providers/payments/index.ts";
import { createStubPayments, type StubPayments } from "../../../src/providers/payments/stub.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  fakeQueue,
  markDatabase,
  NOW,
  provedNumberCode,
  request,
} from "../helpers.ts";
import { asClient, client, fittedInAugust, signedIn, technician, type Call } from "../clients.ts";
import { JOB, working } from "../job-fixtures.ts";
import { createLogger } from "../../../src/log.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const OTHER = "55555555-5555-4555-8555-555555555555";
const MINUTE = 60_000;
const at = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);

/** Ten per cent off service visits and first fits, any number of times, once a client. */
const TEN_OFF: NewCodes = {
  code: "TENPC",
  count: 1,
  kind: "percent",
  value: 10,
  cap: null,
  covers: ["first_fit", "service"],
  expiresOn: null,
  maxUses: null,
  oncePerClient: true,
};

const make = (code: Partial<NewCodes> = {}) =>
  makeCodes(
    env.DB,
    { ...TEN_OFF, ...code },
    { actor: { kind: "staff", id: "ops@localhost" }, requestId: "r", now: NOW },
  );

const cookies = new Map<string, string>();

/** A fitted client, with an address and a session in the app. */
async function fittedClient(id: string, mobile: string) {
  await client(id, mobile);
  await fittedInAugust(id, `fit-${id}`);
  cookies.set(id, await signedIn(id));
}

const call = (personId: string, path: string, init: Call = {}, now = NOW) =>
  asClient(cookies.get(personId) ?? "", path, init, { now });

interface HoldAnswer {
  id: string;
  price: { amount_ex_gst: number; amount: number; gst_percent: number };
  discount: { code: string; amount_ex_gst: number | null; list_price: { amount: number } | null } | null;
}

/** A service visit held on Thursday, in the afternoon unless another window is named: one technician comes. */
async function heldService(personId: string, now = NOW, window = "afternoon"): Promise<HoldAnswer> {
  const held = await call(
    personId,
    "/api/holds",
    { method: "POST", body: { type: "service", date: "2026-09-24", window } },
    now,
  );
  expect(held.status).toBe(201);
  return held.json<HoldAnswer>();
}

const enter = (personId: string, holdId: string, code: string, now = NOW) =>
  call(personId, `/api/holds/${holdId}/discount-code`, { method: "POST", body: { code } }, now);

const uses = () =>
  env.DB.prepare(
    "SELECT hold_id, appointment_id, amount_off, given_by, removed_at IS NOT NULL AS removed FROM discount_code_uses",
  ).all();

/** The client's page in the console, as ops read it behind Access. */
async function clientRecord(personId: string) {
  const answer = await request(appFor("local", fakeDependencies(), {}, "ops"), `/api/clients/${personId}`);
  expect(answer.status).toBe(200);
  return answer.json<{ visits: { upcoming: unknown[] } }>();
}

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

describe("the site's form, for a consultation and fit in one visit", () => {
  const ADDRESS = {
    flat: "Flat 402",
    floor: "4",
    tower: "Tower C",
    line1: "Palm Grove Society",
    line2: null,
    landmark: "Opposite the park",
    locality: "Sector 65",
    city: "Gurgaon",
    pincode: "122018",
    access_notes: null,
  };
  /** The one visit, booked at once with its number proved by a code. */
  const book = async (body: { mobile?: string; [field: string]: unknown }, settings = {}) => {
    const mobile = body.mobile ?? "9810000002";
    return request(
      appFor("local", fakeDependencies(), settings, "public"),
      "/api/consultation",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Karan Bhatia",
          mobile,
          loss_extent: "crown",
          turnstile_token: "token",
          pincode: "122018",
          date: "2026-09-23",
          window: "morning",
          consent: true,
          address: ADDRESS,
          one_visit: true,
          number_code_id: await provedNumberCode(`+91${mobile}`),
          ...body,
        }),
      },
      { CRM_QUEUE: fakeQueue() },
    );
  };

  beforeEach(async () => {
    await technician();
    await env.DB.prepare(
      "INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at) VALUES ('122018', 'Sector 65', 'Gurgaon', 1, ?1)",
    )
      .bind(NOW.toISOString())
      .run();
  });

  /** TEN_OFF as the site's confirmation reads it. */
  const TENPC_STANDS = { code: "TENPC", kind: "percent", value: 10, cap: null };

  /** The site's one visit, booked with a code: the visit, and whose it is. */
  async function bookedWithCode(code: string) {
    await book({ discount_code: code });
    const hold = await env.DB.prepare("SELECT id, person_id FROM slot_holds").first<{
      id: string;
      person_id: string;
    }>();
    const visit = await env.DB.prepare("SELECT id FROM appointments").first<{ id: string }>();
    return { visitId: visit?.id ?? "", personId: hold?.person_id ?? "" };
  }

  /** A captured payment of the visit's: its price, or a late fee. */
  const paid = (id: string, booked: { visitId: string; personId: string }, kind: "visit" | "late_fee") =>
    env.DB.prepare(
      `INSERT INTO payments (id, person_id, appointment_id, razorpay_payment_id, amount, currency, status, kind,
         captured_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 2700000, 'INR', 'captured', ?5, ?6, ?6, ?6)`,
    )
      .bind(id, booked.personId, booked.visitId, `pay_${id}`, kind, NOW.toISOString())
      .run();

  // The confirmation said nothing of a code the booking took.
  it("answers what an amount code takes off, for the confirmation to say", async () => {
    await make({ code: "AUDTEST", kind: "amount", value: 100_000, covers: ["first_fit"] });
    const answer = await book({ discount_code: "audtest" });
    expect(await answer.json()).toMatchObject({
      discount_code: { code: "AUDTEST", kind: "amount", value: 100_000, cap: null },
    });
  });

  // After paying, neither the app's entry nor ops' Payments said the code was taken.
  it("carries the code onto the payment its link took, and not onto a late fee", async () => {
    await make();
    const booked = await bookedWithCode("TENPC");
    const listed = { amount_ex_gst: 3_000_000, amount: 3_000_000, gst_percent: 0 };
    await env.DB.batch((await priceAfterCode(env.DB, booked.visitId, listed)).fix);
    await paid("pay-fit", booked, "visit");
    await paid("pay-fee", booked, "late_fee");

    const entries = await paymentEntries(env.DB, booked.personId, NOW);
    const codeOf = (id: string) => entries.find((entry) => entry.id === id);
    expect(codeOf("pay-fit")).toMatchObject({ discount_code: { code: "TENPC", amount_off: 300_000 } });
    expect(codeOf("pay-fee")).toMatchObject({ discount_code: null });
    expect(await paymentEntry(env.DB, booked.personId, "pay-fit", NOW)).toMatchObject({
      discount_code: { code: "TENPC", amount_off: 300_000 },
    });
  });

  // A number we know that books nothing hears what a new number would, its code included.
  it("answers a number we know, which books nothing, with the code as a new number hears it", async () => {
    await make();
    expect((await book({})).status).toBe(201);
    const again = await book({ discount_code: "tenpc", date: "2026-09-24" });
    expect(again.status).toBe(201);
    expect(await again.json()).toMatchObject({ state: "booked", one_visit: true, discount_code: TENPC_STANDS });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM slot_holds").first("n")).toBe(1);
    expect((await uses()).results).toEqual([]);
  });

  it("keeps the code on the booking, to come off the product's price at the link", async () => {
    await make();
    const answer = await book({ discount_code: "tenpc" });
    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({ state: "booked", one_visit: true, discount_code: TENPC_STANDS });
    expect((await uses()).results).toEqual([
      { hold_id: expect.any(String) as string, appointment_id: null, amount_off: null, given_by: "client", removed: 0 },
    ]);
  });

  /** GET /api/me as the person the site's booking made. */
  async function homeOfBooker() {
    const person = await env.DB.prepare("SELECT id FROM people").first<string>("id");
    const answer = await asClient(await signedIn(person ?? ""), "/api/me");
    return answer.json<{
      consultation: { one_visit: unknown } | null;
      being_booked: { one_visit: unknown } | null;
      next_visit: { one_visit: unknown } | null;
    }>();
  }

  // Home said "We are booking your visit", with no price, while the site had said it was booked, and
  // every Home logged consultation_window_unknown.
  it("shows Home the one visit booked as itself, priced after the code it was booked with", async () => {
    await make();
    await book({ discount_code: "TENPC" });
    const logs = captureLogs();
    const me = await homeOfBooker();
    expect(me.being_booked).toBeNull();
    expect(me.next_visit?.one_visit).toEqual({ amount: 2_700_000, from: false, code: "TENPC" });
    expect(me.consultation).toBeNull();
    expect(logs.lines().filter((line) => line.event === "consultation_window_unknown")).toEqual([]);
  });

  it("shows Home the one visit asked for while booking is off, priced after the code typed", async () => {
    await make();
    await book({ discount_code: "TENPC" }, { selfServeBooking: false });
    const me = await homeOfBooker();
    expect(me.consultation?.one_visit).toEqual({ amount: 2_700_000, from: false, code: "TENPC" });
    expect(me.being_booked).toBeNull();
  });

  it("refuses the booking for a code that does not apply, naming the box, and writes nothing", async () => {
    await make({ code: "SVC25", covers: ["service"] });
    for (const body of [
      { discount_code: "SVC25" },
      { discount_code: "NOSUCH" },
      { one_visit: false, discount_code: "TENPC" },
    ]) {
      const answer = await book(body);
      expect(answer.status).toBe(422);
      expect(await answer.json()).toMatchObject({ error: { code: "code_not_applicable", fields: ["discount_code"] } });
    }
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM slot_holds").first("n")).toBe(0);
  });

  it("keeps the code on the request while booking is off, and the Tasks board names it", async () => {
    await make();
    const answer = await book({ discount_code: "TENPC" }, { selfServeBooking: false });
    expect(await answer.json()).toMatchObject({ state: "requested", discount_code: TENPC_STANDS });
    const asked = await env.DB.prepare("SELECT one_visit, discount_code FROM consultation_requests").first();
    expect(asked).toEqual({ one_visit: 1, discount_code: "TENPC" });
    expect((await uses()).results).toEqual([]);
    const { tasks } = await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS);
    expect(tasks.filter((task) => task.group === "consultation_request")).toMatchObject([
      { detail: "2026-09-23 morning one_visit TENPC" },
    ]);
  });

  describe("a code kept on the request while booking is off, which ops book the one visit from", () => {
    const TOMORROW = at(24 * 60);

    /** Ops book the one visit the request asked for, from the console, with the code they typed. */
    const opsBook = async (personId: string, code: string | undefined) => {
      const deps = fakeDependencies({ now: () => TOMORROW });
      const [product] = await offeredProducts(env.DB, "2026-09-23");
      return request(
        appFor("local", deps, {}, "ops"),
        "/api/visits",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
          body: JSON.stringify({
            client: personId,
            kind: "first_fit",
            tier: product?.tier,
            one_visit: true,
            date: "2026-09-23",
            window: "morning",
            ...(code === undefined ? {} : { code }),
          }),
        },
        { MESSAGE_QUEUE: fakeQueue() },
      );
    };

    /** The client's one visit, asked for on /book with the code while booking is off. */
    async function requested(code: string, mobile = "9810000002") {
      const answer = await book({ mobile, discount_code: code }, { selfServeBooking: false });
      expect(await answer.json()).toMatchObject({ state: "requested" });
      const personId = await env.DB.prepare("SELECT id FROM people WHERE mobile_e164 = ?1")
        .bind(`+91${mobile}`)
        .first<string>("id");
      return personId ?? "";
    }

    const auditDetail = async () =>
      JSON.parse(
        (await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'visit.book'").first<string>("detail")) ??
          "{}",
      ) as Record<string, string>;

    // The code was judged again when ops booked the visit, and refused once it had expired meanwhile.
    it("books it with the code though its last day has passed since the client typed it", async () => {
      await make({ expiresOn: "2026-09-21" });
      const personId = await requested("TENPC");

      const answer = await opsBook(personId, "tenpc");
      expect(answer.status).toBe(201);
      expect(await answer.json()).toMatchObject({ outcome: "booked" });
      const record = await clientRecord(personId);
      expect(record.visits.upcoming).toMatchObject([{ discount_code: { code: "TENPC", given_by: "ops" } }]);
      expect(await auditDetail()).toMatchObject({ code: "TENPC", code_typed_at: NOW.toISOString() });
    });

    it("books it with the code though ops switched the code off since", async () => {
      await make();
      const personId = await requested("TENPC");
      await env.DB.prepare("UPDATE discount_codes SET switched_off_at = ?1, switched_off_by = 'ops@localhost'")
        .bind(at(60).toISOString())
        .run();

      const answer = await opsBook(personId, "TENPC");
      expect(answer.status).toBe(201);
      const { hold_id: holdId } = await answer.json<{ hold_id: string }>();
      expect(await codeOnHold(env.DB, holdId)).toMatchObject({ code: "TENPC", amountOff: null });
    });

    it("judges a code the client did not give on /book as it stands now", async () => {
      await make();
      await make({ code: "OLDPC", expiresOn: "2026-09-21" });
      const personId = await requested("TENPC");

      const answer = await opsBook(personId, "OLDPC");
      expect(answer.status).toBe(422);
      expect(await answer.json()).toMatchObject({ error: { code: "code_not_applicable" } });
    });

    // Typing it kept no use, so a code whose last use went to another booking meanwhile has none left for this one.
    it("tells ops the code no longer applies once another booking took its last use, and holds nothing", async () => {
      await make({ code: "UNQ5", maxUses: 1, oncePerClient: false });
      const personId = await requested("UNQ5");
      expect((await book({ mobile: "9810000003", discount_code: "UNQ5" })).status).toBe(201);

      const answer = await opsBook(personId, "UNQ5");
      expect(answer.status).toBe(422);
      expect(await answer.json()).toMatchObject({ error: { code: "code_not_applicable" } });
      const held = await env.DB.prepare("SELECT COUNT(*) AS n FROM slot_holds WHERE person_id = ?1 AND state = 'held'")
        .bind(personId)
        .first("n");
      expect(held).toBe(0);
    });

    it("shows ops the code on the visit booked without it, and takes it there as it stood when typed", async () => {
      await make({ expiresOn: "2026-09-21" });
      const personId = await requested("TENPC");
      const booked = await (await opsBook(personId, undefined)).json<{ visit_id: string }>();

      const record = await clientRecord(personId);
      expect(record.visits.upcoming).toMatchObject([{ discount_code: null, requested_code: "TENPC" }]);
      const entered = await request(
        appFor("local", fakeDependencies({ now: () => TOMORROW }), {}, "ops"),
        `/api/visits/${booked.visit_id}/discount-code`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
          body: JSON.stringify({ code: "TENPC" }),
        },
      );
      expect(entered.status).toBe(200);
      expect(await entered.json()).toMatchObject({ code: "TENPC", amount_off: null, given_by: "ops" });
    });
  });

  it("refuses a single-use code another client's booking already stands on", async () => {
    await make({ code: "UNQ5", maxUses: 1, oncePerClient: false });
    const theirs = await book({ discount_code: "UNQ5" });
    expect(await theirs.json()).toMatchObject({ discount_code: { code: "UNQ5" } });
    const mine = await book({ mobile: "9810000003", discount_code: "UNQ5" });
    expect(mine.status).toBe(422);
  });

  it("names the code on the visit ops see once it is booked", async () => {
    await make();
    expect((await book({ discount_code: "tenpc" })).status).toBe(201);
    const personId = await env.DB.prepare("SELECT person_id FROM slot_holds").first<string>("person_id");
    const record = await clientRecord(personId ?? "");
    expect(record.visits.upcoming).toMatchObject([
      { type: "first_fit", discount_code: { code: "TENPC", amount_off: null, given_by: "client" } },
    ]);
  });

  it("stays the visit's code once the visit is booked, and comes off the product's price there", async () => {
    await make();
    const { visitId } = await bookedWithCode("TENPC");
    const listed = { amount_ex_gst: 3_000_000, amount: 3_000_000, gst_percent: 0 };
    const after = await priceAfterCode(env.DB, visitId, listed);
    expect(after).toMatchObject({ off: 300_000, price: { amount: 2_700_000 } });
  });
});

describe("the technician, before a one visit's payment link", () => {
  const NATURAL = { tier: "natural", name: "Mane Man Natural", amount: 4_500_000 };
  const A_PIECE = { piece_code: "MM-NAT-4417-A", base: "Lace", supplier_lot: "L-22" };

  async function oneVisit(payments = createStubPayments()) {
    const job = await working("first_fit", { payments });
    await env.DB.batch([
      env.DB.prepare("UPDATE appointments SET one_visit = 'booked' WHERE id = ?1").bind(JOB),
      env.DB.prepare(
        `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
         VALUES ('first_fit', ?1, ?2, 180, 1, 'ops@localhost', ?3)`,
      ).bind(NATURAL.tier, NATURAL.name, NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from)
         VALUES ('first_fit', ?1, ?2, 0, '2026-09-01')`,
      ).bind(NATURAL.tier, NATURAL.amount),
    ]);
    return job;
  }

  /** Works the one visit up to its outcome, the client's choice first, as its piece step's body says. */
  const workedWith = async (job: Awaited<ReturnType<typeof oneVisit>>, piece: object) => {
    await job.workTo("piece");
    await job.post(`/api/tech/jobs/${JOB}/piece`, piece, "event-piece-01");
    await job.post(`/api/tech/jobs/${JOB}/checklist`, { done: [] }, "event-checklist-01");
    await job.post(`/api/tech/jobs/${JOB}/consumables`, { items: [] }, "event-consumables-01");
    await job.post(`/api/tech/jobs/${JOB}/photos`, { phase: "after" }, "event-afterphotos-01");
  };
  const fitted = (job: Awaited<ReturnType<typeof oneVisit>>) => workedWith(job, { ...A_PIECE, product: NATURAL.tier });

  it("takes the code off the product's price in the link, and no amount reaches the phone", async () => {
    await make();
    const payments = createStubPayments();
    const job = await oneVisit(payments);
    const entered = await job.post(`/api/tech/jobs/${JOB}/discount-code`, { code: "tenpc" }, "unused");
    expect(entered.status).toBe(200);
    expect(await entered.json()).toEqual({ code: "TENPC" });

    await fitted(job);
    await job.post(`/api/tech/jobs/${JOB}/outcome`, { outcome: "done" }, "event-outcome-01");
    expect(payments.made.links).toMatchObject([{ amount: 4_050_000 }]);
    const link = await env.DB.prepare("SELECT amount, amount_ex_gst FROM payment_links").first();
    expect(link).toEqual({ amount: 4_050_000, amount_ex_gst: 4_050_000 });
    expect((await uses()).results).toEqual([
      { hold_id: null, appointment_id: JOB, amount_off: 450_000, given_by: "technician", removed: 0 },
    ]);
  });

  it("is refused once the link is made, and on a visit paid ahead", async () => {
    await make();
    const job = await oneVisit();
    await fitted(job);
    await job.post(`/api/tech/jobs/${JOB}/outcome`, { outcome: "done" }, "event-outcome-01");
    const late = await job.post(`/api/tech/jobs/${JOB}/discount-code`, { code: "TENPC" }, "unused");
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ error: { code: "price_settled" } });

    await env.DB.prepare("UPDATE appointments SET one_visit = NULL WHERE id = ?1").bind(JOB).run();
    const prepaid = await job.post(`/api/tech/jobs/${JOB}/discount-code`, { code: "TENPC" }, "unused");
    expect(await prepaid.json()).toMatchObject({ error: { code: "price_settled" } });
  });

  it("still takes a code on a first fit while the client holds credits, which pay only service visits", async () => {
    await make();
    const job = await oneVisit();
    await grantCredits(env.DB, { personId: PERSON, visits: 3, source: "ops", sourceId: "o1", now: NOW }).run();
    const entered = await job.post(`/api/tech/jobs/${JOB}/discount-code`, { code: "TENPC" }, "unused");
    expect(entered.status).toBe(200);
  });

  // Review of #177: a ₹0 link, which Razorpay refuses, left ops a task that never closed.
  it("settles a one visit a code makes free: no link, nothing owed, and the client told on WhatsApp", async () => {
    await make({ code: "ALLFREE", kind: "amount", value: NATURAL.amount });
    const payments = createStubPayments();
    const job = await oneVisit(payments);
    await job.post(`/api/tech/jobs/${JOB}/discount-code`, { code: "ALLFREE" }, "unused");
    await fitted(job);
    await job.post(`/api/tech/jobs/${JOB}/outcome`, { outcome: "done" }, "event-outcome-01");

    expect(payments.made.links).toEqual([]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM payment_links").first("n")).toBe(0);
    const { tasks } = await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS);
    expect(tasks.filter((task) => task.group === "payment_owed")).toEqual([]);
    expect(job.deps.alerts).toEqual([]);
    const told = await env.DB.prepare("SELECT kind FROM outbound_messages WHERE subject_id = ?1 ORDER BY kind")
      .bind(JOB)
      .all();
    // The other is the arrival notice of the technician's check-in.
    expect(told.results).toEqual([{ kind: "arrival_notice" }, { kind: "nothing_to_pay" }]);
    expect((await uses()).results).toMatchObject([{ amount_off: NATURAL.amount }]);
    // Owing nothing, the fit settles an invited friend's referral as a payment would.
    const visit = await env.DB.prepare("SELECT nothing_owed_at FROM appointments WHERE id = ?1").bind(JOB).first();
    expect(visit).toEqual({ nothing_owed_at: NOW.toISOString() });
    // The close settled its price, so the code stays on it, as on a visit paid for.
    const ops = { kind: "ops", actor: { kind: "staff", id: "ops@localhost" } } as const;
    expect(await removeFromVisit(env.DB, { visitId: JOB, by: ops, requestId: "r" }, NOW)).toBe("price_settled");
  });

  it("gives the code back when the client decides against the fit, and nothing is sold", async () => {
    await make({ code: "UNQ5", maxUses: 1 });
    const job = await oneVisit();
    await job.post(`/api/tech/jobs/${JOB}/discount-code`, { code: "UNQ5" }, "unused");
    await workedWith(job, { declined: true });
    await job.post(`/api/tech/jobs/${JOB}/outcome`, { outcome: "done" }, "event-outcome-01");
    const use = await env.DB.prepare("SELECT removed_by, removed_by_id FROM discount_code_uses").first();
    expect(use).toEqual({ removed_by: "system", removed_by_id: "declined" });
    const [code] = await listCodes(env.DB, NOW, "UNQ5");
    expect(code?.uses).toBe(0);
  });

  // The technician learnt a code was on the visit only by typing one ("This visit already has a code.").
  it("puts the code already on a one visit on its card, and who gave it, never what it takes off", async () => {
    await make();
    const job = await oneVisit();
    const card = async () => (await job.get(`/api/tech/jobs/${JOB}`)).json();
    expect(await card()).toMatchObject({ discount_code: null });

    await env.DB.prepare(
      `INSERT INTO discount_code_uses (id, code_id, person_id, appointment_id, given_by, given_by_id, created_at)
       SELECT 'use-booked', id, ?1, ?2, 'client', ?1, ?3 FROM discount_codes WHERE code = 'TENPC'`,
    )
      .bind(PERSON, JOB, NOW.toISOString())
      .run();
    expect(await card()).toMatchObject({ discount_code: { code: "TENPC", given_by: "client" } });

    // A visit paid ahead takes no code at the visit, so its card names none.
    await env.DB.prepare("UPDATE appointments SET one_visit = NULL WHERE id = ?1").bind(JOB).run();
    expect(await card()).toMatchObject({ discount_code: null });
  });

  it("says the code the technician entered is on the card once it is read again", async () => {
    await make();
    const job = await oneVisit();
    await job.post(`/api/tech/jobs/${JOB}/discount-code`, { code: "TENPC" }, "unused");
    const card = await (await job.get(`/api/tech/jobs/${JOB}`)).json();
    expect(card).toMatchObject({ discount_code: { code: "TENPC", given_by: "technician" } });
  });

  it("says only that a code does not apply", async () => {
    await make({ code: "SVC25", covers: ["service"] });
    const job = await oneVisit();
    const answer = await job.post(`/api/tech/jobs/${JOB}/discount-code`, { code: "SVC25" }, "unused");
    expect(answer.status).toBe(422);
    expect(await answer.json()).toEqual({
      error: { code: "code_not_applicable", request_id: expect.any(String) as string },
    });
  });
});
