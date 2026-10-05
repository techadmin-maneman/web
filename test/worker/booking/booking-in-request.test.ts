// Booking, moving and cancelling: each is written in the request that makes it. NOW is Monday 21 September 2026, 12 noon
// in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { autoRefundsOf } from "../../../src/domain/auto-refunds.ts";
import { bookUnbookedHolds, confirmBooking, giveBack } from "../../../src/domain/bookings.ts";
import { clawBack, creditBalance, grantCredits, redeemCredit } from "../../../src/domain/credits.ts";
import { openSession } from "../../../src/domain/sessions.ts";
import { settleOwedRefunds } from "../../../src/domain/cancel-refunds.ts";
import { moveJob } from "../../../src/domain/dispatch.ts";
import {
  cancelVisit,
  changeableVisit,
  changeTerms,
  opsCancelTerms,
  termsInForce,
  type OpsCancel,
} from "../../../src/domain/visit-changes.ts";
import { readOpsInputs } from "../../../src/domain/ops-settings.ts";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import { type PaymentsProvider } from "../../../src/providers/payments/index.ts";
import { createStubPayments } from "../../../src/providers/payments/stub.ts";
import { PaymentUnanswered } from "../../../src/providers/provider-error.ts";
import { CRON_JOBS, runCronJobs } from "../../../src/scheduled/cron.ts";
import { outstandingTasks } from "../../../src/domain/tasks.ts";
import { TASK_SLA_HOURS } from "../../../src/policy/tasks.ts";
import {
  appFor,
  captureLogs,
  failingAfterTheFirstBatch,
  fakeDependencies,
  fakeQueue,
  LOCAL_CONFIG,
  markDatabase,
  NOW,
  request,
  savedAddress,
  type TestDependencies,
  deliverRazorpay,
} from "../helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const NEWCOMER = "55555555-5555-4555-8555-555555555555";
const VISIT = "22222222-2222-4222-8222-222222222222";
const PAYMENT = "33333333-3333-4333-8333-333333333333";
const SECRET = "a-razorpay-webhook-secret-for-bookings";

/** Thursday 24 September, afternoon: free to change until Wednesday noon. */
const THURSDAY_NOON = "2026-09-24T06:30:00.000Z";
/** Tuesday 22 September, morning: inside 24 hours from NOW. */
const TUESDAY_MORNING = "2026-09-22T03:30:00.000Z";

const SECOND = 1000;
const at = (seconds: number) => new Date(NOW.getTime() + seconds * SECOND);

const cookies = new Map<string, string>();
let messageQueue: ReturnType<typeof fakeQueue>;

const bindings = () => ({ MESSAGE_QUEUE: messageQueue, CRM_QUEUE: fakeQueue() });

function call(
  personId: string,
  path: string,
  init: { method?: string; body?: object } = {},
  deps: TestDependencies = fakeDependencies(),
  database: D1Database = env.DB,
) {
  const app = appFor("local", deps, {}, "client");
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
    { ...bindings(), DB: database },
  );
}

/** Razorpay's signed webhook for a payment. */
async function webhook(event: string, eventId: string, payment: object, deps: TestDependencies = fakeDependencies()) {
  const answer = await deliverRazorpay(
    { entity: "event", event, payload: { payment: { entity: payment } } },
    {
      eventId,
      deps,
      settings: { razorpay: { keyId: "rzp_test_ours", keySecret: "s", webhookSecret: SECRET } },
      bindings: bindings(),
    },
  );
  return answer.status;
}

/** Razorpay's payment entity for an order of ours, made at `madeAt`. */
const payment = (id: string, ordered: { holdId: string; orderId: string; amount: number }, madeAt = at(30)) => ({
  id,
  amount: ordered.amount,
  currency: "INR",
  status: "captured",
  order_id: ordered.orderId,
  method: "upi",
  notes: { hold_id: ordered.holdId, person_id: PERSON },
  created_at: Math.floor(madeAt.getTime() / SECOND),
});

async function client(id: string, mobile: string, name: string) {
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)")
    .bind(id, NOW.toISOString(), mobile, name)
    .run();
  await savedAddress(id);
  cookies.set(
    id,
    `mm_app=${await openSession(env.DB, { kind: "client", subjectId: id, deviceLabel: null, now: NOW })}`,
  );
}

