// A client who pays inside the hold gets the visit, or, paying too late, an
// automatic refund; nothing is booked twice (docs/decisions/0068-a-paid-hold-is-kept.md).
// A visit FSM refuses is held for ops, with its payment: test/worker/held-bookings.test.ts.
// What does not depend on FSM runs on both records of field work: FSM's, and our own
// database's, where the webhook books the visit itself (test/worker/booking-without-fsm.test.ts).
// The scenarios are the audit's (24 September 2026, W1 to W10), each at the
// moment it went wrong. NOW is Monday 21 September 2026, 12 noon in India, and a
// hold lasts ten minutes. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmBooking, requeueUnbookedHolds } from "../../src/domain/bookings.ts";
import { creditBalance, grantCredits } from "../../src/domain/credits.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { saltedHash } from "../../src/lib/hash.ts";
import { createLogger } from "../../src/log.ts";
import { createStubFsm, EMPTY_FSM, type FsmProvider } from "../../src/providers/fsm.ts";
import { createStubPayments } from "../../src/providers/payments.ts";
import { handleFsmSyncBatch } from "../../src/queues/fsm-sync.ts";
import { createCallBudget } from "../../src/lib/call-budget.ts";
import type { FieldRecord } from "../../src/config/field-record.ts";
import type { PaymentsProvider } from "../../src/providers/payments.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  fakeQueue,
  fsmSwitchedOff,
  LOCAL_SETTINGS,
  markDatabase,
  NOW,
  PROVIDERS_FOR,
  request,
  savedAddress,
} from "./helpers.ts";

const RECORDS: readonly FieldRecord[] = ["fsm", "ours"];

const PERSON = "11111111-1111-4111-8111-111111111111";
const OTHER = "55555555-5555-4555-8555-555555555555";
const OLD_VISIT = "88888888-8888-4888-8888-888888888888";
const SECRET = "a-razorpay-webhook-secret-for-the-money-path";
const SECOND = 1000;
const at = (seconds: number) => new Date(NOW.getTime() + seconds * SECOND);

const world = () => ({
  ...EMPTY_FSM,
  items: [
    { id: "item-service", name: "Service visit", type: "Service" as const, price: null },
    { id: "item-consult", name: "Consultation", type: "Service" as const, price: null },
    { id: "item-fit", name: "First fit", type: "Service" as const, price: null },
  ],
});

const cookies = new Map<string, string>();

/** The dependencies each record runs with: FSM's stub, or FSM switched off. */
const depsFor = (record: FieldRecord, overrides: Parameters<typeof fakeDependencies>[0] = {}) =>
  fakeDependencies({ fsm: record === "ours" ? fsmSwitchedOff() : createStubFsm(world()), ...overrides });

function call(
  personId: string,
  path: string,
  init: { method?: string; body?: object } = {},
  now = NOW,
  record: FieldRecord = "fsm",
) {
  const app = appFor("local", depsFor(record, { now: () => now }), {}, "client", PROVIDERS_FOR[record]);
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
    { FSM_QUEUE: fakeQueue() },
  );
}

