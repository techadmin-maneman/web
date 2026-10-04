// The no-show queue ops rule on (Ops Console, board D1; src/routes/ops-field.ts).
// NOW is Monday 21 September 2026, 12 noon in India. Nothing here is a real
// person, number or address.
//
// A case is evidence a client may be charged on, so it has to say whose visit
// it was, when it was booked for, both clocks the check-in was read by, and
// whether the reminder ever went at all; and a ruling has to carry its reason.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { refundNoShow } from "../../src/domain/after-a-ruling.ts";
import { decideNoShow } from "../../src/domain/no-shows.ts";
import { NO_VISITS_CONSENT } from "../../src/domain/visit-messages.ts";
import { FREE_CHANGE_NOTICE_HOURS, LATE_CHANGE_CHARGES } from "../../src/policy/moving-a-visit.ts";
import { NO_SHOW_CHARGES, WAIVER_GIVES_BACK, type Waiver } from "../../src/policy/no-show.ts";
import { createStubPayments } from "../../src/providers/payments.ts";
import {
  appFor,
  captureLogs,
  failingAfterTheFirstBatch,
  fakeDependencies,
  fakeQueue,
  markDatabase,
  NOW,
  request,
} from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const VISIT = "22222222-2222-4222-8222-222222222222";
const CASE = "33333333-3333-4333-8333-333333333333";
const TECHNICIAN = "44444444-4444-4444-8444-444444444444";

let ops: App;

/** The terms before ops set any: a visit no hold sold is charged under them. */
const COMMITTED_TERMS = {
  changeNoticeHours: FREE_CHANGE_NOTICE_HOURS,
  lateChangeCharges: LATE_CHANGE_CHARGES,
  noShowCharges: NO_SHOW_CHARGES,
};

interface Case {
  id: string;
  person: { id: string; name: string } | null;
  message_state: string;
  message_delivered_at: string | null;
  opened_at: string;
  due: string;
  decision: string;
}

const cases = async (): Promise<Case[]> =>
  (await (await request(ops, "/api/no-shows")).json<{ cases: Case[] }>()).cases;

