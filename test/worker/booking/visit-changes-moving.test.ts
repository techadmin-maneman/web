// A client moving or cancelling a visit (src/routes/client/changes.ts, src/domain/visits/visit-changes.ts, and the move
// in confirmBooking). NOW is Monday 21 September 2026, 12 noon in India; the price book is at 0% from 22 September.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { confirmBooking } from "../../../src/domain/booking/bookings.ts";
import { listCodes, makeCodes } from "../../../src/domain/money/discount-codes.ts";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { createStubPayments } from "../../../src/providers/payments/stub.ts";
import { appFor, failingAfterTheFirstBatch, markDatabase, NOW, request, savedAddress } from "../helpers.ts";
import { createLogger } from "../../../src/log.ts";
import {
  PERSON,
  VISIT,
  PAYMENT,
  THURSDAY_NOON,
  TUESDAY_MORNING,
  booked,
  client,
  visitRow,
  changes,
} from "./visit-changes-fixtures.ts";

const FEE = "44444444-4444-4444-8444-444444444444";

let cookie: string;

beforeEach(async () => {
  await markDatabase();
  for (const [id, name, initials] of [
    ["t1", "Imran Qureshi", "IQ"],
    ["t2", "Vikram Sethi", "VS"],
  ]) {
    await env.DB.prepare(
      "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES (?1, ?1, ?2, ?3, 1, ?4)",
    )
      .bind(id, name, initials, NOW.toISOString())
      .run();
  }
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name)
     VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  await savedAddress(PERSON);
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

const get = (app: ReturnType<typeof appFor>, path: string) => request(app, path, { headers: { Cookie: cookie } });

/** The hold's payment, captured by Razorpay. */
const paidFor = (holdId: string, paymentId: string) =>
  env.DB.prepare(
    `INSERT INTO payments (id, person_id, razorpay_order_id, razorpay_payment_id, amount, currency, method, status,
       captured_at, created_at, updated_at)
     SELECT ?3, person_id, razorpay_order_id, ?4, amount, 'INR', 'upi', 'captured', ?1, ?1, ?1
     FROM slot_holds WHERE id = ?2`,
  )
    .bind(NOW.toISOString(), holdId, crypto.randomUUID(), paymentId)
    .run();

/** Imran's check-in, landed from his phone, the visit's status as it was. */
const checkedIn = () =>
  env.DB.prepare(
    `INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at,
       updated_at)
     VALUES (?1, ?2, 'event-checkin-01', 't1', 'check_in', '{}', ?3, ?3, ?3)`,
  )
    .bind(crypto.randomUUID(), VISIT, NOW.toISOString())
    .run();

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
      price: { amount: number };
      days: { date: string; windows: { window: string; open: boolean }[] }[];
    }>();
    expect(body.price.amount).toBe(0);
    expect(body.days[0]?.windows.map(({ window, open }) => ({ window, open }))).toEqual([
      { window: "morning", open: true },
      { window: "afternoon", open: true },
      { window: "evening", open: true },
    ]);
  });

  it("moves a visit for free in place, in the request, and its payment carries over", async () => {
    await booked("service", THURSDAY_NOON, 200000);
    const app = client();
    const held = await hold(app, "service", "2026-09-25", "evening");
    expect(held).toMatchObject({ price: { amount: 0 }, technician: { name: "Imran Qureshi" }, moves_visit_id: VISIT });

    const started = await post(app, `/api/appointments/${VISIT}/reschedule`, { hold_id: held.id });
    expect(await started.json()).toEqual({ hold_id: held.id, checkout: null });
    const visits = await env.DB.prepare("SELECT COUNT(*) AS n FROM appointments").first<{ n: number }>();
    expect(visits?.n).toBe(1);
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
      checkout: { amount: 400000, description: "Moving your visit to Mon 28 Sep" },
    });

    expect(await confirmBooking({ db: env.DB, payments: payments, now: NOW, log: createLogger() }, held.id)).toBe(
      "not_paid",
    );
    await env.DB.prepare(
      `INSERT INTO payments (id, person_id, razorpay_order_id, razorpay_payment_id, amount, currency, method, status,
         captured_at, created_at, updated_at)
       SELECT ?3, person_id, razorpay_order_id, 'pay_fee', amount, 'INR', 'upi', 'captured', ?1, ?1, ?1
       FROM slot_holds WHERE id = ?2`,
    )
      .bind(NOW.toISOString(), held.id, FEE)
      .run();
    expect(await confirmBooking({ db: env.DB, payments: payments, now: NOW, log: createLogger() }, held.id)).toBe(
      "booked",
    );
    expect((await visitRow())?.window_start).toBe("2026-09-28T03:30:00.000Z");
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

    expect(
      await confirmBooking({ db: env.DB, payments: createStubPayments(), now: NOW, log: createLogger() }, held.id),
    ).toBe("booked");
    const visits = await env.DB.prepare("SELECT status FROM appointments ORDER BY window_start").all();
    expect(visits.results).toEqual([{ status: "cancelled" }, { status: "scheduled" }]);
    expect((await visitRow())?.status).toBe("cancelled");
    expect((await changes()).results).toEqual([
      expect.objectContaining({ kind: "replaced", notice: "late", kept_amount: 200000, payment_id: PAYMENT }),
    ]);
    const old = await (await get(app, `/api/payments/${PAYMENT}`)).json();
    expect(old).toMatchObject({ charge: { change: "moved", amount: 200000 } });

    // Told again, nothing is booked or cancelled twice.
    expect(
      await confirmBooking({ db: env.DB, payments: createStubPayments(), now: NOW, log: createLogger() }, held.id),
    ).toBe("already_booked");
    expect((await changes()).results).toHaveLength(1);
    const again = await env.DB.prepare("SELECT COUNT(*) AS n FROM appointments").first<{ n: number }>();
    expect(again?.n).toBe(2);
  });

  // A visit's discount code moves with it (docs/decisions/0108-discount-codes.md).
  it("carries the visit's discount code to the visit a late move books, the code counted once", async () => {
    await booked("service", TUESDAY_MORNING, 180000);
    const made = { actor: { kind: "staff", id: "ops@localhost" }, requestId: "r", now: NOW } as const;
    const terms = { count: 1, kind: "percent", value: 10, cap: null, covers: ["service"], expiresOn: null } as const;
    await makeCodes(env.DB, { ...terms, code: "TENPC", maxUses: 1, oncePerClient: false }, made);
    await env.DB.prepare(
      `INSERT INTO discount_code_uses (id, code_id, person_id, appointment_id, amount_off, given_by, given_by_id,
         created_at)
       SELECT 'use-1', id, ?1, ?2, 20000, 'ops', 'ops@localhost', ?3 FROM discount_codes WHERE code = 'TENPC'`,
    )
      .bind(PERSON, VISIT, NOW.toISOString())
      .run();
    const app = client();
    const held = await hold(app, "service", "2026-09-26", "afternoon");
    expect(held).toMatchObject({ price: { amount: 180000 }, discount: { code: "TENPC", amount_ex_gst: 20000 } });

    await post(app, `/api/appointments/${VISIT}/reschedule`, { hold_id: held.id });
    await env.DB.prepare(
      `INSERT INTO payments (id, person_id, razorpay_order_id, razorpay_payment_id, amount, currency, method, status,
         captured_at, created_at, updated_at)
       SELECT 'new-1', person_id, razorpay_order_id, 'pay_new', amount, 'INR', 'upi', 'captured', ?1, ?1, ?1
       FROM slot_holds WHERE id = ?2`,
    )
      .bind(NOW.toISOString(), held.id)
      .run();
    expect(
      await confirmBooking({ db: env.DB, payments: createStubPayments(), now: NOW, log: createLogger() }, held.id),
    ).toBe("booked");
    expect((await visitRow())?.status).toBe("cancelled");
    // The visit moved is cancelled, so its use stands no more: the code counts the new visit's alone.
    const [code] = await listCodes(env.DB, NOW, "TENPC");
    expect(code?.uses).toBe(1);
  });

  it("cancels the replaced visit on a later try, when the first stopped once the new one was booked", async () => {
    await booked("service", TUESDAY_MORNING, 200000);
    const app = client();
    const held = await hold(app, "service", "2026-09-26", "afternoon");
    await post(app, `/api/appointments/${VISIT}/reschedule`, { hold_id: held.id });
    await paidFor(held.id, "pay_new");
    await expect(
      confirmBooking(
        { db: failingAfterTheFirstBatch(env.DB), payments: createStubPayments(), now: NOW, log: createLogger() },
        held.id,
      ),
    ).rejects.toThrow("Network connection lost");
    expect((await visitRow())?.status).toBe("scheduled");
    expect(
      await confirmBooking({ db: env.DB, payments: createStubPayments(), now: NOW, log: createLogger() }, held.id),
    ).toBe("already_booked");
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
    expect(await confirmBooking({ db: env.DB, payments: payments, now: NOW, log: createLogger() }, held.id)).toBe(
      "refunded",
    );
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_fee", amount: 400000 }]);
    expect((await visitRow())?.window_start).toBe(TUESDAY_MORNING);
  });

  it("gives the late fee back when the technician checked in before the move was confirmed, whatever the status says", async () => {
    await booked("first_fit", TUESDAY_MORNING, 3000000);
    const payments = createStubPayments();
    const app = client({ payments });
    const held = await hold(app, "first_fit", "2026-09-28", "morning");
    await post(app, `/api/appointments/${VISIT}/reschedule`, { hold_id: held.id });
    await paidFor(held.id, "pay_fee");
    await checkedIn();
    expect(await confirmBooking({ db: env.DB, payments: payments, now: NOW, log: createLogger() }, held.id)).toBe(
      "refunded",
    );
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_fee", amount: 400000 }]);
    expect(await visitRow()).toMatchObject({ status: "scheduled", window_start: TUESDAY_MORNING });
  });

  it("gives the late fee back, moving nothing, when the visit went to another technician before it was booked", async () => {
    await booked("first_fit", TUESDAY_MORNING, 3000000);
    const payments = createStubPayments();
    const app = client({ payments });
    const held = await hold(app, "first_fit", "2026-09-28", "morning");
    await post(app, `/api/appointments/${VISIT}/reschedule`, { hold_id: held.id });
    await paidFor(held.id, "pay_fee");
    await env.DB.prepare("UPDATE appointments SET technician_id = 't2' WHERE id = ?1").bind(VISIT).run();

    expect(await confirmBooking({ db: env.DB, payments: payments, now: NOW, log: createLogger() }, held.id)).toBe(
      "refunded",
    );
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_fee", amount: 400000 }]);
    expect(await visitRow()).toMatchObject({ window_start: TUESDAY_MORNING });
    const told = await env.DB.prepare("SELECT kind, subject_id FROM outbound_messages").all();
    expect(told.results).toEqual([{ kind: "booking_refunded", subject_id: held.id }]);
  });

  it("books nothing in place of a visit the technician checked in to before a late move was confirmed", async () => {
    await booked("service", TUESDAY_MORNING, 200000);
    const payments = createStubPayments();
    const app = client({ payments });
    const held = await hold(app, "service", "2026-09-26", "afternoon");
    await post(app, `/api/appointments/${VISIT}/reschedule`, { hold_id: held.id });
    await paidFor(held.id, "pay_new");
    await checkedIn();
    expect(await confirmBooking({ db: env.DB, payments: payments, now: NOW, log: createLogger() }, held.id)).toBe(
      "refunded",
    );
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_new", amount: 200000 }]);
    const visits = await env.DB.prepare("SELECT id, status FROM appointments").all();
    expect(visits.results).toEqual([{ id: VISIT, status: "scheduled" }]);
  });

  it("never cancels a visit the technician began after its replacement was booked, and tells ops", async () => {
    await booked("service", TUESDAY_MORNING, 200000);
    const app = client();
    const held = await hold(app, "service", "2026-09-26", "afternoon");
    await post(app, `/api/appointments/${VISIT}/reschedule`, { hold_id: held.id });
    await paidFor(held.id, "pay_new");
    await expect(
      confirmBooking(
        { db: failingAfterTheFirstBatch(env.DB), payments: createStubPayments(), now: NOW, log: createLogger() },
        held.id,
      ),
    ).rejects.toThrow("Network connection lost");
    await checkedIn();

    const told: string[] = [];
    const alertOnce = (alert: { key: string }) => {
      told.push(alert.key);
      return Promise.resolve();
    };
    expect(
      await confirmBooking(
        { db: env.DB, payments: createStubPayments(), now: NOW, alertOnce, log: createLogger() },
        held.id,
      ),
    ).toBe("already_booked");
    expect((await visitRow())?.status).toBe("scheduled");
    expect(told).toEqual([`replaced_after_begun:${VISIT}`]);
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
    expect((await get(app, `/api/appointments/${VISIT}/reschedule`)).status).toBe(409);
    expect((await get(app, `/api/availability?type=service&moving=${VISIT}`)).status).toBe(409);
  });
});
