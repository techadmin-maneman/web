// A client who pays inside the hold gets the visit, or, paying too late, an
// automatic refund; nothing is booked twice (docs/decisions/0068-a-paid-hold-is-kept.md).
// Razorpay's webhook books the visit itself, and the cron books one whose request failed part-way
// (test/worker/booking-without-fsm.test.ts). Each scenario is set at
// the moment it once went wrong. NOW is Monday 21 September 2026, 12 noon in India, and a hold lasts ten minutes. Every
// name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createStubPayments } from "../../../src/providers/payments/stub.ts";
import { captureLogs, leaseRefused, markDatabase, NOW } from "../helpers.ts";
import { technician } from "../clients.ts";
import {
  PERSON,
  OTHER,
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

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  cookies.clear();
  await technician();
  await fittedPerson(PERSON, "+919810000001", "Rohit Malhotra");
});

describe("a payment made inside the hold whose webhook lands after it", () => {
  it("is booked, judged on Razorpay's time for the payment, not on when the webhook came", async () => {
    const ordered = await heldAndOrdered(PERSON);
    const payments = createStubPayments();
    // Paid at 9 minutes 50 seconds; the webhook reaches us at 10 minutes 5.
    await webhook("payment.captured", "evt_w1", payment("pay_w1", ordered, at(590)), at(605), { payments });
    expect(await holdRow(ordered.holdId)).toEqual({ state: "booked", refunded_at: null });
    expect(payments.made.refunds).toEqual([]);
  });

  it("is still refunded when Razorpay's own time for it is past the hold and the two minutes' grace", async () => {
    const ordered = await heldAndOrdered(PERSON);
    const payments = createStubPayments();
    await webhook("payment.captured", "evt_w1b", payment("pay_w1b", ordered, at(725)), at(726), { payments });
    expect((await holdRow(ordered.holdId))?.state).toBe("released");
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_w1b", amount: 200000 }]);
  });
});

// A payment may land on a hold's order until its grace ends, so until then neither the app's lapse nor the client's
// next hold lets that hold go.
describe("a hold with a Razorpay order, let go before its grace ends", () => {
  const letGo = (holdId: string, now: Date) => call(PERSON, `/api/holds/${holdId}`, { method: "DELETE" }, now);

  /** The webhook of a payment made at `madeAt`, heard of at `heardAt`, which books it. */
  async function paidAndBooked(ordered: Awaited<ReturnType<typeof heldAndOrdered>>, madeAt: Date, heardAt: Date) {
    const payments = createStubPayments();
    const id = `pay_${String(madeAt.getTime())}`;
    await webhook("payment.captured", `evt_${id}`, payment(id, ordered, madeAt), heardAt, { payments });
    return payments;
  }

  it("is booked when the app lets it go at ten minutes and the payment is made in the grace", async () => {
    const ordered = await heldAndOrdered(PERSON);
    expect((await letGo(ordered.holdId, at(600))).status).toBe(204);
    expect(await holdRow(ordered.holdId)).toEqual({ state: "held", refunded_at: null });
    const payments = await paidAndBooked(ordered, at(630), at(635));
    expect(await holdRow(ordered.holdId)).toEqual({ state: "booked", refunded_at: null });
    expect(payments.made.refunds).toEqual([]);
  });

  it("is booked when the app lets it go at ten minutes before the webhook of a payment made in them", async () => {
    const ordered = await heldAndOrdered(PERSON);
    await letGo(ordered.holdId, at(600));
    const payments = await paidAndBooked(ordered, at(590), at(605));
    expect(await holdRow(ordered.holdId)).toEqual({ state: "booked", refunded_at: null });
    expect(payments.made.refunds).toEqual([]);
  });

  it("keeps its time when its client lets it go mid-countdown, or holds another window", async () => {
    const ordered = await heldAndOrdered(PERSON);
    await letGo(ordered.holdId, at(300));
    const another = await call(
      PERSON,
      "/api/holds",
      { method: "POST", body: { type: "service", date: "2026-09-30", window: "morning" } },
      at(310),
    );
    expect(another.status).toBe(201);
    expect(await holdRow(ordered.holdId)).toEqual({ state: "held", refunded_at: null });
  });

  it("is let go once its grace has ended", async () => {
    const ordered = await heldAndOrdered(PERSON);
    await letGo(ordered.holdId, at(719));
    expect(await holdRow(ordered.holdId)).toEqual({ state: "held", refunded_at: null });
    await letGo(ordered.holdId, at(720));
    expect(await holdRow(ordered.holdId)).toEqual({ state: "released", refunded_at: null });
  });
});

