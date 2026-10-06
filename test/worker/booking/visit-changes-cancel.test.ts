// A client moving or cancelling a visit (src/routes/client/changes.ts, src/domain/visits/visit-changes.ts, and the move
// in confirmBooking). NOW is Monday 21 September 2026, 12 noon in India; the price book is at 0% from 22 September.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { clawBack, creditBalance, grantCredits, redeemCredit } from "../../../src/domain/money/credits.ts";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { type PaymentsProvider } from "../../../src/providers/payments/index.ts";
import { createStubPayments } from "../../../src/providers/payments/stub.ts";
import { PaymentUnanswered } from "../../../src/providers/provider-error.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request, savedAddress } from "../helpers.ts";
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
      `The refund of Rs. 2,000 for visit ${VISIT}, cancelled by the client, failed (Razorpay payment pay_visit). ` +
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
      `Razorpay did not answer the refund of Rs. 2,000 for visit ${VISIT}, cancelled by the client (payment ` +
        "pay_visit), so it may have been made. Look at the payment in Razorpay, and refund it by hand only if no " +
        `refund of Rs. 2,000 is there. http://ops.localhost:4323/clients/${PERSON}/payments`,
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
