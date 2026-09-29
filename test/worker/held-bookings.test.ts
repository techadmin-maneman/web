// A booking FSM refuses is held, not refunded (docs/decisions/0095-a-booking-fsm-refuses-is-held.md). The owner
// ruled on 27 September 2026: after the fifth refusal the slot and the payment are kept and ops are alerted once; it
// is tried again hourly for 24 hours; ops book it in FSM or refund it from the console. NOW is Monday 21 September
// 2026, 12 noon in India; the client pays for a service visit on Thursday afternoon, and FSM refuses it five times,
// the fifth at 12:08. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { grantCredits } from "../../src/domain/credits.ts";
import { composeBookingRefunded, retryHeldBookings } from "../../src/domain/held-bookings.ts";
import { requeueUnbookedHolds } from "../../src/domain/bookings.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { createCallBudget } from "../../src/lib/call-budget.ts";
import { saltedHash } from "../../src/lib/hash.ts";
import { createLogger } from "../../src/log.ts";
import { createStubFsm, EMPTY_FSM, type FsmProvider, type StubFsm } from "../../src/providers/fsm.ts";
import { createStubPayments, type PaymentsProvider } from "../../src/providers/payments.ts";
import { handleFsmSyncBatch } from "../../src/queues/fsm-sync.ts";
import { CRON_JOBS, runCronJobs } from "../../src/scheduled/cron.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  fakeQueue,
  LOCAL_CONFIG,
  LOCAL_SETTINGS,
  markDatabase,
  NOW,
  request,
  savedAddress,
  type TestDependencies,
} from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const OTHER = "55555555-5555-4555-8555-555555555555";
const SECRET = "a-razorpay-webhook-secret-for-held-bookings";
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const at = (ms: number) => new Date(NOW.getTime() + ms);
/** When FSM refused the booking for the fifth time. */
const HELD_AT = at(8 * MINUTE);
const afterHeld = (ms: number) => new Date(HELD_AT.getTime() + ms);

const world = () => ({
  ...EMPTY_FSM,
  items: [
    { id: "item-service", name: "Service visit", type: "Service" as const, price: null },
    { id: "item-consult", name: "Consultation", type: "Service" as const, price: null },
    { id: "item-fit", name: "First fit", type: "Service" as const, price: null },
  ],
});

/** FSM refusing every work order, as during an outage at Zoho. */
const refusing = (): FsmProvider => ({
  ...createStubFsm(world()),
  createWorkOrder: () => Promise.reject(new Error("Zoho 400 INVALID_DATA")),
});

/** FSM taking the work order and refusing its appointment, so a work order is left for the booking. */
function halfWay(): { fsm: FsmProvider; stub: StubFsm } {
  const stub = createStubFsm(world());
  return { stub, fsm: { ...stub, createAppointment: () => Promise.reject(new Error("Zoho 500 INTERNAL_ERROR")) } };
}

const cookies = new Map<string, string>();

function asClient(personId: string, path: string, init: { method?: string; body?: object } = {}, now = NOW) {
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
    { FSM_QUEUE: fakeQueue() },
  );
}

