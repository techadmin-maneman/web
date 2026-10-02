// A booking FSM refuses is held, not refunded (docs/decisions/0095-a-booking-fsm-refuses-is-held.md). The owner
// ruled on 27 September 2026: after the fifth refusal the slot and the payment are kept and ops are alerted once; it
// is tried again hourly for 24 hours; ops book it in FSM or refund it from the console. NOW is Monday 21 September
// 2026, 12 noon in India; the client pays for a service visit on Thursday afternoon, and FSM refuses it five times,
// the fifth at 12:08. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditStatement, type AuditEntry } from "../../src/domain/audit.ts";
import { grantCredits } from "../../src/domain/credits.ts";
import { composeBookingRefunded, retryHeldBookings } from "../../src/domain/held-bookings.ts";
import { bookAsVisit, giveUpOnBooking, requeueUnbookedHolds, stopTries } from "../../src/domain/bookings.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { createCallBudget } from "../../src/lib/call-budget.ts";
import { saltedHash } from "../../src/lib/hash.ts";
import { createLogger } from "../../src/log.ts";
import { createStubFsm, EMPTY_FSM, type FsmProvider, type StubFsm } from "../../src/providers/fsm.ts";
import {
  createStubPayments,
  PaymentUnanswered,
  type PaymentsProvider,
  type StubPayments,
} from "../../src/providers/payments.ts";
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

/** The cron's pass over held bookings, `ms` after the fifth refusal. */
const hourlyPass = (queue: Queue, ms: number, retry?: { every: number; for: number }) =>
  retryHeldBookings(env.DB, { queue, log: createLogger() }, afterHeld(ms), retry);

/** The visit ops booked in FSM by hand. */
const HAND_MADE = "99999999-9999-4999-8999-999999999999";

/**
 * A visit as FSM's webhook mirrors it: by default the one ops booked in FSM by hand for Thursday at 2 pm, on a work
 * order of their own, which reached us at 13:02, 54 minutes after the booking was held.
 */
