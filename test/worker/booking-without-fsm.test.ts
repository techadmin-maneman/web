// Booking, moving and cancelling where our own database holds the record of field work (FSM_PROVIDER "none"): each is
// written in the request that makes it, and nothing reaches FSM, whose every call here fails. NOW is Monday
// 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookUnbookedHolds, confirmBooking } from "../../src/domain/bookings.ts";
import { creditBalance, grantCredits, redeemCredit } from "../../src/domain/credits.ts";
import { resolveAskedWindows } from "../../src/domain/asked-windows.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { settleOwedRefunds } from "../../src/domain/cancel-refunds.ts";
import { cancelVisit, changeableVisit, changeTerms, termsInForce } from "../../src/domain/visit-changes.ts";
import { moveJob } from "../../src/domain/dispatch.ts";
import { readOpsInputs } from "../../src/domain/ops-settings.ts";
import { saltedHash } from "../../src/lib/hash.ts";
import { createCallBudget } from "../../src/lib/call-budget.ts";
import { createLogger } from "../../src/log.ts";
import { createStubPayments, PaymentUnanswered, type PaymentsProvider } from "../../src/providers/payments.ts";
import { handleFsmSyncBatch } from "../../src/queues/fsm-sync.ts";
import { CRON_JOBS, runCronJobs } from "../../src/scheduled/cron.ts";
import {
  appFor,
  captureLogs,
  failingAfterTheFirstBatch,
  fakeDependencies,
  fakeQueue,
  fsmSwitchedOff,
  LOCAL_CONFIG,
  LOCAL_SETTINGS,
  markDatabase,
  NOW,
  PROVIDERS_FOR,
  request,
  savedAddress,
  type TestDependencies,
} from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const NEWCOMER = "55555555-5555-4555-8555-555555555555";
const VISIT = "22222222-2222-4222-8222-222222222222";
const PAYMENT = "33333333-3333-4333-8333-333333333333";
const SECRET = "a-razorpay-webhook-secret-without-fsm";

/** Thursday 24 September, afternoon: free to change until Wednesday noon. */
const THURSDAY_NOON = "2026-09-24T06:30:00.000Z";
/** Tuesday 22 September, morning: inside 24 hours from NOW. */
const TUESDAY_MORNING = "2026-09-22T03:30:00.000Z";

const SECOND = 1000;
const at = (seconds: number) => new Date(NOW.getTime() + seconds * SECOND);

const cookies = new Map<string, string>();
let fsmQueue: ReturnType<typeof fakeQueue>;
let messageQueue: ReturnType<typeof fakeQueue>;

/** Dependencies with FSM switched off, as FSM_PROVIDER "none" makes them. */
const withoutFsm = (overrides: Parameters<typeof fakeDependencies>[0] = {}): TestDependencies =>
  fakeDependencies({ fsm: fsmSwitchedOff(), ...overrides });

const bindings = () => ({ FSM_QUEUE: fsmQueue, MESSAGE_QUEUE: messageQueue, CRM_QUEUE: fakeQueue() });