/** A call to the console, behind Access, which the local stand-in lets through as ops@localhost. */
function asOps(deps: TestDependencies, path: string, init: { method?: string; body?: object } = {}) {
  const messages = fakeQueue();
  const answer = request(
    appFor("local", deps, {}, "ops"),
    path,
    {
      method: init.method ?? "GET",
      headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    },
    { MESSAGE_QUEUE: messages, FSM_QUEUE: fakeQueue() },
  );
  return { answer, messages };
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

/** Razorpay's signed webhook for the payment of a hold's order, made at 30 seconds. */
async function captured(paymentId: string, ordered: { holdId: string; orderId: string; amount: number }) {
  const app = appFor("local", fakeDependencies({ now: () => at(31 * SECOND) }), {
    ...LOCAL_SETTINGS,
    razorpay: { keyId: "rzp_test_held", keySecret: "s", webhookSecret: SECRET },
  });
  const payment = {
    id: paymentId,
    amount: ordered.amount,
    currency: "INR",
    status: "captured",
    order_id: ordered.orderId,
    method: "upi",
    notes: { hold_id: ordered.holdId, person_id: PERSON },
    created_at: Math.floor(at(30 * SECOND).getTime() / SECOND),
  };
  const body = JSON.stringify({
    entity: "event",
    event: "payment.captured",
    payload: { payment: { entity: payment } },
  });
  const answer = await request(
    app,
    "/api/hooks/razorpay",
    {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json",
        "X-Razorpay-Signature": await saltedHash(SECRET, body),
        "X-Razorpay-Event-Id": `evt_${paymentId}`,
      },
    },
    { FSM_QUEUE: fakeQueue() },
  );
  expect(answer.status).toBe(200);
}

/** A service visit on Thursday afternoon, held and paid for, waiting for the queue. */
async function paidHold(paymentId = "pay_h1", date = "2026-09-24") {
  const held = await asClient(PERSON, "/api/holds", {
    method: "POST",
    body: { type: "service", date, window: "afternoon" },
  });
  const hold = await held.json<{ id: string }>();
  const started = await asClient(PERSON, "/api/bookings", { method: "POST", body: { hold_id: hold.id } });
  const checkout = (await started.json<{ checkout: { order_id: string; amount: number } | null }>()).checkout;
  const ordered = { holdId: hold.id, orderId: checkout?.order_id ?? "", amount: checkout?.amount ?? 0 };
  await captured(paymentId, ordered);
  return ordered;
}

/** One delivery of the queue's message for a hold. */
function delivery(holdId: string, attempts: number) {
  const message = {
    id: `m${String(attempts)}`,
    body: { hold_id: holdId, request_id: "r" },
    attempts,
    ack: vi.fn(),
    retry: vi.fn(),
  };
  const batch = { queue: "mm-fsm-sync-local", messages: [message], ackAll: vi.fn(), retryAll: vi.fn() };
  return { batch: batch as unknown as MessageBatch, message };
}

/** The queue's five tries, each refused, the fifth at HELD_AT. */
async function refusedFiveTimes(holdId: string, fsm: FsmProvider = refusing(), payments = createStubPayments()) {
  const deps = fakeDependencies({ now: () => HELD_AT, fsm, payments });
  const tries = [1, 2, 3, 4, 5].map((attempts) => delivery(holdId, attempts));
  for (const each of tries) await handleFsmSyncBatch(each.batch, env, deps, createLogger());
  return { deps, tries, payments };
}

const holdRow = (id: string) =>
  env.DB.prepare("SELECT state, refunded_at, fsm_held_at, fsm_refusal, appointment_id FROM slot_holds WHERE id = ?1")
    .bind(id)
    .first<{
      state: string;
      refunded_at: string | null;
      fsm_held_at: string | null;
      fsm_refusal: string | null;
      appointment_id: string | null;
    }>();

const auditRows = (action: string) =>
  env.DB.prepare("SELECT actor_kind, actor, subject_kind, subject_id, detail FROM audit_log WHERE action = ?1")
    .bind(action)
    .all()
    .then((answer) => answer.results);

/** The other client, trying to hold the same Thursday afternoon. */
const otherHolds = async () =>
  (
    await asClient(OTHER, "/api/holds", {
      method: "POST",
      body: { type: "service", date: "2026-09-24", window: "afternoon" },
    })
  ).status;

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
  await fittedPerson(OTHER, "+919810000005", "Karan Bhatia");
});

