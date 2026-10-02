// An audited action and its audit entry happen together or not at all
// (docs/decisions/0031-access-and-audit.md, src/domain/audit.ts). Each route
// here is made to fail on writing its entry, and each must then leave nothing
// changed: an action the log does not record did not happen. NOW is Monday
// 21 September 2026, 12 noon in India. Every name and number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { createStubFsm, EMPTY_FSM } from "../../src/providers/fsm.ts";
import { appFor, captureLogs, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const FRIEND = "22222222-2222-4222-8222-222222222222";
const TECHNICIAN = "33333333-3333-4333-8333-333333333333";
const VISIT = "44444444-4444-4444-8444-444444444444";
const CASE = "55555555-5555-4555-8555-555555555555";
const LEAVE = "66666666-6666-4666-8666-666666666666";
const CHANGE = "77777777-7777-4777-8777-777777777777";
const REFERRAL = "88888888-8888-4888-8888-888888888888";
const GRIEVANCE = "99999999-9999-4999-8999-999999999999";
const AT = NOW.toISOString();

let ops: App;
let client: App;
let cookie: string;

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  client = appFor("local", fakeDependencies(), {}, "client");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra', 1)",
    ).bind(PERSON, AT),
    env.DB.prepare(
      "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES (?1, 'resource-1', 'Imran Qureshi', 'IQ', 1, ?2)",
    ).bind(TECHNICIAN, AT),
  ]);
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
});

/** Every audit entry but the ops surface's own record of each call, which is written first and apart. */
async function refuseAuditEntries(): Promise<void> {
  await env.DB.prepare(
    `CREATE TRIGGER refuse_audit BEFORE INSERT ON audit_log WHEN NEW.action != 'ops.call'
     BEGIN SELECT RAISE(ABORT, 'refused for the test'); END`,
  ).run();
}