function call(
  personId: string,
  path: string,
  init: { method?: string; body?: object } = {},
  deps: TestDependencies = withoutFsm(),
  database: D1Database = env.DB,
) {
  const app = appFor("local", deps, {}, "client", PROVIDERS_FOR.ours);
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
async function webhook(event: string, eventId: string, payment: object, deps: TestDependencies = withoutFsm()) {
  const settings = { ...LOCAL_SETTINGS, razorpay: { keyId: "rzp_test_ours", keySecret: "s", webhookSecret: SECRET } };
  const app = appFor("local", deps, settings, "public", PROVIDERS_FOR.ours);
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
    bindings(),
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

/**
 * A paid visit with Imran, a service visit unless `type` says, booked without FSM: its FSM ID is its own, and it has
 * no work order.
 */
async function bookedWithoutFsm(start: string, type = "service") {
  const minutes = type === "first_fit" ? 180 : 90;
  const end = new Date(new Date(start).getTime() + minutes * 60_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, tier, status, window_start, window_end, technician_id,
       synced_at)
     VALUES (?1, ?1, ?2, ?6, 'standard', 'scheduled', ?3, ?4, 't1', ?5)`,
  )
    .bind(VISIT, PERSON, start, end, NOW.toISOString(), type)
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

/** A hold that moves the visit, a service visit unless `type` says. */
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
    `SELECT fsm_id = id AS own_fsm_id, fsm_work_order_id, fsm_status, fsm_modified_at, status, type, tier,
       technician_id, window_start, window_end, service_city, service_pincode, asked_checked_at
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
  fsmQueue = fakeQueue();
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
      own_fsm_id: 1,
      fsm_work_order_id: null,
      fsm_status: null,
      fsm_modified_at: null,
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
    expect(fsmQueue.sent).toEqual([]);

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
    expect(fsmQueue.sent).toEqual([]);
  });

  it("refunds a payment Razorpay made after the hold and its grace ran out, and books nothing", async () => {
    await fittedClient();
    const ordered = await heldAndOrdered();
    const payments = createStubPayments();

    await webhook("payment.captured", "evt_late", payment("pay_late", ordered, at(725)), withoutFsm({ payments }));

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
    expect(await visitOf(booked?.appointment_id)).toMatchObject({ own_fsm_id: 1, type: "consultation" });
    expect((await messagesOf(NEWCOMER)).results).toEqual([
      { kind: "consultation_confirmation", subject_id: booked?.appointment_id },
    ]);
    expect(fsmQueue.sent).toEqual([]);
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
    const site = appFor("local", withoutFsm(), {}, "public", PROVIDERS_FOR.ours);
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
      "SELECT fsm_id = id AS own_fsm_id, status, service_city, service_pincode FROM appointments WHERE type = 'consultation'",
    ).first();
    expect(visit).toEqual({ own_fsm_id: 1, status: "scheduled", service_city: "Gurgaon", service_pincode: "122018" });
    expect(fsmQueue.sent).toEqual([]);
  });
});