describe("a booking FSM refuses five times running", () => {
  it("keeps its slot and its payment, cancels nothing, and tells ops once", async () => {
    const { holdId } = await paidHold();
    const { deps, tries, payments } = await refusedFiveTimes(holdId);

    expect(tries.slice(0, 4).every((each) => each.message.retry.mock.calls.length === 1)).toBe(true);
    expect(tries[4]?.message.ack).toHaveBeenCalled();
    expect(tries[4]?.message.retry).not.toHaveBeenCalled();
    expect(payments.made.refunds).toEqual([]);
    expect(await holdRow(holdId)).toEqual({
      state: "held",
      refunded_at: null,
      fsm_held_at: HELD_AT.toISOString(),
      fsm_refusal: "Zoho 400 INVALID_DATA",
      appointment_id: null,
    });
    expect(deps.alerts).toEqual([
      expect.stringMatching(
        new RegExp(
          `${holdId} could not be written to FSM after 5 attempts.*Nothing is refunded.*every hour for 24 hours`,
        ),
      ),
    ]);
    expect(deps.alerts[0]).toContain(`/clients/${PERSON}/visits`);
  });

  it("is not sold to anyone else while it waits", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    expect(await otherHolds()).toBe(409);
  });

  it("is not tried again by the queue when an hourly try fails, and ops are not told twice", async () => {
    const { holdId } = await paidHold();
    const { deps } = await refusedFiveTimes(holdId);
    const hourly = delivery(holdId, 1);
    const later = fakeDependencies({
      now: () => afterHeld(HOUR),
      fsm: { ...createStubFsm(world()), createWorkOrder: () => Promise.reject(new Error("Zoho 429 TOO_MANY")) },
    });
    await handleFsmSyncBatch(hourly.batch, env, later, createLogger());
    expect(hourly.message.ack).toHaveBeenCalled();
    expect(hourly.message.retry).not.toHaveBeenCalled();
    expect([...deps.alerts, ...later.alerts]).toHaveLength(1);
    expect(await holdRow(holdId)).toMatchObject({
      state: "held",
      fsm_held_at: HELD_AT.toISOString(),
      fsm_refusal: "Zoho 429 TOO_MANY",
    });
  });

  it("is left alone by the half-hour pass over paid holds, which only finds what the queue lost", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    const queue = fakeQueue();
    const deps = fakeDependencies();
    const pass = (ms: number) =>
      requeueUnbookedHolds(
        env.DB,
        { queue, alertOnce: deps.alertOnce, budget: createCallBudget(40), log: createLogger() },
        afterHeld(ms),
      );
    expect(await pass(45 * MINUTE)).toBe(0);
    expect(await pass(3 * HOUR)).toBe(0);
    expect(queue.sent).toEqual([]);
  });
});

