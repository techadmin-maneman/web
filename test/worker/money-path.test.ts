// A client who pays inside the hold gets the visit, or an automatic refund ops
// are told about; nothing is booked twice (docs/decisions/0068-a-paid-hold-is-kept.md).
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
import { createStubPayments } from "../../src/providers/razorpay.ts";
import { handleFsmSyncBatch } from "../../src/queues/fsm-sync.ts";
import { createCallBudget } from "../../src/lib/call-budget.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  fakeQueue,
  LOCAL_SETTINGS,
  markDatabase,
  NOW,
  request,
} from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const OTHER = "55555555-5555-4555-8555-555555555555";
const OLD_VISIT = "88888888-8888-4888-8888-888888888888";
const SECRET = "a-razorpay-webhook-secret-for-the-money-path";
const SECOND = 1000;
const at = (seconds: number) => new Date(NOW.getTime() + seconds * SECOND);

const world = () => ({
  ...EMPTY_FSM,
  items: [
    { id: "item-service", name: "Service visit", type: "Service" as const },
    { id: "item-consult", name: "Consultation", type: "Service" as const },
    { id: "item-fit", name: "First fit", type: "Service" as const },
  ],
});

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
    { FSM_QUEUE: fakeQueue() },
  );
}

async function fittedPerson(id: string, mobile: string, name: string) {
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name, fsm_contact_id) VALUES (?1, ?2, ?3, ?4, ?5)",
  )
    .bind(id, NOW.toISOString(), mobile, name, `contact-${id}`)
    .run();
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

