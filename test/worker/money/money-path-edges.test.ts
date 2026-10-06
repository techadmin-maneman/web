// A client who pays inside the hold gets the visit, or, paying too late, an
// automatic refund; nothing is booked twice (docs/decisions/0068-a-paid-hold-is-kept.md).
// Razorpay's webhook books the visit itself, and the cron books one whose request failed part-way
// (test/worker/booking-without-fsm.test.ts). Each scenario is set at
// the moment it once went wrong. NOW is Monday 21 September 2026, 12 noon in India, and a hold lasts ten minutes. Every
// name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { confirmBooking } from "../../../src/domain/booking/bookings.ts";
import { creditBalance, grantCredits } from "../../../src/domain/money/credits.ts";
import { createLogger } from "../../../src/log.ts";
import { createStubPayments } from "../../../src/providers/payments/stub.ts";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  fakeQueue,
  leaseRefused,
  markDatabase,
  NOW,
  request,
} from "../helpers.ts";
import { technician } from "../clients.ts";
import {
  PERSON,
  OTHER,
  SECOND,
  at,
  cookies,
  call,
  fittedPerson,
  webhook,
  heldAndOrdered,
  payment,
  holdRow,
  scheduledServiceVisits,
  halfHourPass,
} from "./money-path-fixtures.ts";

const OLD_VISIT = "88888888-8888-4888-8888-888888888888";

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  cookies.clear();
  await technician();
  await fittedPerson(PERSON, "+919810000001", "Rohit Malhotra");
});

/** A paid service visit tomorrow at 12:00 in India: exactly 24 hours away, so moving it is late. */
async function lateServiceVisit() {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id, synced_at)
     VALUES (?1, ?1, ?2, 'service', 'scheduled', '2026-09-22T06:30:00.000Z', '2026-09-22T08:00:00.000Z', 't1', ?3)`,
  )
    .bind(OLD_VISIT, PERSON, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO payments (id, person_id, appointment_id, razorpay_payment_id, amount, currency, method, status,
       captured_at, created_at, updated_at)
     VALUES ('p-v1', ?1, ?2, 'pay_v1', 200000, 'INR', 'upi', 'captured', ?3, ?3, ?3)`,
  )
    .bind(PERSON, OLD_VISIT, NOW.toISOString())
    .run();
}

/** The hold for a new visit on Thursday that replaces it, with the move started. */
async function replacementHold(): Promise<string> {
  const body = { type: "service", date: "2026-09-24", window: "afternoon", moving: OLD_VISIT };
  const hold = await (await call(PERSON, "/api/holds", { method: "POST", body }, NOW)).json<{ id: string }>();
  const move = { method: "POST", body: { hold_id: hold.id } };
  await call(PERSON, `/api/appointments/${OLD_VISIT}/reschedule`, move, NOW);
  return hold.id;
}

const oldVisitStatus = () => env.DB.prepare("SELECT status FROM appointments WHERE id = ?1").bind(OLD_VISIT).first();

/** A service visit held, ordered and paid for at 30 seconds, its webhook's booking lost part-way. */
async function paidHold(paymentId: string) {
  const ordered = await heldAndOrdered(PERSON);
  const paid = payment(paymentId, ordered, at(30));
  await webhook("payment.captured", `evt_${paymentId}`, paid, at(31), { db: leaseRefused(env.DB) });
  return ordered;
}

const booking = (holdId: string, seconds: number, payments = createStubPayments()) =>
  confirmBooking({ db: env.DB, payments: payments, now: at(seconds), log: createLogger() }, holdId);