describe("the hourly tries", () => {
  const pass = (queue: Queue, ms: number, retry?: { every: number; for: number }) =>
    retryHeldBookings(env.DB, { queue, log: createLogger() }, afterHeld(ms), retry);

  it("put a held booking back on the queue an hour after the fifth refusal, and each hour after", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    const queue = fakeQueue();
    expect(await pass(queue, 59 * MINUTE)).toBe(0);
    expect(await pass(queue, HOUR)).toBe(1);
    expect(queue.sent).toEqual([{ hold_id: holdId, request_id: "held-bookings" }]);
    expect(await pass(queue, 90 * MINUTE)).toBe(0);
    expect(await pass(queue, 2 * HOUR)).toBe(1);
  });

  it("book it, once one lands, exactly as the first try would have, and tell the client", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    const fsm = createStubFsm(world());
    const deps = fakeDependencies({ now: () => afterHeld(HOUR), fsm });
    const hourly = delivery(holdId, 1);
    await handleFsmSyncBatch(hourly.batch, env, deps, createLogger(), { labelAsTest: true, cataloguePush: false });

    expect(hourly.message.ack).toHaveBeenCalled();
    expect(fsm.made.workOrders).toHaveLength(1);
    expect(fsm.made.visits).toHaveLength(1);
    const hold = await holdRow(holdId);
    expect(hold?.state).toBe("booked");
    const told = await env.DB.prepare("SELECT kind FROM outbound_messages WHERE subject_id = ?1")
      .bind(hold?.appointment_id)
      .first();
    expect(told).toEqual({ kind: "payment_receipt" });
    const payment = await env.DB.prepare(
      "SELECT appointment_id FROM payments WHERE razorpay_payment_id = 'pay_h1'",
    ).first();
    expect(payment).toEqual({ appointment_id: hold?.appointment_id });
    const alert = await env.DB.prepare("SELECT resolved_at FROM alerts WHERE key = ?1")
      .bind(`booking_held:${holdId}`)
      .first();
    expect(alert).toEqual({ resolved_at: afterHeld(HOUR).toISOString() });
  });

  it("stop 24 hours after the fifth refusal, and the booking waits for ops", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    const queue = fakeQueue();
    expect(await pass(queue, 22 * HOUR)).toBe(1);
    expect(await pass(queue, 23 * HOUR)).toBe(1);
    expect(await pass(queue, 24 * HOUR)).toBe(0);
    expect(await pass(queue, 30 * HOUR)).toBe(0);
    expect(queue.sent).toHaveLength(2);
    expect(await holdRow(holdId)).toMatchObject({ state: "held" });
  });

  it("come as often, and for as long, as ops set in the console", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    await env.DB.prepare(
      "INSERT INTO ops_settings (name, value, set_by, set_at) VALUES ('fsm_retry', ?1, 'ops@localhost', ?2)",
    )
      .bind(JSON.stringify({ every: 3, for: 6 }), NOW.toISOString())
      .run();
    const job = CRON_JOBS.filter((each) => each.name === "unbooked_holds");
    const run = async (ms: number) => {
      const queue = fakeQueue();
      await runCronJobs(job, {
        env: { ...env, FSM_QUEUE: queue },
        deps: fakeDependencies({ now: () => afterHeld(ms) }),
        config: LOCAL_CONFIG,
        log: createLogger(),
      });
      return queue.sent.length;
    };
    expect(await run(2 * HOUR)).toBe(0);
    expect(await run(3 * HOUR)).toBe(1);
    expect(await run(5 * HOUR)).toBe(0);
    expect(await run(6 * HOUR)).toBe(0);
  });

  it("are not made once the visit's time has come, and the booking waits for ops", async () => {
    const { holdId } = await paidHold("pay_h1", "2026-09-22");
    await refusedFiveTimes(holdId);
    const queue = fakeQueue();
    // Tuesday's afternoon starts at noon, 24 hours after the booking was held.
    expect(await pass(queue, 23 * HOUR)).toBe(1);
    await env.DB.prepare("UPDATE slot_holds SET fsm_held_at = ?2, queued_at = ?2 WHERE id = ?1")
      .bind(holdId, afterHeld(20 * HOUR).toISOString())
      .run();
    expect(await pass(queue, 24 * HOUR)).toBe(0);
    expect(queue.sent).toHaveLength(1);
  });
});

