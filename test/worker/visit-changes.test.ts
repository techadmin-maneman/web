// A client moving or cancelling a visit (src/routes/client-changes.ts, src/domain/visit-changes.ts, and the move
// in confirmBooking). NOW is Monday 21 September 2026, 12 noon in India; the price book is at 0% from 22 September.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { confirmBooking } from "../../src/domain/bookings.ts";
import { clawBack, creditBalance, grantCredits, redeemCredit } from "../../src/domain/credits.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { createStubFsm, EMPTY_FSM, type FsmProvider } from "../../src/providers/fsm.ts";
import { createStubPayments } from "../../src/providers/razorpay.ts";
import { appFor, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const VISIT = "22222222-2222-4222-8222-222222222222";
const PAYMENT = "33333333-3333-4333-8333-333333333333";
const FEE = "44444444-4444-4444-8444-444444444444";

/** Thursday 24 September, afternoon: free to change until Wednesday noon. */
const THURSDAY_NOON = "2026-09-24T06:30:00.000Z";
/** Tuesday 22 September, morning: inside 24 hours from NOW. */
const TUESDAY_MORNING = "2026-09-22T03:30:00.000Z";

let cookie: string;

beforeEach(async () => {
  await markDatabase();
  for (const [id, resource, name, initials] of [
    ["t1", "resource-1", "Imran Qureshi", "IQ"],
    ["t2", "resource-2", "Vikram Sethi", "VS"],
  ]) {
    await env.DB.prepare(
      "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)",
    )
      .bind(id, resource, name, initials, NOW.toISOString())
      .run();
  }
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name, fsm_contact_id)
     VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra', 'contact-1')`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
});

/** A booked, paid visit with Imran. */
async function booked(type: string, start: string, amount: number) {
  const minutes = type === "first_fit" ? 180 : 90;
  const end = new Date(new Date(start).getTime() + minutes * 60_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, status, fsm_status, window_start,
       window_end, technician_id, fsm_modified_at, synced_at)
     VALUES (?1, 'fsm-visit-1', 'fsm-order-1', ?2, ?3, 'scheduled', 'Scheduled', ?4, ?5, 't1', ?6, ?6)`,
  )
    .bind(VISIT, PERSON, type, start, end, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO payments (id, reference, person_id, appointment_id, razorpay_payment_id, amount, currency, method,
       status, captured_at, created_at, updated_at)
     VALUES (?1, 'MM-2026-0841', ?2, ?3, 'pay_visit', ?4, 'INR', 'upi', 'captured', ?5, ?5, ?5)`,
  )
    .bind(PAYMENT, PERSON, VISIT, amount, "2026-09-20T06:30:00.000Z")
    .run();
}

const world = () => ({
  ...EMPTY_FSM,
  items: [
    { id: "item-service", name: "Service visit", type: "Service" as const, price: null },
    { id: "item-fit", name: "First fit", type: "Service" as const, price: null },
  ],
});

function client(overrides: Parameters<typeof fakeDependencies>[0] = {}, settings = {}) {
  return appFor("local", fakeDependencies(overrides), settings, "client");
}

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

const get = (app: ReturnType<typeof appFor>, path: string) => request(app, path, { headers: { Cookie: cookie } });

const visitRow = () =>
  env.DB.prepare("SELECT status, window_start, window_end FROM appointments WHERE id = ?1")
    .bind(VISIT)
    .first<{ status: string; window_start: string; window_end: string }>();

const changes = () =>
  env.DB.prepare(
    "SELECT kind, notice, refund_amount, kept_amount, payment_id, now_start FROM visit_changes ORDER BY created_at",
  ).all();