async function fittedPerson(id: string, mobile: string, name: string) {
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name, fsm_contact_id) VALUES (?1, ?2, ?3, ?4, ?5)",
  )
    .bind(id, NOW.toISOString(), mobile, name, `contact-${id}`)
    .run();
  await savedAddress(id);
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end, technician_id,
       fsm_modified_at, synced_at)
     VALUES (?1, ?2, ?3, 'first_fit', 'completed', 'Completed', '2026-08-01T03:30:00.000Z', '2026-08-01T06:30:00.000Z',
       't1', ?4, ?4)`,
  )
    .bind(`fit-${id}`, `fsm-fit-${id}`, id, NOW.toISOString())
    .run();
  cookies.set(
    id,
    `mm_app=${await openSession(env.DB, { kind: "client", subjectId: id, deviceLabel: null, now: NOW })}`,
  );
}

/**
 * Razorpay's signed webhook for a payment, delivered at `now`. On our own record it books the hold itself, refunding
 * through `through.payments` a payment made too late.
 */
async function webhook(
  event: string,
  eventId: string,
  payment: object,
  now: Date,
  queue = fakeQueue(),
  through: { readonly record?: FieldRecord; readonly payments?: PaymentsProvider } = {},
) {
  const record = through.record ?? "fsm";
  const payments = through.payments ?? createStubPayments();
  const deps = depsFor(record, { now: () => now, payments });
  const settings = { ...LOCAL_SETTINGS, razorpay: { keyId: "rzp_test_money", keySecret: "s", webhookSecret: SECRET } };
  const app = appFor("local", deps, settings, "public", PROVIDERS_FOR[record]);
  const body = JSON.stringify({ entity: "event", event, payload: { payment: { entity: payment } } });
  const answer = await request(
    app,
    "/api/hooks/razorpay",
    {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json",
        "X-Razorpay-Signature": await saltedHash(SECRET, body),
        "X-Razorpay-Event-Id": eventId,
      },
    },
    { FSM_QUEUE: queue },
  );
  return { status: answer.status, queue };
}

/** A service visit held on Thursday afternoon, and its Razorpay order. */
async function heldAndOrdered(
  personId: string,
  now = NOW,
  date = "2026-09-24",
  window = "afternoon",
  record: FieldRecord = "fsm",
) {
  const body = { type: "service", date, window };
  const held = await call(personId, "/api/holds", { method: "POST", body }, now, record);
  const hold = await held.json<{ id: string; expires_at: string }>();
  const started = await call(personId, "/api/bookings", { method: "POST", body: { hold_id: hold.id } }, now, record);
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

/**
 * What FSM's queue does with the holds sent to it: each booked with the stub FSM, as the consumer would. On our own
 * record nothing is queued: the request that confirmed the hold booked it.
 */
async function drain(queue: { sent: unknown[] }, now: Date, payments: PaymentsProvider = createStubPayments()) {
  for (const sent of queue.sent as { hold_id: string }[]) {
    await confirmBooking(env.DB, createStubFsm(world()), payments, sent.hold_id, now, { labelAsTest: true });
  }
}

const scheduledServiceVisits = (personId: string) =>
  env.DB.prepare("SELECT id FROM appointments WHERE person_id = ?1 AND type = 'service' AND status = 'scheduled'")
    .bind(personId)
    .all();

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  cookies.clear();
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'resource-1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
  await fittedPerson(PERSON, "+919810000001", "Rohit Malhotra");
});

describe.each(RECORDS)("a payment made inside the hold whose webhook lands after it (W1), on %s's record", (record) => {
  it("is booked, judged on Razorpay's time for the payment, not on when the webhook came", async () => {
    const ordered = await heldAndOrdered(PERSON, NOW, "2026-09-24", "afternoon", record);
    const payments = createStubPayments();
    const queue = fakeQueue();
    // Paid at 9 minutes 50 seconds; the webhook reaches us at 10 minutes 5.
    await webhook("payment.captured", "evt_w1", payment("pay_w1", ordered, at(590)), at(605), queue, {
      record,
      payments,
    });
    await drain(queue, at(606), payments);
    expect(await holdRow(ordered.holdId)).toEqual({ state: "booked", refunded_at: null });
    expect(payments.made.refunds).toEqual([]);
  });

  it("is still refunded when Razorpay's own time for it is past the hold and the two minutes' grace", async () => {
    const ordered = await heldAndOrdered(PERSON, NOW, "2026-09-24", "afternoon", record);
    const payments = createStubPayments();
    const queue = fakeQueue();
    await webhook("payment.captured", "evt_w1b", payment("pay_w1b", ordered, at(725)), at(726), queue, {
      record,
      payments,
    });
    await drain(queue, at(727), payments);
    expect((await holdRow(ordered.holdId))?.state).toBe("released");
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_w1b", amount: 200000 }]);
  });
});

// A payment may land on a hold's order until its grace ends, so until then neither the app's lapse nor the client's
// next hold lets that hold go (MON-03, BK-03).
describe.each(RECORDS)("a hold with a Razorpay order, let go before its grace ends, on %s's record", (record) => {
  const letGo = (holdId: string, now: Date) => call(PERSON, `/api/holds/${holdId}`, { method: "DELETE" }, now, record);

  /** The webhook of a payment made at `madeAt`, heard of at `heardAt`, and the booking it leads to. */
  async function paidAndBooked(ordered: Awaited<ReturnType<typeof heldAndOrdered>>, madeAt: Date, heardAt: Date) {
    const payments = createStubPayments();
    const queue = fakeQueue();
    const id = `pay_${String(madeAt.getTime())}`;
    await webhook("payment.captured", `evt_${id}`, payment(id, ordered, madeAt), heardAt, queue, { record, payments });
    await drain(queue, new Date(heardAt.getTime() + SECOND), payments);
    return payments;
  }

  it("is booked when the app lets it go at ten minutes and the payment is made in the grace", async () => {
    const ordered = await heldAndOrdered(PERSON, NOW, "2026-09-24", "afternoon", record);
    expect((await letGo(ordered.holdId, at(600))).status).toBe(204);
    expect(await holdRow(ordered.holdId)).toEqual({ state: "held", refunded_at: null });
    const payments = await paidAndBooked(ordered, at(630), at(635));
    expect(await holdRow(ordered.holdId)).toEqual({ state: "booked", refunded_at: null });
    expect(payments.made.refunds).toEqual([]);
  });

  it("is booked when the app lets it go at ten minutes before the webhook of a payment made in them", async () => {
    const ordered = await heldAndOrdered(PERSON, NOW, "2026-09-24", "afternoon", record);
    await letGo(ordered.holdId, at(600));
    const payments = await paidAndBooked(ordered, at(590), at(605));
    expect(await holdRow(ordered.holdId)).toEqual({ state: "booked", refunded_at: null });
    expect(payments.made.refunds).toEqual([]);
  });

  it("keeps its time when its client lets it go mid-countdown, or holds another window", async () => {
    const ordered = await heldAndOrdered(PERSON, NOW, "2026-09-24", "afternoon", record);
    await letGo(ordered.holdId, at(300));
    const another = await call(
      PERSON,
      "/api/holds",
      { method: "POST", body: { type: "service", date: "2026-09-30", window: "morning" } },
      at(310),
      record,
    );
    expect(another.status).toBe(201);
    expect(await holdRow(ordered.holdId)).toEqual({ state: "held", refunded_at: null });
  });

  it("is let go once its grace has ended", async () => {
    const ordered = await heldAndOrdered(PERSON, NOW, "2026-09-24", "afternoon", record);
    await letGo(ordered.holdId, at(719));
    expect(await holdRow(ordered.holdId)).toEqual({ state: "held", refunded_at: null });
    await letGo(ordered.holdId, at(720));
    expect(await holdRow(ordered.holdId)).toEqual({ state: "released", refunded_at: null });
  });
});

// A payment made in time whose webhook lands only after the hold was let go at the end of its grace (MON-03).
describe.each(RECORDS)("a payment made in time, heard of after its hold was let go, on %s's record", (record) => {
  const otherHolds = async (date: string, window: string) => {
    await fittedPerson(OTHER, "+919810000005", "Karan Bhatia");
    return call(OTHER, "/api/holds", { method: "POST", body: { type: "service", date, window } }, at(730), record);
  };

  /** The webhook of a payment made at nine and a half minutes, heard of at `heardAt`, and what follows it. */
  async function heardLate(ordered: Awaited<ReturnType<typeof heldAndOrdered>>, eventId: string, heardAt: Date) {
    const payments = createStubPayments();
    const queue = fakeQueue();
    const id = `pay_${eventId}`;
    await webhook("payment.captured", eventId, payment(id, ordered, at(570)), heardAt, queue, { record, payments });
    await drain(queue, new Date(heardAt.getTime() + SECOND), payments);
    return { payments, id };
  }

  it("is booked on its own time, taken back, when nobody has taken that since", async () => {
    const ordered = await heldAndOrdered(PERSON, NOW, "2026-09-24", "afternoon", record);
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
    const ordered = await heldAndOrdered(PERSON, NOW, "2026-09-24", "afternoon", record);
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
    const ordered = await heldAndOrdered(PERSON, NOW, "2026-09-24", "afternoon", record);
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
describe.each(RECORDS)("a payment made in the grace its hold was made with, on %s's record", (record) => {
  const grace = (minutes: number) =>
    env.DB.prepare(
      "INSERT OR REPLACE INTO ops_settings (name, value, set_by, set_at) VALUES ('payment_hold', ?1, 'ops', ?2)",
    )
      .bind(JSON.stringify({ countdown: 10, grace: minutes }), NOW.toISOString())
      .run();

  it("is booked, though ops shortened the grace after the hold was made", async () => {
    await grace(5);
    const ordered = await heldAndOrdered(PERSON, NOW, "2026-09-24", "afternoon", record);
    await grace(1);
    const payments = createStubPayments();
    const queue = fakeQueue();
    // Paid at 14 minutes: past a minute's grace, inside the five the hold was made with.
    await webhook("payment.captured", "evt_g1", payment("pay_g1", ordered, at(840)), at(841), queue, {
      record,
      payments,
    });
    await drain(queue, at(842), payments);
    expect(await holdRow(ordered.holdId)).toEqual({ state: "booked", refunded_at: null });
    expect(payments.made.refunds).toEqual([]);
  });
});

describe("a paid hold whose booking FSM refused once (W2)", () => {
  it("keeps its time when another client holds after its ten minutes, and is booked on the retry", async () => {
    await fittedPerson(OTHER, "+919810000005", "Karan Bhatia");
    const ordered = await heldAndOrdered(PERSON);
    await webhook("payment.captured", "evt_w2", payment("pay_w2", ordered, at(299)), at(300));
    const fsm = createStubFsm(world());
    fsm.failNext("createWorkOrder", "Zoho 400 Access Denied: could not refresh the access token");
    await expect(
      confirmBooking(env.DB, fsm, createStubPayments(), ordered.holdId, at(301), { labelAsTest: true }),
    ).rejects.toThrow();

    // Another client holds after the tenth minute: a different day, and then the same window.
    expect(
      (
        await call(
          OTHER,
          "/api/holds",
          { method: "POST", body: { type: "service", date: "2026-09-30", window: "morning" } },
          at(660),
        )
      ).status,
    ).toBe(201);
    expect(await holdRow(ordered.holdId)).toEqual({ state: "held", refunded_at: null });
    const same = await call(
      OTHER,
      "/api/holds",
      { method: "POST", body: { type: "service", date: "2026-09-24", window: "afternoon" } },
      at(665),
    );
    expect(same.status).toBe(409);

    const payments = createStubPayments();
    expect(await confirmBooking(env.DB, fsm, payments, ordered.holdId, at(700), { labelAsTest: true })).toBe("booked");
    expect(payments.made.refunds).toEqual([]);
  });

  it("cannot be let go by the client once paid, and says it is paid rather than expired", async () => {
    const ordered = await heldAndOrdered(PERSON);
    await webhook("payment.captured", "evt_w2b", payment("pay_w2b", ordered, at(30)), at(31));
    await call(PERSON, `/api/holds/${ordered.holdId}`, { method: "DELETE" }, at(40));
    expect(await holdRow(ordered.holdId)).toEqual({ state: "held", refunded_at: null });
    const view = await (await call(PERSON, `/api/holds/${ordered.holdId}`, {}, at(700))).json();
    expect(view).toMatchObject({ state: "held", paid: true });
  });
});

describe("the public form, with a client's number, while that client's hold is paid (W3)", () => {
  it("neither lets the hold go nor renames the client", async () => {
    await env.DB.prepare(
      "INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at) VALUES ('122018', 'South City II', 'Gurgaon', 1, '2026-09-01T18:30:00.000Z')",
    ).run();
    const ordered = await heldAndOrdered(PERSON);
    await webhook("payment.captured", "evt_w3", payment("pay_w3", ordered, at(59)), at(60));
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
      { FSM_QUEUE: fakeQueue(), CRM_QUEUE: fakeQueue() },
    );
    expect(await holdRow(ordered.holdId)).toEqual({ state: "held", refunded_at: null });
    expect(await env.DB.prepare("SELECT name FROM people WHERE id = ?1").bind(PERSON).first()).toEqual({
      name: "Rohit Malhotra",
    });
    const payments = createStubPayments();
    expect(
      await confirmBooking(env.DB, createStubFsm(world()), payments, ordered.holdId, at(75), { labelAsTest: true }),
    ).toBe("booked");
    expect(payments.made.refunds).toEqual([]);
  });
});

/** A paid service visit tomorrow at 12:00 in India: exactly 24 hours away, so moving it is late. */
async function lateServiceVisit() {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, status, fsm_status, window_start,
       window_end, technician_id, fsm_modified_at, synced_at)
     VALUES (?1, 'fsm-v1', 'wo-v1', ?2, 'service', 'scheduled', 'Scheduled', '2026-09-22T06:30:00.000Z',
       '2026-09-22T08:00:00.000Z', 't1', ?3, ?3)`,
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
async function replacementHold(record: FieldRecord = "fsm"): Promise<string> {
  const body = { type: "service", date: "2026-09-24", window: "afternoon", moving: OLD_VISIT };
  const hold = await (await call(PERSON, "/api/holds", { method: "POST", body }, NOW, record)).json<{ id: string }>();
  const move = { method: "POST", body: { hold_id: hold.id } };
  await call(PERSON, `/api/appointments/${OLD_VISIT}/reschedule`, move, NOW, record);
  return hold.id;
}

