// A client disputing a no-show's charge in the app, and ops ruling Refund or Uphold in the console
// (src/routes/client-disputes.ts, src/routes/ops-disputes.ts; docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
// NOW is Monday 21 September 2026, 12 noon in India. Nothing here is a real person, number or address.
//
// "The client disputes a charge in the app, and ops rule Refund or Uphold in the console with a reason, and the
// client is told." (docs/archive/owner-answers-2026-09-27.md, item 60)

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { ruleOnDispute } from "../../src/domain/no-show-disputes.ts";
import { composeVisitMessage } from "../../src/domain/visit-messages.ts";
import { openSession } from "../../src/domain/sessions.ts";
import type { DisputeRuling } from "../../src/policy/no-show.ts";
import { createStubPayments } from "../../src/providers/payments.ts";
import { PaymentUnanswered } from "../../src/providers/provider-error.ts";
import {
  appFor,
  captureLogs,
  eraseByMobile,
  failingAfterTheFirstBatch,
  fakeDependencies,
  fakeQueue,
  markDatabase,
  NOW,
  request,
} from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const OTHER = "11111111-1111-4111-8111-111111111112";
const VISIT = "22222222-2222-4222-8222-222222222222";
const CASE = "33333333-3333-4333-8333-333333333333";
const TECHNICIAN = "44444444-4444-4444-8444-444444444444";
const MOBILE = "+919810000001";

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

interface OpsDispute {
  id: string;
  person: { id: string; name: string; mobile: string } | null;
  reason: string | null;
  kept: number;
  credit_spent: boolean;
  distance_m: number | null;
  radius_m: number;
  message_state: string;
  message_delivered_at: string | null;
  due: string;
}

function opsApp(payments = createStubPayments()) {
  return { app: appFor("local", fakeDependencies({ payments }), {}, "ops"), payments };
}

const disputes = async (ops: App): Promise<OpsDispute[]> =>
  (await (await request(ops, "/api/no-shows/disputes")).json<{ disputes: OpsDispute[] }>()).disputes;

function rule(ops: App, id: string, body: unknown, queue = fakeQueue()) {
  return request(
    ops,
    `/api/no-shows/disputes/${id}/ruling`,
    {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { MESSAGE_QUEUE: queue },
  );
}

/** The visit paid for with a credit instead, which the charge spent: it kept no money. */
const onCredit = (grantExpires = "2027-09-21T06:30:00.000Z") =>
  env.DB.batch([
    env.DB.prepare("DELETE FROM payments"),
    env.DB.prepare("UPDATE no_show_cases SET charge = 'visit', kept_amount = 0, refund_amount = 0"),
    env.DB.prepare(
      `INSERT INTO credit_ledger (id, person_id, kind, visits, source_kind, source_id, expires_at, created_at)
       VALUES ('grant-1', ?1, 'grant', 3, 'referral', 'referral-1', ?2, ?3)`,
    ).bind(PERSON, grantExpires, NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
       VALUES ('redeem-1', ?1, 'redeem', -1, 'grant-1', 'appointment', ?2, ?3)`,
    ).bind(PERSON, VISIT, NOW.toISOString()),
  ]);

async function raised(): Promise<string> {
  expect((await dispute("I was home all morning; the bell is broken")).status).toBe(201);
  const row = await env.DB.prepare("SELECT id FROM no_show_disputes").first<{ id: string }>();
  return row?.id ?? "";
}

describe("POST /api/visits/:id/dispute", () => {
  it("offers the dispute on a charge that kept money, and says what the charge took", async () => {
    expect(await noShowNote()).toMatchObject({
      decision: "charged",
      charge: { kept: 400000, credit_spent: false },
      dispute: null,
      disputable: true,
    });
  });

  it("raises one dispute, with the client's words, audited under the client and without them", async () => {
    const answer = await dispute("  I was home all morning; the bell is broken  ");
    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({ state: "open" });

    expect(await env.DB.prepare("SELECT case_id, person_id, reason, ruling FROM no_show_disputes").first()).toEqual({
      case_id: CASE,
      person_id: PERSON,
      reason: "I was home all morning; the bell is broken",
      ruling: null,
    });
    const audit = await env.DB.prepare(
      "SELECT actor_kind, actor, detail FROM audit_log WHERE action = 'no_show.dispute'",
    ).first();
    expect(audit).toEqual({ actor_kind: "client", actor: PERSON, detail: null });
    expect(await noShowNote()).toMatchObject({ dispute: "open", disputable: false });
  });

  it("takes one dispute a charge", async () => {
    await raised();
    const again = await dispute("Still home");
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "already_disputed" } });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM no_show_disputes").first()).toEqual({ n: 1 });
  });

  it("refuses a charge that took nothing to give back", async () => {
    await env.DB.prepare("UPDATE no_show_cases SET charge = 'nothing', kept_amount = 0, refund_amount = 3000000").run();
    const answer = await dispute("I was home");
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "not_disputable" } });
    expect(await noShowNote()).toMatchObject({ disputable: false });
  });

  it("offers it on a charge that spent the credit the visit used", async () => {
    await onCredit();
    expect(await noShowNote()).toMatchObject({ charge: { kept: 0, credit_spent: true }, disputable: true });
    expect((await dispute("I was home")).status).toBe(201);
  });

  it("neither offers nor takes a dispute once the charge's days for it are past", async () => {
    await env.DB.prepare("UPDATE no_show_cases SET dispute_until = ?1").bind("2026-09-21T06:29:59.000Z").run();
    expect(await noShowNote()).toMatchObject({ decision: "charged", disputable: false });
    const answer = await dispute("I was home all afternoon");
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "dispute_window_closed" } });
  });

  it("still takes one on its last day", async () => {
    await env.DB.prepare("UPDATE no_show_cases SET dispute_until = ?1").bind("2026-09-21T06:30:01.000Z").run();
    expect(await noShowNote()).toMatchObject({ disputable: true });
    expect((await dispute("I was home all afternoon")).status).toBe(201);
  });

  // A charge past its days once showed no Dispute button and no reason why (MON-17).
  it("says when the days to dispute ended, once they have, for a charge never disputed", async () => {
    expect(await noShowNote()).toMatchObject({ disputable: true, dispute_closed_at: null });

    await env.DB.prepare("UPDATE no_show_cases SET dispute_until = ?1").bind("2026-09-21T06:29:59.000Z").run();
    expect(await noShowNote()).toMatchObject({ disputable: false, dispute_closed_at: "2026-09-21T06:29:59.000Z" });

    // One disputed in time says where the dispute stands instead.
    await env.DB.prepare(
      "INSERT INTO no_show_disputes (id, case_id, person_id, reason, created_at) VALUES ('d-1', ?1, ?2, 'Home', ?3)",
    )
      .bind(CASE, PERSON, "2026-09-20T06:00:00.000Z")
      .run();
    expect(await noShowNote()).toMatchObject({ dispute: "open", dispute_closed_at: null });
  });

  it("refuses a no-show that was waived, or not ruled on, and another client's visit", async () => {
    const otherCookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: OTHER, deviceLabel: null, now: NOW })}`;
    expect((await dispute("Not mine", client, otherCookie)).status).toBe(404);
    await env.DB.prepare("UPDATE no_show_cases SET decision = 'waived'").run();
    expect((await dispute("I was home")).status).toBe(404);
  });

  it("refuses an empty reason, and one without a session", async () => {
    expect((await dispute("   ")).status).toBe(400);
    expect((await dispute("I was home", client, "")).status).toBe(401);
  });

  it("tells ops a dispute is waiting, naming the visit and neither the client nor their words", async () => {
    const deps = fakeDependencies();
    await dispute("I was home all morning", appFor("local", deps, {}, "client"));
    expect(deps.alerts).toEqual([`A client disputed the no-show charge on visit ${VISIT}; rule on it in the console.`]);
  });
});