/** A client fitted in August, so a service visit is theirs to book. */
async function fittedClient() {
  await client(PERSON, "+919810000001", "Rohit Malhotra");
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id, synced_at)
     VALUES ('fit-1', 'fit-1', ?1, 'first_fit', 'completed', '2026-08-01T03:30:00.000Z', '2026-08-01T06:30:00.000Z',
       't1', ?2)`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
}

/** A paid visit with Imran, a service visit unless `type` says. */
async function booked(start: string, type = "service") {
  const minutes = type === "first_fit" ? 180 : 90;
  const end = new Date(new Date(start).getTime() + minutes * 60_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, tier, status, window_start, window_end, technician_id,
       synced_at)
     VALUES (?1, ?1, ?2, ?3, 'standard', 'scheduled', ?4, ?5, 't1', ?6)`,
  )
    .bind(VISIT, PERSON, type, start, end, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO payments (id, person_id, appointment_id, razorpay_payment_id, amount, currency, method, status,
       captured_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'pay_visit', 200000, 'INR', 'upi', 'captured', ?4, ?4, ?4)`,
  )
    .bind(PAYMENT, PERSON, VISIT, "2026-09-20T06:30:00.000Z")
    .run();
}

/** A hold for a service visit, and the Razorpay order the app opens Checkout with. */
async function heldAndOrdered(body: object = { type: "service", date: "2026-09-24", window: "afternoon" }) {
  const held = await call(PERSON, "/api/holds", { method: "POST", body });
  expect(held.status).toBe(201);
  const hold = await held.json<{ id: string }>();
  const started = await call(PERSON, "/api/bookings", { method: "POST", body: { hold_id: hold.id } });
  const checkout = (await started.json<{ checkout: { order_id: string; amount: number } | null }>()).checkout;
  return { holdId: hold.id, orderId: checkout?.order_id ?? "", amount: checkout?.amount ?? 0 };
}

async function moveHold(date: string, window: string, type = "service") {
  const answer = await call(PERSON, "/api/holds", { method: "POST", body: { type, date, window, moving: VISIT } });
  expect(answer.status).toBe(201);
  return (await answer.json<{ id: string }>()).id;
}

const holdRow = (id: string) =>
  env.DB.prepare("SELECT state, appointment_id FROM slot_holds WHERE id = ?1")
    .bind(id)
    .first<{ state: string; appointment_id: string | null }>();

const visitOf = (id: string | null | undefined) =>
  env.DB.prepare(
    `SELECT status, type, tier, technician_id, window_start, window_end, service_city, service_pincode,
       asked_checked_at
     FROM appointments WHERE id = ?1`,
  )
    .bind(id ?? "")
    .first();

const visitsOf = (personId: string, type: string) =>
  env.DB.prepare("SELECT id, status FROM appointments WHERE person_id = ?1 AND type = ?2 ORDER BY window_start")
    .bind(personId, type)
    .all<{ id: string; status: string }>();

const messagesOf = (personId: string) =>
  env.DB.prepare("SELECT kind, subject_id FROM outbound_messages WHERE person_id = ?1 ORDER BY created_at")
    .bind(personId)
    .all<{ kind: string; subject_id: string }>();

const changes = () =>
  env.DB.prepare(
    "SELECT appointment_id, kind, notice, refund_amount, kept_amount, payment_id FROM visit_changes ORDER BY created_at",
  ).all();

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  cookies.clear();
  messageQueue = fakeQueue();
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
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
    await client(NEWCOMER, "+919810000005", "Karan Bhatia");
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

describe("a visit moved by the client", () => {
  it("moves it in place for free, in the request that confirms the move", async () => {
    await fittedClient();
    await booked(THURSDAY_NOON);
    const holdId = await moveHold("2026-09-25", "evening");

    const started = await call(PERSON, `/api/appointments/${VISIT}/reschedule`, {
      method: "POST",
      body: { hold_id: holdId },
    });
    expect(await started.json()).toEqual({ hold_id: holdId, checkout: null });

    expect(await visitOf(VISIT)).toMatchObject({
      status: "scheduled",
      window_start: "2026-09-25T10:30:00.000Z",
      window_end: "2026-09-25T12:00:00.000Z",
    });
    expect(await holdRow(holdId)).toEqual({ state: "booked", appointment_id: VISIT });
    expect((await changes()).results).toEqual([
      { appointment_id: VISIT, kind: "moved", notice: "free", refund_amount: 0, kept_amount: 0, payment_id: null },
    ]);
    expect((await messagesOf(PERSON)).results).toEqual([{ kind: "reschedule_confirmation", subject_id: VISIT }]);
  });

  it("books a new visit for a late move once paid, and cancels and charges the old one", async () => {
    await fittedClient();
    await booked(TUESDAY_MORNING);
    const holdId = await moveHold("2026-09-26", "afternoon");
    const started = await call(PERSON, `/api/appointments/${VISIT}/reschedule`, {
      method: "POST",
      body: { hold_id: holdId },
    });
    const { checkout } = await started.json<{ checkout: { order_id: string; amount: number } }>();
    expect(checkout.amount).toBe(200000);

    const ordered = { holdId, orderId: checkout.order_id, amount: checkout.amount };
    await webhook("payment.captured", "evt_move", payment("pay_new", ordered));

    const [old, replacement] = (await visitsOf(PERSON, "service")).results;
    expect(old).toEqual({ id: VISIT, status: "cancelled" });
    expect(replacement?.status).toBe("scheduled");
    expect((await changes()).results).toEqual([
      {
        appointment_id: VISIT,
        kind: "replaced",
        notice: "late",
        refund_amount: 0,
        kept_amount: 200000,
        payment_id: PAYMENT,
      },
    ]);
  });
});

describe("a client's move in place, when ops change the visit before it is booked", () => {
  const OPS = {};

  /** Ops giving the visit to Sameer on the dispatch board, at the time it has. */
  const toSameer = (startsAt: string) => ({
    appointmentId: VISIT,
    technicianId: "t2",
    reason: "zone_rebalance" as const,
    actor: "ops@maneman.test",
    expected: { technicianId: "t1", startsAt },
  });

  const confirm = (holdId: string) =>
    env.DB.prepare("UPDATE slot_holds SET confirmed_at = ?2 WHERE id = ?1").bind(holdId, NOW.toISOString()).run();

  const countOf = async (table: string) =>
    (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n;

  beforeEach(async () => {
    await env.DB.prepare(
      "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t2', 't2', 'Sameer Bhatt', 'SB', 1, ?1)",
    )
      .bind(NOW.toISOString())
      .run();
  });

  it("gives a free move back and tells the client when ops gave the visit to another technician meanwhile", async () => {
    await fittedClient();
    await booked(THURSDAY_NOON);
    const holdId = await moveHold("2026-09-25", "evening");
    expect(await moveJob(env.DB, OPS, toSameer(THURSDAY_NOON), NOW)).toMatchObject({ kind: "moved" });

    await call(PERSON, `/api/appointments/${VISIT}/reschedule`, { method: "POST", body: { hold_id: holdId } });

    expect(await visitOf(VISIT)).toMatchObject({ technician_id: "t2", window_start: THURSDAY_NOON });
    expect(await holdRow(holdId)).toEqual({ state: "released", appointment_id: null });
    expect((await changes()).results).toEqual([]);
    expect((await messagesOf(PERSON)).results).toEqual([{ kind: "booking_refunded", subject_id: holdId }]);
    expect(messageQueue.sent).toHaveLength(1);
    expect(await countOf("slot_claims")).toBe(0);
  });

  it("refunds a late fee paid after ops gave the visit to another technician, and tells the client", async () => {
    await client(PERSON, "+919810000001", "Rohit Malhotra");
    await booked(TUESDAY_MORNING, "first_fit");
    const holdId = await moveHold("2026-09-28", "morning", "first_fit");
    const started = await call(PERSON, `/api/appointments/${VISIT}/reschedule`, {
      method: "POST",
      body: { hold_id: holdId },
    });
    const { checkout } = await started.json<{ checkout: { order_id: string; amount: number } }>();
    expect(checkout.amount).toBe(400000);
    expect(await moveJob(env.DB, OPS, toSameer(TUESDAY_MORNING), NOW)).toMatchObject({ kind: "moved" });
    const payments = createStubPayments();

    const ordered = { holdId, orderId: checkout.order_id, amount: checkout.amount };
    await webhook("payment.captured", "evt_fee", payment("pay_fee", ordered), fakeDependencies({ payments }));

    expect(payments.made.refunds).toEqual([{ paymentId: "pay_fee", amount: 400000 }]);
    expect(await visitOf(VISIT)).toMatchObject({ technician_id: "t2", window_start: TUESDAY_MORNING });
    expect(await holdRow(holdId)).toEqual({ state: "released", appointment_id: null });
    expect((await changes()).results).toEqual([]);
    expect((await messagesOf(PERSON)).results).toEqual([{ kind: "booking_refunded", subject_id: holdId }]);
    expect(await autoRefundsOf(env.DB, PERSON)).toMatchObject([{ holdId, amount: 400000, reason: "not_movable" }]);
  });

  it("gives a free move back and tells the client when the technician is away on the new day", async () => {
    await fittedClient();
    await booked(THURSDAY_NOON);
    const holdId = await moveHold("2026-09-25", "evening");
    await env.DB.prepare(
      `INSERT INTO technician_leave (id, technician_id, from_date, to_date, actor, created_at)
       VALUES ('leave-1', 't1', '2026-09-25', '2026-09-25', 'ops@maneman.test', ?1)`,
    )
      .bind(NOW.toISOString())
      .run();

    await call(PERSON, `/api/appointments/${VISIT}/reschedule`, { method: "POST", body: { hold_id: holdId } });

    expect(await visitOf(VISIT)).toMatchObject({ technician_id: "t1", window_start: THURSDAY_NOON });
    expect(await holdRow(holdId)).toEqual({ state: "released", appointment_id: null });
    expect((await messagesOf(PERSON)).results).toEqual([{ kind: "booking_refunded", subject_id: holdId }]);
  });

  it("refuses ops' move of a visit whose client's move is confirmed and waits to be booked", async () => {
    await fittedClient();
    await booked(THURSDAY_NOON);
    const holdId = await moveHold("2026-09-25", "evening");
    await confirm(holdId);

    expect(await moveJob(env.DB, OPS, toSameer(THURSDAY_NOON), NOW)).toEqual({
      kind: "superseded",
      changed: ["moving"],
    });
    expect(await visitOf(VISIT)).toMatchObject({ technician_id: "t1", window_start: THURSDAY_NOON });
    expect(await countOf("dispatch_moves")).toBe(0);
  });

  it("writes nothing when the client's move is confirmed between ops' checks and their write", async () => {
    await fittedClient();
    await booked(THURSDAY_NOON);
    const holdId = await moveHold("2026-09-25", "evening");
    const claimsHeld = await countOf("slot_claims");
    const db = env.DB;
    const confirmedMeanwhile: Pick<D1Database, "prepare" | "batch"> = {
      prepare: (sql) => db.prepare(sql),
      batch: async <T = unknown>(statements: D1PreparedStatement[]) => {
        await confirm(holdId);
        return db.batch<T>(statements);
      },
    };

    const outcome = await moveJob(confirmedMeanwhile as D1Database, OPS, toSameer(THURSDAY_NOON), NOW);

    expect(outcome).toEqual({ kind: "superseded", changed: ["moving"] });
    expect(await visitOf(VISIT)).toMatchObject({ technician_id: "t1", window_start: THURSDAY_NOON });
    expect(await countOf("dispatch_moves")).toBe(0);
    expect(await countOf("slot_claims")).toBe(claimsHeld);
  });
});

describe("a visit cancelled by the client", () => {
  it("is cancelled and refunded in the request, its change, status and message written together", async () => {
    await fittedClient();
    await booked(THURSDAY_NOON);
    const payments = createStubPayments();
    const deps = fakeDependencies({ payments });

    const done = await call(
      PERSON,
      `/api/appointments/${VISIT}/cancel`,
      {
        method: "POST",
        body: { confirm: true, notice: "free" },
      },
      deps,
    );

    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ cancelled: true, refund: 200000, kept: 0, refund_pending: false });
    expect((await visitOf(VISIT))?.status).toBe("cancelled");
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_visit", amount: 200000 }]);
    expect((await changes()).results).toEqual([
      {
        appointment_id: VISIT,
        kind: "cancelled",
        notice: "free",
        refund_amount: 200000,
        kept_amount: 0,
        payment_id: PAYMENT,
      },
    ]);
    expect((await messagesOf(PERSON)).results).toEqual([{ kind: "cancel_confirmation", subject_id: VISIT }]);
    expect(messageQueue.sent).toHaveLength(1);

    const again = await call(
      PERSON,
      `/api/appointments/${VISIT}/cancel`,
      {
        method: "POST",
        body: { confirm: true, notice: "free" },
      },
      deps,
    );
    expect(again.status).toBe(409);
    expect(payments.made.refunds).toHaveLength(1);
  });

  it("writes nothing and refunds nothing for a visit the technician checked in to after the terms were read", async () => {
    await fittedClient();
    await booked(THURSDAY_NOON);
    const visit = await changeableVisit(env.DB, PERSON, VISIT, NOW);
    if (visit === null) throw new Error("the visit should be changeable");
    const terms = await changeTerms(env.DB, visit, NOW, termsInForce(await readOpsInputs(env.DB, NOW), "service"));
    await env.DB.prepare(
      `INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at,
         updated_at)
       VALUES (?1, ?2, 'event-checkin-01', 't1', 'check_in', '{}', ?3, ?3, ?3)`,
    )
      .bind(crypto.randomUUID(), VISIT, NOW.toISOString())
      .run();
    const payments = createStubPayments();
    const deps = fakeDependencies({ payments });

    const outcome = await cancelVisit(env.DB, deps, terms, NOW, { log: createLogger() });

    expect(outcome).toEqual({ kind: "not_changeable" });
    expect((await visitOf(VISIT))?.status).toBe("scheduled");
    expect((await changes()).results).toEqual([]);
    expect((await messagesOf(PERSON)).results).toEqual([]);
    expect(payments.made.refunds).toEqual([]);
  });
});

describe("a visit the client and ops cancel at the same moment", () => {
  const options = { log: createLogger() };
  const byOps: OpsCancel = {
    staff: "ops@localhost",
    reason: "Client phoned to cancel",
    terms: "free",
    audit: {
      surface: "ops",
      actor: { kind: "staff", id: "ops@localhost" },
      action: "visit.cancel",
      subject: { kind: "appointment", id: VISIT },
      requestId: null,
    },
  };

  /** Both read the terms before either cancels, as two requests at the same moment do; then both cancel. */
  async function cancelledByBoth(deps: TestDependencies) {
    const visit = await changeableVisit(env.DB, PERSON, VISIT, NOW);
    if (visit === null) throw new Error("the visit should be changeable");
    const terms = await changeTerms(env.DB, visit, NOW, termsInForce(await readOpsInputs(env.DB, NOW), "service"));
    const outcomes = await Promise.all([
      cancelVisit(env.DB, deps, terms, NOW, options),
      cancelVisit(env.DB, deps, opsCancelTerms(terms, false), NOW, { ...options, ops: byOps }),
    ]);
    return outcomes.map((outcome) => outcome.kind).sort();
  }

  const restores = async () =>
    (await env.DB.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'restore'").first<{ n: number }>())?.n;

  beforeEach(async () => {
    await fittedClient();
    await booked(THURSDAY_NOON);
  });

  it("is cancelled once, refunded once and the client told once", async () => {
    const payments = createStubPayments();

    expect(await cancelledByBoth(fakeDependencies({ payments }))).toEqual(["cancelled", "not_changeable"]);

    expect((await visitOf(VISIT))?.status).toBe("cancelled");
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_visit", amount: 200000 }]);
    expect((await changes()).results).toHaveLength(1);
    expect((await messagesOf(PERSON)).results).toHaveLength(1);
  });

  it("gives its credit back once", async () => {
    await env.DB.prepare("DELETE FROM payments").run();
    await grantCredits(env.DB, { personId: PERSON, visits: 1, source: "referral", sourceId: "attr-1", now: NOW }).run();
    await redeemCredit(env.DB, PERSON, VISIT, NOW).run();

    expect(await cancelledByBoth(fakeDependencies())).toEqual(["cancelled", "not_changeable"]);

    expect(await restores()).toBe(1);
    expect((await creditBalance(env.DB, PERSON, NOW)).visits).toBe(1);
  });
});

describe("a visit cancelled, when something fails after it is cancelled", () => {
  const cancelFree = (deps: TestDependencies, database: D1Database = env.DB) =>
    call(
      PERSON,
      `/api/appointments/${VISIT}/cancel`,
      { method: "POST", body: { confirm: true, notice: "free" } },
      deps,
      database,
    );

  const settled = () =>
    env.DB.prepare("SELECT refund_settled_at FROM visit_changes WHERE appointment_id = ?1")
      .bind(VISIT)
      .first<{ refund_settled_at: string | null }>();

  /** The cron's cancel_refunds pass, `minutes` after NOW. */
  const refundPass = (deps: TestDependencies, minutes: number) =>
    settleOwedRefunds(env.DB, { ...deps, budget: createCallBudget(40), log: createLogger() }, at(minutes * 60));

  const queueThatRefuses = () => ({ ...fakeQueue(), send: () => Promise.reject(new Error("Queue send failed")) });

  beforeEach(async () => {
    await fittedClient();
    await booked(THURSDAY_NOON);
  });

  it("stays cancelled with its refund pending when D1 is lost once it is cancelled, and the job refunds once", async () => {
    const payments = createStubPayments();
    const deps = fakeDependencies({ payments });

    const done = await cancelFree(deps, failingAfterTheFirstBatch(env.DB));

    expect(done.status).toBe(202);
    expect(await done.json()).toMatchObject({ cancelled: true, refund_pending: true, refund: 200000 });
    expect((await visitOf(VISIT))?.status).toBe("cancelled");
    expect((await messagesOf(PERSON)).results).toEqual([{ kind: "cancel_confirmation", subject_id: VISIT }]);
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_visit", amount: 200000 }]);
    expect(await settled()).toEqual({ refund_settled_at: null });

    expect(await refundPass(deps, 5)).toBe(0);
    expect(await refundPass(deps, 11)).toBe(1);
    expect(payments.made.refunds).toHaveLength(1);
    expect(deps.alerts).toEqual([]);
    expect(await settled()).toEqual({ refund_settled_at: at(11 * 60).toISOString() });
    expect(await refundPass(deps, 16)).toBe(0);
  });

  it("leaves the job a refund Razorpay did not answer when ops could not be told", async () => {
    const silent = () => Promise.reject(new PaymentUnanswered("refund", new Error("The operation timed out.")));
    const failing = fakeDependencies({
      payments: { ...createStubPayments(), refund: silent },
      alertOnce: () => Promise.reject(new Error("D1_ERROR: Network connection lost.")),
    });

    const done = await cancelFree(failing);
    expect(done.status).toBe(202);
    expect((await visitOf(VISIT))?.status).toBe("cancelled");

    const payments = createStubPayments();
    const deps = fakeDependencies({ payments });
    expect(await refundPass(deps, 11)).toBe(1);
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_visit", amount: 200000 }]);
    expect(deps.alerts).toEqual([]);
  });

  it("answers cancelled and refunded when the queue refuses the message, which waits for the sweeper", async () => {
    messageQueue = queueThatRefuses();
    const payments = createStubPayments();

    const done = await cancelFree(fakeDependencies({ payments }));

    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ cancelled: true, refund_pending: false });
    expect(payments.made.refunds).toHaveLength(1);
    expect((await messagesOf(PERSON)).results).toEqual([{ kind: "cancel_confirmation", subject_id: VISIT }]);
    expect(await settled()).toEqual({ refund_settled_at: NOW.toISOString() });
  });

  it("gives a credit back with the cancel itself, whatever fails after", async () => {
    await env.DB.prepare("DELETE FROM payments").run();
    await grantCredits(env.DB, { personId: PERSON, visits: 1, source: "referral", sourceId: "attr-1", now: NOW }).run();
    await redeemCredit(env.DB, PERSON, VISIT, NOW).run();
    messageQueue = queueThatRefuses();

    const done = await cancelFree(fakeDependencies(), failingAfterTheFirstBatch(env.DB));

    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ cancelled: true, credit: "restored", refund_pending: false });
    expect((await creditBalance(env.DB, PERSON, NOW)).visits).toBe(1);
  });
});

describe("the cron's cancel_refunds job", () => {
  /** A cancel whose Worker stopped once the visit was cancelled, before its refund was settled. */
  const stoppedAfterCancelling = (visitStatus = "cancelled") =>
    env.DB.batch([
      env.DB.prepare("UPDATE appointments SET status = ?2 WHERE id = ?1").bind(VISIT, visitStatus),
      env.DB.prepare(
        `INSERT INTO visit_changes (id, appointment_id, person_id, kind, notice, was_start, refund_amount, kept_amount,
           payment_id, created_at)
         VALUES (?1, ?2, ?3, 'cancelled', 'free', ?4, 200000, 0, ?5, ?6)`,
      ).bind(crypto.randomUUID(), VISIT, PERSON, THURSDAY_NOON, PAYMENT, NOW.toISOString()),
    ]);

  const job = CRON_JOBS.filter((each) => each.name === "cancel_refunds");
  const run = (deps: TestDependencies) =>
    runCronJobs(job, { env: { ...env, MESSAGE_QUEUE: messageQueue }, deps, config: LOCAL_CONFIG, log: createLogger() });

  beforeEach(async () => {
    await fittedClient();
    await booked(THURSDAY_NOON);
  });

  it("refunds once a cancel whose Worker stopped before its refund", async () => {
    await stoppedAfterCancelling();
    const payments = createStubPayments();
    const deps = fakeDependencies({ payments, now: () => at(11 * 60) });

    expect(await run(deps)).toEqual([{ job: "cancel_refunds", ok: true }]);
    expect(await run(deps)).toEqual([{ job: "cancel_refunds", ok: true }]);

    expect(payments.made.refunds).toEqual([{ paymentId: "pay_visit", amount: 200000 }]);
    expect(deps.alerts).toEqual([]);
  });

  it("tells ops to look in Razorpay before refunding by hand, since the refund it refuses may have been made", async () => {
    await stoppedAfterCancelling();
    let asked = 0;
    const refusing: PaymentsProvider = {
      ...createStubPayments(),
      refund: () => {
        asked += 1;
        return Promise.reject(new Error("Razorpay 400 BAD_REQUEST_ERROR: the payment has been fully refunded"));
      },
    };
    const deps = fakeDependencies({ payments: refusing, now: () => at(11 * 60) });

    await run(deps);
    await run(deps);

    expect(asked).toBe(2);
    expect(deps.alerts).toEqual([
      `Razorpay did not answer the refund of Rs. 2,000 for visit ${VISIT}, cancelled by the client (payment ` +
        "pay_visit), so it may have been made. Look at the payment in Razorpay, and refund it by hand only if no " +
        `refund of Rs. 2,000 is there. http://ops.localhost:4323/clients/${PERSON}/payments`,
    ]);
  });

  it("names ops in the alert for a cancel ops made in the console", async () => {
    await stoppedAfterCancelling();
    await env.DB.prepare("UPDATE visit_changes SET cancelled_by = 'ops@localhost', ops_terms = 'free'").run();
    const refusing: PaymentsProvider = {
      ...createStubPayments(),
      refund: () => Promise.reject(new Error("Razorpay 400 BAD_REQUEST_ERROR: the payment has been fully refunded")),
    };
    const deps = fakeDependencies({ payments: refusing, now: () => at(11 * 60) });

    await run(deps);

    expect(deps.alerts).toHaveLength(1);
    expect(deps.alerts[0]).toContain(`Rs. 2,000 for visit ${VISIT}, cancelled by ops (payment pay_visit)`);
  });

  it("leaves alone a claim whose visit was never cancelled, and one the Worker before it refunded", async () => {
    await stoppedAfterCancelling("scheduled");
    const payments = createStubPayments();
    const deps = fakeDependencies({ payments, now: () => at(11 * 60) });
    await run(deps);
    expect(payments.made.refunds).toEqual([]);

    await env.DB.batch([
      env.DB.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?1").bind(VISIT),
      env.DB.prepare("UPDATE visit_changes SET razorpay_refund_id = 'rfnd_before' WHERE appointment_id = ?1").bind(
        VISIT,
      ),
    ]);
    await run(deps);
    expect(payments.made.refunds).toEqual([]);
  });
});

