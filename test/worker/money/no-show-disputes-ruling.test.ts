// A client disputing a no-show's charge in the app, and ops ruling Refund or Uphold in the console
// (src/routes/client/disputes.ts, src/routes/ops/disputes.ts; docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
// NOW is Monday 21 September 2026, 12 noon in India. Nothing here is a real person, number or address.
//
// "The client disputes a charge in the app, and ops rule Refund or Uphold in the console with a reason, and the
// client is told." (docs/archive/owner-answers-2026-09-27.md, item 60)

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { ruleOnDispute } from "../../../src/domain/no-shows/no-show-disputes.ts";
import { composeVisitMessage } from "../../../src/domain/messages/visit-message-text.ts";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import type { DisputeRuling } from "../../../src/policy/no-show.ts";
import { createStubPayments } from "../../../src/providers/payments/stub.ts";
import { PaymentUnanswered } from "../../../src/providers/provider-error.ts";
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
import { PERSON, OTHER, VISIT, CASE, TECHNICIAN, MOBILE, opsApp, rule, onCredit } from "./no-show-disputes-fixtures.ts";

let client: App;

let cookie: string;

beforeEach(async () => {
  captureLogs();
  client = appFor("local", fakeDependencies(), {}, "client");
  await markDatabase();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, '2026-08-01T06:00:00.000Z', ?2, 'Rohit Malhotra')",
    ).bind(PERSON, MOBILE),
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, '2026-08-01T06:00:00.000Z', '+919810000002', 'Vikram Sethi')",
    ).bind(OTHER),
    env.DB.prepare(
      "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES (?1, 'fsm-t1', 'Imran Qureshi', 'IQ', 1, ?2)",
    ).bind(TECHNICIAN, NOW.toISOString()),
    // A first fit booked for 9 am on Saturday the 19th; he checked in 240 m away, against a 200 m radius.
    env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
         technician_id, fsm_modified_at, synced_at)
       VALUES (?1, 'fsm-1', ?2, 'first_fit', 'terminated', 'Terminated', '2026-09-19T03:30:00.000Z',
         '2026-09-19T06:30:00.000Z', ?3, ?4, ?4)`,
    ).bind(VISIT, PERSON, TECHNICIAN, NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO checkins (id, appointment_id, technician_id, at, lat, lng, distance_m, radius_m, passed, created_at)
       VALUES ('checkin-1', ?1, ?2, '2026-09-19T03:31:00.000Z', 28.4, 77.0, 240, 200, 0, '2026-09-19T03:31:00.000Z')`,
    ).bind(VISIT, TECHNICIAN),
    // Charged: Rs. 30,000 paid, the Rs. 4,000 late fee kept, Rs. 26,000 given back.
    env.DB.prepare(
      `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, closed_at, decision,
         decided_by, decided_at, decision_reason, charge, kept_amount, refund_amount, created_at)
       VALUES (?1, 'checkin-1', ?2, '2026-09-19T03:31:00.000Z', '2026-09-19T03:46:00.000Z',
         '2026-09-19T03:47:00.000Z', 'charged', 'ops@localhost', '2026-09-19T05:00:00.000Z', 'Nobody came down',
         'late_fee', 400000, 2600000, '2026-09-19T03:47:00.000Z')`,
    ).bind(CASE, VISIT),
    env.DB.prepare(
      `INSERT INTO payments (id, reference, person_id, appointment_id, razorpay_payment_id, amount, refunded_amount,
         currency, method, status, captured_at, created_at, updated_at)
       VALUES ('payment-1', 'MM-2026-0841', ?1, ?2, 'pay_visit', 3000000, 2600000, 'INR', 'upi', 'partially_refunded',
         ?3, ?3, ?3)`,
    ).bind(PERSON, VISIT, "2026-09-15T06:30:00.000Z"),
  ]);
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
});

