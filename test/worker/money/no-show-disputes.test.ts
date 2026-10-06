// A client disputing a no-show's charge in the app, and ops ruling Refund or Uphold in the console
// (src/routes/client/disputes.ts, src/routes/ops/disputes.ts; docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
// NOW is Monday 21 September 2026, 12 noon in India. Nothing here is a real person, number or address.
//
// "The client disputes a charge in the app, and ops rule Refund or Uphold in the console with a reason, and the
// client is told." (docs/archive/owner-answers-2026-09-27.md, item 60)

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { appFor, captureLogs, eraseByMobile, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
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

const disputes = async (ops: App): Promise<OpsDispute[]> =>
  (await (await request(ops, "/api/no-shows/disputes")).json<{ disputes: OpsDispute[] }>()).disputes;

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

  // A charge past its days once showed no Dispute button and no reason why.
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

  // A reminder that was skipped read "Not delivered" on the evidence ops rule a refund on.
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