async function mirrored(
  visit: {
    id?: string;
    personId?: string;
    type?: string;
    status?: string;
    seen?: Date;
    fsmId?: string;
    workOrder?: string;
  } = {},
) {
  const id = visit.id ?? HAND_MADE;
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, status, fsm_status, window_start,
       window_end, technician_id, fsm_modified_at, synced_at, first_seen_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'Scheduled', '2026-09-24T08:30:00.000Z', '2026-09-24T10:00:00.000Z', 't1',
       ?7, ?7, ?7)`,
  )
    .bind(
      id,
      visit.fsmId ?? `fsm-${id}`,
      visit.workOrder ?? `wo-${id}`,
      visit.personId ?? PERSON,
      visit.type ?? "service",
      visit.status ?? "scheduled",
      (visit.seen ?? afterHeld(54 * MINUTE)).toISOString(),
    )
    .run();
}

/** Ops' three actions and the fourth, from the client's Visits tab. */
const retry = (deps: TestDependencies, holdId: string) =>
  asOps(deps, `/api/held-bookings/${holdId}/retry`, { method: "POST" });
const link = (deps: TestDependencies, holdId: string, visitId = HAND_MADE) =>
  asOps(deps, `/api/held-bookings/${holdId}/link`, { method: "POST", body: { visit_id: visitId } });
const refund = (deps: TestDependencies, holdId: string) =>
  asOps(deps, `/api/held-bookings/${holdId}/refund`, { method: "POST" });
const stop = (deps: TestDependencies, holdId: string) =>
  asOps(deps, `/api/held-bookings/${holdId}/stop`, { method: "POST" });

/** Ops refunded the payment in Razorpay's dashboard, and Razorpay's webhook said so. */
const refundedInDashboard = (paymentId = "pay_h1") =>
  env.DB.prepare("UPDATE payments SET status = 'refunded', refunded_amount = amount WHERE razorpay_payment_id = ?1")
    .bind(paymentId)
    .run();

/** A try that has just made the booking's work order in FSM and kept it on the hold. */
async function workOrderKept(fsm: FsmProvider, holdId: string): Promise<string> {
  const workOrder = await fsm.createWorkOrder({
    contactId: `contact-${PERSON}`,
    summary: "Service visit for Rohit Malhotra",
    serviceId: "item-service",
    reference: holdId,
  });
  await env.DB.prepare("UPDATE slot_holds SET fsm_work_order_id = ?2, fsm_tried_at = ?3 WHERE id = ?1")
    .bind(holdId, workOrder, HELD_AT.toISOString())
    .run();
  return workOrder;
}

/**
 * The database, with `meanwhile` done just before a hold's lease is taken: what a try wrote between ops reading the
 * booking and ops' action taking it.
 */
function meanwhileBeforeLease(meanwhile: () => Promise<void>): D1Database {
  return new Proxy(env.DB, {
    get(target, property) {
      if (property !== "prepare") {
        const value: unknown = Reflect.get(target, property);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      }
      return (sql: string) => {
        const statement = target.prepare(sql);
        if (!sql.includes("SET booking_until = ?2")) return statement;
        return {
          bind: (...values: unknown[]) => {
            const bound = statement.bind(...values);
            return {
              first: async () => {
                await meanwhile();
                return bound.first();
              },
            };
          },
        };
      };
    },
  });
}

/**
 * Ops' refund of the booking at 13:08, which Razorpay makes and whose own write then fails: the money has gone back,
 * the hold is still held, and the payment still reads as captured until Razorpay's webhook says otherwise.
 */
async function refundedThenWriteFailed(holdId: string, payments = createStubPayments()) {
  await env.DB.prepare(
    `CREATE TRIGGER refuse_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'booking.refund'
     BEGIN SELECT RAISE(ABORT, 'refused for the test'); END`,
  ).run();
  const answer = await refund(fakeDependencies({ now: () => afterHeld(HOUR), payments }), holdId).answer;
  expect(answer.status).toBe(500);
  expect(payments.made.refunds).toHaveLength(1);
  await env.DB.prepare("DROP TRIGGER refuse_audit").run();
  return payments;
}

/** Ops' entry for a link, as the route writes it. */
const linkEntry = (holdId: string): AuditEntry => ({
  surface: "ops",
  actor: { kind: "staff", id: "ops@localhost" },
  action: "booking.link",
  subject: { kind: "slot_hold", id: holdId },
  requestId: "r",
  detail: { visit_id: HAND_MADE },
});

/** Wednesday's service visit, which the client moved to Thursday afternoon; booked a week ago. */
const MOVED = "77777777-7777-4777-8777-777777777777";

/**
 * A booking that moves Wednesday's visit to Thursday afternoon, confirmed and held for FSM: `replace` books a new visit
 * and cancels Wednesday's, `move` moves it in place. A fee is paid on `orderId`, where there is one.
 */
async function heldMove(kind: "move" | "replace", fee: { amount: number; orderId: string } | null = null) {
  await mirrored({ id: MOVED, seen: at(-7 * 24 * HOUR) });
  const id = crypto.randomUUID();
  const statements = [
    env.DB.prepare(
      `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount,
         amount_ex_gst, gst_percent, state, razorpay_order_id, expires_at, created_at, updated_at, confirmed_at,
         queued_at, fsm_held_at, moves_appointment_id, move_kind)
       VALUES (?1, ?2, 'service', '2026-09-24', 'afternoon', 't1', 0, ?3, ?3, 0, 'held', ?4, ?5, ?5, ?5, ?5, ?6, ?6, ?7,
         ?8)`,
    ).bind(
      id,
      PERSON,
      fee?.amount ?? 0,
      fee?.orderId ?? null,
      at(MINUTE).toISOString(),
      HELD_AT.toISOString(),
      MOVED,
      kind,
    ),
  ];
  if (fee !== null) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO payments (id, person_id, razorpay_order_id, razorpay_payment_id, amount, currency, method, status,
           created_at, updated_at)
         VALUES (?1, ?2, ?3, 'pay_move', ?4, 'INR', 'upi', 'captured', ?5, ?5)`,
      ).bind(crypto.randomUUID(), PERSON, fee.orderId, fee.amount, at(MINUTE).toISOString()),
    );
  }
  await env.DB.batch(statements);
  return id;
}

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

/** The stub, with Razorpay's first answer to a refund lost though the refund was made (open point 161). */
function losingFirstAnswer(payments: StubPayments): PaymentsProvider {
  let asked = 0;
  return {
    ...payments,
    refund: async (paymentId, refund) => {
      asked += 1;
      const made = await payments.refund(paymentId, refund);
      if (asked === 1) throw new PaymentUnanswered("refund", new Error("The operation timed out."));
      return made;
    },
  };
}