describe("POST /api/appointments/:id/cancel", () => {
  it("shows a free cancel's full refund first, then cancels in FSM and refunds to the source", async () => {
    await booked("service", THURSDAY_NOON, 200000);
    const fsm = createStubFsm(world());
    const payments = createStubPayments();
    const app = client({ fsm, payments });

    const shown = await post(app, `/api/appointments/${VISIT}/cancel`, { confirm: false });
    expect(await shown.json()).toEqual({
      visit_id: VISIT,
      type: "service",
      notice: "free",
      free_until: "2026-09-23T06:30:00.000Z",
      paid: 200000,
      credit: null,
      refund: 200000,
      kept: 0,
      destination: "upi",
      cancelled: false,
    });
    expect(fsm.made.cancelled).toEqual([]);

    const done = await post(app, `/api/appointments/${VISIT}/cancel`, { confirm: true, notice: "free" });
    expect(await done.json()).toMatchObject({ cancelled: true, refund: 200000, kept: 0 });
    expect(fsm.made.cancelled).toEqual([
      {
        workOrderId: "fsm-order-1",
        note: "Staging test: Cancelled by the client in the app, more than 24 hours ahead.",
      },
    ]);
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_visit", amount: 200000 }]);
    expect((await visitRow())?.status).toBe("cancelled");
    expect((await changes()).results).toEqual([
      {
        kind: "cancelled",
        notice: "free",
        refund_amount: 200000,
        kept_amount: 0,
        payment_id: PAYMENT,
        now_start: null,
      },
    ]);

    // Once cancelled, it cannot be again.
    expect((await post(app, `/api/appointments/${VISIT}/cancel`, { confirm: true, notice: "free" })).status).toBe(409);
    expect(payments.made.refunds).toHaveLength(1);
  });

  it("tells ops which visit and payment to refund by hand when Razorpay fails the refund, and where to find the client", async () => {
    await booked("service", THURSDAY_NOON, 200000);
    const deps = fakeDependencies({
      fsm: createStubFsm(world()),
      payments: { ...createStubPayments(), refund: () => Promise.reject(new Error("Razorpay 502")) },
    });
    const app = appFor("local", deps, {}, "client");

    const done = await post(app, `/api/appointments/${VISIT}/cancel`, { confirm: true, notice: "free" });
    expect(await done.json()).toMatchObject({ cancelled: true });
    expect(deps.alerts).toEqual([
      `The refund of Rs. 2000 for visit ${VISIT}, cancelled by the client, failed (Razorpay payment pay_visit). ` +
        `Refund it by hand in Razorpay, once. http://ops.localhost:4323/clients/${PERSON}`,
    ]);
  });

  it("keeps a service visit's payment inside 24 hours, and shows it as a charge with its evidence", async () => {
    await booked("service", TUESDAY_MORNING, 200000);
    const payments = createStubPayments();
    const app = client({ fsm: createStubFsm(world()), payments });
    const done = await post(app, `/api/appointments/${VISIT}/cancel`, { confirm: true, notice: "late" });
    expect(await done.json()).toMatchObject({ notice: "late", refund: 0, kept: 200000, cancelled: true });
    expect(payments.made.refunds).toEqual([]);

    const entry = await (await get(app, `/api/payments/${PAYMENT}`)).json();
    expect(entry).toMatchObject({
      purpose: "visit",
      charge: { change: "cancelled", at: NOW.toISOString(), visit_started_at: TUESDAY_MORNING, amount: 200000 },
    });
  });

  it("refunds a first fit less its late fee inside 24 hours", async () => {
    await booked("first_fit", TUESDAY_MORNING, 3000000);
    const payments = createStubPayments();
    const app = client({ fsm: createStubFsm(world()), payments });
    const shown = await (await post(app, `/api/appointments/${VISIT}/cancel`, { confirm: false })).json();
    expect(shown).toMatchObject({ notice: "late", refund: 2600000, kept: 400000 });
    await post(app, `/api/appointments/${VISIT}/cancel`, { confirm: true, notice: "late" });
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_visit", amount: 2600000 }]);
  });

  // BIZ-09 of the audit, 24 September 2026.
  it("keeps the late fee the visit was booked under, whatever the price book says since", async () => {
    await booked("first_fit", TUESDAY_MORNING, 3000000);
    await env.DB.prepare(
      `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount,
         amount_ex_gst, gst_percent, state, expires_at, created_at, updated_at, appointment_id, late_fee_ex_gst,
         late_fee_gst_percent)
       VALUES ('hold-fit', ?1, 'first_fit', '2026-09-22', 'morning', 't1', 0, 3000000, 3000000, 0, 'booked', ?2, ?2,
         ?2, ?3, 400000, 0)`,
    )
      .bind(PERSON, "2026-09-20T06:30:00.000Z", VISIT)
      .run();
    // Ops correct the late fee in force, which rewrites the very row the visit was sold under.
    await env.DB.prepare("UPDATE price_book SET amount_ex_gst = 500000 WHERE item = 'late_fee_first_fit'").run();
    const shown = await (await post(client(), `/api/appointments/${VISIT}/cancel`, { confirm: false })).json();
    expect(shown).toMatchObject({ notice: "late", refund: 2600000, kept: 400000 });
    const move = await (await post(client(), `/api/appointments/${VISIT}/reschedule`, {})).json();
    expect(move).toMatchObject({ cost: "late_fee", price: { amount: 400000 } });
  });

  // W5 of the audit, 24 September 2026 (BIZ-11).
  it("gives no credit back to a grant the guarantee refund took back, even when the cancel is free", async () => {
    await booked("service", THURSDAY_NOON, 0);
    await env.DB.prepare("DELETE FROM payments").run();
    await grantCredits(env.DB, { personId: PERSON, visits: 3, source: "referral", sourceId: "attr-1", now: NOW }).run();
    await (await redeemCredit(env.DB, PERSON, VISIT, NOW))?.run();
    await clawBack(env.DB, "referral", "attr-1", NOW);
    const app = client({ fsm: createStubFsm(world()) });

    const shown = await (await post(app, `/api/appointments/${VISIT}/cancel`, { confirm: false })).json();
    expect(shown).toMatchObject({ notice: "free", credit: "lost" });
    await post(app, `/api/appointments/${VISIT}/cancel`, { confirm: true, notice: "free" });
    const restored = await env.DB.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'restore'").first();
    expect(restored).toEqual({ n: 0 });
    expect((await creditBalance(env.DB, PERSON, NOW)).visits).toBe(0);
  });

  it("refuses to cancel on terms the client was not shown", async () => {
    await booked("service", TUESDAY_MORNING, 200000);
    const fsm = createStubFsm(world());
    const app = client({ fsm });
    const answer = await post(app, `/api/appointments/${VISIT}/cancel`, { confirm: true, notice: "free" });
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "terms_changed" } });
    expect(fsm.made.cancelled).toEqual([]);
  });

  it("changes nothing when FSM fails, so the client can try again", async () => {
    await booked("service", THURSDAY_NOON, 200000);
    const failing: FsmProvider = {
      ...createStubFsm(world()),
      cancelVisit: () => Promise.reject(new Error("Zoho 503 UNAVAILABLE")),
    };
    const payments = createStubPayments();
    const app = client({ fsm: failing, payments });
    const answer = await post(app, `/api/appointments/${VISIT}/cancel`, { confirm: true, notice: "free" });
    expect(answer.status).toBe(503);
    expect((await visitRow())?.status).toBe("scheduled");
    expect((await changes()).results).toEqual([]);
    expect(payments.made.refunds).toEqual([]);
  });

  it("refuses a visit that has started, has passed, is another client's, or while self-serve is off", async () => {
    await booked("service", THURSDAY_NOON, 200000);
    await env.DB.prepare("UPDATE appointments SET status = 'in_progress' WHERE id = ?1").bind(VISIT).run();
    const app = client();
    expect((await post(app, `/api/appointments/${VISIT}/cancel`, { confirm: false })).status).toBe(409);
    await env.DB.prepare("UPDATE appointments SET status = 'scheduled', person_id = NULL WHERE id = ?1")
      .bind(VISIT)
      .run();
    expect((await post(app, `/api/appointments/${VISIT}/cancel`, { confirm: false })).status).toBe(409);
    const off = client({}, { selfServeBooking: false });
    const answer = await post(off, `/api/appointments/${VISIT}/cancel`, { confirm: false });
    expect(await answer.json()).toMatchObject({ error: { code: "ops_assisted" } });
  });
});