describe("ops trying FSM again from the console", () => {
  const retry = (deps: TestDependencies, holdId: string) =>
    asOps(deps, `/api/held-bookings/${holdId}/retry`, { method: "POST" });

  it("books it now, tells the client, and records who asked, with the booking", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    const deps = fakeDependencies({ now: () => afterHeld(30 * MINUTE), fsm: createStubFsm(world()) });
    const { answer, messages } = retry(deps, holdId);
    expect(await (await answer).json()).toEqual({ outcome: "booked", refusal: null });
    const hold = await holdRow(holdId);
    expect(hold?.state).toBe("booked");
    expect(await auditRows("booking.retry")).toEqual([
      { actor_kind: "staff", actor: "ops@localhost", subject_kind: "slot_hold", subject_id: holdId, detail: null },
    ]);
    expect(messages.sent).toHaveLength(1);
  });

  it("says what FSM said when it refuses again, keeps the booking waiting, and records nothing done", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    const deps = fakeDependencies({
      now: () => afterHeld(30 * MINUTE),
      fsm: {
        ...createStubFsm(world()),
        createWorkOrder: () => Promise.reject(new Error("Zoho 400 MANDATORY_NOT_FOUND")),
      },
    });
    const { answer } = retry(deps, holdId);
    expect(await (await answer).json()).toEqual({ outcome: "refused", refusal: "Zoho 400 MANDATORY_NOT_FOUND" });
    expect(await holdRow(holdId)).toMatchObject({ state: "held", fsm_refusal: "Zoho 400 MANDATORY_NOT_FOUND" });
    expect(await auditRows("booking.retry")).toEqual([]);
  });

  it("refuses once the visit's time has passed, and knows no booking that is not waiting", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    const thursdayEvening = fakeDependencies({ now: () => new Date("2026-09-24T12:00:00Z") });
    expect((await retry(thursdayEvening, holdId).answer).status).toBe(409);
    expect((await retry(fakeDependencies(), crypto.randomUUID()).answer).status).toBe(404);
  });
});