describe("a visit booked without FSM, moved by the client", () => {
  it("moves it in place for free, in the request that confirms the move", async () => {
    await fittedClient();
    await bookedWithoutFsm(THURSDAY_NOON);
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
    expect(fsmQueue.sent).toEqual([]);
  });

  it("books a new visit for a late move once paid, and cancels and charges the old one", async () => {
    await fittedClient();
    await bookedWithoutFsm(TUESDAY_MORNING);
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
    expect(await visitOf(VISIT)).toMatchObject({ fsm_status: null });
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
  const OPS = { fsm: fsmSwitchedOff(), labelAsTest: true, record: "ours" } as const;

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
    await bookedWithoutFsm(THURSDAY_NOON);
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
    await bookedWithoutFsm(TUESDAY_MORNING, "first_fit");
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
    await webhook("payment.captured", "evt_fee", payment("pay_fee", ordered), withoutFsm({ payments }));

    expect(payments.made.refunds).toEqual([{ paymentId: "pay_fee", amount: 400000 }]);
    expect(await visitOf(VISIT)).toMatchObject({ technician_id: "t2", window_start: TUESDAY_MORNING });
    expect(await holdRow(holdId)).toEqual({ state: "released", appointment_id: null });
    expect((await changes()).results).toEqual([]);
    expect((await messagesOf(PERSON)).results).toEqual([{ kind: "booking_refunded", subject_id: holdId }]);
  });

  it("gives a free move back and tells the client when the technician is away on the new day", async () => {
    await fittedClient();
    await bookedWithoutFsm(THURSDAY_NOON);
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
    await bookedWithoutFsm(THURSDAY_NOON);
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
    await bookedWithoutFsm(THURSDAY_NOON);
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

describe("a visit booked without FSM, cancelled by the client", () => {
  it("is cancelled and refunded in the request, its change, status and message written together", async () => {
    await fittedClient();
    await bookedWithoutFsm(THURSDAY_NOON);
    const payments = createStubPayments();
    const deps = withoutFsm({ payments });

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
    await bookedWithoutFsm(THURSDAY_NOON);
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
    const deps = withoutFsm({ payments });

    const outcome = await cancelVisit(env.DB, deps, terms, NOW, {
      labelAsTest: true,
      log: createLogger(),
      record: "ours",
    });

    expect(outcome).toEqual({ kind: "not_changeable" });
    expect((await visitOf(VISIT))?.status).toBe("scheduled");
    expect((await changes()).results).toEqual([]);
    expect((await messagesOf(PERSON)).results).toEqual([]);
    expect(payments.made.refunds).toEqual([]);
  });
});

describe("a visit cancelled without FSM, when something fails after it is cancelled", () => {
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
    await bookedWithoutFsm(THURSDAY_NOON);
  });

  it("stays cancelled with its refund pending when D1 is lost once it is cancelled, and the job refunds once", async () => {
    const payments = createStubPayments();
    const deps = withoutFsm({ payments });

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
    const failing = withoutFsm({
      payments: { ...createStubPayments(), refund: silent },
      alertOnce: () => Promise.reject(new Error("D1_ERROR: Network connection lost.")),
    });

    const done = await cancelFree(failing);
    expect(done.status).toBe(202);
    expect((await visitOf(VISIT))?.status).toBe("cancelled");

    const payments = createStubPayments();
    const deps = withoutFsm({ payments });
    expect(await refundPass(deps, 11)).toBe(1);
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_visit", amount: 200000 }]);
    expect(deps.alerts).toEqual([]);
  });

  it("answers cancelled and refunded when the queue refuses the message, which waits for the sweeper", async () => {
    messageQueue = queueThatRefuses();
    const payments = createStubPayments();

    const done = await cancelFree(withoutFsm({ payments }));

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

    const done = await cancelFree(withoutFsm(), failingAfterTheFirstBatch(env.DB));

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

  const config = { ...LOCAL_CONFIG, providers: { ...LOCAL_CONFIG.providers, ...PROVIDERS_FOR.ours } };
  const job = CRON_JOBS.filter((each) => each.name === "cancel_refunds");
  const run = (deps: TestDependencies) =>
    runCronJobs(job, { env: { ...env, MESSAGE_QUEUE: messageQueue }, deps, config, log: createLogger() });

  beforeEach(async () => {
    await fittedClient();
    await bookedWithoutFsm(THURSDAY_NOON);
  });

  it("refunds once a cancel whose Worker stopped before its refund", async () => {
    await stoppedAfterCancelling();
    const payments = createStubPayments();
    const deps = withoutFsm({ payments, now: () => at(11 * 60) });

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
    const deps = withoutFsm({ payments: refusing, now: () => at(11 * 60) });

    await run(deps);
    await run(deps);

    expect(asked).toBe(2);
    expect(deps.alerts).toEqual([
      `Razorpay did not answer the refund of Rs. 2000 for visit ${VISIT}, cancelled by the client (payment ` +
        "pay_visit), so it may have been made. Look at the payment in Razorpay, and refund it by hand only if no " +
        `refund of Rs. 2000 is there. http://ops.localhost:4323/clients/${PERSON}`,
    ]);
  });

  it("names ops in the alert for a cancel ops made in the console", async () => {
    await stoppedAfterCancelling();
    await env.DB.prepare("UPDATE visit_changes SET cancelled_by = 'ops@localhost', ops_terms = 'free'").run();
    const refusing: PaymentsProvider = {
      ...createStubPayments(),
      refund: () => Promise.reject(new Error("Razorpay 400 BAD_REQUEST_ERROR: the payment has been fully refunded")),
    };
    const deps = withoutFsm({ payments: refusing, now: () => at(11 * 60) });

    await run(deps);

    expect(deps.alerts).toHaveLength(1);
    expect(deps.alerts[0]).toContain(`Rs. 2000 for visit ${VISIT}, cancelled by ops (payment pay_visit)`);
  });

  it("leaves alone a claim whose visit was never cancelled, and one the Worker before it refunded", async () => {
    await stoppedAfterCancelling("scheduled");
    const payments = createStubPayments();
    const deps = withoutFsm({ payments, now: () => at(11 * 60) });
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

describe("a booking our own database holds, after the request that confirmed it failed", () => {
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
    bookUnbookedHolds(
      env.DB,
      { ...deps, notify: () => Promise.resolve(), labelAsTest: true, budget, log: createLogger() },
      at(seconds),
    );

  it("is booked by the half-hour pass, without FSM", async () => {
    await fittedClient();
    const { holdId } = await paidButUnbooked("pay_net");
    const deps = withoutFsm();

    expect(await pass(deps, 29 * 60)).toBe(0);
    expect(await pass(deps, 32 * 60)).toBe(1);

    expect((await holdRow(holdId))?.state).toBe("booked");
    expect(fsmQueue.sent).toEqual([]);
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
    const deps = withoutFsm({ payments: refusing });

    expect(await pass(deps, 50 * 60)).toBe(0);
    expect(asked).toBe(1);
    expect(await pass(deps, 60 * 60)).toBe(0);
    expect(asked).toBe(1);
    expect(await pass(deps, 81 * 60)).toBe(0);
    expect(asked).toBe(2);

    expect((await holdRow(holdId))?.state).toBe("held");
    expect(deps.alerts).toEqual([expect.stringMatching(new RegExp(`${holdId}.*/clients/${PERSON}`))]);
  });

  it("is booked by the cron's own job, which runs with FSM switched off", async () => {
    await fittedClient();
    const { holdId } = await paidButUnbooked("pay_cron");
    const job = CRON_JOBS.filter((each) => each.name === "unbooked_holds");
    const config = { ...LOCAL_CONFIG, providers: { ...LOCAL_CONFIG.providers, ...PROVIDERS_FOR.ours } };

    const outcomes = await runCronJobs(job, {
      env: { ...env, FSM_QUEUE: fsmQueue, MESSAGE_QUEUE: messageQueue },
      deps: withoutFsm({ now: () => at(32 * 60) }),
      config,
      log: createLogger(),
    });

    expect(outcomes).toEqual([{ job: "unbooked_holds", ok: true }]);
    expect((await holdRow(holdId))?.state).toBe("booked");
    expect(messageQueue.sent).toHaveLength(1);
    expect(fsmQueue.sent).toEqual([]);
  });

  it("is booked in our own database when FSM's queue still carries it", async () => {
    await fittedClient();
    const { holdId } = await paidButUnbooked("pay_queued");
    const message = {
      id: "m1",
      body: { hold_id: holdId, request_id: "r1" },
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const batch = { queue: "mm-fsm-sync-local", messages: [message], ackAll: vi.fn(), retryAll: vi.fn() };

    await handleFsmSyncBatch(batch as unknown as MessageBatch, env, withoutFsm({ now: () => at(40) }), createLogger(), {
      labelAsTest: true,
      cataloguePush: false,
      record: "ours",
    });

    expect(message.ack).toHaveBeenCalled();
    const booked = await holdRow(holdId);
    expect(await visitOf(booked?.appointment_id)).toMatchObject({ own_fsm_id: 1, fsm_work_order_id: null });
  });
});

describe("the asked-window pass", () => {
  it("has nothing to look up for a visit our own booking made, which is booked into the window the client picked", async () => {
    await fittedClient();
    const ordered = await heldAndOrdered();
    await webhook("payment.captured", "evt_asked", payment("pay_asked", ordered));

    expect(await resolveAskedWindows(env.DB, at(60))).toEqual({ resolved: 0 });
    const hold = await holdRow(ordered.holdId);
    expect(await visitOf(hold?.appointment_id)).toMatchObject({ asked_checked_at: NOW.toISOString() });
  });
});

describe("confirmBooking, where our own database holds the record", () => {
  it("answers already_booked for a hold it booked before, and writes nothing more", async () => {
    await fittedClient();
    await grantCredits(env.DB, { personId: PERSON, visits: 2, source: "ops", sourceId: "o2", now: NOW }).run();
    const ordered = await heldAndOrdered();

    const again = await confirmBooking(env.DB, fsmSwitchedOff(), createStubPayments(), ordered.holdId, at(5), {
      labelAsTest: true,
      record: "ours",
    });

    expect(again).toBe("already_booked");
    expect((await visitsOf(PERSON, "service")).results).toHaveLength(1);
    expect((await creditBalance(env.DB, PERSON, NOW)).visits).toBe(1);
  });
});