const rule = (body: unknown) =>
  request(ops, `/api/no-shows/${CASE}/decision`, {
    method: "POST",
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/**
 * The visit paid for ahead and partly with a credit, as no real visit is, so one waiver can show what happens to
 * each: Rs. 2,000 captured for it, and a credit redeemed on it.
 */
async function paidAndCredited() {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO payments (id, reference, person_id, appointment_id, razorpay_payment_id, amount, currency, method,
         status, captured_at, created_at, updated_at)
       VALUES ('payment-1', 'MM-2026-0841', ?1, ?2, 'pay_visit', 200000, 'INR', 'upi', 'captured', ?3, ?3, ?3)`,
    ).bind(PERSON, VISIT, NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO credit_ledger (id, person_id, kind, visits, source_kind, source_id, expires_at, created_at)
       VALUES ('grant-1', ?1, 'grant', 3, 'referral', 'referral-1', '2027-09-21T06:30:00.000Z', ?2)`,
    ).bind(PERSON, NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
       VALUES ('redeem-1', ?1, 'redeem', -1, 'grant-1', 'appointment', ?2, ?3)`,
    ).bind(PERSON, VISIT, NOW.toISOString()),
  ]);
}

/** The day-before reminder, as the messaging consumer left it. */
async function reminder(state: string, extra: { delivered_at?: string; last_error?: string } = {}) {
  await env.DB.prepare(
    `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, delivered_at,
       last_error)
     VALUES ('message-1', '2026-09-18T12:30:00.000Z', ?1, 'visit_reminder', 'appointment', ?2, ?3, ?4, ?5)`,
  )
    .bind(PERSON, VISIT, state, extra.delivered_at ?? null, extra.last_error ?? null)
    .run();
  await env.DB.prepare("UPDATE no_show_cases SET message_id = 'message-1'").run();
}

beforeEach(async () => {
  captureLogs();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await markDatabase();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, '2026-08-01T06:00:00.000Z', '+919810000001', 'Rohit Malhotra')",
    ).bind(PERSON),
    env.DB.prepare(
      "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES (?1, 'fsm-t1', 'Imran Qureshi', 'IQ', 1, ?2)",
    ).bind(TECHNICIAN, NOW.toISOString()),
    // Booked for 9 am on Saturday the 19th; he checked in at 2:08 pm by his phone, which reached us at 2:29.
    env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
         technician_id, fsm_modified_at, synced_at)
       VALUES (?1, 'fsm-1', ?2, 'service', 'terminated', 'Terminated', '2026-09-19T03:30:00.000Z',
         '2026-09-19T06:30:00.000Z', ?3, ?4, ?4)`,
    ).bind(VISIT, PERSON, TECHNICIAN, NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO checkins (id, appointment_id, technician_id, at, claimed_at, lat, lng, distance_m, radius_m, passed,
         created_at)
       VALUES ('checkin-1', ?1, ?2, '2026-09-19T08:38:59.000Z', '2026-09-19T08:38:59.000Z', 28.4, 77.0, 40, 200, 1,
         '2026-09-19T08:59:00.037Z')`,
    ).bind(VISIT, TECHNICIAN),
    env.DB.prepare(
      `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, closed_at, decision,
         created_at)
       VALUES (?1, 'checkin-1', ?2, '2026-09-19T08:38:59.000Z', '2026-09-19T09:14:00.037Z',
         '2026-09-19T09:14:00.067Z', 'undecided', '2026-09-19T09:14:00.067Z')`,
    ).bind(CASE, VISIT),
  ]);
});

describe("GET /api/no-shows", () => {
  it("names the client whose visit it was, which the case once never did", async () => {
    expect((await cases())[0]?.person).toEqual({ id: PERSON, name: "Rohit Malhotra" });
  });

  it("says what waiving a case gives back now, as ops set it", async () => {
    const waiver = async () => (await (await request(ops, "/api/no-shows")).json<{ waiver: unknown }>()).waiver;
    expect(await waiver()).toEqual({ payment: "refunded", credit: "returned" });
    await env.DB.prepare(
      `INSERT INTO ops_settings (name, value, set_by, set_at)
       VALUES ('no_show_waiver', '{"payment": "kept", "credit": "returned"}', 'ops', ?1)`,
    )
      .bind(NOW.toISOString())
      .run();
    ops = appFor("local", fakeDependencies(), {}, "ops");
    expect(await waiver()).toEqual({ payment: "kept", credit: "returned" });
  });

  // The board writes "240 m · over 200 m fence": the distance against the radius that was in force when he checked in,
  // which the check-in keeps, not the radius ops have set since (docs/open-points.md, item 56).
  it("carries the distance the check-in measured and the radius in force then", async () => {
    await env.DB.prepare(
      "INSERT INTO ops_settings (name, value, set_by, set_at) VALUES ('checkin_radius_m', '350', 'ops', ?1)",
    )
      .bind(NOW.toISOString())
      .run();
    ops = appFor("local", fakeDependencies(), {}, "ops");
    expect((await cases())[0]).toMatchObject({ distance_m: 40, radius_m: 200 });
  });

  it("names nobody once the client has been erased", async () => {
    await env.DB.prepare("UPDATE people SET erased_at = ?1").bind(NOW.toISOString()).run();
    expect((await cases())[0]?.person).toBeNull();
  });

  // The audit's B13: a 4 pm visit checked in at 11:31, closed at 11:36 and charged, with nothing to say so.
  it("flags a case whose wait ran from a check-in before the booked start", async () => {
    expect((await cases())[0]).toMatchObject({ minutes_late: 309, closed_early: false });

    await env.DB.prepare(
      `UPDATE checkins SET at = '2026-09-19T02:00:00.000Z', claimed_at = '2026-09-19T02:00:00.000Z',
         created_at = '2026-09-19T02:00:00.000Z'`,
    ).run();
    await env.DB.prepare(
      `UPDATE no_show_cases SET wait_started_at = '2026-09-19T02:00:00.000Z', wait_ends_at = '2026-09-19T02:15:00.000Z',
         closed_at = '2026-09-19T02:16:00.000Z'`,
    ).run();
    expect((await cases())[0]).toMatchObject({
      checked_in_at: "2026-09-19T02:00:00.000Z",
      minutes_late: -90,
      closed_early: true,
    });

    // Closed sixteen minutes after the booked start: the client's own wait had run.
    await env.DB.prepare("UPDATE no_show_cases SET closed_at = '2026-09-19T03:46:00.000Z'").run();
    expect((await cases())[0]).toMatchObject({ closed_early: false });
  });

  it("gives the moment it opened and the day it falls due, as the Tasks board reads it", async () => {
    // The placeholder allowance is two days (src/policy/tasks.ts), from the moment the case opened.
    expect((await cases())[0]).toMatchObject({
      opened_at: "2026-09-19T09:14:00.067Z",
      due: "2026-09-21T09:14:00.067Z",
    });
  });

  // "Never delivered" was all ops read when no reminder was ever sent: a client
  // who never agreed to WhatsApp about visits reads the same as one whose phone was off.
  describe("says what became of the reminder", () => {
    it("none was ever queued", async () => {
      expect((await cases())[0]?.message_state).toBe("none");
    });

    it("it was not sent, because the client never agreed to WhatsApp about visits", async () => {
      await reminder("skipped", { last_error: NO_VISITS_CONSENT });
      expect((await cases())[0]?.message_state).toBe("no_consent");
    });

    it("it was not sent, for another reason", async () => {
      await reminder("skipped", { last_error: "messaging is off" });
      expect((await cases())[0]?.message_state).toBe("not_sent");
      await env.DB.prepare("UPDATE outbound_messages SET state = 'failed'").run();
      expect((await cases())[0]?.message_state).toBe("not_sent");
    });

    it("it was sent, and no receipt came back", async () => {
      await reminder("sent");
      expect((await cases())[0]).toMatchObject({ message_state: "sent", message_delivered_at: null });
    });

    it("it was delivered, and when, even when the receipt came after the case opened", async () => {
      await reminder("sent", { delivered_at: "2026-09-18T12:33:00.000Z" });
      expect((await cases())[0]).toMatchObject({
        message_state: "delivered",
        message_delivered_at: "2026-09-18T12:33:00.000Z",
      });
    });
  });
});

describe("POST /api/no-shows/:id/decision", () => {
  // "Charge or waive, with a reason." (docs/prompts/phase2-frontend.md)
  it("refuses a ruling without a reason, either way, and leaves the case undecided", async () => {
    for (const body of [
      { decision: "charged" },
      { decision: "charged", reason: null },
      { decision: "waived", reason: "  " },
    ]) {
      const answer = await rule(body);
      expect(answer.status, JSON.stringify(body)).toBe(400);
      expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["reason"] } });
    }
    expect((await cases())[0]?.decision).toBe("undecided");
  });

  // LIFE-07: the client was never told of the missed visit or of what ops decided.
  it("queues the client's WhatsApp about the ruling with it", async () => {
    const messages = fakeQueue();
    const answer = await request(
      ops,
      `/api/no-shows/${CASE}/decision`,
      {
        method: "POST",
        headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "charged", reason: "Nobody came to the door" }),
      },
      { MESSAGE_QUEUE: messages },
    );
    expect(answer.status).toBe(200);

    const queued = await env.DB.prepare("SELECT id, person_id, kind, subject_id, state FROM outbound_messages").all();
    expect(queued.results).toEqual([
      {
        id: expect.any(String) as string,
        person_id: PERSON,
        kind: "no_show_decided",
        subject_id: VISIT,
        state: "queued",
      },
    ]);
    expect(messages.sent).toEqual([{ message_id: queued.results[0]?.id, request_id: expect.any(String) as string }]);
  });

  // BIZ-28: the owner ruled on 27 September 2026 that a waiver gives back the payment and the credit.
  it("gives back the payment and the credit when ops waive a no-show", async () => {
    const payments = createStubPayments();
    const app = appFor("local", fakeDependencies({ payments }), {}, "ops");
    await paidAndCredited();

    const answer = await request(
      app,
      `/api/no-shows/${CASE}/decision`,
      {
        method: "POST",
        headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "waived", reason: "The lift was out" }),
      },
      { MESSAGE_QUEUE: fakeQueue() },
    );

    expect(answer.status).toBe(200);
    expect(payments.made.refunds).toEqual([expect.objectContaining({ paymentId: "pay_visit", amount: 200000 })]);
    expect(await env.DB.prepare("SELECT kind, visits FROM credit_ledger WHERE kind = 'restore'").all()).toMatchObject({
      results: [{ kind: "restore", visits: 1 }],
    });
  });

  // Once the ruling has committed, a retry answers not found; so nothing between the commit and Razorpay may fail
  // without ops hearing of the refund owed. A waiver as the owner ruled gives back the credit too, which once meant
  // a read of the ledger before the refund.
  it("tells ops of the refund owed when the database fails once the waiver has committed", async () => {
    await paidAndCredited();
    const deps = fakeDependencies();

    await request(
      appFor("local", deps, {}, "ops"),
      `/api/no-shows/${CASE}/decision`,
      {
        method: "POST",
        headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "waived", reason: "The lift was out" }),
      },
      { DB: failingAfterTheFirstBatch(env.DB), MESSAGE_QUEUE: fakeQueue() },
    );

    expect(deps.alerts).toEqual([
      `The refund of Rs. 2000 for visit ${VISIT}, a no-show waived, failed (its payment could not be read). ` +
        `Refund it by hand in Razorpay, once. http://ops.localhost:4323/clients/${PERSON}`,
    ]);
  });

  it("moves no money on a waiver that gives nothing back", async () => {
    await paidAndCredited();

    const ruled = await decideNoShow(env.DB, {
      caseId: CASE,
      decision: "waived",
      reason: "The lift was out",
      actor: "ops@localhost",
      audit: {
        surface: "ops",
        actor: { kind: "staff", id: "ops@localhost" },
        action: "no_show.decide",
        subject: { kind: "no_show_case", id: CASE },
        requestId: "request-1",
        detail: { decision: "waived" },
      },
      now: NOW,
      terms: COMMITTED_TERMS,
      waiver: { payment: "kept", credit: "spent" },
    });

    expect(ruled?.refund).toBeNull();
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'restore'").first()).toEqual({
      n: 0,
    });
  });

  it("gives back the payment and the credit on a waiver, as the owner ruled", async () => {
    const payments = createStubPayments();
    await paidAndCredited();

    const ruled = await decideNoShow(env.DB, {
      caseId: CASE,
      decision: "waived",
      reason: "The lift was out",
      actor: "ops@localhost",
      audit: {
        surface: "ops",
        actor: { kind: "staff", id: "ops@localhost" },
        action: "no_show.decide",
        subject: { kind: "no_show_case", id: CASE },
        requestId: "request-1",
        detail: { decision: "waived" },
      },
      now: NOW,
      terms: COMMITTED_TERMS,
      waiver: WAIVER_GIVES_BACK,
    });
    expect(ruled?.refund).not.toBeNull();
    if (ruled?.refund) {
      await refundNoShow(env.DB, { payments, alertOnce: () => Promise.resolve() }, ruled.refund);
    }

    expect(payments.made.refunds).toEqual([expect.objectContaining({ paymentId: "pay_visit", amount: 200000 })]);
    expect(await env.DB.prepare("SELECT kind, visits FROM credit_ledger WHERE kind = 'restore'").all()).toMatchObject({
      results: [{ kind: "restore", visits: 1 }],
    });
  });

  // What a waiver gives back is ops' to set (docs/decisions/0088-every-policy-in-the-console.md).
  it("gives back what ops set a waiver to give, and keeps on the ruling what it gave", async () => {
    await env.DB.prepare(
      `INSERT INTO ops_settings (name, value, set_by, set_at)
       VALUES ('no_show_waiver', '{"payment": "refunded", "credit": "spent"}', 'ops', ?1)`,
    )
      .bind(NOW.toISOString())
      .run();
    const payments = createStubPayments();
    const app = appFor("local", fakeDependencies({ payments }), {}, "ops");
    await paidAndCredited();

    const answer = await request(
      app,
      `/api/no-shows/${CASE}/decision`,
      {
        method: "POST",
        headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "waived", reason: "The lift was out" }),
      },
      { MESSAGE_QUEUE: fakeQueue() },
    );

    expect(answer.status).toBe(200);
    expect(payments.made.refunds).toEqual([expect.objectContaining({ paymentId: "pay_visit", amount: 200000 })]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'restore'").first()).toEqual({
      n: 0,
    });
    expect(await env.DB.prepare("SELECT waiver_payment, waiver_credit FROM no_show_cases").first()).toEqual({
      waiver_payment: "refunded",
      waiver_credit: "spent",
    });
  });

  it("keeps no waiver on a charge", async () => {
    await rule({ decision: "charged", reason: "Nobody came to the door" });
    expect(await env.DB.prepare("SELECT waiver_payment, waiver_credit FROM no_show_cases").first()).toEqual({
      waiver_payment: null,
      waiver_credit: null,
    });
  });

  // The owner ruled on 30 September 2026: a client may dispute a charge for 30 days, a console setting; each charge
  // keeps the deadline it was given (src/policy/no-show.ts, DISPUTE_WINDOW_DAYS).
  it("gives a charge the days ops set for disputing it, and a waiver none", async () => {
    await rule({ decision: "charged", reason: "Nobody came to the door" });
    expect(await env.DB.prepare("SELECT dispute_until FROM no_show_cases").first()).toEqual({
      dispute_until: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
  });

  it("gives a charge the window ops set, when they have set one", async () => {
    await env.DB.prepare(
      "INSERT INTO ops_settings (name, value, set_by, set_at) VALUES ('dispute_window_days', '7', 'ops', ?1)",
    )
      .bind(NOW.toISOString())
      .run();
    await rule({ decision: "charged", reason: "Nobody came to the door" });
    expect(await env.DB.prepare("SELECT dispute_until FROM no_show_cases").first()).toEqual({
      dispute_until: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
  });

  it("keeps the reason with the ruling, under who made it, and out of the audit log", async () => {
    const answer = await rule({ decision: "charged", reason: "  Delivered the evening before; nobody came down  " });
    expect(answer.status).toBe(200);

    const ruled = await env.DB.prepare("SELECT decision, decided_by, decision_reason FROM no_show_cases").first();
    expect(ruled).toEqual({
      decision: "charged",
      decided_by: "ops@localhost",
      decision_reason: "Delivered the evening before; nobody came down",
    });
    // The log holds IDs, counts and codes, and can never be blanked if the client is erased (ADR 0031).
    const audit = await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'no_show.decide'").first();
    expect(audit).toEqual({ detail: JSON.stringify({ decision: "charged" }) });
  });
});

/**
 * The owner ruled on 27 September 2026 that a no-show costs, to begin with, what a late cancellation of the same
 * visit costs, set in the console apart from it (docs/owner-answers-2026-09-27.md, item 60); a booking keeps the
 * charge it was sold under (docs/decisions/0088-every-policy-in-the-console.md).
 */
describe("what charging a no-show costs the client", () => {
  const as = (type: string) =>
    env.DB.prepare("UPDATE appointments SET type = ?1 WHERE id = ?2").bind(type, VISIT).run();

  const paid = (amount: number) =>
    env.DB.prepare(
      `INSERT INTO payments (id, reference, person_id, appointment_id, razorpay_payment_id, amount, currency, method,
         status, captured_at, created_at, updated_at)
       VALUES ('payment-1', 'MM-2026-0841', ?1, ?2, 'pay_visit', ?3, 'INR', 'upi', 'captured', ?4, ?4, ?4)`,
    )
      .bind(PERSON, VISIT, amount, NOW.toISOString())
      .run();

  async function onCredit(grantExpires = "2027-09-21T06:30:00.000Z") {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO credit_ledger (id, person_id, kind, visits, source_kind, source_id, expires_at, created_at)
         VALUES ('grant-1', ?1, 'grant', 3, 'referral', 'referral-1', ?2, ?3)`,
      ).bind(PERSON, grantExpires, NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
         VALUES ('redeem-1', ?1, 'redeem', -1, 'grant-1', 'appointment', ?2, ?3)`,
      ).bind(PERSON, VISIT, NOW.toISOString()),
    ]);
  }

  /** The hold that sold the visit, with the no-show charge and the late fee it kept. */
  const soldWith = (charge: string, lateFeeExGst: number | null = null) =>
    env.DB.prepare(
      `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount,
         amount_ex_gst, gst_percent, state, expires_at, created_at, updated_at, appointment_id, no_show_charge,
         late_fee_ex_gst, late_fee_gst_percent)
       SELECT 'hold-1', ?1, type, '2026-09-19', 'morning', ?2, 0, 0, 0, 0, 'booked', ?3, ?3, ?3, id, ?4, ?5, ?6
       FROM appointments WHERE id = ?7`,
    )
      .bind(
        PERSON,
        TECHNICIAN,
        "2026-09-15T06:30:00.000Z",
        charge,
        lateFeeExGst,
        lateFeeExGst === null ? null : 0,
        VISIT,
      )
      .run();

  const opsSetNoShowCharge = async (service: string) => {
    await env.DB.prepare(
      `INSERT INTO ops_settings (name, value, set_by, set_at) VALUES ('no_show_charge', ?1, 'ops', ?2)`,
    )
      .bind(
        JSON.stringify({ consultation: "nothing", first_fit: "late_fee", replacement: "late_fee", service }),
        NOW.toISOString(),
      )
      .run();
  };

  async function charge(payments = createStubPayments(), deps = fakeDependencies({ payments })) {
    const app = appFor("local", deps, {}, "ops");
    const answer = await request(
      app,
      `/api/no-shows/${CASE}/decision`,
      {
        method: "POST",
        headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "charged", reason: "Nobody came to the door" }),
      },
      { MESSAGE_QUEUE: fakeQueue() },
    );
    expect(answer.status).toBe(200);
    return payments;
  }

  const recorded = () => env.DB.prepare("SELECT charge, kept_amount, refund_amount FROM no_show_cases").first();
  const restores = async () =>
    (await env.DB.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'restore'").first<{ n: number }>())?.n;

  it("keeps a first fit's late fee from its payment, refunds the rest, and records both on the no-show", async () => {
    await as("first_fit");
    await paid(3000000);
    await soldWith("late_fee", 400000);

    const payments = await charge();

    expect(payments.made.refunds).toEqual([expect.objectContaining({ paymentId: "pay_visit", amount: 2600000 })]);
    expect(await recorded()).toEqual({ charge: "late_fee", kept_amount: 400000, refund_amount: 2600000 });
  });

  it("keeps a replacement's late fee on its day, where no hold sold it", async () => {
    await as("replacement");
    await paid(1575000);

    const payments = await charge();

    // Rs. 3,000 and 5% GST, the price book's before 22 September.
    expect(payments.made.refunds).toEqual([expect.objectContaining({ amount: 1260000 })]);
    expect(await recorded()).toEqual({ charge: "late_fee", kept_amount: 315000, refund_amount: 1260000 });
  });

  it("keeps a paid service visit whole", async () => {
    await paid(200000);
    const payments = await charge();
    expect(payments.made.refunds).toEqual([]);
    expect(await recorded()).toEqual({ charge: "visit", kept_amount: 200000, refund_amount: 0 });
  });

  it("spends the credit a service visit was paid with", async () => {
    await onCredit();
    await charge();
    expect(await restores()).toBe(0);
    expect(await recorded()).toEqual({ charge: "visit", kept_amount: 0, refund_amount: 0 });
  });

  it("charges what the booking was sold under, whatever ops have set since", async () => {
    await paid(200000);
    await onCredit();
    await soldWith("nothing");
    await opsSetNoShowCharge("visit");

    const payments = await charge();

    expect(payments.made.refunds).toEqual([expect.objectContaining({ amount: 200000 })]);
    expect(await restores()).toBe(1);
    expect(await recorded()).toEqual({ charge: "nothing", kept_amount: 0, refund_amount: 200000 });
  });

  // A consultation and fit in one visit holds no payment, and is sold to cost nothing if missed, as the build took for
  // the owner to confirm (ADR 0025, item 90; docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
  it("charges nothing for a consultation and fit in one visit, which was sold so", async () => {
    await as("first_fit");
    await env.DB.prepare("UPDATE appointments SET one_visit = 'booked' WHERE id = ?1").bind(VISIT).run();
    await soldWith("nothing");
    await opsSetNoShowCharge("visit");

    const payments = await charge();

    expect(payments.made.refunds).toEqual([]);
    expect(await recorded()).toEqual({ charge: "nothing", kept_amount: 0, refund_amount: 0 });
  });

  // The credit comes back only to a grant that can still take it (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
  it("tells ops once when a charge of nothing finds the credit's grant clawed back", async () => {
    await onCredit();
    await soldWith("nothing");
    await env.DB.prepare(
      `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
       VALUES ('clawback-1', ?1, 'clawback', -2, 'grant-1', 'referral', 'referral-1', ?2)`,
    )
      .bind(PERSON, "2026-09-20T06:30:00.000Z")
      .run();
    const deps = fakeDependencies();

    await charge(createStubPayments(), deps);

    expect(await restores()).toBe(0);
    expect(deps.alerts).toEqual([
      `The visit credit for visit ${VISIT}, a no-show charged, could not come back: its grant has expired or been ` +
        "withdrawn. The client is told so; settle it with them by hand if they are owed one. " +
        `http://ops.localhost:4323/clients/${PERSON}`,
    ]);
  });

  it("tells ops once when a waiver finds the credit's grant expired", async () => {
    await onCredit("2026-09-20T18:30:00.000Z");
    const deps = fakeDependencies();

    const answer = await request(
      appFor("local", deps, {}, "ops"),
      `/api/no-shows/${CASE}/decision`,
      {
        method: "POST",
        headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "waived", reason: "The lift was out" }),
      },
      { MESSAGE_QUEUE: fakeQueue() },
    );

    expect(answer.status).toBe(200);
    expect(await restores()).toBe(0);
    expect(await env.DB.prepare("SELECT key FROM alerts").all()).toMatchObject({
      results: [{ key: `no_show_credit_not_back:waived:${VISIT}` }],
    });
  });

  it("charges a visit no hold sold what ops set a no-show to cost now", async () => {
    await paid(200000);
    await opsSetNoShowCharge("nothing");
    const payments = await charge();
    expect(payments.made.refunds).toEqual([expect.objectContaining({ amount: 200000 })]);
  });

  it("tells ops once, with the visit and the payment, when Razorpay refuses the balance", async () => {
    await as("first_fit");
    await paid(3000000);
    await soldWith("late_fee", 400000);
    const payments = { ...createStubPayments(), refund: () => Promise.reject(new Error("Razorpay 502")) };
    const deps = fakeDependencies({ payments });

    await charge(createStubPayments(), deps);

    expect(deps.alerts).toEqual([
      `The refund of Rs. 26000 for visit ${VISIT}, a no-show charged, failed (Razorpay payment pay_visit). ` +
        `Refund it by hand in Razorpay, once. http://ops.localhost:4323/clients/${PERSON}`,
    ]);
    // The charge stands: the ruling is recorded whatever Razorpay says.
    expect(await recorded()).toMatchObject({ kept_amount: 400000 });
  });

  it("gives back nothing twice when two rulings meet", async () => {
    await as("first_fit");
    await paid(3000000);
    await soldWith("late_fee", 400000);
    const ruling = {
      caseId: CASE,
      decision: "charged" as const,
      reason: "Nobody came to the door",
      actor: "ops@localhost",
      audit: {
        surface: "ops" as const,
        actor: { kind: "staff" as const, id: "ops@localhost" },
        action: "no_show.decide" as const,
        subject: { kind: "no_show_case", id: CASE },
        requestId: "request-1",
        detail: { decision: "charged" },
      },
      now: NOW,
      terms: COMMITTED_TERMS,
      waiver: WAIVER_GIVES_BACK,
    };

    const both = await Promise.all([decideNoShow(env.DB, ruling), decideNoShow(env.DB, ruling)]);

    expect(both.filter((ruled) => ruled?.refund !== null && ruled !== null)).toHaveLength(1);
  });

  // The ruling that loses writes nothing at all: not the credit it would give back, not the client's message, not
  // its audit entry. Before the ruling's ID guarded them, all three went in beside the ruling that stood.
  describe("when a charge and a waiver meet", () => {
    const ruling = (decision: "charged" | "waived", waiver: Waiver) => ({
      caseId: CASE,
      decision,
      reason: "Nobody came to the door",
      actor: "ops@localhost",
      audit: {
        surface: "ops" as const,
        actor: { kind: "staff" as const, id: "ops@localhost" },
        action: "no_show.decide" as const,
        subject: { kind: "no_show_case", id: CASE },
        requestId: "request-1",
        detail: { decision },
      },
      now: NOW,
      terms: COMMITTED_TERMS,
      waiver,
    });

    /** What the race left: the ruling that stands, and what went in beside it. */
    async function afterTheRace() {
      const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())?.n;
      return {
        stands: (await env.DB.prepare("SELECT decision FROM no_show_cases").first<{ decision: string }>())?.decision,
        restores: await restores(),
        messages: await count("SELECT COUNT(*) AS n FROM outbound_messages WHERE kind = 'no_show_decided'"),
        audited: (await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'no_show.decide'").all()).results,
      };
    }

    it("gives the credit back only if the charge of nothing stands, against a waiver that keeps it", async () => {
      await onCredit();
      await soldWith("nothing");

      const both = await Promise.all([
        decideNoShow(env.DB, ruling("waived", { payment: "kept", credit: "spent" })),
        decideNoShow(env.DB, ruling("charged", WAIVER_GIVES_BACK)),
      ]);

      expect(both.filter((ruled) => ruled !== null)).toHaveLength(1);
      const { stands, restores: restored, messages, audited } = await afterTheRace();
      expect(restored).toBe(stands === "charged" ? 1 : 0);
      expect(messages).toBe(1);
      expect(audited).toEqual([{ detail: JSON.stringify({ decision: stands }) }]);
    });

    it("gives the credit back only if the waiver stands, against a charge that spends it", async () => {
      await onCredit();
      await soldWith("visit");

      const both = await Promise.all([
        decideNoShow(env.DB, ruling("charged", WAIVER_GIVES_BACK)),
        decideNoShow(env.DB, ruling("waived", WAIVER_GIVES_BACK)),
      ]);

      expect(both.filter((ruled) => ruled !== null)).toHaveLength(1);
      const { stands, restores: restored, messages, audited } = await afterTheRace();
      expect(restored).toBe(stands === "waived" ? 1 : 0);
      expect(messages).toBe(1);
      expect(audited).toEqual([{ detail: JSON.stringify({ decision: stands }) }]);
    });
  });
});
