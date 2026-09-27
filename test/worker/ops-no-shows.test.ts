// The no-show queue ops rule on (Ops Console, board D1; src/routes/ops-field.ts).
// NOW is Monday 21 September 2026, 12 noon in India. Nothing here is a real
// person, number or address.
//
// A case is evidence a client may be charged on, so it has to say whose visit
// it was, when it was booked for, both clocks the check-in was read by, and
// whether the reminder ever went at all; and a ruling has to carry its reason.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.ts";
import { decideNoShow, refundWaivedVisit } from "../../src/domain/no-shows.ts";
import { NO_VISITS_CONSENT } from "../../src/domain/visit-messages.ts";
import { createStubPayments } from "../../src/providers/razorpay.ts";
import { appFor, captureLogs, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const VISIT = "22222222-2222-4222-8222-222222222222";
const CASE = "33333333-3333-4333-8333-333333333333";
const TECHNICIAN = "44444444-4444-4444-8444-444444444444";

let ops: App;

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

  it("names nobody once the client has been erased", async () => {
    await env.DB.prepare("UPDATE people SET erased_at = ?1").bind(NOW.toISOString()).run();
    expect((await cases())[0]?.person).toBeNull();
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

  // BIZ-28: what a waiver does to the money waits for the owner; until then it moves none, and says so.
  it("moves no money on a waiver while the owner has not ruled what one gives back", async () => {
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
    expect(payments.made.refunds).toEqual([]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'restore'").first()).toEqual({
      n: 0,
    });
  });

  it("gives back the payment and the credit on a waiver, once the owner rules that it should", async () => {
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
      waiverGivesBack: true,
    });
    expect(ruled?.refund).not.toBeNull();
    if (ruled?.refund) {
      await refundWaivedVisit(env.DB, { payments, alertOnce: () => Promise.resolve() }, ruled.refund);
    }

    expect(payments.made.refunds).toEqual([expect.objectContaining({ paymentId: "pay_visit", amount: 200000 })]);
    expect(await env.DB.prepare("SELECT kind, visits FROM credit_ledger WHERE kind = 'restore'").all()).toMatchObject({
      results: [{ kind: "restore", visits: 1 }],
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