// A payment made in time whose webhook lands only after the hold was let go at the end of its grace.
describe("a payment made in time, heard of after its hold was let go", () => {
  const otherHolds = async (date: string, window: string) => {
    await fittedPerson(OTHER, "+919810000005", "Karan Bhatia");
    return call(OTHER, "/api/holds", { method: "POST", body: { type: "service", date, window } }, at(730));
  };

  /** The webhook of a payment made at nine and a half minutes, heard of at `heardAt`. */
  async function heardLate(ordered: Awaited<ReturnType<typeof heldAndOrdered>>, eventId: string, heardAt: Date) {
    const payments = createStubPayments();
    const id = `pay_${eventId}`;
    await webhook("payment.captured", eventId, payment(id, ordered, at(570)), heardAt, { payments });
    return { payments, id };
  }

  it("is booked on its own time, taken back, when nobody has taken that since", async () => {
    const ordered = await heldAndOrdered(PERSON);
    expect((await otherHolds("2026-09-30", "morning")).status).toBe(201);
    expect(await holdRow(ordered.holdId)).toEqual({ state: "released", refunded_at: null });
    const { payments } = await heardLate(ordered, "evt_r1", at(750));
    expect(await holdRow(ordered.holdId)).toEqual({ state: "booked", refunded_at: null });
    expect(payments.made.refunds).toEqual([]);
    const booked = await env.DB.prepare(
      "SELECT window_start FROM appointments WHERE person_id = ?1 AND type = 'service' AND status = 'scheduled'",
    )
      .bind(PERSON)
      .all();
    expect(booked.results).toEqual([{ window_start: "2026-09-24T06:30:00.000Z" }]);
  });

  it("is refunded when another client has held its time since", async () => {
    const ordered = await heldAndOrdered(PERSON);
    expect((await otherHolds("2026-09-24", "afternoon")).status).toBe(201);
    const { payments, id } = await heardLate(ordered, "evt_r2", at(750));
    expect((await holdRow(ordered.holdId))?.state).toBe("released");
    expect(payments.made.refunds).toEqual([{ paymentId: id, amount: 200000 }]);
    const claims = await env.DB.prepare("SELECT COUNT(*) AS n FROM slot_claims WHERE hold_id = ?1")
      .bind(ordered.holdId)
      .first();
    expect(claims).toEqual({ n: 0 });
  });

  it("is refunded when its visit has begun by the time the payment is heard of", async () => {
    const ordered = await heldAndOrdered(PERSON);
    expect((await otherHolds("2026-09-30", "morning")).status).toBe(201);
    // Thursday's visit started at noon in India, 06:30 UTC.
    const { payments, id } = await heardLate(ordered, "evt_r3", new Date("2026-09-24T07:00:00.000Z"));
    expect((await holdRow(ordered.holdId))?.state).toBe("released");
    expect(payments.made.refunds).toEqual([{ paymentId: id, amount: 200000 }]);
    expect((await scheduledServiceVisits(PERSON)).results).toEqual([]);
  });
});

// The grace is ops' to set, and a hold is judged by the one it was made with
// (docs/decisions/0088-every-policy-in-the-console.md).
describe("a payment made in the grace its hold was made with", () => {
  const grace = (minutes: number) =>
    env.DB.prepare(
      "INSERT OR REPLACE INTO ops_settings (name, value, set_by, set_at) VALUES ('payment_hold', ?1, 'ops', ?2)",
    )
      .bind(JSON.stringify({ countdown: 10, grace: minutes }), NOW.toISOString())
      .run();

  it("is booked, though ops shortened the grace after the hold was made", async () => {
    await grace(5);
    const ordered = await heldAndOrdered(PERSON);
    await grace(1);
    const payments = createStubPayments();
    // Paid at 14 minutes: past a minute's grace, inside the five the hold was made with.
    await webhook("payment.captured", "evt_g1", payment("pay_g1", ordered, at(840)), at(841), { payments });
    expect(await holdRow(ordered.holdId)).toEqual({ state: "booked", refunded_at: null });
    expect(payments.made.refunds).toEqual([]);
  });
});

describe("a paid hold whose webhook could not book it", () => {
  it("keeps its time when another client holds after its ten minutes, and is booked by the half-hour pass", async () => {
    await fittedPerson(OTHER, "+919810000005", "Karan Bhatia");
    const ordered = await heldAndOrdered(PERSON);
    const paid = payment("pay_w2", ordered, at(299));
    await webhook("payment.captured", "evt_w2", paid, at(300), { db: leaseRefused(env.DB) });
    expect(await holdRow(ordered.holdId)).toEqual({ state: "held", refunded_at: null });

    // Another client holds after the tenth minute: a different day, and then the same window.
    const elsewhere = { type: "service", date: "2026-09-30", window: "morning" };
    expect((await call(OTHER, "/api/holds", { method: "POST", body: elsewhere }, at(660))).status).toBe(201);
    expect(await holdRow(ordered.holdId)).toEqual({ state: "held", refunded_at: null });
    const same = { type: "service", date: "2026-09-24", window: "afternoon" };
    expect((await call(OTHER, "/api/holds", { method: "POST", body: same }, at(665))).status).toBe(409);

    // Half an hour from the payment's webhook, at five minutes.
    expect(await halfHourPass(at(34 * 60))).toBe(0);
    expect(await halfHourPass(at(36 * 60))).toBe(1);
    expect(await holdRow(ordered.holdId)).toEqual({ state: "booked", refunded_at: null });
    expect((await scheduledServiceVisits(PERSON)).results).toHaveLength(1);
  });

  it("cannot be let go by the client once paid, and says it is paid rather than expired", async () => {
    const ordered = await heldAndOrdered(PERSON);
    const paid = payment("pay_w2b", ordered, at(30));
    await webhook("payment.captured", "evt_w2b", paid, at(31), { db: leaseRefused(env.DB) });
    await call(PERSON, `/api/holds/${ordered.holdId}`, { method: "DELETE" }, at(40));
    expect(await holdRow(ordered.holdId)).toEqual({ state: "held", refunded_at: null });
    const view = await (await call(PERSON, `/api/holds/${ordered.holdId}`, {}, at(700))).json();
    expect(view).toMatchObject({ state: "held", paid: true });
  });
});