describe("GET /api/no-shows/disputes", () => {
  it("lists each open dispute with the client's words, what the charge took, and the evidence", async () => {
    await raised();
    const [open] = await disputes(opsApp().app);
    expect(open).toMatchObject({
      person: { id: PERSON, name: "Rohit Malhotra", mobile: MOBILE },
      reason: "I was home all morning; the bell is broken",
      kept: 400000,
      credit_spent: false,
      checked_in_at: "2026-09-19T03:31:00.000Z",
      phone_checked_in_at: null,
      distance_m: 240,
      radius_m: 200,
      message_state: "none",
      message_delivered_at: null,
    });
  });

  // FLD-35: a reminder that was skipped read "Not delivered" on the evidence ops rule a refund on.
  it("says the reminder never went where it was skipped, and when it reached him where it did", async () => {
    await raised();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, last_error)
         VALUES ('m-1', '2026-09-18T12:30:00.000Z', ?1, 'visit_reminder', 'appointment', ?2, 'skipped', 'test record')`,
      ).bind(PERSON, VISIT),
      env.DB.prepare("UPDATE no_show_cases SET message_id = 'm-1'"),
    ]);
    const { app } = opsApp();
    expect((await disputes(app))[0]).toMatchObject({ message_state: "not_sent", message_delivered_at: null });

    await env.DB.prepare(
      "UPDATE outbound_messages SET state = 'sent', last_error = NULL, delivered_at = '2026-09-18T12:31:00.000Z'",
    ).run();
    expect((await disputes(app))[0]).toMatchObject({
      message_state: "delivered",
      message_delivered_at: "2026-09-18T12:31:00.000Z",
    });
  });

  it("drops a dispute once it is ruled on", async () => {
    const id = await raised();
    const { app } = opsApp();
    await rule(app, id, { ruling: "upheld", reason: "He checked in at the door" });
    expect(await disputes(app)).toEqual([]);
  });
});

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
      `The refund of Rs. 4000 for visit ${VISIT}, a no-show refunded on dispute, failed (Razorpay payment ` +
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
      `Razorpay did not answer the refund of Rs. 4000 for visit ${VISIT}, a no-show refunded on dispute (payment ` +
        "pay_visit), so it may have been made. Look at the payment in Razorpay, and refund it by hand only if no " +
        `refund of Rs. 4000 is there. http://ops.localhost:4323/clients/${PERSON}/payments`,
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
      `The refund of Rs. 4000 for visit ${VISIT}, a no-show refunded on dispute, failed (its payment could not be ` +
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

describe("an erasure", () => {
  it("blanks the client's reason and ops' ruling on it, and keeps the ruling", async () => {
    const id = await raised();
    await rule(opsApp().app, id, { ruling: "upheld", reason: "He waited at the door" });

    expect(await eraseByMobile(MOBILE)).not.toBeNull();

    expect(await env.DB.prepare("SELECT reason, ruling, ruling_reason FROM no_show_disputes").first()).toEqual({
      reason: null,
      ruling: "upheld",
      ruling_reason: null,
    });
  });
});

describe("the client's data export", () => {
  it("carries the charge they disputed, in their words, and how ops ruled", async () => {
    await raised();
    const exported = await (
      await request(client, "/api/me/export", { headers: { Cookie: cookie } })
    ).json<{
      no_show_disputes: unknown[];
    }>();
    expect(exported.no_show_disputes).toEqual([
      {
        visit: "2026-09-19T03:30:00.000Z",
        reason: "I was home all morning; the bell is broken",
        created_at: NOW.toISOString(),
        ruling: null,
        ruled_at: null,
      },
    ]);
  });
});
