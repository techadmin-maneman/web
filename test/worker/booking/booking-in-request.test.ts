// Booking, moving and cancelling: each is written in the request that makes it. NOW is Monday 21 September 2026, 12 noon
// in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { bookUnbookedHolds } from "../../../src/domain/booking/unbooked-holds.ts";
import { clawBack, creditBalance, grantCredits } from "../../../src/domain/money/credits.ts";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import { createStubPayments } from "../../../src/providers/payments/stub.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  fakeQueue,
  markDatabase,
  NOW,
  request,
  type TestDependencies,
} from "../helpers.ts";
import { technician } from "../clients.ts";
import {
  PERSON,
  at,
  cookies,
  messageQueue,
  useMessageQueue,
  bindings,
  call,
  webhook,
  payment,
  signedInClient,
  fittedClient,
  heldAndOrdered,
  holdRow,
  visitOf,
  visitsOf,
  messagesOf,
} from "./booking-in-request-fixtures.ts";

const NEWCOMER = "55555555-5555-4555-8555-555555555555";

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  cookies.clear();
  useMessageQueue(fakeQueue());
  await technician();
  await env.DB.prepare(
    "INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at) VALUES ('122018', 'South City II', 'Gurgaon', 1, '2026-09-01T18:30:00.000Z')",
  ).run();
});

describe("a paid booking", () => {
  it("is booked by Razorpay's webhook, in its own request, and the client sees the visit at once", async () => {
    await fittedClient();
    const ordered = await heldAndOrdered();

    expect(await webhook("payment.captured", "evt_paid", payment("pay_1", ordered))).toBe(200);

    const hold = await holdRow(ordered.holdId);
    expect(hold?.state).toBe("booked");
    expect(await visitOf(hold?.appointment_id)).toEqual({
      status: "scheduled",
      type: "service",
      tier: "standard",
      technician_id: "t1",
      window_start: "2026-09-24T06:30:00.000Z",
      window_end: "2026-09-24T08:00:00.000Z",
      service_city: "Gurgaon",
      service_pincode: "122018",
      asked_checked_at: NOW.toISOString(),
    });
    const paid = await env.DB.prepare(
      "SELECT appointment_id FROM payments WHERE razorpay_payment_id = 'pay_1'",
    ).first();
    expect(paid).toEqual({ appointment_id: hold?.appointment_id });
    expect((await messagesOf(PERSON)).results).toEqual([{ kind: "payment_receipt", subject_id: hold?.appointment_id }]);
    expect(messageQueue.sent).toHaveLength(1);

    const listed = await (await call(PERSON, "/api/visits")).json<{ upcoming: { id: string }[] }>();
    expect(listed.upcoming.map((visit) => visit.id)).toContain(hold?.appointment_id);
  });

  it("books once when Razorpay delivers the capture twice, under one event and under two", async () => {
    await fittedClient();
    const ordered = await heldAndOrdered();

    await webhook("payment.captured", "evt_twice", payment("pay_2", ordered));
    await webhook("payment.captured", "evt_twice", payment("pay_2", ordered));
    await webhook("payment.captured", "evt_again", payment("pay_2", ordered));
    await webhook("order.paid", "evt_order", payment("pay_2", ordered));

    expect((await visitsOf(PERSON, "service")).results).toHaveLength(1);
    expect((await messagesOf(PERSON)).results).toHaveLength(1);
  });

  it("refunds a payment Razorpay made after the hold and its grace ran out, and books nothing", async () => {
    await fittedClient();
    const ordered = await heldAndOrdered();
    const payments = createStubPayments();

    await webhook(
      "payment.captured",
      "evt_late",
      payment("pay_late", ordered, at(725)),
      fakeDependencies({ payments }),
    );

    expect(await holdRow(ordered.holdId)).toEqual({ state: "released", appointment_id: null });
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_late", amount: 200000 }]);
    expect((await visitsOf(PERSON, "service")).results).toEqual([]);
  });
});

describe("a free booking", () => {
  it("books a consultation in the request that confirms it", async () => {
    await signedInClient(NEWCOMER, "+919810000005", "Karan Bhatia");
    const held = await call(NEWCOMER, "/api/holds", {
      method: "POST",
      body: { type: "consultation", date: "2026-09-24", window: "morning" },
    });
    expect(held.status).toBe(201);
    const hold = await held.json<{ id: string }>();

    const started = await call(NEWCOMER, "/api/bookings", { method: "POST", body: { hold_id: hold.id } });
    expect(await started.json()).toEqual({ hold_id: hold.id, checkout: null });

    const booked = await holdRow(hold.id);
    expect(booked?.state).toBe("booked");
    expect(await visitOf(booked?.appointment_id)).toMatchObject({ type: "consultation" });
    expect((await messagesOf(NEWCOMER)).results).toEqual([
      { kind: "consultation_confirmation", subject_id: booked?.appointment_id },
    ]);
  });

  it("spends one credit on a visit a credit pays for, and books it at once", async () => {
    await fittedClient();
    await grantCredits(env.DB, { personId: PERSON, visits: 1, source: "ops", sourceId: "o1", now: NOW }).run();
    const ordered = await heldAndOrdered();
    expect(ordered.orderId).toBe("");

    const [visit] = (await visitsOf(PERSON, "service")).results;
    expect(visit?.status).toBe("scheduled");
    const redeemed = await env.DB.prepare("SELECT source_id FROM credit_ledger WHERE kind = 'redeem'").all();
    expect(redeemed.results).toEqual([{ source_id: visit?.id }]);
    expect((await creditBalance(env.DB, PERSON, NOW)).visits).toBe(0);
  });

  it("books a consultation from the site's form in its own request, where the client said the visit is", async () => {
    const site = appFor("local", fakeDependencies(), {}, "public");
    const answer = await request(
      site,
      "/api/consultation",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9" },
        body: JSON.stringify({
          name: "Neha Kapoor",
          mobile: "98100 00077",
          pincode: "122018",
          loss_extent: "crown",
          turnstile_token: "token",
          date: "2026-09-23",
          window: "morning",
          consent: true,
          address: {
            flat: "Flat 402",
            line1: "Palm Grove Society",
            line2: null,
            locality: "Sector 65",
            city: "Gurgaon",
            pincode: "122018",
            access_notes: null,
          },
        }),
      },
      bindings(),
    );
    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({ state: "booked" });

    const visit = await env.DB.prepare(
      "SELECT status, service_city, service_pincode FROM appointments WHERE type = 'consultation'",
    ).first();
    expect(visit).toEqual({ status: "scheduled", service_city: "Gurgaon", service_pincode: "122018" });
  });
});