const dispute = (reason: string, app: App = client, withCookie = cookie) =>
  request(app, `/api/visits/${VISIT}/dispute`, {
    method: "POST",
    headers: { Cookie: withCookie, Origin: "https://maneman.test", "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });

const noShowNote = async () =>
  (await (await request(client, `/api/visits/${VISIT}`, { headers: { Cookie: cookie } })).json<{ no_show: unknown }>())
    .no_show;

async function raised(): Promise<string> {
  expect((await dispute("I was home all morning; the bell is broken")).status).toBe(201);
  const row = await env.DB.prepare("SELECT id FROM no_show_disputes").first<{ id: string }>();
  return row?.id ?? "";
}

describe("POST /api/no-shows/disputes/:id/ruling", () => {
  it("refuses a ruling without a reason, either way", async () => {
    const id = await raised();
    const { app } = opsApp();
    for (const body of [
      { ruling: "refunded", reason: null },
      { ruling: "upheld", reason: "  " },
    ]) {
      const answer = await rule(app, id, body);
      expect(answer.status, JSON.stringify(body)).toBe(400);
      expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["reason"] } });
    }
  });

  it("refunds what the charge kept, keeps ops' reason on the dispute and out of the log, and tells the client", async () => {
    const id = await raised();
    const { app, payments } = opsApp();
    const queue = fakeQueue();

    const answer = await rule(app, id, { ruling: "refunded", reason: "The bell was broken that week" }, queue);

    expect(answer.status).toBe(200);
    expect(payments.made.refunds).toEqual([expect.objectContaining({ paymentId: "pay_visit", amount: 400000 })]);
    expect(await env.DB.prepare("SELECT ruling, ruled_by, ruling_reason FROM no_show_disputes").first()).toEqual({
      ruling: "refunded",
      ruled_by: "ops@localhost",
      ruling_reason: "The bell was broken that week",
    });
    const audit = await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'no_show.dispute_rule'").first();
    expect(audit).toEqual({ detail: JSON.stringify({ ruling: "refunded" }) });
    const message = await env.DB.prepare("SELECT id, kind, subject_id FROM outbound_messages").first();
    expect(message).toMatchObject({ kind: "no_show_dispute_ruled", subject_id: VISIT });
    expect(queue.sent).toEqual([{ message_id: message?.id, request_id: expect.any(String) as string }]);
    expect(await noShowNote()).toMatchObject({ dispute: "refunded", disputable: false });
  });

  it("gives back the credit a charge spent, as a waiver does", async () => {
    await onCredit();
    const id = await raised();
    const { app, payments } = opsApp();

    await rule(app, id, { ruling: "refunded", reason: "The bell was broken" });

    expect(payments.made.refunds).toEqual([]);
    expect(await env.DB.prepare("SELECT kind FROM credit_ledger WHERE kind = 'restore'").all()).toMatchObject({
      results: [{ kind: "restore" }],
    });
  });

  // The credit comes back only to a grant that can still take it. Where it cannot, the client is told so, from what
  // the ledger holds, and ops are told to settle it by hand.
  const clawedBack = () =>
    env.DB.prepare(
      `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
       VALUES ('clawback-1', ?1, 'clawback', -2, 'grant-1', 'referral', 'referral-1', '2026-09-20T06:30:00.000Z')`,
    )
      .bind(PERSON)
      .run();

  it.each([
    ["expired", () => onCredit("2026-09-20T18:30:00.000Z")],
    [
      "been clawed back",
      async () => {
        await onCredit();
        await clawedBack();
      },
    ],
  ])("tells the client and ops the credit cannot come back, where its grant has %s", async (_, grantGone) => {
    await grantGone();
    await env.DB.prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
       VALUES ('consent-1', ?1, 'whatsapp_visits', 'test-notice', 1, ?2)`,
    )
      .bind(PERSON, NOW.toISOString())
      .run();
    const id = await raised();
    const deps = fakeDependencies();

    await rule(appFor("local", deps, {}, "ops"), id, { ruling: "refunded", reason: "The bell was broken" });

    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'restore'").first()).toEqual({
      n: 0,
    });
    expect(await composeVisitMessage(env.DB, "no_show_dispute_ruled", VISIT, PERSON)).toMatchObject({
      template: "no_show_dispute_credit_gone_v1",
    });
    expect(deps.alerts).toEqual([
      `The visit credit for visit ${VISIT}, a no-show refunded on dispute, could not come back: its grant has ` +
        "expired or been withdrawn. The client is told so; settle it with them by hand if they are owed one. " +
        `http://ops.localhost:4323/clients/${PERSON}/payments`,
    ]);
    expect(await env.DB.prepare("SELECT key FROM alerts WHERE key LIKE 'no_show_credit%'").first()).toEqual({
      key: `no_show_credit_not_back:refunded on dispute:${VISIT}`,
    });
  });

  it("tells ops once, with the visit and the payment, when Razorpay refuses the refund; the ruling stands", async () => {
    const id = await raised();
    const deps = fakeDependencies({
      payments: { ...createStubPayments(), refund: () => Promise.reject(new Error("Razorpay 502")) },
    });

    const answer = await rule(appFor("local", deps, {}, "ops"), id, {
      ruling: "refunded",
      reason: "The bell was broken",
    });

    expect(answer.status).toBe(200);
    expect(deps.alerts).toEqual([
      `The refund of Rs. 4,000 for visit ${VISIT}, a no-show refunded on dispute, failed (Razorpay payment ` +
        `pay_visit). Refund it by hand in Razorpay, once. http://ops.localhost:4323/clients/${PERSON}/payments`,
    ]);
    expect(await env.DB.prepare("SELECT key FROM alerts").first()).toEqual({
      key: `no_show_refund_failed:refunded on dispute:${VISIT}`,
    });
    expect(await env.DB.prepare("SELECT ruling FROM no_show_disputes").first()).toEqual({ ruling: "refunded" });
  });

  it("tells ops to look in Razorpay before refunding by hand, when Razorpay will not say it refunded", async () => {
    const id = await raised();
    const silent = () => Promise.reject(new PaymentUnanswered("refund", new Error("The operation timed out.")));
    const deps = fakeDependencies({ payments: { ...createStubPayments(), refund: silent } });

    const answer = await rule(appFor("local", deps, {}, "ops"), id, {
      ruling: "refunded",
      reason: "The bell was broken",
    });

    expect(answer.status).toBe(200);
    expect(deps.alerts).toEqual([
      `Razorpay did not answer the refund of Rs. 4,000 for visit ${VISIT}, a no-show refunded on dispute (payment ` +
        "pay_visit), so it may have been made. Look at the payment in Razorpay, and refund it by hand only if no " +
        `refund of Rs. 4,000 is there. http://ops.localhost:4323/clients/${PERSON}/payments`,
    ]);
  });

  // Once the ruling has committed, a retry answers "ruled already" and the client's message says the money is on its
  // way; so nothing between the commit and Razorpay may fail without ops hearing of the refund owed.
  it("tells ops of the refund owed when the database fails once the ruling has committed", async () => {
    const id = await raised();
    const deps = fakeDependencies();

    const answer = await request(
      appFor("local", deps, {}, "ops"),
      `/api/no-shows/disputes/${id}/ruling`,
      {
        method: "POST",
        headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
        body: JSON.stringify({ ruling: "refunded", reason: "The bell was broken" }),
      },
      { DB: failingAfterTheFirstBatch(env.DB), MESSAGE_QUEUE: fakeQueue() },
    );

    expect(answer.status).toBe(200);
    expect(deps.alerts).toEqual([
      `The refund of Rs. 4,000 for visit ${VISIT}, a no-show refunded on dispute, failed (its payment could not be ` +
        `read). Refund it by hand in Razorpay, once. http://ops.localhost:4323/clients/${PERSON}/payments`,
    ]);
  });

  it("refunds at most what is left of the payment, where some went back by hand since the charge", async () => {
    // Ops gave back Rs. 2,000 of the Rs. 4,000 fee in Razorpay's dashboard, which the webhook recorded.
    await env.DB.prepare("UPDATE payments SET refunded_amount = 2800000").run();
    const id = await raised();
    const { app, payments } = opsApp();

    await rule(app, id, { ruling: "refunded", reason: "The bell was broken" });

    expect(payments.made.refunds).toEqual([expect.objectContaining({ paymentId: "pay_visit", amount: 200000 })]);
  });

  it("keeps the charge on an uphold, and tells the client", async () => {
    const id = await raised();
    const { app, payments } = opsApp();
    const answer = await rule(app, id, { ruling: "upheld", reason: "He waited at the door and rang twice" });
    expect(answer.status).toBe(200);
    expect(payments.made.refunds).toEqual([]);
    expect(await env.DB.prepare("SELECT kind FROM outbound_messages").first()).toEqual({
      kind: "no_show_dispute_ruled",
    });
    expect(await noShowNote()).toMatchObject({ dispute: "upheld" });
  });

  // The ruling that loses writes nothing at all: not the credit a refund gives back, not the client's message, not
  // its audit entry. Before the ruling's ID guarded them, all three went in beside the ruling that stood.
  it.each([
    ["upheld", "refunded"],
    ["refunded", "upheld"],
  ] as const)("gives back, tells and audits only the ruling that stands, when %s meets %s", async (first, second) => {
    await onCredit();
    const id = await raised();
    const ruling = (named: DisputeRuling) =>
      ruleOnDispute(env.DB, {
        disputeId: id,
        ruling: named,
        reason: "The bell was broken",
        actor: "ops@localhost",
        audit: {
          surface: "ops",
          actor: { kind: "staff", id: "ops@localhost" },
          action: "no_show.dispute_rule",
          subject: { kind: "no_show_dispute", id },
          requestId: "request-1",
          detail: { ruling: named },
        },
        now: NOW,
      });

    const both = await Promise.all([ruling(first), ruling(second)]);

    expect(both.filter((ruled) => ruled !== null)).toHaveLength(1);
    const stands = (await env.DB.prepare("SELECT ruling FROM no_show_disputes").first<{ ruling: string }>())?.ruling;
    const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())?.n;
    expect(await count("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'restore'")).toBe(
      stands === "refunded" ? 1 : 0,
    );
    expect(await count("SELECT COUNT(*) AS n FROM outbound_messages WHERE kind = 'no_show_dispute_ruled'")).toBe(1);
    const audited = await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'no_show.dispute_rule'").all();
    expect(audited.results).toEqual([{ detail: JSON.stringify({ ruling: stands }) }]);
  });

  it("rules once: a second ruling finds nothing to rule on", async () => {
    const id = await raised();
    const { app, payments } = opsApp();
    await rule(app, id, { ruling: "refunded", reason: "The bell was broken" });
    const again = await rule(app, id, { ruling: "refunded", reason: "The bell was broken" });
    expect(again.status).toBe(404);
    expect(payments.made.refunds).toHaveLength(1);
  });
});