describe("POST /api/appointments/:id/reschedule: the terms", () => {
  it("is free more than 24 hours out", async () => {
    await booked("service", THURSDAY_NOON, 200000);
    const terms = await (await post(client(), `/api/appointments/${VISIT}/reschedule`, {})).json();
    expect(terms).toEqual({
      visit_id: VISIT,
      type: "service",
      notice: "free",
      free_until: "2026-09-23T06:30:00.000Z",
      paid: 200000,
      credit: null,
      cost: "free",
      price: { amount_ex_gst: 0, amount: 0, gst_percent: 0 },
    });
  });

  it("costs a first fit its late fee inside 24 hours, and a service visit a new payment", async () => {
    await booked("first_fit", TUESDAY_MORNING, 3000000);
    const fit = await (await post(client(), `/api/appointments/${VISIT}/reschedule`, {})).json();
    expect(fit).toMatchObject({ notice: "late", cost: "late_fee", price: { amount: 400000 } });

    await env.DB.prepare("UPDATE appointments SET type = 'service' WHERE id = ?1").bind(VISIT).run();
    const service = await (await post(client(), `/api/appointments/${VISIT}/reschedule`, {})).json();
    expect(service).toMatchObject({ notice: "late", cost: "charged", price: { amount: 200000 } });
  });
});