/** Razorpay's signed webhook for a payment, delivered at `now`. */
async function webhook(event: string, eventId: string, payment: object, now: Date, queue = fakeQueue()) {
  const app = appFor("local", fakeDependencies({ now: () => now }), {
    ...LOCAL_SETTINGS,
    razorpay: { keyId: "rzp_test_money", keySecret: "s", webhookSecret: SECRET },
  });
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
async function heldAndOrdered(personId: string, now = NOW, date = "2026-09-24", window = "afternoon") {
  const held = await call(personId, "/api/holds", { method: "POST", body: { type: "service", date, window } }, now);
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

describe("a payment made inside the hold whose webhook lands after it (W1)", () => {
  it("is booked, judged on Razorpay's time for the payment, not on when the webhook came", async () => {
    const ordered = await heldAndOrdered(PERSON);
    // Paid at 9 minutes 50 seconds; the webhook reaches us at 10 minutes 5.
    await webhook("payment.captured", "evt_w1", payment("pay_w1", ordered, at(590)), at(605));
    const payments = createStubPayments();
    const outcome = await confirmBooking(env.DB, createStubFsm(world()), payments, ordered.holdId, at(606), {
      labelAsTest: true,
    });
    expect(outcome).toBe("booked");
    expect(payments.made.refunds).toEqual([]);
  });

  it("is still refunded when Razorpay's own time for it is past the hold and the two minutes' grace", async () => {
    const ordered = await heldAndOrdered(PERSON);
    await webhook("payment.captured", "evt_w1b", payment("pay_w1b", ordered, at(725)), at(726));
    const payments = createStubPayments();
    const outcome = await confirmBooking(env.DB, createStubFsm(world()), payments, ordered.holdId, at(727), {
      labelAsTest: true,
    });
    expect(outcome).toBe("refunded");
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_w1b", amount: 200000 }]);
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
async function replacementHold(): Promise<string> {
  const hold = await (
    await call(PERSON, "/api/holds", {
      method: "POST",
      body: { type: "service", date: "2026-09-24", window: "afternoon", moving: OLD_VISIT },
    })
  ).json<{ id: string }>();
  await call(PERSON, `/api/appointments/${OLD_VISIT}/reschedule`, { method: "POST", body: { hold_id: hold.id } });
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

describe("order.paid and payment.captured for one payment (W9)", () => {
  it("queues the booking once, on the capture", async () => {
    const ordered = await heldAndOrdered(PERSON);
    const queue = fakeQueue();
    await webhook("payment.captured", "evt_w9a", payment("pay_w9", ordered, at(30)), at(31), queue);
    await webhook("order.paid", "evt_w9b", payment("pay_w9", ordered, at(30)), at(31), queue);
    expect(queue.sent).toEqual([{ hold_id: ordered.holdId, request_id: expect.any(String) as string }]);
  });
});

describe("FSM refuses five times and Razorpay refuses the refund (W10)", () => {
  it("tells ops the payment to refund by hand, acknowledges the message, and goes on to the next", async () => {
    const ordered = await heldAndOrdered(PERSON);
    await webhook("payment.captured", "evt_w10", payment("pay_w10", ordered, at(30)), at(31));
    const deps = fakeDependencies({
      now: () => at(500),
      fsm: { ...createStubFsm(world()), createWorkOrder: () => Promise.reject(new Error("Zoho 400 INVALID_DATA")) },
      payments: {
        createOrder: () => Promise.reject(new Error("unused")),
        refund: () => Promise.reject(new Error("Razorpay 400 BAD_REQUEST_ERROR")),
      },
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
      body: { lead_id: "77777777-7777-4777-8777-777777777777", request_id: "r2" },
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const batch = { queue: "mm-fsm-sync-local", messages: [first, second], ackAll: vi.fn(), retryAll: vi.fn() };

    await handleFsmSyncBatch(batch as unknown as MessageBatch, env, deps, createLogger());

    expect(first.ack).toHaveBeenCalled();
    expect(second.ack).toHaveBeenCalled();
    expect(deps.alerts).toEqual([expect.stringMatching(/pay_w10.*by hand/)]);
    expect(deps.alerts.join()).not.toMatch(/has been refunded/);
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

describe("giving up on a booking FSM would not finish (BIZ-06, INT-02)", () => {
  it("cancels the work order FSM made, refunds the payment, and tells ops both", async () => {
    const { holdId } = await paidHold("pay_g1");
    const stub = createStubFsm(world());
    const fsm: FsmProvider = { ...stub, createAppointment: () => Promise.reject(new Error("Zoho 400 INVALID_DATA")) };
    const payments = createStubPayments();
    const deps = fakeDependencies({ now: () => at(500), fsm, payments });
    const { batch, message } = lastTry(holdId);
    await handleFsmSyncBatch(batch, env, deps, createLogger(), { labelAsTest: true });

    expect(message.ack).toHaveBeenCalled();
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_g1", amount: 200000 }]);
    expect(stub.made.cancelled).toEqual([
      {
        workOrderId: expect.stringMatching(/^stub-work-order-/) as string,
        note: expect.stringMatching(/refunded/) as string,
      },
    ]);
    expect(deps.alerts).toEqual([
      expect.stringMatching(
        /pay_g1 \(Rs\. 2,000\) is refunded in full\. Its work order stub-work-order-\S+ is cancelled/,
      ),
    ]);
    expect(await holdRow(holdId)).toMatchObject({ state: "released" });
  });

  it("says nothing was refunded for a visit a credit paid for", async () => {
    await grantCredits(env.DB, { personId: PERSON, visits: 1, source: "ops", sourceId: "o1", now: NOW }).run();
    const held = await (
      await call(PERSON, "/api/holds", {
        method: "POST",
        body: { type: "service", date: "2026-09-24", window: "afternoon" },
      })
    ).json<{ id: string }>();
    await call(PERSON, "/api/bookings", { method: "POST", body: { hold_id: held.id } });
    const deps = fakeDependencies({
      now: () => at(500),
      fsm: { ...createStubFsm(world()), createWorkOrder: () => Promise.reject(new Error("Zoho 400 INVALID_DATA")) },
    });
    await handleFsmSyncBatch(lastTry(held.id).batch, env, deps, createLogger());
    expect(deps.alerts).toEqual([expect.stringMatching(/Nothing was paid for it, so nothing is refunded/)]);
    expect(deps.alerts.join()).not.toMatch(/work order/);
  });
});

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

describe("GST once a price carries it (W7, BIZ-07)", () => {
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