const silent = (): PaymentsProvider => ({
  ...createStubPayments(),
  refund: () => Promise.reject(new PaymentUnanswered("refund", new Error("The operation timed out."))),
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
  const pass = hourlyPass;

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

  it("waits while another try is writing the booking to FSM, as ops' other actions do", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    await env.DB.prepare("UPDATE slot_holds SET booking_until = ?2 WHERE id = ?1")
      .bind(holdId, afterHeld(HOUR + 5 * MINUTE).toISOString())
      .run();
    const fsm = createStubFsm(world());
    const answer = await retry(fakeDependencies({ now: () => afterHeld(HOUR), fsm }), holdId).answer;
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "superseded" } });
    expect(fsm.made.workOrders).toEqual([]);
  });

  it("records ops' try that let the booking go, its payment refunded in Razorpay's dashboard meanwhile", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    await refundedInDashboard();
    const { answer } = retry(fakeDependencies({ now: () => afterHeld(HOUR) }), holdId);
    expect(await (await answer).json()).toEqual({ outcome: "given_back", refusal: null });
    expect(await holdRow(holdId)).toMatchObject({ state: "released" });
    expect(await auditRows("booking.retry")).toEqual([
      { actor_kind: "staff", actor: "ops@localhost", subject_kind: "slot_hold", subject_id: holdId, detail: null },
    ]);
  });
});