describe("moving a visit", () => {
  async function hold(app: ReturnType<typeof appFor>, type: string, date: string, window: string) {
    const answer = await post(app, "/api/holds", { type, date, window, moving: VISIT });
    expect(answer.status).toBe(201);
    return answer.json<{
      id: string;
      price: { amount: number };
      technician: { name: string };
      moves_visit_id: string;
    }>();
  }

  it("offers only the visit's technician, leaving its own time out", async () => {
    await booked("service", THURSDAY_NOON, 200000);
    // Imran's own visit that Thursday afternoon does not count against its move.
    const answer = await get(client(), `/api/availability?type=service&from=2026-09-24&moving=${VISIT}`);
    const body = await answer.json<{
      regular: { name: string };
      price: { amount: number };
      days: { date: string; windows: { window: string; with: string | null }[] }[];
    }>();
    expect(body.regular.name).toBe("Imran Qureshi");
    expect(body.price.amount).toBe(0);
    expect(body.days[0]?.windows).toEqual([
      { window: "morning", with: "regular" },
      { window: "afternoon", with: "regular" },
      { window: "evening", with: "regular" },
    ]);
  });

  it("moves a visit for free in place: FSM reschedules it, and its payment carries over", async () => {
    await booked("service", THURSDAY_NOON, 200000);
    const app = client();
    const held = await hold(app, "service", "2026-09-25", "evening");
    expect(held).toMatchObject({ price: { amount: 0 }, technician: { name: "Imran Qureshi" }, moves_visit_id: VISIT });

    const queue = fakeQueue();
    const started = await post(
      app,
      `/api/appointments/${VISIT}/reschedule`,
      { hold_id: held.id },
      { FSM_QUEUE: queue },
    );
    expect(await started.json()).toEqual({ hold_id: held.id, checkout: null });
    expect(queue.sent).toEqual([{ hold_id: held.id, request_id: expect.any(String) as string }]);

    const fsm = createStubFsm(world());
    expect(await confirmBooking(env.DB, fsm, createStubPayments(), held.id, NOW, { labelAsTest: true })).toBe("booked");
    expect(fsm.made.rescheduled).toEqual([
      { appointmentId: "fsm-visit-1", start: "2026-09-25T16:00:00+05:30", end: "2026-09-25T17:30:00+05:30" },
    ]);
    expect(fsm.made.visits).toEqual([]);
    expect(await visitRow()).toEqual({
      status: "scheduled",
      window_start: "2026-09-25T10:30:00.000Z",
      window_end: "2026-09-25T12:00:00.000Z",
    });
    expect((await changes()).results).toEqual([
      {
        kind: "moved",
        notice: "free",
        refund_amount: 0,
        kept_amount: 0,
        payment_id: null,
        now_start: "2026-09-25T10:30:00.000Z",
      },
    ]);
    const polled = await (await get(app, `/api/holds/${held.id}`)).json();
    expect(polled).toMatchObject({ state: "booked", visit_id: VISIT });
  });

  it("moves a first fit inside 24 hours once its late fee is paid, keeping the fee as a charge", async () => {
    await booked("first_fit", TUESDAY_MORNING, 3000000);
    const payments = createStubPayments();
    const app = client({ payments });
    const held = await hold(app, "first_fit", "2026-09-28", "morning");
    expect(held.price.amount).toBe(400000);
    const started = await post(app, `/api/appointments/${VISIT}/reschedule`, { hold_id: held.id });
    expect(await started.json()).toMatchObject({
      checkout: { amount: 400000, description: "Moving your first fit to 2026-09-28" },
    });

    const fsm = createStubFsm(world());
    expect(await confirmBooking(env.DB, fsm, payments, held.id, NOW, { labelAsTest: true })).toBe("not_paid");
    await env.DB.prepare(
      `INSERT INTO payments (id, person_id, razorpay_order_id, razorpay_payment_id, amount, currency, method, status,
         captured_at, created_at, updated_at)
       SELECT ?3, person_id, razorpay_order_id, 'pay_fee', amount, 'INR', 'upi', 'captured', ?1, ?1, ?1
       FROM slot_holds WHERE id = ?2`,
    )
      .bind(NOW.toISOString(), held.id, FEE)
      .run();
    expect(await confirmBooking(env.DB, fsm, payments, held.id, NOW, { labelAsTest: true })).toBe("booked");
    expect(fsm.made.rescheduled).toHaveLength(1);
    expect((await changes()).results).toEqual([
      expect.objectContaining({ kind: "moved", notice: "late", kept_amount: 400000, payment_id: FEE }),
    ]);
    const fee = await (await get(app, `/api/payments/${FEE}`)).json();
    expect(fee).toMatchObject({ purpose: "late_fee", charge: { change: "moved", amount: 400000 } });
    // The fit's own payment carried over, untouched.
    const fit = await (await get(app, `/api/payments/${PAYMENT}`)).json();
    expect(fit).toMatchObject({ purpose: "visit", charge: null, refunded_amount: 0 });
  });

  it("replaces a service visit moved inside 24 hours: a new visit is booked, the old one cancelled and charged", async () => {
    await booked("service", TUESDAY_MORNING, 200000);
    const app = client();
    const held = await hold(app, "service", "2026-09-26", "afternoon");
    expect(held.price.amount).toBe(200000);
    await post(app, `/api/appointments/${VISIT}/reschedule`, { hold_id: held.id });
    await env.DB.prepare(
      `INSERT INTO payments (id, person_id, razorpay_order_id, razorpay_payment_id, amount, currency, method, status,
         captured_at, created_at, updated_at)
       SELECT 'new-1', person_id, razorpay_order_id, 'pay_new', amount, 'INR', 'upi', 'captured', ?1, ?1, ?1
       FROM slot_holds WHERE id = ?2`,
    )
      .bind(NOW.toISOString(), held.id)
      .run();

    const fsm = createStubFsm(world());
    expect(await confirmBooking(env.DB, fsm, createStubPayments(), held.id, NOW, { labelAsTest: true })).toBe("booked");
    expect(fsm.made.visits).toHaveLength(1);
    expect(fsm.made.cancelled).toEqual([
      {
        workOrderId: "fsm-order-1",
        note: "Staging test: Moved by the client inside 24 hours, to a new visit; charged.",
      },
    ]);
    expect((await visitRow())?.status).toBe("cancelled");
    expect((await changes()).results).toEqual([
      expect.objectContaining({ kind: "replaced", notice: "late", kept_amount: 200000, payment_id: PAYMENT }),
    ]);
    const old = await (await get(app, `/api/payments/${PAYMENT}`)).json();
    expect(old).toMatchObject({ charge: { change: "moved", amount: 200000 } });

    // Told again, nothing is cancelled twice.
    await confirmBooking(env.DB, fsm, createStubPayments(), held.id, NOW, { labelAsTest: true });
    expect(fsm.made.cancelled).toHaveLength(1);
  });

  it("cancels the replaced visit on a later try, when FSM failed the first time", async () => {
    await booked("service", TUESDAY_MORNING, 200000);
    const app = client();
    const held = await hold(app, "service", "2026-09-26", "afternoon");
    await post(app, `/api/appointments/${VISIT}/reschedule`, { hold_id: held.id });
    await env.DB.prepare(
      `INSERT INTO payments (id, person_id, razorpay_order_id, razorpay_payment_id, amount, currency, method, status,
         captured_at, created_at, updated_at)
       SELECT 'new-1', person_id, razorpay_order_id, 'pay_new', amount, 'INR', 'upi', 'captured', ?1, ?1, ?1
       FROM slot_holds WHERE id = ?2`,
    )
      .bind(NOW.toISOString(), held.id)
      .run();
    const stub = createStubFsm(world());
    const failing: FsmProvider = { ...stub, cancelVisit: () => Promise.reject(new Error("Zoho 503")) };
    await expect(
      confirmBooking(env.DB, failing, createStubPayments(), held.id, NOW, { labelAsTest: true }),
    ).rejects.toThrow("503");
    expect((await visitRow())?.status).toBe("scheduled");
    expect(await confirmBooking(env.DB, stub, createStubPayments(), held.id, NOW, { labelAsTest: true })).toBe(
      "already_booked",
    );
    expect(stub.made.cancelled).toHaveLength(1);
    expect((await visitRow())?.status).toBe("cancelled");
  });

  it("gives the late fee back when the visit started before the move was confirmed", async () => {
    await booked("first_fit", TUESDAY_MORNING, 3000000);
    const payments = createStubPayments();
    const app = client({ payments });
    const held = await hold(app, "first_fit", "2026-09-28", "morning");
    await post(app, `/api/appointments/${VISIT}/reschedule`, { hold_id: held.id });
    await env.DB.prepare(
      `INSERT INTO payments (id, person_id, razorpay_order_id, razorpay_payment_id, amount, currency, method, status,
         captured_at, created_at, updated_at)
       SELECT ?3, person_id, razorpay_order_id, 'pay_fee', amount, 'INR', 'upi', 'captured', ?1, ?1, ?1
       FROM slot_holds WHERE id = ?2`,
    )
      .bind(NOW.toISOString(), held.id, FEE)
      .run();
    await env.DB.prepare("UPDATE appointments SET status = 'in_progress' WHERE id = ?1").bind(VISIT).run();
    const fsm = createStubFsm(world());
    expect(await confirmBooking(env.DB, fsm, payments, held.id, NOW, { labelAsTest: true })).toBe("refunded");
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_fee", amount: 400000 }]);
    expect(fsm.made.rescheduled).toEqual([]);
  });

  it("refuses a move of another type, or of a visit no longer ahead", async () => {
    await booked("service", THURSDAY_NOON, 200000);
    const app = client();
    const wrong = await post(app, "/api/holds", {
      type: "first_fit",
      date: "2026-09-25",
      window: "morning",
      moving: VISIT,
    });
    expect(wrong.status).toBe(409);
    await env.DB.prepare("UPDATE appointments SET status = 'completed' WHERE id = ?1").bind(VISIT).run();
    expect((await post(app, `/api/appointments/${VISIT}/reschedule`, {})).status).toBe(409);
    expect((await get(app, `/api/availability?type=service&moving=${VISIT}`)).status).toBe(409);
  });
});