describe("ops linking the visit they booked in FSM by hand", () => {
  const HAND_MADE = "99999999-9999-4999-8999-999999999999";

  /** The visit ops made in FSM, as its webhook mirrors it: Thursday at 2 pm, on a work order of their own. */
  async function mirroredByHand(personId = PERSON, status = "scheduled") {
    await env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, status, fsm_status, window_start,
         window_end, technician_id, fsm_modified_at, synced_at)
       VALUES (?1, 'fsm-by-hand', 'wo-by-hand', ?2, 'service', ?3, 'Scheduled', '2026-09-24T08:30:00.000Z',
         '2026-09-24T10:00:00.000Z', 't1', ?4, ?4)`,
    )
      .bind(HAND_MADE, personId, status, NOW.toISOString())
      .run();
  }

  const link = (deps: TestDependencies, holdId: string, visitId = HAND_MADE) =>
    asOps(deps, `/api/held-bookings/${holdId}/link`, { method: "POST", body: { visit_id: visitId } });

  it("books it as that visit, with its payment, tells the client, and cancels the work order a try left", async () => {
    const { holdId } = await paidHold();
    const { fsm, stub } = halfWay();
    await refusedFiveTimes(holdId, fsm);
    await mirroredByHand();

    const deps = fakeDependencies({ now: () => afterHeld(2 * HOUR), fsm: stub });
    const { answer, messages } = link(deps, holdId);
    expect(await (await answer).json()).toEqual({
      fsm: { kind: "cancelled", work_order_id: expect.stringMatching(/^stub-work-order-/) as string },
    });

    expect(await holdRow(holdId)).toMatchObject({ state: "booked", appointment_id: HAND_MADE });
    const payment = await env.DB.prepare(
      "SELECT appointment_id FROM payments WHERE razorpay_payment_id = 'pay_h1'",
    ).first();
    expect(payment).toEqual({ appointment_id: HAND_MADE });
    const visits = await env.DB.prepare(
      "SELECT id FROM appointments WHERE person_id = ?1 AND type = 'service' AND deleted_at IS NULL",
    )
      .bind(PERSON)
      .all();
    expect(visits.results).toEqual([{ id: HAND_MADE }]);
    expect(stub.made.visits).toEqual([]);
    expect(stub.made.cancelled).toHaveLength(1);
    expect(await auditRows("booking.link")).toEqual([
      {
        actor_kind: "staff",
        actor: "ops@localhost",
        subject_kind: "slot_hold",
        subject_id: holdId,
        detail: JSON.stringify({ visit_id: HAND_MADE }),
      },
    ]);
    const told = await env.DB.prepare("SELECT kind FROM outbound_messages WHERE subject_id = ?1")
      .bind(HAND_MADE)
      .first();
    expect(told).toEqual({ kind: "payment_receipt" });
    expect(messages.sent).toHaveLength(1);
    // The visit ops made holds its own time now, in place of the booking's claim on the afternoon.
    const claims = await env.DB.prepare("SELECT COUNT(*) AS left FROM slot_claims WHERE hold_id = ?1")
      .bind(holdId)
      .first();
    expect(claims).toEqual({ left: 0 });
  });

  it("waits while a try is writing the booking to FSM, so nothing is booked twice", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    await mirroredByHand();
    await env.DB.prepare("UPDATE slot_holds SET booking_until = ?2 WHERE id = ?1")
      .bind(holdId, afterHeld(HOUR + 5 * MINUTE).toISOString())
      .run();
    const { answer } = link(fakeDependencies({ now: () => afterHeld(HOUR) }), holdId);
    expect((await answer).status).toBe(409);
    expect(await holdRow(holdId)).toMatchObject({ state: "held", appointment_id: null });
    expect(await auditRows("booking.link")).toEqual([]);
  });

  it("refuses another client's visit, or one already done, and leaves the booking waiting", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    await mirroredByHand(OTHER);
    expect((await link(fakeDependencies(), holdId).answer).status).toBe(400);
    await env.DB.prepare("UPDATE appointments SET person_id = ?2, status = 'completed' WHERE id = ?1")
      .bind(HAND_MADE, PERSON)
      .run();
    expect((await link(fakeDependencies(), holdId).answer).status).toBe(400);
    expect(await holdRow(holdId)).toMatchObject({ state: "held" });
    expect(await auditRows("booking.link")).toEqual([]);
  });
});

describe("ops refunding it from the console", () => {
  const refund = (deps: TestDependencies, holdId: string) =>
    asOps(deps, `/api/held-bookings/${holdId}/refund`, { method: "POST" });

  it("cancels the work order FSM holds, refunds in full, frees the slot, tells the client, and records it", async () => {
    const { holdId } = await paidHold();
    const { fsm, stub } = halfWay();
    await refusedFiveTimes(holdId, fsm);
    const payments = createStubPayments();
    const deps = fakeDependencies({ now: () => afterHeld(26 * HOUR), fsm: stub, payments });

    const { answer, messages } = refund(deps, holdId);
    expect(await (await answer).json()).toEqual({
      money: { kind: "refunded", payment_id: "pay_h1", amount: 200000 },
      fsm: { kind: "cancelled", work_order_id: expect.stringMatching(/^stub-work-order-/) as string },
    });
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_h1", amount: 200000 }]);
    expect(stub.made.cancelled).toEqual([
      {
        workOrderId: expect.stringMatching(/^stub-work-order-/) as string,
        note: expect.stringMatching(/refunded/) as string,
      },
    ]);
    expect(await holdRow(holdId)).toMatchObject({ state: "released" });
    expect(await auditRows("booking.refund")).toEqual([
      { actor_kind: "staff", actor: "ops@localhost", subject_kind: "slot_hold", subject_id: holdId, detail: null },
    ]);
    const told = await env.DB.prepare("SELECT id, kind, subject_kind FROM outbound_messages WHERE subject_id = ?1")
      .bind(holdId)
      .first<{ id: string; kind: string; subject_kind: string }>();
    expect(told).toMatchObject({ kind: "booking_refunded", subject_kind: "slot_hold" });
    expect(messages.sent).toEqual([{ message_id: told?.id, request_id: expect.any(String) as string }]);
    expect(await otherHolds()).toBe(201);
  });

  it("books a waiting booking afresh once its work order was cancelled by a refund Razorpay then refused", async () => {
    const { holdId } = await paidHold();
    const { fsm, stub } = halfWay();
    await refusedFiveTimes(holdId, fsm);
    const refusing: PaymentsProvider = {
      createOrder: () => Promise.reject(new Error("unused")),
      refund: () => Promise.reject(new Error("Razorpay 400 BAD_REQUEST_ERROR")),
    };
    await refund(fakeDependencies({ now: () => afterHeld(HOUR), fsm: stub, payments: refusing }), holdId).answer;
    const cancelled = stub.made.cancelled.map((each) => each.workOrderId);
    expect(cancelled).toHaveLength(1);

    const deps = fakeDependencies({ now: () => afterHeld(2 * HOUR), fsm: stub });
    const { answer } = asOps(deps, `/api/held-bookings/${holdId}/retry`, { method: "POST" });
    expect(await (await answer).json()).toEqual({ outcome: "booked", refusal: null });
    expect(stub.made.workOrders).toHaveLength(2);
    const booked = await env.DB.prepare(
      "SELECT fsm_work_order_id FROM appointments WHERE id = (SELECT appointment_id FROM slot_holds WHERE id = ?1)",
    )
      .bind(holdId)
      .first<{ fsm_work_order_id: string }>();
    expect(cancelled).not.toContain(booked?.fsm_work_order_id);
  });

  it("keeps the booking waiting, and tells the client nothing, when Razorpay refuses the refund", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    const payments: PaymentsProvider = {
      createOrder: () => Promise.reject(new Error("unused")),
      refund: () => Promise.reject(new Error("Razorpay 400 BAD_REQUEST_ERROR")),
    };
    const deps = fakeDependencies({ now: () => afterHeld(26 * HOUR), payments });
    const { answer, messages } = refund(deps, holdId);
    expect(await (await answer).json()).toEqual({
      money: { kind: "refund_refused", payment_id: "pay_h1", amount: 200000 },
      fsm: { kind: "nothing", work_order_id: null },
    });
    expect(await holdRow(holdId)).toMatchObject({ state: "held", refunded_at: null });
    expect(await auditRows("booking.refund")).toEqual([]);
    expect(messages.sent).toEqual([]);
  });

  it("gives back a booking a credit covered, with nothing to refund and the credit never spent", async () => {
    await grantCredits(env.DB, { personId: PERSON, visits: 1, source: "ops", sourceId: "o1", now: NOW }).run();
    const held = await (
      await asClient(PERSON, "/api/holds", {
        method: "POST",
        body: { type: "service", date: "2026-09-24", window: "afternoon" },
      })
    ).json<{ id: string }>();
    await asClient(PERSON, "/api/bookings", { method: "POST", body: { hold_id: held.id } });
    await refusedFiveTimes(held.id);
    const { answer } = refund(fakeDependencies({ now: () => afterHeld(HOUR) }), held.id);
    expect(await (await answer).json()).toEqual({
      money: { kind: "nothing_paid", payment_id: null, amount: null },
      fsm: { kind: "nothing", work_order_id: null },
    });
    const redeemed = await env.DB.prepare("SELECT 1 FROM credit_ledger WHERE kind = 'redeem'").first();
    expect(redeemed).toBeNull();
  });
});

describe("what the client is told when ops refund it", () => {
  async function consentsToVisitMessages() {
    await env.DB.prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, ip_hash)
       VALUES (?1, ?2, 'whatsapp_visits', 'whatsapp-visits-v1', 1, ?3, 'a-hash')`,
    )
      .bind(crypto.randomUUID(), PERSON, NOW.toISOString())
      .run();
  }

  it("names the visit, and the money on its way back", async () => {
    await consentsToVisitMessages();
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    await refund(fakeDependencies({ now: () => afterHeld(HOUR) }), holdId).answer;
    expect(await composeBookingRefunded(env.DB, holdId, PERSON)).toEqual({
      template: "booking_refunded_v1",
      params: ["Rohit", "service visit", "Thu 24 Sep", "", "", "Rs. 2,000", "", "UPI"],
    });
  });

  it("is not sent without their consent to WhatsApp about their visits", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    await refund(fakeDependencies({ now: () => afterHeld(HOUR) }), holdId).answer;
    expect(await composeBookingRefunded(env.DB, holdId, PERSON)).toEqual({
      skip: "no consent to WhatsApp about visits",
    });
  });

  function refund(deps: TestDependencies, holdId: string) {
    return asOps(deps, `/api/held-bookings/${holdId}/refund`, { method: "POST" });
  }
});