describe("ops linking the visit they booked in FSM by hand", () => {
  it("books it as that visit, with its payment, tells the client, and cancels the work order a try left", async () => {
    const { holdId } = await paidHold();
    const { fsm, stub } = halfWay();
    await refusedFiveTimes(holdId, fsm);
    await mirrored();

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

  it("spends the credit of a booking a credit covers on the visit ops booked for it, once", async () => {
    await grantCredits(env.DB, { personId: PERSON, visits: 1, source: "ops", sourceId: "o1", now: NOW }).run();
    const held = await (
      await asClient(PERSON, "/api/holds", {
        method: "POST",
        body: { type: "service", date: "2026-09-24", window: "afternoon" },
      })
    ).json<{ id: string }>();
    await asClient(PERSON, "/api/bookings", { method: "POST", body: { hold_id: held.id } });
    await refusedFiveTimes(held.id);
    await mirrored();

    const deps = fakeDependencies({ now: () => afterHeld(2 * HOUR) });
    expect((await link(deps, held.id).answer).status).toBe(200);
    expect((await link(deps, held.id).answer).status).toBe(404);
    const redeems = await env.DB.prepare("SELECT source_id FROM credit_ledger WHERE kind = 'redeem'").all();
    expect(redeems.results).toEqual([{ source_id: HAND_MADE }]);
    expect(deps.alerts.filter((alert) => alert.includes("no credit left"))).toEqual([]);
  });

  it("waits while a try is writing the booking to FSM, so nothing is booked twice", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    await mirrored();
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
    await mirrored({ personId: OTHER });
    expect((await link(fakeDependencies(), holdId).answer).status).toBe(400);
    await env.DB.prepare("UPDATE appointments SET person_id = ?2, status = 'completed' WHERE id = ?1")
      .bind(HAND_MADE, PERSON)
      .run();
    expect((await link(fakeDependencies(), holdId).answer).status).toBe(400);
    expect(await holdRow(holdId)).toMatchObject({ state: "held" });
    expect(await auditRows("booking.link")).toEqual([]);
  });

  it("refuses a visit of another kind", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    await mirrored({ type: "consultation" });
    expect((await link(fakeDependencies({ now: () => afterHeld(2 * HOUR) }), holdId).answer).status).toBe(400);
    expect(await holdRow(holdId)).toMatchObject({ state: "held", appointment_id: null });
  });

  it("refuses a visit another booking already is", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    await mirrored();
    await env.DB.prepare(
      `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount,
         amount_ex_gst, gst_percent, state, appointment_id, expires_at, created_at, updated_at)
       VALUES (?1, ?2, 'service', '2026-09-24', 'afternoon', 't1', 4, 0, 0, 0, 'booked', ?3, ?4, ?4, ?4)`,
    )
      .bind(crypto.randomUUID(), PERSON, HAND_MADE, NOW.toISOString())
      .run();
    expect((await link(fakeDependencies({ now: () => afterHeld(2 * HOUR) }), holdId).answer).status).toBe(400);
    expect(await holdRow(holdId)).toMatchObject({ state: "held", appointment_id: null });
  });

  it("refuses a visit the mirror had before the client paid, which cannot be this booking", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    await mirrored({ seen: at(-HOUR) });
    expect((await link(fakeDependencies({ now: () => afterHeld(2 * HOUR) }), holdId).answer).status).toBe(400);
    expect(await holdRow(holdId)).toMatchObject({ state: "held", appointment_id: null });
    expect(await auditRows("booking.link")).toEqual([]);
  });

  it("refuses, for a booking that replaces a visit, the visit it replaces, and leaves that visit booked", async () => {
    const holdId = await heldMove("replace");
    const fsm = createStubFsm(world());
    const { answer } = link(fakeDependencies({ now: () => afterHeld(HOUR), fsm }), holdId, MOVED);
    expect((await answer).status).toBe(400);
    expect(fsm.made.cancelled).toEqual([]);
    const replaced = await env.DB.prepare("SELECT status FROM appointments WHERE id = ?1").bind(MOVED).first();
    expect(replaced).toEqual({ status: "scheduled" });
    expect(await holdRow(holdId)).toMatchObject({ state: "held", appointment_id: null });
  });

  it("links a visit to one booking only, when two of the client's waiting bookings are linked to it at once", async () => {
    const first = await paidHold("pay_h1", "2026-09-24");
    const second = await paidHold("pay_h2", "2026-09-25");
    await refusedFiveTimes(first.holdId);
    await refusedFiveTimes(second.holdId);
    await mirrored();
    const fsm = createStubFsm(world());
    const now = afterHeld(2 * HOUR);
    const linkFirst = () =>
      bookAsVisit(env.DB, fsm, createStubPayments(), { holdId: first.holdId, visitId: HAND_MADE }, now, {
        labelAsTest: false,
        audit: linkEntry(first.holdId),
      });
    // Each found the visit free, and each holds its own booking's lease; the first's batch lands just before the
    // second's.
    let raced = false;
    const racing = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch" && !raced) {
          return async (statements: D1PreparedStatement[]) => {
            raced = true;
            await linkFirst();
            return target.batch(statements);
          };
        }
        const value: unknown = Reflect.get(target, property);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });

    const linked = await bookAsVisit(
      racing,
      fsm,
      createStubPayments(),
      { holdId: second.holdId, visitId: HAND_MADE },
      now,
      { labelAsTest: false, audit: linkEntry(second.holdId) },
    );
    expect(linked).toEqual({ kind: "not_the_visit" });
    expect(await holdRow(first.holdId)).toMatchObject({ state: "booked", appointment_id: HAND_MADE });
    expect(await holdRow(second.holdId)).toMatchObject({ state: "held", appointment_id: null });
    const secondsHold = await env.DB.prepare(
      `SELECT h.booking_until, (SELECT COUNT(*) FROM slot_claims c WHERE c.hold_id = h.id) AS claims,
              (SELECT p.appointment_id FROM payments p WHERE p.razorpay_payment_id = 'pay_h2') AS paid_for
       FROM slot_holds h WHERE h.id = ?1`,
    )
      .bind(second.holdId)
      .first<{ booking_until: string | null; claims: number; paid_for: string | null }>();
    expect(secondsHold).toMatchObject({ booking_until: null, paid_for: null });
    expect(secondsHold?.claims).toBeGreaterThan(0);
    expect((await auditRows("booking.link")).map((row) => row.subject_id)).toEqual([first.holdId]);
  });

  it("books nothing free once the payment was refunded in Razorpay's dashboard, and lets the booking go", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    await mirrored();
    await refundedInDashboard();
    const { answer, messages } = link(fakeDependencies({ now: () => afterHeld(2 * HOUR) }), holdId);
    expect((await answer).status).toBe(404);
    expect(await holdRow(holdId)).toMatchObject({ state: "released", appointment_id: null });
    const payment = await env.DB.prepare(
      "SELECT appointment_id FROM payments WHERE razorpay_payment_id = 'pay_h1'",
    ).first();
    expect(payment).toEqual({ appointment_id: null });
    expect(messages.sent).toEqual([]);
    expect(await auditRows("booking.link")).toEqual([]);
    expect(await auditRows("booking.give_back")).toEqual([
      {
        actor_kind: "staff",
        actor: "ops@localhost",
        subject_kind: "slot_hold",
        subject_id: holdId,
        detail: JSON.stringify({ visit_id: HAND_MADE, reason: "payment_refunded" }),
      },
    ]);
    const held = await env.DB.prepare("SELECT resolved_at FROM alerts WHERE key = ?1")
      .bind(`booking_held:${holdId}`)
      .first();
    expect(held).toEqual({ resolved_at: afterHeld(2 * HOUR).toISOString() });
  });

  it("books nothing once ops' refund went through though its own write failed, and lets the booking go", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    await mirrored();
    const payments = await refundedThenWriteFailed(holdId);
    const { answer } = link(fakeDependencies({ now: () => afterHeld(2 * HOUR), payments }), holdId);
    expect((await answer).status).toBe(404);
    expect(await holdRow(holdId)).toMatchObject({ state: "released", appointment_id: null });
    expect(payments.made.refunds).toHaveLength(1);
    expect(await auditRows("booking.give_back")).toHaveLength(1);
  });

  it("cancels the work order a try kept just before ops' link took the booking", async () => {
    const { holdId } = await paidHold();
    // FSM had no item for the service, so none of the five tries reached a work order.
    await refusedFiveTimes(holdId, createStubFsm(EMPTY_FSM));
    await mirrored();
    const fsm = createStubFsm(world());
    const linked = await bookAsVisit(
      meanwhileBeforeLease(async () => {
        await workOrderKept(fsm, holdId);
      }),
      fsm,
      createStubPayments(),
      { holdId, visitId: HAND_MADE },
      afterHeld(2 * HOUR),
      { labelAsTest: false, audit: linkEntry(holdId) },
    );
    expect(linked).toMatchObject({ kind: "linked", fsm: { kind: "cancelled" } });
    expect(fsm.made.cancelled).toHaveLength(1);
  });
});

