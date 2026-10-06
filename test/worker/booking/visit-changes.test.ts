// A client moving or cancelling a visit (src/routes/client/changes.ts, src/domain/visits/visit-changes.ts, and the move
// in confirmBooking). NOW is Monday 21 September 2026, 12 noon in India; the price book is at 0% from 22 September.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { grantCredits, redeemCredit } from "../../../src/domain/money/credits.ts";
import { moveJob } from "../../../src/domain/dispatch/dispatch.ts";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { createStubPayments } from "../../../src/providers/payments/stub.ts";
import type { MoveReason } from "../../../src/policy/dispatch.ts";
import { appFor, markDatabase, NOW, request, savedAddress } from "../helpers.ts";
import { PERSON, VISIT, THURSDAY_NOON, TUESDAY_MORNING, booked, client, visitRow } from "./visit-changes-fixtures.ts";

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

/**
 * The client keeps the free change after a move by ops: their notice counts from the visit's time before ops moved it
 * (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
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
