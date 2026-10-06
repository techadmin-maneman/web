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
import { openNoShowCase } from "../../../src/domain/no-shows/no-shows.ts";
import { NO_VISITS_CONSENT } from "../../../src/domain/messages/visit-message-text.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { PERSON, VISIT, CASE, TECHNICIAN, type Case } from "./ops-no-shows-fixtures.ts";

let ops: App;

const cases = async (): Promise<Case[]> =>
  (await (await request(ops, "/api/no-shows")).json<{ cases: Case[] }>()).cases;

const rule = (body: unknown) =>
  request(ops, `/api/no-shows/${CASE}/decision`, {
    method: "POST",
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

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

    it("reads the reminder that went, not a later arrival notice that did not", async () => {
      await env.DB.prepare(
        `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, last_error)
         VALUES ('reminder-1', '2026-09-18T12:30:00.000Z', ?1, 'visit_reminder', 'appointment', ?2, 'sent', NULL),
                ('arrival-1', '2026-09-19T08:39:00.000Z', ?1, 'arrival_notice', 'appointment', ?2, 'skipped', 'test record')`,
      )
        .bind(PERSON, VISIT)
        .run();
      const checkIn = {
        id: "checkin-1",
        at: new Date("2026-09-19T08:38:59.000Z"),
        receivedAt: new Date("2026-09-19T08:59:00.037Z"),
        distanceM: 40,
        radiusM: 200,
      };
      await openNoShowCase(env.DB, {
        appointmentId: VISIT,
        checkIn,
        waitStartsAt: checkIn.at,
        waitEndsAt: new Date("2026-09-19T09:14:00.037Z"),
        now: NOW,
      });

      expect((await cases())[0]?.message_state).toBe("sent");
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

// After a charge the page once still said "Nothing was charged today", and the case was gone.
describe("GET /api/no-shows/decided", () => {
  const decided = async () => (await (await request(ops, "/api/no-shows/decided")).json<{ cases: unknown[] }>()).cases;

  it("lists the cases ruled on today, with the ruling and what a charge kept", async () => {
    expect(await decided()).toEqual([]);
    await env.DB.prepare(
      `INSERT INTO payments (id, reference, person_id, appointment_id, razorpay_payment_id, amount, currency, method,
         status, captured_at, created_at, updated_at)
       VALUES ('payment-1', 'MM-2026-0841', ?1, ?2, 'pay_visit', 200000, 'INR', 'upi', 'captured', ?3, ?3, ?3)`,
    )
      .bind(PERSON, VISIT, NOW.toISOString())
      .run();
    expect((await rule({ decision: "charged", reason: "Nobody came to the door" })).status).toBe(200);

    expect(await decided()).toEqual([
      {
        id: CASE,
        person: { id: PERSON, name: "Rohit Malhotra" },
        visit_date: "2026-09-19",
        decision: "charged",
        decided_at: NOW.toISOString(),
        charge: { kept: 200000, credit_spent: false },
      },
    ]);
  });

  it("says a waiver kept nothing, and leaves out a case ruled before today", async () => {
    expect((await rule({ decision: "waived", reason: "He was stuck in the lift" })).status).toBe(200);
    expect(await decided()).toMatchObject([{ id: CASE, decision: "waived", charge: null }]);

    // Ruled at 11:59 pm last night in India.
    await env.DB.prepare("UPDATE no_show_cases SET decided_at = '2026-09-20T18:29:00.000Z'").run();
    expect(await decided()).toEqual([]);
  });
});