describe("a booking, after the request that confirmed it failed", () => {
  /** A service hold paid for, whose webhook recorded the payment but never booked it. */
  async function paidButUnbooked(paymentId: string, madeAt = at(30)) {
    const ordered = await heldAndOrdered();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO payments (id, person_id, razorpay_order_id, razorpay_payment_id, amount, currency, method, status,
           captured_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'INR', 'upi', 'captured', ?6, ?6, ?6)`,
      ).bind(crypto.randomUUID(), PERSON, ordered.orderId, paymentId, ordered.amount, madeAt.toISOString()),
      env.DB.prepare("UPDATE slot_holds SET confirmed_at = ?2, queued_at = ?2 WHERE id = ?1").bind(
        ordered.holdId,
        madeAt.toISOString(),
      ),
    ]);
    return ordered;
  }

  const pass = (deps: TestDependencies, seconds: number, budget = createCallBudget(40)) =>
    bookUnbookedHolds(env.DB, { ...deps, notify: () => Promise.resolve(), budget, log: createLogger() }, at(seconds));

  it("is booked by the half-hour pass", async () => {
    await fittedClient();
    const { holdId } = await paidButUnbooked("pay_net");
    const deps = fakeDependencies();

    expect(await pass(deps, 29 * 60)).toBe(0);
    expect(await pass(deps, 32 * 60)).toBe(1);

    expect((await holdRow(holdId))?.state).toBe("booked");
    expect(deps.alerts).toEqual([]);
  });

  it("tells ops once of a booking it still cannot finish, and tries it again half an hour on", async () => {
    await fittedClient();
    // Paid past the hold's ten minutes and its grace, so it is to be refunded, which Razorpay refuses.
    const { holdId } = await paidButUnbooked("pay_refused", at(800));
    let asked = 0;
    const refusing: PaymentsProvider = {
      ...createStubPayments(),
      refund: () => {
        asked += 1;
        return Promise.reject(new Error("Razorpay 400 BAD_REQUEST_ERROR"));
      },
    };
    const deps = fakeDependencies({ payments: refusing });

    expect(await pass(deps, 50 * 60)).toBe(0);
    expect(asked).toBe(1);
    expect(await pass(deps, 60 * 60)).toBe(0);
    expect(asked).toBe(1);
    expect(await pass(deps, 81 * 60)).toBe(0);
    expect(asked).toBe(2);

    expect((await holdRow(holdId))?.state).toBe("held");
    expect(deps.alerts).toEqual([expect.stringMatching(new RegExp(`${holdId}.*/clients/${PERSON}`))]);
  });

  it("is booked by the cron's own job", async () => {
    await fittedClient();
    const { holdId } = await paidButUnbooked("pay_cron");
    const job = CRON_JOBS.filter((each) => each.name === "unbooked_holds");

    const outcomes = await runCronJobs(job, {
      env: { ...env, MESSAGE_QUEUE: messageQueue },
      deps: fakeDependencies({ now: () => at(32 * 60) }),
      config: LOCAL_CONFIG,
      log: createLogger(),
    });

    expect(outcomes).toEqual([{ job: "unbooked_holds", ok: true }]);
    expect((await holdRow(holdId))?.state).toBe("booked");
    expect(messageQueue.sent).toHaveLength(1);
  });
});

describe("confirmBooking", () => {
  it("answers already_booked for a hold it booked before, and writes nothing more", async () => {
    await fittedClient();
    await grantCredits(env.DB, { personId: PERSON, visits: 2, source: "ops", sourceId: "o2", now: NOW }).run();
    const ordered = await heldAndOrdered();

    const again = await confirmBooking(env.DB, createStubPayments(), ordered.holdId, at(5));

    expect(again).toBe("already_booked");
    expect((await visitsOf(PERSON, "service")).results).toHaveLength(1);
    expect((await creditBalance(env.DB, PERSON, NOW)).visits).toBe(1);
  });
});

// A refund Razorpay refused for a hold already let go was swallowed, the money kept and nobody told;
// and giving back a hold after a partial refund in Razorpay's dashboard refunded nothing of the rest.
describe("money owed back on a hold", () => {
  const refusing = (payments: PaymentsProvider): PaymentsProvider => ({
    ...payments,
    refund: () => Promise.reject(new Error("Razorpay 400 BAD_REQUEST_ERROR")),
  });

  it("tells ops at once of a late payment Razorpay will not refund, and lists it on Tasks", async () => {
    await fittedClient();
    const ordered = await heldAndOrdered();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM slot_claims WHERE hold_id = ?1").bind(ordered.holdId),
      env.DB.prepare("UPDATE slot_holds SET state = 'released', updated_at = ?2 WHERE id = ?1").bind(
        ordered.holdId,
        at(11 * 60).toISOString(),
      ),
    ]);
    const deps = fakeDependencies({ payments: refusing(createStubPayments()) });

    await webhook("payment.captured", "evt_late", payment("pay_late", ordered, at(13 * 60)), deps);

    expect(deps.alerts).toEqual([
      expect.stringContaining(
        `Booking ${ordered.holdId} owes back payment pay_late of Rs. 2,000, and Razorpay refused the refund.`,
      ),
    ]);
    const tasks = (await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS)).tasks;
    expect(tasks.filter((task) => task.group === "payment_to_refund")).toMatchObject([
      { person: { id: PERSON }, detail: "let_go 200000 pay_late" },
    ]);
  });

  // A refund Razorpay never answered may have been made, so ops are asked to look before they refund it.
  it("tells ops to check Razorpay first for a late payment whose refund went unanswered", async () => {
    await fittedClient();
    const ordered = await heldAndOrdered();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM slot_claims WHERE hold_id = ?1").bind(ordered.holdId),
      env.DB.prepare("UPDATE slot_holds SET state = 'released', updated_at = ?2 WHERE id = ?1").bind(
        ordered.holdId,
        at(11 * 60).toISOString(),
      ),
    ]);
    const silent: PaymentsProvider = {
      ...createStubPayments(),
      refund: () => Promise.reject(new PaymentUnanswered("refund", new Error("The operation timed out."))),
    };
    const deps = fakeDependencies({ payments: silent });

    await webhook("payment.captured", "evt_late", payment("pay_late", ordered, at(13 * 60)), deps);

    expect(deps.alerts).toEqual([
      expect.stringContaining("and Razorpay did not say whether it refunded it. Check Razorpay's dashboard"),
    ]);
  });

  it("refunds what a partial refund in Razorpay's dashboard left when the hold is given back", async () => {
    await fittedClient();
    const ordered = await heldAndOrdered();
    await webhook("payment.captured", "evt_paid", payment("pay_part", ordered, at(13 * 60)), fakeDependencies());
    await env.DB.prepare(
      "UPDATE payments SET status = 'partially_refunded', refunded_amount = 50000 WHERE razorpay_payment_id = 'pay_part'",
    ).run();
    await env.DB.prepare("UPDATE slot_holds SET state = 'held', refunded_at = NULL WHERE id = ?1")
      .bind(ordered.holdId)
      .run();
    const payments = createStubPayments();

    expect(await giveBack(env.DB, payments, ordered.holdId, NOW, "test")).toEqual({
      kind: "refunded",
      paymentId: "pay_part",
      amount: 150000,
    });
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_part", amount: 150000 }]);
  });
});