const oldVisitStatus = () => env.DB.prepare("SELECT status FROM appointments WHERE id = ?1").bind(OLD_VISIT).first();

describe("a credit-covered move inside 24 hours whose old work order FSM fails to cancel once (W4)", () => {
  it("spends the credit and tells the client, even though the cancel only lands on the retry", async () => {
    await lateServiceVisit();
    await grantCredits(env.DB, { personId: PERSON, visits: 1, source: "ops", sourceId: "o1", now: NOW }).run();
    const holdId = await replacementHold();

    let cancels = 0;
    const stub = createStubFsm(world());
    const flaky: FsmProvider = {
      ...stub,
      cancelVisit: (workOrderId, note) => {
        cancels += 1;
        return cancels === 1
          ? Promise.reject(new Error("Zoho 500 INTERNAL_ERROR"))
          : stub.cancelVisit(workOrderId, note);
      },
    };
    await expect(
      confirmBooking(env.DB, flaky, createStubPayments(), holdId, at(5), { labelAsTest: true }),
    ).rejects.toThrow();
    expect(await confirmBooking(env.DB, flaky, createStubPayments(), holdId, at(40), { labelAsTest: true })).toBe(
      "already_booked",
    );

    const redeemed = await env.DB.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'redeem'").first();
    expect(redeemed).toEqual({ n: 1 });
    expect((await creditBalance(env.DB, PERSON, at(60))).visits).toBe(0);
    const told = await env.DB.prepare("SELECT kind FROM outbound_messages WHERE person_id = ?1").bind(PERSON).all();
    expect(told.results).toEqual([{ kind: "reschedule_confirmation" }]);
    expect(await oldVisitStatus()).toEqual({ status: "cancelled" });
  });

  // INT-10's leftover (the audit, 24 September 2026): a refused cancel was taken for a cancel.
  it("leaves the old visit as FSM has it, and tells ops, when FSM will not cancel its work order", async () => {
    await lateServiceVisit();
    const holdId = await replacementHold();
    const refusing: FsmProvider = { ...createStubFsm(world()), cancelVisit: () => Promise.resolve(false) };
    const deps = fakeDependencies();
    const ordered = await env.DB.prepare("SELECT razorpay_order_id AS id FROM slot_holds WHERE id = ?1")
      .bind(holdId)
      .first<{ id: string }>();
    await webhook(
      "payment.captured",
      "evt_r1",
      payment("pay_r1", { holdId, orderId: ordered?.id ?? "", amount: 200000 }, at(20)),
      at(21),
    );
    const outcome = await confirmBooking(env.DB, refusing, createStubPayments(), holdId, at(30), {
      labelAsTest: true,
      alertOnce: deps.alertOnce,
    });
    expect(outcome).toBe("booked");
    expect(await oldVisitStatus()).toEqual({ status: "scheduled" });
    expect(deps.alerts).toEqual([expect.stringMatching(/would not cancel its work order wo-v1.*\/clients\//)]);
    const replaced = await env.DB.prepare("SELECT COUNT(*) AS n FROM visit_changes WHERE kind = 'replaced'").first();
    expect(replaced).toEqual({ n: 0 });
  });
});

describe("a credit-covered move inside 24 hours, on our own record (W4)", () => {
  it("spends the credit once, tells the client once, and cancels the old visit without FSM", async () => {
    await lateServiceVisit();
    await grantCredits(env.DB, { personId: PERSON, visits: 1, source: "ops", sourceId: "o1", now: NOW }).run();

    // The move confirmed it free, on the credit, so the request that confirmed it booked it.
    const holdId = await replacementHold("ours");
    const again = await confirmBooking(env.DB, fsmSwitchedOff(), createStubPayments(), holdId, at(40), {
      labelAsTest: true,
      record: "ours",
    });

    expect(again).toBe("already_booked");
    const redeemed = await env.DB.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'redeem'").first();
    expect(redeemed).toEqual({ n: 1 });
    expect((await creditBalance(env.DB, PERSON, at(60))).visits).toBe(0);
    const told = await env.DB.prepare("SELECT kind FROM outbound_messages WHERE person_id = ?1").bind(PERSON).all();
    expect(told.results).toEqual([{ kind: "reschedule_confirmation" }]);
    expect(await oldVisitStatus()).toEqual({ status: "cancelled" });
  });
});

describe.each(RECORDS)("order.paid and payment.captured for one payment (W9), on %s's record", (record) => {
  it("books the visit once, on the capture", async () => {
    const ordered = await heldAndOrdered(PERSON, NOW, "2026-09-24", "afternoon", record);
    const queue = fakeQueue();
    await webhook("payment.captured", "evt_w9a", payment("pay_w9", ordered, at(30)), at(31), queue, { record });
    await webhook("order.paid", "evt_w9b", payment("pay_w9", ordered, at(30)), at(31), queue, { record });
    expect(queue.sent.length).toBeLessThanOrEqual(1);
    await drain(queue, at(40));
    expect((await scheduledServiceVisits(PERSON)).results).toHaveLength(1);
  });
});

// W10 was a fifth refusal whose refund Razorpay refused, escaping the handler. The fifth refusal refunds nothing now
// (docs/decisions/0095-a-booking-fsm-refuses-is-held.md); what W10 found still holds of it.
describe("FSM refuses five times (W10)", () => {
  it("holds the booking for ops, acknowledges the message, and goes on to the next", async () => {
    const ordered = await heldAndOrdered(PERSON);
    await webhook("payment.captured", "evt_w10", payment("pay_w10", ordered, at(30)), at(31));
    const payments = createStubPayments();
    const deps = fakeDependencies({
      now: () => at(500),
      fsm: { ...createStubFsm(world()), createWorkOrder: () => Promise.reject(new Error("Zoho 400 INVALID_DATA")) },
      payments,
    });
    const first = {
      id: "m1",
      body: { hold_id: ordered.holdId, request_id: "r1" },
      attempts: 5,
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const second = {
      id: "m2",
      body: { erase_person_id: "nobody-erased", request_id: "r2" },
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const batch = { queue: "mm-fsm-sync-local", messages: [first, second], ackAll: vi.fn(), retryAll: vi.fn() };

    await handleFsmSyncBatch(batch as unknown as MessageBatch, env, deps, createLogger());

    expect(first.ack).toHaveBeenCalled();
    expect(second.ack).toHaveBeenCalled();
    expect(payments.made.refunds).toEqual([]);
    expect(deps.alerts).toEqual([expect.stringMatching(/Nothing is refunded/)]);
    expect(await holdRow(ordered.holdId)).toEqual({ state: "held", refunded_at: null });
  });
});

/** A service visit held, ordered and paid for at 30 seconds, waiting for the queue. */
async function paidHold(paymentId: string) {
  const ordered = await heldAndOrdered(PERSON);
  await webhook("payment.captured", `evt_${paymentId}`, payment(paymentId, ordered, at(30)), at(31));
  return ordered;
}

const booking = (fsm: FsmProvider, holdId: string, seconds: number, payments = createStubPayments()) =>
  confirmBooking(env.DB, fsm, payments, holdId, at(seconds), { labelAsTest: true });

/** The queue's message for a hold, on its fifth and last try. */
function lastTry(holdId: string) {
  const message = { id: "m1", body: { hold_id: holdId, request_id: "r1" }, attempts: 5, ack: vi.fn(), retry: vi.fn() };
  const batch = { queue: "mm-fsm-sync-local", messages: [message], ackAll: vi.fn(), retryAll: vi.fn() };
  return { batch: batch as unknown as MessageBatch, message };
}

describe("booking in FSM when an answer never comes back (INT-01, BIZ-05)", () => {
  it("finds the work order FSM made on the first try, and makes no second one", async () => {
    const { holdId } = await paidHold("pay_i1");
    const fsm = createStubFsm(world());
    fsm.loseAnswer("createWorkOrder");
    await expect(booking(fsm, holdId, 40)).rejects.toThrow();
    expect(await booking(fsm, holdId, 80)).toBe("booked");
    expect(fsm.made.workOrders).toHaveLength(1);
    expect(fsm.made.visits).toHaveLength(1);
  });

  it("finds the appointment FSM made on the first try, and makes no second one", async () => {
    const { holdId } = await paidHold("pay_i2");
    const fsm = createStubFsm(world());
    fsm.loseAnswer("createAppointment");
    await expect(booking(fsm, holdId, 40)).rejects.toThrow();
    expect(await booking(fsm, holdId, 80)).toBe("booked");
    expect(fsm.made.workOrders).toHaveLength(1);
    expect(fsm.made.visits).toHaveLength(1);
  });

  it("keeps the work order's ID the moment FSM gives it, and reuses it when the appointment fails", async () => {
    const { holdId } = await paidHold("pay_i3");
    const fsm = createStubFsm(world());
    fsm.failNext("createAppointment", "Zoho 500 INTERNAL_ERROR");
    await expect(booking(fsm, holdId, 40)).rejects.toThrow();
    const kept = await env.DB.prepare("SELECT fsm_work_order_id FROM slot_holds WHERE id = ?1").bind(holdId).first();
    expect(kept).toEqual({ fsm_work_order_id: expect.stringMatching(/^stub-work-order-/) as string });
    expect(await booking(fsm, holdId, 80)).toBe("booked");
    expect(fsm.made.workOrders).toHaveLength(1);
    const visit = await env.DB.prepare(
      "SELECT fsm_work_order_id FROM appointments WHERE person_id = ?1 AND type = 'service'",
    )
      .bind(PERSON)
      .first();
    expect(visit).toEqual(kept);
  });

  it("books a hold once when two consumers take it at the same moment", async () => {
    const { holdId } = await paidHold("pay_i4");
    const fsm = createStubFsm(world());
    const both = await Promise.all([booking(fsm, holdId, 40), booking(fsm, holdId, 40)]);
    expect(both).toContain("booked");
    expect(fsm.made.visits).toHaveLength(1);
  });

  it("waits for a consumer still writing the hold, and never gives it up or refunds it for that", async () => {
    const { holdId } = await paidHold("pay_i5");
    await env.DB.prepare("UPDATE slot_holds SET booking_until = ?2 WHERE id = ?1")
      .bind(holdId, at(200).toISOString())
      .run();
    const payments = createStubPayments();
    const deps = fakeDependencies({ now: () => at(60), fsm: createStubFsm(world()), payments });
    const early = lastTry(holdId);
    early.message.attempts = 1;
    await handleFsmSyncBatch(early.batch, env, deps, createLogger());
    expect(early.message.retry).toHaveBeenCalled();

    const last = lastTry(holdId);
    await handleFsmSyncBatch(last.batch, env, deps, createLogger());
    expect(last.message.ack).toHaveBeenCalled();
    expect(payments.made.refunds).toEqual([]);
    expect(deps.alerts).toEqual([]);
    expect(await holdRow(holdId)).toEqual({ state: "held", refunded_at: null });
  });
});

// Giving up on a booking FSM would not finish (BIZ-06, INT-02) is ops' refund now, from the console, and
// test/worker/held-bookings.test.ts holds it to the same: the work order cancelled, the payment refunded, and what
// happened to each said, or nothing refunded for a visit a credit paid for.

describe("the half-hour pass over paid holds (BIZ-06)", () => {
  const pass = (queue: Queue, seconds: number, deps = fakeDependencies(), budget = createCallBudget(40)) =>
    requeueUnbookedHolds(env.DB, { queue, alertOnce: deps.alertOnce, budget, log: createLogger() }, at(seconds));

  it("puts back on the queue, and tells ops once of, a paid hold neither booked nor refunded half an hour on", async () => {
    const { holdId } = await paidHold("pay_s1");
    const queue = fakeQueue();
    const deps = fakeDependencies();
    expect(await pass(queue, 29 * 60, deps)).toBe(0);
    expect(await pass(queue, 32 * 60, deps)).toBe(1);
    expect(queue.sent).toEqual([{ hold_id: holdId, request_id: "unbooked-holds" }]);
    expect(deps.alerts).toEqual([expect.stringMatching(new RegExp(`${holdId}.*/clients/${PERSON}`))]);
    // Put back once, it waits another half hour; put back again, ops are not told twice.
    expect(await pass(queue, 40 * 60, deps)).toBe(0);
    expect(await pass(queue, 63 * 60, deps)).toBe(1);
    expect(deps.alerts).toHaveLength(1);
  });

  it("leaves alone a hold that is booked, or was never paid for", async () => {
    const paid = await paidHold("pay_s2");
    await booking(createStubFsm(world()), paid.holdId, 40);
    await fittedPerson(OTHER, "+919810000005", "Karan Bhatia");
    await heldAndOrdered(OTHER, NOW, "2026-09-25");
    expect(await pass(fakeQueue(), 60 * 60)).toBe(0);
  });

  it("stops when the run's calls are spent, and leaves the rest for the next run", async () => {
    const { holdId } = await paidHold("pay_s3");
    const spent = createCallBudget(0);
    expect(await pass(fakeQueue(), 32 * 60, fakeDependencies(), spent)).toBe(0);
    expect(spent.ranOut()).toBe(true);
    const queue = fakeQueue();
    expect(await pass(queue, 37 * 60)).toBe(1);
    expect(queue.sent).toEqual([{ hold_id: holdId, request_id: "unbooked-holds" }]);
  });
});

describe.each(RECORDS)("GST once a price carries it (W7, BIZ-07), on %s's record", (record) => {
  it("shows the Payments tab the figure before GST, and the rate, that the hold charged", async () => {
    await env.DB.prepare(
      "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES ('service', 'standard', 200000, 18, '2026-09-23')",
    ).run();
    const ordered = await heldAndOrdered(PERSON, NOW, "2026-09-24", "afternoon", record);
    expect(ordered.amount).toBe(236000);
    await webhook("payment.captured", "evt_w7", payment("pay_w7", ordered, at(30)), at(31), fakeQueue(), { record });
    const { entries } = await (
      await call(PERSON, "/api/payments", {}, at(60), record)
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

describe("where a visit booked from the site is (LIFE-04, CLI-14)", () => {
  it("carries the pincode booked at onto the visit, and onto the contact FSM is given", async () => {
    await env.DB.prepare(
      "INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at) VALUES ('122018', 'South City II', 'Gurgaon', 1, '2026-09-01T18:30:00.000Z')",
    ).run();
    const site = appFor("local", fakeDependencies(), {}, "public");
    const queue = fakeQueue();
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
      { FSM_QUEUE: queue, CRM_QUEUE: fakeQueue() },
    );
    expect(answer.status).toBe(201);
    const [queued] = queue.sent as { hold_id: string }[];
    const fsm = createStubFsm(world());
    expect(await booking(fsm, queued?.hold_id ?? "", 5)).toBe("booked");
    expect(fsm.made.contacts).toMatchObject([{ city: "Gurgaon", pincode: "122018", lastName: "Kapoor" }]);
    const visit = await env.DB.prepare(
      "SELECT service_city, service_pincode FROM appointments WHERE type = 'consultation'",
    ).first();
    expect(visit).toEqual({ service_city: "Gurgaon", service_pincode: "122018" });
  });
});
