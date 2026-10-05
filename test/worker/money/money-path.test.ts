// A client who pays inside the hold gets the visit, or, paying too late, an
// automatic refund; nothing is booked twice (docs/decisions/0068-a-paid-hold-is-kept.md).
// Razorpay's webhook books the visit itself, and the cron books one whose request failed part-way
// (test/worker/booking-without-fsm.test.ts). Each scenario is set at
// the moment it once went wrong. NOW is Monday 21 September 2026, 12 noon in India, and a hold lasts ten minutes. Every
// name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { bookUnbookedHolds, confirmBooking } from "../../../src/domain/bookings.ts";
import { creditBalance, grantCredits } from "../../../src/domain/credits.ts";
import { openSession } from "../../../src/domain/sessions.ts";
import { createLogger } from "../../../src/log.ts";
import { createStubPayments } from "../../../src/providers/payments/stub.ts";
import { createCallBudget, type CallBudget } from "../../../src/lib/call-budget.ts";
import type { PaymentsProvider } from "../../../src/providers/payments/index.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  fakeQueue,
  leaseRefused,
  markDatabase,
  NOW,
  request,
  savedAddress,
  deliverRazorpay,
} from "../helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const OTHER = "55555555-5555-4555-8555-555555555555";
const OLD_VISIT = "88888888-8888-4888-8888-888888888888";
const SECRET = "a-razorpay-webhook-secret-for-the-money-path";
const SECOND = 1000;
const at = (seconds: number) => new Date(NOW.getTime() + seconds * SECOND);

const cookies = new Map<string, string>();

function call(personId: string, path: string, init: { method?: string; body?: object } = {}, now = NOW) {
  const app = appFor("local", fakeDependencies({ now: () => now }), {}, "client");
  return request(
    app,
    path,
    {
      method: init.method ?? "GET",
      headers: {
        Cookie: cookies.get(personId) ?? "",
        "Content-Type": "application/json",
        Origin: "https://maneman.test",
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    },
    { MESSAGE_QUEUE: fakeQueue() },
  );
}

async function fittedPerson(id: string, mobile: string, name: string) {
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)")
    .bind(id, NOW.toISOString(), mobile, name)
    .run();
  await savedAddress(id);
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id, synced_at)
     VALUES (?1, ?1, ?2, 'first_fit', 'completed', '2026-08-01T03:30:00.000Z', '2026-08-01T06:30:00.000Z', 't1', ?3)`,
  )
    .bind(`fit-${id}`, id, NOW.toISOString())
    .run();
  cookies.set(
    id,
    `mm_app=${await openSession(env.DB, { kind: "client", subjectId: id, deviceLabel: null, now: NOW })}`,
  );
}

interface Through {
  readonly payments?: PaymentsProvider;
  readonly refund?: object;
  /** The database the webhook writes through, as when its connection is lost part-way. */
  readonly db?: D1Database;
}

/**
 * Razorpay's signed webhook for a payment, or for `through.refund` of it, delivered at `now`. It books the hold itself,
 * refunding through `through.payments` a payment made too late.
 */
async function webhook(event: string, eventId: string, payment: object, now: Date, through: Through = {}) {
  const payments = through.payments ?? createStubPayments();
  const refund = through.refund === undefined ? {} : { refund: { entity: through.refund } };
  const answer = await deliverRazorpay(
    { entity: "event", event, payload: { payment: { entity: payment }, ...refund } },
    {
      eventId,
      deps: fakeDependencies({ now: () => now, payments }),
      settings: { razorpay: { keyId: "rzp_test_money", keySecret: "s", webhookSecret: SECRET } },
      bindings: { MESSAGE_QUEUE: fakeQueue(), ...(through.db === undefined ? {} : { DB: through.db }) },
    },
  );
  return { status: answer.status };
}

/** A service visit held on Thursday afternoon, and its Razorpay order. */
async function heldAndOrdered(personId: string, now = NOW, date = "2026-09-24", window = "afternoon") {
  const body = { type: "service", date, window };
  const held = await call(personId, "/api/holds", { method: "POST", body }, now);
  const hold = await held.json<{ id: string; expires_at: string }>();
  const started = await call(personId, "/api/bookings", { method: "POST", body: { hold_id: hold.id } }, now);
  const checkout = (await started.json<{ checkout: { order_id: string; amount: number } | null }>()).checkout;
  return { holdId: hold.id, orderId: checkout?.order_id ?? "", amount: checkout?.amount ?? 0 };
}

/** Razorpay's payment entity: `madeAt` is Razorpay's own time for it. */
const payment = (id: string, ordered: { holdId: string; orderId: string; amount: number }, madeAt: Date) => ({
  id,
  amount: ordered.amount,
  currency: "INR",
  status: "captured",
  order_id: ordered.orderId,
  method: "upi",
  notes: { hold_id: ordered.holdId, person_id: PERSON },
  created_at: Math.floor(madeAt.getTime() / SECOND),
});

const holdRow = (id: string) =>
  env.DB.prepare("SELECT state, refunded_at FROM slot_holds WHERE id = ?1").bind(id).first();

const scheduledServiceVisits = (personId: string) =>
  env.DB.prepare("SELECT id FROM appointments WHERE person_id = ?1 AND type = 'service' AND status = 'scheduled'")
    .bind(personId)
    .all();

/** The cron's half-hour pass over paid holds: how many it booked. */
function halfHourPass(now: Date, budget: CallBudget = createCallBudget(40), deps = fakeDependencies()) {
  return bookUnbookedHolds(env.DB, { ...deps, notify: () => Promise.resolve(), budget, log: createLogger() }, now);
}

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  cookies.clear();
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
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
    expect(await confirmBooking(env.DB, payments, ordered.holdId, at(75), {})).toBe("booked");
    expect(payments.made.refunds).toEqual([]);
  });
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

describe("a credit-covered move inside 24 hours", () => {
  it("spends the credit once, tells the client once, and cancels the old visit", async () => {
    await lateServiceVisit();
    await grantCredits(env.DB, { personId: PERSON, visits: 1, source: "ops", sourceId: "o1", now: NOW }).run();

    // The move confirmed it free, on the credit, so the request that confirmed it booked it.
    const holdId = await replacementHold();
    expect(await confirmBooking(env.DB, createStubPayments(), holdId, at(40), {})).toBe("already_booked");

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

/** A service visit held, ordered and paid for at 30 seconds, its webhook's booking lost part-way. */
async function paidHold(paymentId: string) {
  const ordered = await heldAndOrdered(PERSON);
  const paid = payment(paymentId, ordered, at(30));
  await webhook("payment.captured", `evt_${paymentId}`, paid, at(31), { db: leaseRefused(env.DB) });
  return ordered;
}

const booking = (holdId: string, seconds: number, payments = createStubPayments()) =>
  confirmBooking(env.DB, payments, holdId, at(seconds), {});

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
