// Booking a held window (src/domain/bookings.ts): Checkout's order, the write to
// FSM once Razorpay confirms the capture, and the refund when the payment came
// too late or FSM will not take the visit. NOW is Monday 21 September 2026, 12
// noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmBooking } from "../../src/domain/bookings.ts";
import { createLogger } from "../../src/log.ts";
import { createStubFsm, EMPTY_FSM, type FsmProvider } from "../../src/providers/fsm.ts";
import { createStubPayments } from "../../src/providers/payments.ts";
import { handleFsmSyncBatch } from "../../src/queues/fsm-sync.ts";
import { saltedHash } from "../../src/lib/hash.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { appFor, fakeDependencies, fakeQueue, LOCAL_SETTINGS, markDatabase, NOW, request } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const world = () => ({
  ...EMPTY_FSM,
  items: [
    { id: "item-service", name: "Service visit", type: "Service" as const, price: null },
    { id: "item-consult", name: "Consultation", type: "Service" as const, price: null },
  ],
});

let cookie: string;

beforeEach(async () => {
  await markDatabase();
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'resource-1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name, fsm_contact_id)
     VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra', 'contact-1')`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  // Fitted: a service visit done with Imran.
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end, technician_id,
       fsm_modified_at, synced_at)
     VALUES ('past', 'fsm-past', ?1, 'service', 'completed', 'Completed', '2026-09-01T06:30:00.000Z',
       '2026-09-01T08:00:00.000Z', 't1', ?2, ?2)`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
});

const post = (app: ReturnType<typeof appFor>, path: string, body: object, bindings = {}) =>
  request(
    app,
    path,
    {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify(body),
    },
    bindings,
  );

async function heldService(app = appFor("local", fakeDependencies(), {}, "client")): Promise<string> {
  const answer = await post(app, "/api/holds", { type: "service", date: "2026-09-22", window: "afternoon" });
  return (await answer.json<{ id: string }>()).id;
}

/** Razorpay's capture of the hold's order, as the webhook records it. */
async function captured(holdId: string, capturedAt = NOW.toISOString()) {
  await env.DB.prepare(
    `INSERT INTO payments (id, person_id, razorpay_order_id, razorpay_payment_id, amount, currency, method, status,
       captured_at, created_at, updated_at)
     SELECT ?1, person_id, razorpay_order_id, 'pay_1', amount, 'INR', 'upi', 'captured', ?2, ?2, ?2
     FROM slot_holds WHERE id = ?3`,
  )
    .bind(crypto.randomUUID(), capturedAt, holdId)
    .run();
}

describe("POST /api/bookings", () => {
  it("makes one Razorpay order for a paid hold, with what Checkout opens with", async () => {
    const payments = createStubPayments();
    const app = appFor("local", fakeDependencies({ payments }), {}, "client");
    const holdId = await heldService(app);
    const answer = await post(app, "/api/bookings", { hold_id: holdId });
    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({
      hold_id: holdId,
      checkout: {
        key_id: "",
        order_id: expect.stringMatching(/^order_stub_/) as string,
        amount: 200000,
        currency: "INR",
        name: "Mane Man",
        description: "Service visit, 2026-09-22",
        prefill: { name: "Rohit Malhotra", contact: "+919810000001" },
      },
    });
    expect(payments.made.orders).toEqual([
      { amount: 200000, receipt: holdId, notes: { hold_id: holdId, person_id: PERSON } },
    ]);
    // Asked again, the same order.
    await post(app, "/api/bookings", { hold_id: holdId });
    expect(payments.made.orders).toHaveLength(1);
  });

  it("makes one order for two bookings of the same hold at the same moment", async () => {
    const payments = createStubPayments();
    const app = appFor("local", fakeDependencies({ payments }), {}, "client");
    const holdId = await heldService(app);
    // Both taps are in flight together, as they are when a client taps Retry twice on board C6.
    const both = await Promise.all([
      post(app, "/api/bookings", { hold_id: holdId }),
      post(app, "/api/bookings", { hold_id: holdId }),
    ]);
    expect(both.map((answer) => answer.status)).toEqual([201, 201]);
    const orders = await Promise.all(
      both.map(async (answer) => (await answer.json<{ checkout: { order_id: string } }>()).checkout.order_id),
    );
    // Both taps are answered with the one order the hold names. The other, which the race made and
    // no client is ever told about, is the only one Checkout cannot be opened on (ADR 0057).
    expect(orders[0]).toBe(orders[1]);
    expect(await env.DB.prepare("SELECT razorpay_order_id FROM slot_holds WHERE id = ?1").bind(holdId).first()).toEqual(
      { razorpay_order_id: orders[0] },
    );
    expect(payments.made.orders.map((order) => order.receipt)).toEqual([holdId, holdId]);
  });

  it("books a free consultation straight away, and refuses a hold that has lapsed", async () => {
    await env.DB.prepare("DELETE FROM appointments").run(); // a lead: a consultation is what they may book
    const app = appFor("local", fakeDependencies(), {}, "client");
    const queue = fakeQueue();
    const consult = await (
      await post(app, "/api/holds", { type: "consultation", date: "2026-09-22", window: "morning" })
    ).json<{ id: string }>();
    const answer = await post(app, "/api/bookings", { hold_id: consult.id }, { FSM_QUEUE: queue });
    expect(await answer.json()).toEqual({ hold_id: consult.id, checkout: null });
    expect(queue.sent).toEqual([{ hold_id: consult.id, request_id: expect.any(String) as string }]);

    const later = appFor("local", fakeDependencies({ now: () => new Date(NOW.getTime() + 11 * 60_000) }), {}, "client");
    const lapsed = await post(later, "/api/bookings", { hold_id: consult.id });
    expect(lapsed.status).toBe(409);
  });
});

describe("confirmBooking", () => {
  it("books a paid hold in FSM with its technician and times, then in the mirror, and links the payment", async () => {
    const app = appFor("local", fakeDependencies(), {}, "client");
    const holdId = await heldService(app);
    await post(app, "/api/bookings", { hold_id: holdId });
    const fsm = createStubFsm(world());
    const payments = createStubPayments();
    expect(await confirmBooking(env.DB, fsm, payments, holdId, NOW, { labelAsTest: true })).toBe("not_paid");

    await captured(holdId);
    expect(await confirmBooking(env.DB, fsm, payments, holdId, NOW, { labelAsTest: true })).toBe("booked");
    expect(fsm.made.visits).toEqual([
      {
        contactId: "contact-1",
        summary: "Staging test: Service visit for Rohit Malhotra",
        serviceId: "item-service",
        technicianId: "resource-1",
        start: "2026-09-22T12:00:00+05:30",
        end: "2026-09-22T13:30:00+05:30",
      },
    ]);
    const visit = await env.DB.prepare(
      "SELECT id, status, technician_id FROM appointments WHERE fsm_id LIKE 'stub-appointment-%'",
    ).first<{ id: string }>();
    expect(visit).toMatchObject({ status: "scheduled", technician_id: "t1" });
    const paid = await env.DB.prepare(
      "SELECT appointment_id FROM payments WHERE razorpay_payment_id = 'pay_1'",
    ).first();
    expect(paid).toEqual({ appointment_id: visit?.id });
    const claims = await env.DB.prepare("SELECT COUNT(*) AS n FROM slot_claims").first();
    expect(claims).toEqual({ n: 0 });

    const hold = await request(app, `/api/holds/${holdId}`, { headers: { Cookie: cookie } });
    expect(await hold.json()).toMatchObject({ state: "booked", paid: true, visit_id: visit?.id });
    // Told again, it books nothing twice.
    expect(await confirmBooking(env.DB, fsm, payments, holdId, NOW, { labelAsTest: true })).toBe("already_booked");
    expect(fsm.made.visits).toHaveLength(1);
  });

  it("refunds, once, a payment made after its hold had lapsed and the two minutes' grace after it", async () => {
    const app = appFor("local", fakeDependencies(), {}, "client");
    const holdId = await heldService(app);
    await post(app, "/api/bookings", { hold_id: holdId });
    await captured(holdId, new Date(NOW.getTime() + 13 * 60_000).toISOString());
    const payments = createStubPayments();
    const fsm = createStubFsm(world());
    const later = new Date(NOW.getTime() + 13 * 60_000);
    expect(await confirmBooking(env.DB, fsm, payments, holdId, later, { labelAsTest: true })).toBe("refunded");
    expect(await confirmBooking(env.DB, fsm, payments, holdId, later, { labelAsTest: true })).toBe("refunded");
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_1", amount: 200000 }]);
    expect(fsm.made.visits).toEqual([]);
  });

  it("refunds and alerts when FSM will not take the visit after five tries", async () => {
    const app = appFor("local", fakeDependencies(), {}, "client");
    const holdId = await heldService(app);
    await post(app, "/api/bookings", { hold_id: holdId });
    await captured(holdId);
    const payments = createStubPayments();
    const failing: FsmProvider = {
      ...createStubFsm(world()),
      createWorkOrder: () => Promise.reject(new Error("Zoho 400 INVALID_DATA: no resource")),
    };
    const deps = fakeDependencies({ fsm: failing, payments });
    const batchOf = (attempts: number) => ({
      queue: "mm-fsm-sync-local",
      messages: [{ id: "m1", body: { hold_id: holdId, request_id: "r1" }, attempts, ack: vi.fn(), retry: vi.fn() }],
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    });
    const first = batchOf(1);
    await handleFsmSyncBatch(first as unknown as MessageBatch, env, deps, createLogger());
    expect(first.messages[0]?.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(payments.made.refunds).toEqual([]);

    const fifth = batchOf(5);
    await handleFsmSyncBatch(fifth as unknown as MessageBatch, env, deps, createLogger());
    expect(fifth.messages[0]?.ack).toHaveBeenCalled();
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_1", amount: 200000 }]);
    expect(deps.alerts).toEqual([expect.stringMatching(/could not be written to FSM.*refunded/)]);
  });
});

describe("Razorpay's capture of a hold's payment", () => {
  it("queues the booking", async () => {
    const secret = "a-razorpay-webhook-secret-for-tests";
    const app = appFor("local", fakeDependencies(), {
      ...LOCAL_SETTINGS,
      razorpay: { keyId: "rzp_test_abc", keySecret: "s", webhookSecret: secret },
    });
    const holdId = "33333333-3333-4333-8333-333333333333";
    const body = JSON.stringify({
      entity: "event",
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_9",
            amount: 200000,
            currency: "INR",
            status: "captured",
            order_id: "order_9",
            method: "upi",
            contact: "+919810000001",
            notes: { hold_id: holdId, person_id: PERSON },
            created_at: 1790067435,
          },
        },
      },
    });
    const queue = fakeQueue();
    const answer = await request(
      app,
      "/api/hooks/razorpay",
      {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/json",
          "X-Razorpay-Signature": await saltedHash(secret, body),
          "X-Razorpay-Event-Id": "evt_9",
        },
      },
      { FSM_QUEUE: queue },
    );
    expect(answer.status).toBe(200);
    expect(queue.sent).toEqual([{ hold_id: holdId, request_id: expect.any(String) as string }]);
  });
});
