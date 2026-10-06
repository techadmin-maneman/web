// The no-show queue ops rule on (src/routes/ops/no-shows.ts).
// NOW is Monday 21 September 2026, 12 noon in India. Nothing here is a real
// person, number or address.
//
// A case is evidence a client may be charged on, so it has to say whose visit
// it was, when it was booked for, both clocks the check-in was read by, and
// whether the reminder ever went at all; and a ruling has to carry its reason.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { refundNoShow } from "../../../src/domain/no-shows/after-a-ruling.ts";
import { decideNoShow } from "../../../src/domain/no-shows/no-shows.ts";
import { WAIVER_GIVES_BACK } from "../../../src/policy/no-show.ts";
import { createStubPayments } from "../../../src/providers/payments/stub.ts";
import {
  appFor,
  captureLogs,
  failingAfterTheFirstBatch,
  fakeDependencies,
  fakeQueue,
  markDatabase,
  NOW,
  request,
} from "../helpers.ts";
import { PERSON, VISIT, CASE, TECHNICIAN, COMMITTED_TERMS, type Case } from "./ops-no-shows-fixtures.ts";

let ops: App;

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

  // The client was never told of the missed visit or of what ops decided.
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

  // A waiver gives back the payment and the credit.
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
  // without ops hearing of the refund owed. A waiver gives back the credit too, which once meant
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
      `The refund of Rs. 2,000 for visit ${VISIT}, a no-show waived, failed (its payment could not be read). ` +
        `Refund it by hand in Razorpay, once. http://ops.localhost:4323/clients/${PERSON}/payments`,
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

  it("gives back the payment and the credit on a waiver", async () => {
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

  // A client may dispute a charge for 30 days, a console setting; each charge
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