describe("ops stopping the hourly tries, to book it in FSM by hand", () => {
  it("ends the tries, keeps the booking waiting for a link or a refund, and records who stopped them", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    const { answer } = stop(fakeDependencies({ now: () => afterHeld(52 * MINUTE) }), holdId);
    expect(await (await answer).json()).toEqual({ stopped: true });

    const queue = fakeQueue();
    for (const hours of [1, 2, 12, 23]) expect(await hourlyPass(queue, hours * HOUR)).toBe(0);
    expect(queue.sent).toEqual([]);
    expect(await holdRow(holdId)).toMatchObject({ state: "held", refunded_at: null });
    expect(await auditRows("booking.stop")).toEqual([
      { actor_kind: "staff", actor: "ops@localhost", subject_kind: "slot_hold", subject_id: holdId, detail: null },
    ]);
    const record = await (
      await asOps(fakeDependencies({ now: () => afterHeld(HOUR) }), `/api/clients/${PERSON}`).answer
    ).json<{ held_bookings: { retrying: boolean }[] }>();
    expect(record.held_bookings).toMatchObject([{ retrying: false }]);
  });

  it("stays stopped when ops lengthen the tries afterwards", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    await stop(fakeDependencies({ now: () => afterHeld(52 * MINUTE) }), holdId).answer;
    const queue = fakeQueue();
    const longer = { every: 1, for: 72 };
    expect(await hourlyPass(queue, 25 * HOUR, longer)).toBe(0);
    expect(await hourlyPass(queue, 48 * HOUR, longer)).toBe(0);
    expect(queue.sent).toEqual([]);
  });

  it("lets ops book it by hand and link it, with nothing made twice: held at 12:08, stopped at 13:00", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    await stop(fakeDependencies({ now: () => afterHeld(52 * MINUTE) }), holdId).answer;
    await mirrored();
    const queue = fakeQueue();
    expect(await hourlyPass(queue, HOUR)).toBe(0);

    const fsm = createStubFsm(world());
    const { answer } = link(fakeDependencies({ now: () => afterHeld(HOUR + 2 * MINUTE), fsm }), holdId);
    expect((await answer).status).toBe(200);
    expect(await holdRow(holdId)).toMatchObject({ state: "booked", appointment_id: HAND_MADE });
    expect(fsm.made.workOrders).toEqual([]);
    expect(fsm.made.visits).toEqual([]);
  });

  it("leaves a try the cron had already put on the queue writing nothing, while ops' own try still books it", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    await stop(fakeDependencies({ now: () => afterHeld(52 * MINUTE) }), holdId).answer;
    const fsm = createStubFsm(world());
    const hourly = delivery(holdId, 1);
    const deps = fakeDependencies({ now: () => afterHeld(53 * MINUTE), fsm });
    await handleFsmSyncBatch(hourly.batch, env, deps, createLogger());
    expect(hourly.message.ack).toHaveBeenCalled();
    expect(fsm.made.workOrders).toEqual([]);
    expect(await holdRow(holdId)).toMatchObject({ state: "held", appointment_id: null });
    expect(deps.alerts).toEqual([]);

    const { answer } = retry(fakeDependencies({ now: () => afterHeld(HOUR), fsm }), holdId);
    expect(await (await answer).json()).toEqual({ outcome: "booked", refusal: null });
    expect(fsm.made.workOrders).toHaveLength(1);
  });

  it("leaves a try writing nothing when ops stop the tries just before it takes the booking", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    const fsm = createStubFsm(world());
    const now = afterHeld(HOUR);
    const stoppedMeanwhile = meanwhileBeforeLease(async () => {
      const entry: AuditEntry = { ...linkEntry(holdId), action: "booking.stop", detail: {} };
      expect(await stopTries(env.DB, holdId, now, auditStatement(env.DB, entry, now))).toBe("stopped");
    });
    const hourly = delivery(holdId, 1);
    await handleFsmSyncBatch(
      hourly.batch,
      { ...env, DB: stoppedMeanwhile },
      fakeDependencies({ now: () => now, fsm }),
      createLogger(),
    );
    expect(hourly.message.ack).toHaveBeenCalled();
    expect(fsm.made.workOrders).toEqual([]);
    expect(await holdRow(holdId)).toMatchObject({ state: "held", appointment_id: null });
  });

  it("waits while a try is writing the booking to FSM, and stops nothing meanwhile", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    await env.DB.prepare("UPDATE slot_holds SET booking_until = ?2 WHERE id = ?1")
      .bind(holdId, afterHeld(55 * MINUTE).toISOString())
      .run();
    const answer = await stop(fakeDependencies({ now: () => afterHeld(50 * MINUTE) }), holdId).answer;
    expect(answer.status).toBe(409);
    expect(await auditRows("booking.stop")).toEqual([]);
    expect(await hourlyPass(fakeQueue(), HOUR)).toBe(1);
  });

  it("knows no booking that is not waiting", async () => {
    expect((await stop(fakeDependencies(), crypto.randomUUID()).answer).status).toBe(404);
  });
});