function send(app: App, method: string, path: string, body?: unknown) {
  return request(
    app,
    path,
    {
      method,
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json", Cookie: cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    { MESSAGE_QUEUE: fakeQueue(), CRM_QUEUE: fakeQueue(), FSM_QUEUE: fakeQueue() },
  );
}

const one = (sql: string) => env.DB.prepare(sql).first();

describe("ops, when the audit entry cannot be written", () => {
  beforeEach(refuseAuditEntries);

  it("leaves a no-show undecided", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, fsm_modified_at,
           synced_at)
         VALUES (?1, 'fsm-1', ?2, 'service', 'terminated', 'Terminated', ?3, ?3, ?3)`,
      ).bind(VISIT, PERSON, AT),
      env.DB.prepare(
        `INSERT INTO checkins (id, appointment_id, technician_id, at, lat, lng, distance_m, radius_m, passed, created_at)
         VALUES ('checkin-1', ?1, ?2, ?3, 28.39, 77.06, 0, 200, 1, ?3)`,
      ).bind(VISIT, TECHNICIAN, AT),
      env.DB.prepare(
        `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, created_at)
         VALUES (?1, 'checkin-1', ?2, ?3, ?3, ?3)`,
      ).bind(CASE, VISIT, AT),
    ]);

    const ruling = { decision: "charged", reason: "Nobody came to the door in 20 minutes" };
    expect((await send(ops, "POST", `/api/no-shows/${CASE}/decision`, ruling)).status).toBe(500);
    expect(await one("SELECT decision, decided_by FROM no_show_cases")).toEqual({
      decision: "undecided",
      decided_by: null,
    });
  });

  it("adds no credits to a client", async () => {
    const answer = await send(ops, "POST", `/api/clients/${PERSON}/credits`, { visits: 2, reason: "goodwill" });
    expect(answer.status).toBe(500);
    expect(await one("SELECT COUNT(*) AS entries FROM credit_ledger")).toEqual({ entries: 0 });
  });

  it("records no leave", async () => {
    const answer = await send(ops, "POST", `/api/technicians/${TECHNICIAN}/leave`, {
      from: "2026-09-23",
      to: "2026-09-24",
    });
    expect(answer.status).toBe(500);
    expect(await one("SELECT COUNT(*) AS leave FROM technician_leave")).toEqual({ leave: 0 });
  });

  it("keeps leave that ops meant to take back", async () => {
    await env.DB.prepare(
      `INSERT INTO technician_leave (id, technician_id, from_date, to_date, actor, created_at)
       VALUES (?1, ?2, '2026-09-23', '2026-09-24', 'ops@localhost', ?3)`,
    )
      .bind(LEAVE, TECHNICIAN, AT)
      .run();

    expect((await send(ops, "POST", `/api/technicians/${TECHNICIAN}/leave/${LEAVE}/cancel`)).status).toBe(500);
    expect(await one("SELECT cancelled_at FROM technician_leave")).toEqual({ cancelled_at: null });
  });

  it("leaves a phone, and its session, as they were", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO sessions (id, subject_kind, subject_id, created_at, last_seen_at, expires_at)
         VALUES ('session-1', 'technician', ?1, ?2, ?2, '2026-12-01T00:00:00.000Z')`,
      ).bind(TECHNICIAN, AT),
      env.DB.prepare(
        `INSERT INTO technician_devices (id, technician_id, device_id, session_id, created_at, last_seen_at)
         VALUES ('device-1', ?1, 'phone-1', 'session-1', ?2, ?2)`,
      ).bind(TECHNICIAN, AT),
    ]);

    expect((await send(ops, "POST", `/api/technicians/${TECHNICIAN}/devices/phone-1/revoke`)).status).toBe(500);
    expect(await one("SELECT revoked_at FROM technician_devices")).toEqual({ revoked_at: null });
    expect(await one("SELECT revoked_at FROM sessions")).toEqual({ revoked_at: null });
  });

  it("leaves a number change waiting, and the client on their old number", async () => {
    await env.DB.prepare(
      `INSERT INTO number_change_requests (id, person_id, created_at, new_mobile_e164, old_verified_at, new_verified_at,
         state)
       VALUES (?1, ?2, ?3, '+919810000009', ?3, ?3, 'awaiting_ops')`,
    )
      .bind(CHANGE, PERSON, AT)
      .run();

    const answer = await send(ops, "POST", `/api/number-changes/${CHANGE}/decision`, {
      decision: "confirm",
      reason: null,
    });
    expect(answer.status).toBe(500);
    expect(await one("SELECT state FROM number_change_requests")).toEqual({ state: "awaiting_ops" });
    expect(await one("SELECT mobile_e164 FROM people")).toEqual({ mobile_e164: "+919810000001" });
  });

  it("leaves a held referral held, with no credits granted", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES (?1, ?2, '+919810000002', 'Kabir Anand', 1)",
      ).bind(FRIEND, AT),
      env.DB.prepare(
        "INSERT INTO referral_codes (code, person_id, created_at, updated_at) VALUES ('ROHIT1', ?1, ?2, ?2)",
      ).bind(PERSON, AT),
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, fsm_modified_at,
           synced_at)
         VALUES (?1, 'fsm-1', ?2, 'first_fit', 'completed', 'Completed', ?3, ?3, ?3)`,
      ).bind(VISIT, FRIEND, AT),
      env.DB.prepare(
        "INSERT INTO visits (id, appointment_id, outcome, updated_at) VALUES ('v-1', ?1, 'done', ?2)",
      ).bind(VISIT, AT),
      env.DB.prepare(
        `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, grant_state,
           first_fit_appointment_id, fraud_signals, created_at, updated_at)
         VALUES (?1, 'ROHIT1', ?2, ?3, 'consultation', 'held', ?4, '["shared_address"]', ?3, ?3)`,
      ).bind(REFERRAL, FRIEND, AT, VISIT),
    ]);

    const answer = await send(ops, "POST", `/api/referrals/${REFERRAL}/decision`, {
      decision: "approve",
      reason: "Brothers, living together",
    });
    expect(answer.status).toBe(500);
    expect(await one("SELECT grant_state FROM referral_attributions")).toEqual({ grant_state: "held" });
    expect(await one("SELECT COUNT(*) AS entries FROM credit_ledger")).toEqual({ entries: 0 });
  });

  it("leaves a pincode unlaunched, with no alert queued", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES ('122018', 'Sector 65', 'Gurgaon', 0)",
      ),
      env.DB.prepare(
        `INSERT INTO waitlist_entries (id, pincode, person_id, contact_consent_at, launch_alert, created_at)
         VALUES ('wait-1', '122018', ?1, ?2, 1, ?2)`,
      ).bind(PERSON, AT),
      env.DB.prepare(
        `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
         VALUES ('consent-1', ?1, 'whatsapp_launches', 'v1', 1, ?2)`,
      ).bind(PERSON, AT),
    ]);
    const messages = fakeQueue();

    const answer = await request(
      ops,
      "/api/pincodes/122018/launch",
      {
        method: "POST",
        headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      },
      { MESSAGE_QUEUE: messages },
    );

    expect(answer.status).toBe(500);
    expect(await one("SELECT served, launched_at FROM serviceable_pincodes")).toEqual({ served: 0, launched_at: null });
    expect(await one("SELECT COUNT(*) AS alerts FROM outbound_messages")).toEqual({ alerts: 0 });
    expect(messages.sent).toEqual([]);
  });

  it("leaves a grievance open, unanswered", async () => {
    await env.DB.prepare(
      "INSERT INTO grievances (id, person_id, text, state, created_at) VALUES (?1, ?2, 'Please call first.', 'open', ?3)",
    )
      .bind(GRIEVANCE, PERSON, AT)
      .run();

    const answer = await send(ops, "POST", `/api/grievances/${GRIEVANCE}/resolve`, { response: "Called him back." });
    expect(answer.status).toBe(500);
    expect(await one("SELECT state, response FROM grievances")).toEqual({ state: "open", response: null });
  });

  // The services clients book (docs/decisions/0085-services-ops-can-edit.md).
  it("adds no service, renames none, times none, orders none and retires none", async () => {
    const services = "SELECT kind, tier, name, minutes, sort, retired_date FROM services ORDER BY kind, tier";
    const before = await env.DB.prepare(services).all();

    expect((await send(ops, "POST", "/api/services", { kind: "first_fit", name: "Premium" })).status).toBe(500);
    expect((await send(ops, "POST", "/api/services/service/standard/name", { name: "Monthly" })).status).toBe(500);
    expect((await send(ops, "POST", "/api/services/service/standard/length", { minutes: 100 })).status).toBe(500);
    expect((await send(ops, "POST", "/api/services/service/order", { tiers: ["standard"] })).status).toBe(500);

    expect((await env.DB.prepare(services).all()).results).toEqual(before.results);
  });

  it("corrects no price still to come, taking none back and setting none", async () => {
    await env.DB.prepare(
      "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES ('service', 'standard', 250000, 0, '2026-10-01')",
    ).run();
    const correction = {
      item: "service",
      tier: "standard",
      amount_ex_gst: 260_000,
      gst_percent: 0,
      valid_from: "2026-10-05",
      was_valid_from: "2026-10-01",
    };

    expect((await send(ops, "POST", "/api/prices/correct", correction)).status).toBe(500);
    expect(
      await one(
        "SELECT group_concat(valid_from) AS days FROM price_book WHERE item = 'service' AND valid_from > '2026-09-30'",
      ),
    ).toEqual({ days: "2026-10-01" });
  });

  // A booking FSM refused five times running, held for ops (docs/decisions/0095-a-booking-fsm-refuses-is-held.md): a
  // free service visit on Thursday afternoon. Its refund changes Razorpay and FSM before its batch, so only a try,
  // a link and the tries stopped are all-or-nothing here.
  const HELD = "66666666-0000-4000-8000-000000000001";
  const heldBooking = () =>
    env.DB.prepare(
      `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount,
         amount_ex_gst, gst_percent, state, expires_at, created_at, updated_at, confirmed_at, queued_at, fsm_held_at)
       VALUES (?1, ?2, 'service', '2026-09-24', 'afternoon', ?3, 2, 0, 0, 0, 'held', ?4, ?4, ?4, ?4, ?4, ?4)`,
    )
      .bind(HELD, PERSON, TECHNICIAN, AT)
      .run();

  it("books no held booking in the mirror when ops try FSM again", async () => {
    await heldBooking();
    const withItems = createStubFsm({
      ...EMPTY_FSM,
      items: [{ id: "item-service", name: "Service visit", type: "Service", price: null }],
    });
    const trying = appFor("local", fakeDependencies({ fsm: withItems }), {}, "ops");

    const answer = await send(trying, "POST", `/api/held-bookings/${HELD}/retry`);
    expect(await answer.json()).toMatchObject({ outcome: "refused" });
    expect(await one("SELECT state, appointment_id FROM slot_holds")).toEqual({ state: "held", appointment_id: null });
    expect(await one("SELECT COUNT(*) AS visits FROM appointments")).toEqual({ visits: 0 });
  });

  it("links no held booking to the visit ops booked in FSM", async () => {
    await heldBooking();
    await env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, fsm_modified_at,
         synced_at, first_seen_at)
       VALUES (?1, 'fsm-by-hand', ?2, 'service', 'scheduled', 'Scheduled', '2026-09-24T08:30:00.000Z', ?3, ?3, ?3)`,
    )
      .bind(VISIT, PERSON, AT)
      .run();

    const answer = await send(ops, "POST", `/api/held-bookings/${HELD}/link`, { visit_id: VISIT });
    expect(answer.status).toBe(500);
    expect(await one("SELECT state, appointment_id FROM slot_holds")).toEqual({ state: "held", appointment_id: null });
  });

  it("stops no held booking's hourly tries", async () => {
    await heldBooking();

    const answer = await send(ops, "POST", `/api/held-bookings/${HELD}/stop`);
    expect(answer.status).toBe(500);
    expect(await one("SELECT queued_at, booking_until FROM slot_holds")).toEqual({
      queued_at: AT,
      booking_until: null,
    });
  });

  // Discount codes (docs/decisions/0108-discount-codes.md).
  it("makes no discount code, switches none off, and enters none on a visit or takes it off", async () => {
    const code = { code: "TENPC", kind: "percent", value: 10, covers: ["service"], once_per_client: true };
    expect((await send(ops, "POST", "/api/discount-codes", code)).status).toBe(500);
    expect(await one("SELECT COUNT(*) AS codes FROM discount_codes")).toEqual({ codes: 0 });

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO discount_codes (id, code, kind, value, covers_first_fit, covers_service, covers_replacement,
           once_per_client, created_by, created_at)
         VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'TENPC', 'percent', 10, 0, 1, 0, 1, 'ops@localhost', ?1)`,
      ).bind(AT),
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, fsm_modified_at,
           synced_at)
         VALUES (?1, 'fsm-1', ?2, 'service', 'scheduled', 'Scheduled', '2026-09-23T04:30:00.000Z', ?3, ?3)`,
      ).bind(VISIT, PERSON, AT),
    ]);
    expect((await send(ops, "POST", "/api/discount-codes/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/off")).status).toBe(500);
    expect(await one("SELECT switched_off_at FROM discount_codes")).toEqual({ switched_off_at: null });
    expect((await send(ops, "POST", `/api/visits/${VISIT}/discount-code`, { code: "TENPC" })).status).toBe(500);
    expect(await one("SELECT COUNT(*) AS uses FROM discount_code_uses")).toEqual({ uses: 0 });

    await env.DB.prepare(
      `INSERT INTO discount_code_uses (id, code_id, person_id, appointment_id, amount_off, given_by, given_by_id,
         created_at)
       VALUES ('use-1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ?1, ?2, 20000, 'ops', 'ops@localhost', ?3)`,
    )
      .bind(PERSON, VISIT, AT)
      .run();
    expect((await send(ops, "POST", `/api/visits/${VISIT}/discount-code/remove`)).status).toBe(500);
    expect(await one("SELECT removed_at FROM discount_code_uses")).toEqual({ removed_at: null });
  });
});