describe("what a paid booking was sold under", () => {
  it("stays sold when it is booked a day late, though ops changed the terms meanwhile", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO ops_settings (name, value, set_by, set_at) VALUES ('change_notice_hours', '48', 'ops@localhost', ?1)",
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO ops_settings (name, value, set_by, set_at)
         VALUES ('late_change_charge', ?1, 'ops@localhost', ?2)`,
      ).bind(
        JSON.stringify({ consultation: "nothing", first_fit: "nothing", service: "nothing", replacement: "nothing" }),
        NOW.toISOString(),
      ),
    ]);
    const deps = fakeDependencies({ now: () => afterHeld(20 * HOUR), fsm: createStubFsm(world()) });
    await handleFsmSyncBatch(delivery(holdId, 1).batch, env, deps, createLogger());

    const hold = await (
      await asClient(PERSON, `/api/holds/${holdId}`, {}, afterHeld(20 * HOUR))
    ).json<{
      state: string;
      change_notice_hours: number;
      late_change_charge: string;
    }>();
    expect(hold).toMatchObject({ state: "booked", change_notice_hours: 24, late_change_charge: "visit" });
  });
});

describe("where it waits for ops, and what the client sees meanwhile", () => {
  it("is a task on the board from the fifth refusal, due by its visit's day, until it is refunded", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    const board = await (
      await asOps(fakeDependencies({ now: () => afterHeld(HOUR) }), "/api/tasks").answer
    ).json<{
      groups: { group: string; tasks: { id: string; detail: string; since: string; due: string }[] }[];
    }>();
    expect(board.groups.find((group) => group.group === "held_booking")?.tasks).toEqual([
      {
        id: holdId,
        person: { id: PERSON, name: "Rohit Malhotra" },
        detail: "service 2026-09-24 afternoon",
        since: HELD_AT.toISOString(),
        due: afterHeld(24 * HOUR).toISOString(),
        owner: null,
      },
    ]);

    await asOps(fakeDependencies({ now: () => afterHeld(HOUR) }), `/api/held-bookings/${holdId}/refund`, {
      method: "POST",
    }).answer;
    const after = await (await asOps(fakeDependencies(), "/api/tasks").answer).json<{ groups: { group: string }[] }>();
    expect(after.groups.map((group) => group.group)).not.toContain("held_booking");
  });

  it("is on the client's page in the console, with FSM's refusal and until when it is tried", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    const record = await (
      await asOps(fakeDependencies({ now: () => afterHeld(HOUR) }), `/api/clients/${PERSON}`).answer
    ).json<{ held_bookings: unknown[] }>();
    expect(record.held_bookings).toEqual([
      {
        id: holdId,
        type: "service",
        service: "Service visit",
        starts_at: "2026-09-24T06:30:00.000Z",
        window: "afternoon",
        paid: 200000,
        uses_credit: false,
        moves_visit: false,
        held_at: HELD_AT.toISOString(),
        refusal: "Zoho 400 INVALID_DATA",
        retries_end: afterHeld(24 * HOUR).toISOString(),
        retrying: true,
      },
    ]);
  });

  it("is said on the client's Home to be on its way, with the payment in: neither booked nor refunded", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    const me = await (
      await asClient(PERSON, "/api/me", {}, afterHeld(HOUR))
    ).json<{
      next_visit: unknown;
      being_booked: unknown;
    }>();
    expect(me.next_visit).toBeNull();
    expect(me.being_booked).toEqual({ type: "service", date: "2026-09-24", window: "afternoon", paid: true });
  });
});