describe("one credit pays for one visit", () => {
  const hold = async (date: string) => {
    const held = await call(PERSON, "/api/holds", {
      method: "POST",
      body: { type: "service", date, window: "afternoon" },
    });
    expect(held.status).toBe(201);
    return (await held.json<{ id: string }>()).id;
  };
  const book = async (holdId: string) => {
    const started = await call(PERSON, "/api/bookings", { method: "POST", body: { hold_id: holdId } });
    // A call that finds its hold booked already answers 409, with no checkout.
    return started.json<{ checkout?: { amount: number } | null }>();
  };
  const redeems = async () =>
    (await env.DB.prepare("SELECT source_id FROM credit_ledger WHERE kind = 'redeem'").all()).results;

  /** The one service visit booked, its credit redeemed, and nothing left to spend. */
  async function oneVisitOnTheCredit() {
    const visits = (await visitsOf(PERSON, "service")).results;
    expect(visits).toHaveLength(1);
    expect(await redeems()).toEqual([{ source_id: visits[0]?.id }]);
    expect((await creditBalance(env.DB, PERSON, NOW)).visits).toBe(0);
  }

  beforeEach(async () => {
    await fittedClient();
    await grantCredits(env.DB, { personId: PERSON, visits: 1, source: "ops", sourceId: "o1", now: NOW }).run();
  });

  it("books one of two visits booked in two tabs at the same moment on it, and asks payment for the other", async () => {
    const first = await hold("2026-09-24");
    const second = await hold("2026-09-25");
    // Each tab held its visit on the credit before either was booked.
    await env.DB.prepare("UPDATE slot_holds SET state = 'held', use_credit = 1").run();

    const answers = await Promise.all([book(first), book(second)]);

    const onCredit = answers.filter((answer) => answer.checkout === null);
    const paid = answers.filter((answer) => answer.checkout?.amount === 200000);
    expect([onCredit.length, paid.length]).toEqual([1, 1]);
    await oneVisitOnTheCredit();
  });

  it("books a booking call sent twice at once as one visit, on one credit", async () => {
    const first = await hold("2026-09-24");

    const answers = await Promise.all([book(first), book(first)]);

    for (const answer of answers) expect(answer.checkout ?? null).toBeNull();
    await oneVisitOnTheCredit();
  });

  it("books only the first of three visits booked back to back on it, and asks payment for the others", async () => {
    // A second technician, so the three can alternate: no technician takes two of a client's visits in a row.
    await technician("t3", "Sandeep Rawat", "SR");
    const answers = [];
    for (const date of ["2026-09-24", "2026-09-25", "2026-09-28"]) answers.push(await book(await hold(date)));

    expect(answers.map((answer) => answer.checkout?.amount ?? 0)).toEqual([0, 200000, 200000]);
    await oneVisitOnTheCredit();
  });

  /** The booking confirmed on the credit, and its request stopped before the visit was written. */
  const confirmedButUnwritten = (holdId: string) =>
    env.DB.prepare("UPDATE slot_holds SET confirmed_at = ?2, queued_at = ?2 WHERE id = ?1")
      .bind(holdId, NOW.toISOString())
      .run();

  const halfHourPass = (deps: TestDependencies) =>
    bookUnbookedHolds(
      env.DB,
      { ...deps, notify: () => Promise.resolve(), budget: createCallBudget(40), log: createLogger() },
      at(32 * 60),
    );

  it("asks payment on another device's visit while the credit waits on a booking not yet written", async () => {
    const first = await hold("2026-09-24");
    await confirmedButUnwritten(first);
    const second = await hold("2026-09-25");
    // The second device read the balance just before the first booking was confirmed.
    await env.DB.prepare("UPDATE slot_holds SET use_credit = 1 WHERE id = ?1").bind(second).run();

    expect(await book(second)).toMatchObject({ checkout: { amount: 200000 } });
    const secondHold = await env.DB.prepare("SELECT use_credit, confirmed_at FROM slot_holds WHERE id = ?1")
      .bind(second)
      .first();
    expect(secondHold).toEqual({ use_credit: 0, confirmed_at: null });

    expect(await halfHourPass(fakeDependencies())).toBe(1);
    await oneVisitOnTheCredit();
  });

  it("books a credit visit whose credit was taken back before it was written, and tells ops nothing paid for it", async () => {
    const first = await hold("2026-09-24");
    await confirmedButUnwritten(first);
    await clawBack(env.DB, "ops", "o1", NOW);
    const deps = fakeDependencies();

    expect(await halfHourPass(deps)).toBe(1);

    expect((await visitsOf(PERSON, "service")).results).toHaveLength(1);
    expect(await redeems()).toEqual([]);
    expect(deps.alerts).toEqual([
      expect.stringContaining("had none left by then, so nothing has paid for it. Decide whether to charge"),
    ]);
  });
});