describe("the client, when the audit entry cannot be written", () => {
  beforeEach(refuseAuditEntries);

  it("starts no number change, and sends no code", async () => {
    const deps = fakeDependencies();
    const answer = await request(appFor("local", deps, {}, "client"), "/api/number-change", {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ new_mobile: "98100 00009" }),
    });

    expect(answer.status).toBe(500);
    expect(await one("SELECT COUNT(*) AS changes FROM number_change_requests")).toEqual({ changes: 0 });
    expect(deps.sentCodes).toEqual([]);
  });

  it("makes no deletion request", async () => {
    expect((await send(client, "POST", "/api/deletion-request")).status).toBe(500);
    expect(await one("SELECT COUNT(*) AS requests FROM deletion_requests")).toEqual({ requests: 0 });
  });

  it("raises no grievance, and alerts nobody", async () => {
    const deps = fakeDependencies();
    const answer = await request(appFor("local", deps, {}, "client"), "/api/grievances", {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ text: "Please call first." }),
    });

    expect(answer.status).toBe(500);
    expect(await one("SELECT COUNT(*) AS grievances FROM grievances")).toEqual({ grievances: 0 });
    expect(deps.alerts).toEqual([]);
  });

  it("gives no export", async () => {
    const answer = await send(client, "GET", "/api/me/export");
    expect(answer.status).toBe(500);
    expect(await answer.text()).not.toContain("Rohit");
  });
});
