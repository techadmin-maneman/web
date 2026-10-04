// A client moving or cancelling a visit (src/routes/client-changes.ts, src/domain/visit-changes.ts, and the move
// in confirmBooking). NOW is Monday 21 September 2026, 12 noon in India; the price book is at 0% from 22 September.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { confirmBooking } from "../../src/domain/bookings.ts";
import { clawBack, creditBalance, grantCredits, redeemCredit } from "../../src/domain/credits.ts";
import { listCodes, makeCodes } from "../../src/domain/discount-codes.ts";
import { moveJob } from "../../src/domain/dispatch.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { createStubPayments, PaymentUnanswered, type PaymentsProvider } from "../../src/providers/payments.ts";
import type { MoveReason } from "../../src/policy/dispatch.ts";
import {
  appFor,
  failingAfterTheFirstBatch,
  fakeDependencies,
  markDatabase,
  NOW,
  request,
  savedAddress,
} from "./helpers.ts";

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

/** A booked, paid visit with Imran. */
async function booked(type: string, start: string, amount: number) {
  const minutes = type === "first_fit" ? 180 : 90;
  const end = new Date(new Date(start).getTime() + minutes * 60_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id,
       synced_at)
     VALUES (?1, ?1, ?2, ?3, 'scheduled', ?4, ?5, 't1', ?6)`,
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

const changes = () =>
  env.DB.prepare(
    "SELECT kind, notice, refund_amount, kept_amount, payment_id, now_start FROM visit_changes ORDER BY created_at",
  ).all();

describe("POST /api/appointments/:id/cancel", () => {
  it("shows a free cancel's full refund first, then cancels the visit and refunds to the source", async () => {
    await booked("service", THURSDAY_NOON, 200000);
    const payments = createStubPayments();
    const app = client({ payments });

    const shown = await post(app, `/api/appointments/${VISIT}/cancel`, { confirm: false });
    expect(await shown.json()).toEqual({
      visit_id: VISIT,
      type: "service",
      notice: "free",
      notice_hours: 24,
      free_until: "2026-09-23T06:30:00.000Z",
      paid: 200000,
      credit: null,
      refund: 200000,
      kept: 0,
      destination: "upi",
      cancelled: false,
      refund_pending: false,
    });
    expect((await visitRow())?.status).toBe("scheduled");

    const done = await post(app, `/api/appointments/${VISIT}/cancel`, { confirm: true, notice: "free" });
    expect(await done.json()).toMatchObject({ cancelled: true, refund: 200000, kept: 0 });
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
      payments: { ...createStubPayments(), refund: () => Promise.reject(new Error("Razorpay 502")) },
    });
    const app = appFor("local", deps, {}, "client");

    const done = await post(app, `/api/appointments/${VISIT}/cancel`, { confirm: true, notice: "free" });
    expect(await done.json()).toMatchObject({ cancelled: true });
    expect(deps.alerts).toEqual([
      `The refund of Rs. 2000 for visit ${VISIT}, cancelled by the client, failed (Razorpay payment pay_visit). ` +
        `Refund it by hand in Razorpay, once. http://ops.localhost:4323/clients/${PERSON}/payments`,
    ]);
  });

  // docs/open-points.md, item 161: ops were told to refund by hand a refund Razorpay may have made.
  it("refunds a cancel once, and tells ops nothing, when Razorpay made the refund but its answer was lost", async () => {
    await booked("service", THURSDAY_NOON, 200000);
    const payments = createStubPayments();
    let asked = 0;
    const losing: PaymentsProvider = {
      ...payments,
      refund: async (paymentId, refund) => {
        asked += 1;
        const made = await payments.refund(paymentId, refund);
        if (asked === 1) throw new PaymentUnanswered("refund", new Error("The operation timed out."));
        return made;
      },
    };
    const deps = fakeDependencies({ payments: losing });
    const done = await post(appFor("local", deps, {}, "client"), `/api/appointments/${VISIT}/cancel`, {
      confirm: true,
      notice: "free",
    });
    expect(await done.json()).toMatchObject({ cancelled: true, refund: 200000 });
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_visit", amount: 200000 }]);
    expect(deps.alerts).toEqual([]);
  });

  it("tells ops to look in Razorpay before refunding by hand, when Razorpay will not say it refunded", async () => {
    await booked("service", THURSDAY_NOON, 200000);
    const silent = () => Promise.reject(new PaymentUnanswered("refund", new Error("The operation timed out.")));
    const deps = fakeDependencies({ payments: { ...createStubPayments(), refund: silent } });
    const app = appFor("local", deps, {}, "client");

    const done = await post(app, `/api/appointments/${VISIT}/cancel`, { confirm: true, notice: "free" });
    expect(await done.json()).toMatchObject({ cancelled: true });
    expect(deps.alerts).toEqual([
      `Razorpay did not answer the refund of Rs. 2000 for visit ${VISIT}, cancelled by the client (payment ` +
        "pay_visit), so it may have been made. Look at the payment in Razorpay, and refund it by hand only if no " +
        `refund of Rs. 2000 is there. http://ops.localhost:4323/clients/${PERSON}/payments`,
    ]);
  });

  it("keeps a service visit's payment inside 24 hours, and shows it as a charge with its evidence", async () => {
    await booked("service", TUESDAY_MORNING, 200000);
    const payments = createStubPayments();
    const app = client({ payments });
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
    const app = client({ payments });
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
    const move = await (await get(client(), `/api/appointments/${VISIT}/reschedule`)).json();
    expect(move).toMatchObject({ cost: "late_fee", price: { amount: 400000 } });
  });

  // W5 of the audit, 24 September 2026 (BIZ-11).
  it("gives no credit back to a grant the guarantee refund took back, even when the cancel is free", async () => {
    await booked("service", THURSDAY_NOON, 0);
    await env.DB.prepare("DELETE FROM payments").run();
    await grantCredits(env.DB, { personId: PERSON, visits: 3, source: "referral", sourceId: "attr-1", now: NOW }).run();
    await redeemCredit(env.DB, PERSON, VISIT, NOW).run();
    await clawBack(env.DB, "referral", "attr-1", NOW);
    const app = client();

    const shown = await (await post(app, `/api/appointments/${VISIT}/cancel`, { confirm: false })).json();
    expect(shown).toMatchObject({ notice: "free", credit: "lost" });
    await post(app, `/api/appointments/${VISIT}/cancel`, { confirm: true, notice: "free" });
    const restored = await env.DB.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'restore'").first();
    expect(restored).toEqual({ n: 0 });
    expect((await creditBalance(env.DB, PERSON, NOW)).visits).toBe(0);
  });

  it("refuses to cancel on terms the client was not shown", async () => {
    await booked("service", TUESDAY_MORNING, 200000);
    const answer = await post(client(), `/api/appointments/${VISIT}/cancel`, { confirm: true, notice: "free" });
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "terms_changed" } });
    expect((await visitRow())?.status).toBe("scheduled");
  });

  it("changes nothing when the cancel cannot be written, so the client can try again", async () => {
    await booked("service", THURSDAY_NOON, 200000);
    const payments = createStubPayments();
    const deps = fakeDependencies({ payments });
    const lost: Pick<D1Database, "prepare" | "batch"> = {
      prepare: (sql) => env.DB.prepare(sql),
      batch: () => Promise.reject(new Error("D1_ERROR: Network connection lost.")),
    };

    const answer = await post(
      appFor("local", deps, {}, "client"),
      `/api/appointments/${VISIT}/cancel`,
      { confirm: true, notice: "free" },
      { DB: lost as D1Database },
    );
    expect(answer.status).toBe(503);
    expect((await visitRow())?.status).toBe("scheduled");
    expect((await changes()).results).toEqual([]);
    expect(payments.made.refunds).toEqual([]);

    const again = await post(appFor("local", deps, {}, "client"), `/api/appointments/${VISIT}/cancel`, {
      confirm: true,
      notice: "free",
    });
    expect(await again.json()).toMatchObject({ cancelled: true, refund: 200000 });
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_visit", amount: 200000 }]);
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

describe("GET /api/appointments/:id/reschedule: the terms", () => {
  it("is free more than 24 hours out", async () => {
    await booked("service", THURSDAY_NOON, 200000);
    const terms = await (await get(client(), `/api/appointments/${VISIT}/reschedule`)).json();
    expect(terms).toEqual({
      visit_id: VISIT,
      type: "service",
      notice: "free",
      notice_hours: 24,
      free_until: "2026-09-23T06:30:00.000Z",
      paid: 200000,
      credit: null,
      cost: "free",
      price: { amount_ex_gst: 0, amount: 0, gst_percent: 0 },
    });
  });

  it("costs a first fit its late fee inside 24 hours, and a service visit a new payment", async () => {
    await booked("first_fit", TUESDAY_MORNING, 3000000);
    const fit = await (await get(client(), `/api/appointments/${VISIT}/reschedule`)).json();
    expect(fit).toMatchObject({ notice: "late", cost: "late_fee", price: { amount: 400000 } });

    await env.DB.prepare("UPDATE appointments SET type = 'service' WHERE id = ?1").bind(VISIT).run();
    const service = await (await get(client(), `/api/appointments/${VISIT}/reschedule`)).json();
    expect(service).toMatchObject({ notice: "late", cost: "charged", price: { amount: 200000 } });
  });
});

/**
 * The notice and what each kind costs inside it are ops' to set, and a visit keeps the terms it was booked under, on
 * the hold that booked it (docs/decisions/0088-every-policy-in-the-console.md). A visit no hold sold takes the terms
 * in force; one booked before holds kept terms took the committed ones.
 */
describe("the terms a visit was booked under", () => {
  const opsSet = (name: string, value: unknown) =>
    env.DB.prepare("INSERT OR REPLACE INTO ops_settings (name, value, set_by, set_at) VALUES (?1, ?2, 'ops', ?3)")
      .bind(name, JSON.stringify(value), NOW.toISOString())
      .run();

  async function bookedHold(terms: { notice: number | null; charge: string | null }) {
    await env.DB.prepare(
      `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount,
         amount_ex_gst, gst_percent, state, expires_at, created_at, updated_at, appointment_id, change_notice_hours,
         late_change_charge)
       VALUES ('hold-1', ?1, 'service', '2026-09-24', 'afternoon', 't1', 2, 200000, 200000, 0, 'booked', ?2, ?2, ?2,
         ?3, ?4, ?5)`,
    )
      .bind(PERSON, "2026-09-20T06:30:00.000Z", VISIT, terms.notice, terms.charge)
      .run();
  }

  const cancelTerms = async () =>
    (await post(client(), `/api/appointments/${VISIT}/cancel`, { confirm: false })).json<Record<string, unknown>>();

  it("counts the notice ops set for a visit no hold sold", async () => {
    await booked("service", THURSDAY_NOON, 200000);
    await opsSet("change_notice_hours", 96);
    expect(await cancelTerms()).toMatchObject({
      notice: "late",
      notice_hours: 96,
      free_until: "2026-09-20T06:30:00.000Z",
      refund: 0,
    });
  });

  it("counts the notice the visit was booked under, whatever ops set since", async () => {
    await booked("service", THURSDAY_NOON, 200000);
    await bookedHold({ notice: 24, charge: "visit" });
    await opsSet("change_notice_hours", 96);
    expect(await cancelTerms()).toMatchObject({ notice: "free", notice_hours: 24, refund: 200000 });
  });

  it("gives a visit booked before holds kept their terms the committed ones", async () => {
    await booked("service", TUESDAY_MORNING, 200000);
    await bookedHold({ notice: null, charge: null });
    await opsSet("change_notice_hours", 12);
    await opsSet("late_change_charge", {
      consultation: "nothing",
      first_fit: "late_fee",
      service: "nothing",
      replacement: "late_fee",
    });
    expect(await cancelTerms()).toMatchObject({ notice: "late", notice_hours: 24, refund: 0, kept: 200000 });
  });

  it("charges inside the notice what the kind cost when the visit was booked", async () => {
    await booked("service", TUESDAY_MORNING, 200000);
    await bookedHold({ notice: 24, charge: "nothing" });
    expect(await cancelTerms()).toMatchObject({ notice: "late", refund: 200000, kept: 0 });
    const move = await (await get(client(), `/api/appointments/${VISIT}/reschedule`)).json();
    expect(move).toMatchObject({ notice: "late", cost: "free" });
  });

  it("gives a credit back inside the notice where the visit was booked to cost nothing then", async () => {
    await booked("service", TUESDAY_MORNING, 0);
    await bookedHold({ notice: 24, charge: "nothing" });
    await grantCredits(env.DB, { personId: PERSON, visits: 3, source: "referral", sourceId: "attr-1", now: NOW }).run();
    await redeemCredit(env.DB, PERSON, VISIT, NOW).run();
    expect(await cancelTerms()).toMatchObject({ notice: "late", credit: "restored" });
  });

  // The coordinator's ruling on the review of #145: a move of the same visit keeps what it was sold under; a charged
  // move, which sells a new visit, is sold under the terms in force.
  it("keeps the terms it was sold under through a free move, so a later cancel is judged by them", async () => {
    await booked("service", THURSDAY_NOON, 200000);
    await bookedHold({ notice: 24, charge: "visit" });
    await opsSet("change_notice_hours", 72);
    const app = client();

    const moved = await post(app, "/api/holds", {
      type: "service",
      date: "2026-09-25",
      window: "evening",
      moving: VISIT,
    });
    expect(moved.status).toBe(201);
    const held = await moved.json<{ id: string; price: { amount: number }; change_notice_hours: number }>();
    expect(held).toMatchObject({ price: { amount: 0 }, change_notice_hours: 24 });
    const started = await post(app, `/api/appointments/${VISIT}/reschedule`, { hold_id: held.id });
    expect(await started.json()).toEqual({ hold_id: held.id, checkout: null });

    // Thursday 2 pm in India: 26 hours before Friday's evening window.
    const thursday = new Date("2026-09-24T08:30:00.000Z");
    const cancel = await post(client({ now: () => thursday }), `/api/appointments/${VISIT}/cancel`, { confirm: false });
    expect(await cancel.json()).toMatchObject({ notice: "free", notice_hours: 24, refund: 200000, kept: 0 });
  });

  it("sells a charged move's new visit under the terms in force", async () => {
    await booked("service", TUESDAY_MORNING, 200000);
    await bookedHold({ notice: 24, charge: "visit" });
    await opsSet("change_notice_hours", 12);
    const replaced = await post(client(), "/api/holds", {
      type: "service",
      date: "2026-09-28",
      window: "morning",
      moving: VISIT,
    });
    expect(await replaced.json()).toMatchObject({ price: { amount: 200000 }, change_notice_hours: 12 });
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
    expect(body.days[0]?.windows.map(({ window, with: who }) => ({ window, with: who }))).toEqual([
      { window: "morning", with: "regular" },
      { window: "afternoon", with: "regular" },
      { window: "evening", with: "regular" },
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

    expect(await confirmBooking(env.DB, payments, held.id, NOW, {})).toBe("not_paid");
    await env.DB.prepare(
      `INSERT INTO payments (id, person_id, razorpay_order_id, razorpay_payment_id, amount, currency, method, status,
         captured_at, created_at, updated_at)
       SELECT ?3, person_id, razorpay_order_id, 'pay_fee', amount, 'INR', 'upi', 'captured', ?1, ?1, ?1
       FROM slot_holds WHERE id = ?2`,
    )
      .bind(NOW.toISOString(), held.id, FEE)
      .run();
    expect(await confirmBooking(env.DB, payments, held.id, NOW, {})).toBe("booked");
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

    expect(await confirmBooking(env.DB, createStubPayments(), held.id, NOW, {})).toBe("booked");
    const visits = await env.DB.prepare("SELECT status FROM appointments ORDER BY window_start").all();
    expect(visits.results).toEqual([{ status: "cancelled" }, { status: "scheduled" }]);
    expect((await visitRow())?.status).toBe("cancelled");
    expect((await changes()).results).toEqual([
      expect.objectContaining({ kind: "replaced", notice: "late", kept_amount: 200000, payment_id: PAYMENT }),
    ]);
    const old = await (await get(app, `/api/payments/${PAYMENT}`)).json();
    expect(old).toMatchObject({ charge: { change: "moved", amount: 200000 } });

    // Told again, nothing is booked or cancelled twice.
    expect(await confirmBooking(env.DB, createStubPayments(), held.id, NOW, {})).toBe("already_booked");
    expect((await changes()).results).toHaveLength(1);
    const again = await env.DB.prepare("SELECT COUNT(*) AS n FROM appointments").first<{ n: number }>();
    expect(again?.n).toBe(2);
  });

  // The owner's ruling of 1 October 2026: a visit's discount code moves with it (docs/decisions/0108-discount-codes.md).
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
    expect(await confirmBooking(env.DB, createStubPayments(), held.id, NOW, {})).toBe("booked");
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
      confirmBooking(failingAfterTheFirstBatch(env.DB), createStubPayments(), held.id, NOW, {}),
    ).rejects.toThrow("Network connection lost");
    expect((await visitRow())?.status).toBe("scheduled");
    expect(await confirmBooking(env.DB, createStubPayments(), held.id, NOW, {})).toBe("already_booked");
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
    expect(await confirmBooking(env.DB, payments, held.id, NOW, {})).toBe("refunded");
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
    expect(await confirmBooking(env.DB, payments, held.id, NOW, {})).toBe("refunded");
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

    expect(await confirmBooking(env.DB, payments, held.id, NOW, {})).toBe("refunded");
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
    expect(await confirmBooking(env.DB, payments, held.id, NOW, {})).toBe("refunded");
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
      confirmBooking(failingAfterTheFirstBatch(env.DB), createStubPayments(), held.id, NOW, {}),
    ).rejects.toThrow("Network connection lost");
    await checkedIn();

    const told: string[] = [];
    const alertOnce = (alert: { key: string }) => {
      told.push(alert.key);
      return Promise.resolve();
    };
    expect(await confirmBooking(env.DB, createStubPayments(), held.id, NOW, { alertOnce })).toBe("already_booked");
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

/**
 * The owner ruled on 27 September 2026 that the client keeps the free change after a move by ops: their notice counts
 * from the visit's time before ops moved it (docs/archive/owner-answers-2026-09-27.md, item 71;
 * docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
 */
describe("a visit ops moved", () => {
  /** Tuesday 22 September, noon in India: the afternoon window's first half-slot. */
  const TUESDAY_AFTERNOON = "2026-09-22T06:30:00.000Z";

  async function opsMove(
    window: "morning" | "afternoon" | "evening",
    date: string,
    reason: MoveReason = "zone_rebalance",
  ) {
    const now = await visitRow();
    const moved = await moveJob(
      env.DB,
      {},
      {
        appointmentId: VISIT,
        date,
        window,
        reason,
        actor: "ops@localhost",
        expected: { technicianId: "t1", startsAt: now?.window_start ?? "" },
      },
      NOW,
    );
    expect(moved.kind).toBe("moved");
  }

  const cancelTerms = async () =>
    (await post(client(), `/api/appointments/${VISIT}/cancel`, { confirm: false })).json<Record<string, unknown>>();

  it("keeps the client's free change: moved to 21 hours away, a cancel at once is free", async () => {
    await booked("service", THURSDAY_NOON, 200000);
    await opsMove("morning", "2026-09-22");
    expect((await visitRow())?.window_start).toBe(TUESDAY_MORNING);

    expect(await cancelTerms()).toMatchObject({
      notice: "free",
      free_until: "2026-09-23T06:30:00.000Z",
      refund: 200000,
      kept: 0,
    });
    const payments = createStubPayments();
    const done = await post(client({ payments }), `/api/appointments/${VISIT}/cancel`, {
      confirm: true,
      notice: "free",
    });
    expect(await done.json()).toMatchObject({ cancelled: true, refund: 200000, kept: 0 });
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_visit", amount: 200000 }]);
  });

  it("moves it free too, where the client moves it themselves", async () => {
    await booked("first_fit", THURSDAY_NOON, 3000000);
    await opsMove("morning", "2026-09-22");
    const move = await (await get(client(), `/api/appointments/${VISIT}/reschedule`)).json();
    expect(move).toMatchObject({ notice: "free", cost: "free" });
  });

  it("counts from the visit's own time where ops moved it later", async () => {
    await booked("service", TUESDAY_MORNING, 200000);
    await opsMove("afternoon", "2026-09-24");
    expect(await cancelTerms()).toMatchObject({ notice: "free", free_until: "2026-09-23T06:30:00.000Z" });
  });

  it("keeps the time the client chose through every move ops make after it", async () => {
    await booked("service", THURSDAY_NOON, 200000);
    await opsMove("morning", "2026-09-22");
    await opsMove("afternoon", "2026-09-22");
    expect((await visitRow())?.window_start).toBe(TUESDAY_AFTERNOON);
    expect(await cancelTerms()).toMatchObject({ notice: "free", refund: 200000 });
  });

  it("counts from the new time once the client moves it themselves", async () => {
    await booked("service", THURSDAY_NOON, 200000);
    await opsMove("morning", "2026-09-22");
    const app = client();
    const held = await (
      await post(app, "/api/holds", { type: "service", date: "2026-09-22", window: "afternoon", moving: VISIT })
    ).json<{ id: string; price: { amount: number } }>();
    expect(held.price.amount).toBe(0);
    const started = await post(app, `/api/appointments/${VISIT}/reschedule`, { hold_id: held.id });
    expect(await started.json()).toEqual({ hold_id: held.id, checkout: null });

    expect(await cancelTerms()).toMatchObject({ notice: "late", refund: 0, kept: 200000 });
  });

  it("counts a move ops make because the client asked as the client's own", async () => {
    await booked("service", THURSDAY_NOON, 200000);
    await opsMove("morning", "2026-09-22", "client_asked");
    expect(await cancelTerms()).toMatchObject({ notice: "late", refund: 0, kept: 200000 });
  });
});