describe("a try, once ops have booked the visit in FSM by hand", () => {
  it("writes nothing to FSM, and tells ops once to link it: held at 12:08, booked by hand at 13:02, tried at 13:08", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    await mirrored();
    const fsm = createStubFsm(world());
    const hourly = delivery(holdId, 1);
    const at1308 = fakeDependencies({ now: () => afterHeld(HOUR), fsm });
    await handleFsmSyncBatch(hourly.batch, env, at1308, createLogger());

    expect(hourly.message.ack).toHaveBeenCalled();
    expect(fsm.made.workOrders).toEqual([]);
    expect(fsm.made.visits).toEqual([]);
    expect(await holdRow(holdId)).toMatchObject({ state: "held", appointment_id: null });
    expect(at1308.alerts).toHaveLength(1);
    expect(at1308.alerts[0]).toContain(holdId);
    expect(at1308.alerts[0]).toContain(HAND_MADE);
    expect(at1308.alerts[0]).toContain("link it");
    const held = await env.DB.prepare("SELECT resolved_at FROM alerts WHERE key = ?1")
      .bind(`booking_held:${holdId}`)
      .first();
    expect(held).toEqual({ resolved_at: null });

    const at1408 = fakeDependencies({ now: () => afterHeld(2 * HOUR), fsm });
    await handleFsmSyncBatch(delivery(holdId, 1).batch, env, at1408, createLogger());
    expect(at1408.alerts).toEqual([]);
    expect(fsm.made.workOrders).toEqual([]);

    expect((await link(fakeDependencies({ now: () => afterHeld(2 * HOUR), fsm }), holdId).answer).status).toBe(200);
    expect(await holdRow(holdId)).toMatchObject({ state: "booked", appointment_id: HAND_MADE });
  });

  it("says so when ops try FSM again, and writes nothing", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    await mirrored();
    const fsm = createStubFsm(world());
    const { answer } = retry(fakeDependencies({ now: () => afterHeld(HOUR), fsm }), holdId);
    expect(await (await answer).json()).toEqual({ outcome: "to_link", refusal: null });
    expect(fsm.made.workOrders).toEqual([]);
    expect(await holdRow(holdId)).toMatchObject({ state: "held", appointment_id: null });
    expect(await auditRows("booking.retry")).toEqual([]);
  });

  it("books the visit an earlier try made, whose answer never came, and does not take it for one ops made", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    const fsm = createStubFsm(world());
    const workOrder = await workOrderKept(fsm, holdId);
    const appointment = await fsm.createAppointment(workOrder, {
      summary: "Service visit for Rohit Malhotra",
      technicianId: "resource-1",
      start: "2026-09-24T12:00:00+05:30",
      end: "2026-09-24T13:30:00+05:30",
    });
    const OWN = "88888888-8888-4888-8888-888888888888";
    await mirrored({ id: OWN, fsmId: appointment, workOrder, seen: afterHeld(30 * MINUTE) });

    const deps = fakeDependencies({ now: () => afterHeld(HOUR), fsm });
    await handleFsmSyncBatch(delivery(holdId, 1).batch, env, deps, createLogger());
    expect(await holdRow(holdId)).toMatchObject({ state: "booked", appointment_id: OWN });
    expect(fsm.made.workOrders).toHaveLength(1);
    expect(fsm.made.visits).toHaveLength(1);
    expect(deps.alerts).toEqual([]);
  });
});