describe("the public form, with a client's number, while that client's hold is paid", () => {
  it("neither lets the hold go nor renames the client", async () => {
    await env.DB.prepare(
      "INSERT OR REPLACE INTO serviceable_pincodes (pincode, area, city, served, launched_at) VALUES ('122018', 'South City II', 'Gurgaon', 1, '2026-09-01T18:30:00.000Z')",
    ).run();
    const ordered = await heldAndOrdered(PERSON);
    const paid = payment("pay_w3", ordered, at(59));
    await webhook("payment.captured", "evt_w3", paid, at(60), { db: leaseRefused(env.DB) });
    const site = appFor("local", fakeDependencies({ now: () => at(70) }), {}, "public");
    await request(
      site,
      "/api/consultation",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9" },
        body: JSON.stringify({
          name: "Somebody Else",
          mobile: "98100 00001",
          pincode: "122018",
          loss_extent: "crown",
          turnstile_token: "token",
          date: "2026-09-25",
          window: "evening",
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
      { MESSAGE_QUEUE: fakeQueue(), CRM_QUEUE: fakeQueue() },
    );
    expect(await holdRow(ordered.holdId)).toEqual({ state: "held", refunded_at: null });
    expect(await env.DB.prepare("SELECT name FROM people WHERE id = ?1").bind(PERSON).first()).toEqual({
      name: "Rohit Malhotra",
    });
    const payments = createStubPayments();
    expect(
      await confirmBooking({ db: env.DB, payments: payments, now: at(75), log: createLogger() }, ordered.holdId),
    ).toBe("booked");
    expect(payments.made.refunds).toEqual([]);
  });
});

describe("a credit-covered move inside 24 hours", () => {
  it("spends the credit once, tells the client once, and cancels the old visit", async () => {
    await lateServiceVisit();
    await grantCredits(env.DB, { personId: PERSON, visits: 1, source: "ops", sourceId: "o1", now: NOW }).run();

    // The move confirmed it free, on the credit, so the request that confirmed it booked it.
    const holdId = await replacementHold();
    expect(
      await confirmBooking({ db: env.DB, payments: createStubPayments(), now: at(40), log: createLogger() }, holdId),
    ).toBe("already_booked");

    const redeemed = await env.DB.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'redeem'").first();
    expect(redeemed).toEqual({ n: 1 });
    expect((await creditBalance(env.DB, PERSON, at(60))).visits).toBe(0);
    const told = await env.DB.prepare("SELECT kind FROM outbound_messages WHERE person_id = ?1").bind(PERSON).all();
    expect(told.results).toEqual([{ kind: "reschedule_confirmation" }]);
    expect(await oldVisitStatus()).toEqual({ status: "cancelled" });
  });
});

describe("order.paid and payment.captured for one payment", () => {
  it("books the visit once, on the capture", async () => {
    const ordered = await heldAndOrdered(PERSON);
    await webhook("payment.captured", "evt_w9a", payment("pay_w9", ordered, at(30)), at(31));
    await webhook("order.paid", "evt_w9b", payment("pay_w9", ordered, at(30)), at(31));
    expect((await scheduledServiceVisits(PERSON)).results).toHaveLength(1);
  });
});

describe("booking a paid hold twice at once", () => {
  it("books it once when two tries take it at the same moment", async () => {
    const { holdId } = await paidHold("pay_i4");
    const both = await Promise.all([booking(holdId, 40), booking(holdId, 40)]);
    expect(both).toContain("booked");
    expect((await scheduledServiceVisits(PERSON)).results).toHaveLength(1);
  });

  it("waits for a try still writing the hold, and never gives it up or refunds it for that", async () => {
    const { holdId } = await paidHold("pay_i5");
    await env.DB.prepare("UPDATE slot_holds SET booking_until = ?2 WHERE id = ?1")
      .bind(holdId, at(200).toISOString())
      .run();
    const payments = createStubPayments();
    expect(await booking(holdId, 60, payments)).toBe("being_booked");
    expect(payments.made.refunds).toEqual([]);
    expect(await holdRow(holdId)).toEqual({ state: "held", refunded_at: null });
  });
});

describe("the half-hour pass over paid holds", () => {
  it("books a paid hold neither booked nor refunded half an hour on, and tells ops nothing", async () => {
    const { holdId } = await paidHold("pay_s1");
    const deps = fakeDependencies();
    expect(await halfHourPass(at(29 * 60), createCallBudget(40), deps)).toBe(0);
    expect(await halfHourPass(at(32 * 60), createCallBudget(40), deps)).toBe(1);
    expect(await holdRow(holdId)).toEqual({ state: "booked", refunded_at: null });
    expect(deps.alerts).toEqual([]);
  });

  it("leaves alone a hold that is booked, or was never paid for", async () => {
    const paid = await paidHold("pay_s2");
    await booking(paid.holdId, 40);
    await fittedPerson(OTHER, "+919810000005", "Karan Bhatia");
    await heldAndOrdered(OTHER, NOW, "2026-09-25");
    expect(await halfHourPass(at(60 * 60))).toBe(0);
  });

  it("stops when the run's calls are spent, and leaves the rest for the next run", async () => {
    const { holdId } = await paidHold("pay_s3");
    const spent = createCallBudget(0);
    expect(await halfHourPass(at(32 * 60), spent)).toBe(0);
    expect(spent.ranOut()).toBe(true);
    expect(await holdRow(holdId)).toEqual({ state: "held", refunded_at: null });
    expect(await halfHourPass(at(37 * 60))).toBe(1);
  });
});

// After an outage the runbook has ops refund, from Razorpay's dashboard, a payment whose capture never came.
describe("a refund of a payment whose capture never reached us", () => {
  /** A hold paid for inside its ten minutes, then refunded in full from Razorpay's dashboard an hour on. */
  async function refundedInDashboard() {
    const ordered = await heldAndOrdered(PERSON);
    const paid = payment("pay_m12", ordered, at(30));
    const refund = {
      id: "rfnd_m12",
      payment_id: "pay_m12",
      amount: ordered.amount,
      status: "processed",
      created_at: Math.floor(at(3600).getTime() / SECOND),
    };
    return { ordered, paid, refunded: { ...paid, status: "refunded", captured: true }, refund };
  }

  it("records both and books nothing: the hold is not confirmed, and the half-hour pass leaves it alone", async () => {
    const { ordered, refunded, refund } = await refundedInDashboard();

    const answer = await webhook("refund.processed", "evt_m12", refunded, at(3601), { refund });

    expect(answer.status).toBe(200);
    const paid = env.DB.prepare("SELECT status FROM payments WHERE razorpay_payment_id = 'pay_m12'");
    expect(await paid.first()).toEqual({ status: "refunded" });
    const hold = env.DB.prepare("SELECT confirmed_at FROM slot_holds WHERE id = ?1").bind(ordered.holdId);
    expect(await hold.first()).toEqual({ confirmed_at: null });
    expect(await halfHourPass(at(3 * 3600))).toBe(0);
    expect((await scheduledServiceVisits(PERSON)).results).toEqual([]);
  });

  it("books nothing when the capture arrives after the refund, and asks Razorpay for no second refund", async () => {
    const { ordered, paid, refunded, refund } = await refundedInDashboard();
    const payments = createStubPayments();
    await webhook("refund.processed", "evt_m12", refunded, at(3601), { refund });

    await webhook("payment.captured", "evt_m12_late", paid, at(3700), { payments });

    expect((await holdRow(ordered.holdId))?.state).toBe("released");
    expect(payments.made.refunds).toEqual([]);
    expect((await scheduledServiceVisits(PERSON)).results).toEqual([]);
  });
});

describe("GST once a price carries it", () => {
  it("shows the Payments tab the figure before GST, and the rate, that the hold charged", async () => {
    await env.DB.prepare(
      "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES ('service', 'standard', 200000, 18, '2026-09-23')",
    ).run();
    const ordered = await heldAndOrdered(PERSON);
    expect(ordered.amount).toBe(236000);
    await webhook("payment.captured", "evt_w7", payment("pay_w7", ordered, at(30)), at(31));
    const { entries } = await (
      await call(PERSON, "/api/payments", {}, at(60))
    ).json<{
      entries: Record<string, unknown>[];
    }>();
    expect(entries.find((entry) => entry.kind === "payment")).toMatchObject({
      amount: 236000,
      amount_ex_gst: 200000,
      gst_percent: 18,
    });
  });
});

describe("where a visit booked from the site is", () => {
  it("carries the pincode booked at onto the visit", async () => {
    await env.DB.prepare(
      "INSERT OR REPLACE INTO serviceable_pincodes (pincode, area, city, served, launched_at) VALUES ('122018', 'South City II', 'Gurgaon', 1, '2026-09-01T18:30:00.000Z')",
    ).run();
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
      { MESSAGE_QUEUE: fakeQueue(), CRM_QUEUE: fakeQueue() },
    );
    expect(answer.status).toBe(201);
    const visit = await env.DB.prepare(
      "SELECT service_city, service_pincode FROM appointments WHERE type = 'consultation'",
    ).first();
    expect(visit).toEqual({ service_city: "Gurgaon", service_pincode: "122018" });
  });
});