describe("ops refunding it from the console", () => {
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
      createPaymentLink: () => Promise.reject(new Error("unused")),
      findPaymentLink: () => Promise.reject(new Error("unused")),
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
      createPaymentLink: () => Promise.reject(new Error("unused")),
      findPaymentLink: () => Promise.reject(new Error("unused")),
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

  // docs/open-points.md, item 161: a refund whose answer never came is asked for again under its receipt.
  it("refunds once, and says so, when Razorpay made the refund but its answer was lost", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    const payments = createStubPayments();
    const deps = fakeDependencies({ now: () => afterHeld(26 * HOUR), payments: losingFirstAnswer(payments) });
    const { answer, messages } = refund(deps, holdId);
    expect(await (await answer).json()).toMatchObject({
      money: { kind: "refunded", payment_id: "pay_h1", amount: 200000 },
    });
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_h1", amount: 200000 }]);
    expect(await holdRow(holdId)).toMatchObject({ state: "released" });
    expect(messages.sent).toHaveLength(1);
  });

  it("keeps the booking waiting when Razorpay will not say it refunded, and a later press refunds it", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    const first = refund(fakeDependencies({ now: () => afterHeld(26 * HOUR), payments: silent() }), holdId);
    expect(await (await first.answer).json()).toEqual({
      money: { kind: "refund_unanswered", payment_id: "pay_h1", amount: 200000 },
      fsm: { kind: "nothing", work_order_id: null },
    });
    expect(await holdRow(holdId)).toMatchObject({ state: "held", refunded_at: null });
    expect(await auditRows("booking.refund")).toEqual([]);
    expect(first.messages.sent).toEqual([]);

    const payments = createStubPayments();
    const again = refund(fakeDependencies({ now: () => afterHeld(27 * HOUR), payments }), holdId);
    expect(await (await again.answer).json()).toMatchObject({ money: { kind: "refunded" } });
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_h1", amount: 200000 }]);
  });

  it("waits while a try is writing the booking to FSM, and refunds nothing meanwhile", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    await env.DB.prepare("UPDATE slot_holds SET booking_until = ?2 WHERE id = ?1")
      .bind(holdId, afterHeld(HOUR + 5 * MINUTE).toISOString())
      .run();
    const payments = createStubPayments();
    const { answer } = refund(fakeDependencies({ now: () => afterHeld(HOUR), payments }), holdId);
    expect((await answer).status).toBe(409);
    expect(payments.made.refunds).toEqual([]);
    expect(await holdRow(holdId)).toMatchObject({ state: "held" });
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

  it("says the payment was refunded before, and refunds nothing twice, after a refund in Razorpay's dashboard", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    await refundedInDashboard();
    const payments = createStubPayments();
    const { answer, messages } = refund(fakeDependencies({ now: () => afterHeld(26 * HOUR), payments }), holdId);
    expect(await (await answer).json()).toEqual({
      money: { kind: "refunded_before", payment_id: "pay_h1", amount: null },
      fsm: { kind: "nothing", work_order_id: null },
    });
    expect(payments.made.refunds).toEqual([]);
    expect(await holdRow(holdId)).toMatchObject({ state: "released" });
    expect(messages.sent).toHaveLength(1);
  });

  it("leaves the next try booking nothing once a refund went through though its own write failed", async () => {
    const { holdId } = await paidHold();
    await refusedFiveTimes(holdId);
    const payments = await refundedThenWriteFailed(holdId);
    const fsm = createStubFsm(world());
    const hourly = delivery(holdId, 1);
    await handleFsmSyncBatch(
      hourly.batch,
      env,
      fakeDependencies({ now: () => afterHeld(2 * HOUR), fsm, payments }),
      createLogger(),
    );
    expect(hourly.message.ack).toHaveBeenCalled();
    expect(fsm.made.workOrders).toEqual([]);
    expect(await holdRow(holdId)).toMatchObject({ state: "released", appointment_id: null });
    expect(payments.made.refunds).toHaveLength(1);
  });

  it("forgets the work order it cancelled, and lets the booking's lease go, when what follows fails", async () => {
    await grantCredits(env.DB, { personId: PERSON, visits: 1, source: "ops", sourceId: "o1", now: NOW }).run();
    const held = await (
      await asClient(PERSON, "/api/holds", {
        method: "POST",
        body: { type: "service", date: "2026-09-24", window: "afternoon" },
      })
    ).json<{ id: string }>();
    await asClient(PERSON, "/api/bookings", { method: "POST", body: { hold_id: held.id } });
    const { fsm, stub } = halfWay();
    await refusedFiveTimes(held.id, fsm);
    await env.DB.prepare(
      `CREATE TRIGGER refuse_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'booking.refund'
       BEGIN SELECT RAISE(ABORT, 'refused for the test'); END`,
    ).run();

    const answer = await refund(fakeDependencies({ now: () => afterHeld(HOUR), fsm: stub }), held.id).answer;
    expect(answer.status).toBe(500);
    expect(stub.made.cancelled).toHaveLength(1);
    const hold = await env.DB.prepare(
      "SELECT state, fsm_work_order_id, fsm_appointment_id, booking_until FROM slot_holds WHERE id = ?1",
    )
      .bind(held.id)
      .first();
    expect(hold).toEqual({ state: "held", fsm_work_order_id: null, fsm_appointment_id: null, booking_until: null });
  });

  it("cancels the work order a try kept just before ops' refund took the booking", async () => {
    const { holdId } = await paidHold();
    // FSM had no item for the service, so none of the five tries reached a work order.
    await refusedFiveTimes(holdId, createStubFsm(EMPTY_FSM));
    const fsm = createStubFsm(world());
    const gaveUp = await giveUpOnBooking(
      meanwhileBeforeLease(async () => {
        await workOrderKept(fsm, holdId);
      }),
      fsm,
      createStubPayments(),
      holdId,
      afterHeld(2 * HOUR),
      { labelAsTest: false },
    );
    expect(gaveUp).toMatchObject({ money: { kind: "refunded" }, fsm: { kind: "cancelled" } });
    expect(fsm.made.cancelled).toHaveLength(1);
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

  it("tells a client whose move could not be made that the visit stays as it was, and the fee is on its way back", async () => {
    await consentsToVisitMessages();
    const holdId = await heldMove("replace", { amount: 50000, orderId: "order_move" });
    await refund(fakeDependencies({ now: () => afterHeld(HOUR) }), holdId).answer;
    expect(await composeBookingRefunded(env.DB, holdId, PERSON)).toEqual({
      template: "move_refunded_v1",
      params: ["Rohit", "service visit", "Thu 24 Sep", "", "", "Rs. 500", "", "UPI"],
    });
  });

  it("tells a client whose free move could not be made that the visit stays as it was", async () => {
    await consentsToVisitMessages();
    const holdId = await heldMove("move");
    await refund(fakeDependencies({ now: () => afterHeld(HOUR) }), holdId).answer;
    expect(await composeBookingRefunded(env.DB, holdId, PERSON)).toEqual({
      template: "move_not_made_v1",
      params: ["Rohit", "service visit", "Thu 24 Sep", "", "", "", "", "payment method"],
    });
  });
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
