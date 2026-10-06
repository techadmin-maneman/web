import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { erasePerson } from "../../../src/domain/privacy/erasure.ts";
import { createLogger } from "../../../src/log.ts";
import { captureLogs, markDatabase, NOW } from "../helpers.ts";
import { clientWithEverything, databaseRefusesErasure, statusOf, VISIT } from "./erasure-fixtures.ts";

beforeEach(async () => {
  await markDatabase();
  captureLogs();
});

// A reason is ops' own words about a client, kept with the decision (docs/decisions/0072-ops-clients-and-queues.md):
// "same flat as Rohit" is a personal detail, so it goes with the rest of what an erasure blanks.
describe("erasure blanks what ops wrote about the client", () => {
  const FRIEND = "friend-1";
  const REFERRER = "referrer-1";

  async function reasonsWritten(): Promise<void> {
    const at = NOW.toISOString();
    await env.DB.batch([
      ...[
        [REFERRER, "+919810000011", "Vikram Sood"],
        [FRIEND, "+919810000012", "Kabir Anand"],
      ].map(([id, mobile, name]) =>
        env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)").bind(
          id,
          at,
          mobile,
          name,
        ),
      ),
      env.DB.prepare(
        "INSERT INTO referral_codes (code, person_id, created_at, updated_at) VALUES ('VSAB23', ?1, ?2, ?2)",
      ).bind(REFERRER, at),
      env.DB.prepare(
        `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, grant_state,
           review_reason, reviewed_by, reviewed_at, attached_by, attach_reason, created_at, updated_at)
         VALUES ('referral-1', 'VSAB23', ?1, ?2, 'consultation', 'rejected', 'Same flat as Vikram', 'ops@localhost',
           ?2, 'ops@localhost', 'Named Vikram on WhatsApp', ?2, ?2)`,
      ).bind(FRIEND, at),
      env.DB.prepare(
        "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1)",
      ).bind(at),
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, technician_id, synced_at)
         VALUES ('visit-9', 'visit-9', ?1, 'service', 'terminated', '2026-09-19T03:30:00.000Z', 't1', ?2)`,
      ).bind(FRIEND, at),
      env.DB.prepare(
        `INSERT INTO checkins (id, appointment_id, technician_id, at, lat, lng, radius_m, passed, created_at)
         VALUES ('checkin-9', 'visit-9', 't1', ?1, 28.4, 77.0, 200, 1, ?1)`,
      ).bind(at),
      env.DB.prepare(
        `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, closed_at, decision,
           decided_by, decided_at, decision_reason, created_at)
         VALUES ('case-9', 'checkin-9', 'visit-9', ?1, ?1, ?1, 'charged', 'ops@localhost', ?1,
           'His wife said he forgets', ?1)`,
      ).bind(at),
      // Why ops closed a visit of his left partly done without a follow-up (docs/decisions/0092-task-owners.md).
      env.DB.prepare(
        `INSERT INTO task_closures (id, task_group, subject_id, reason, closed_by, closed_at)
         VALUES ('closing-9', 'partial_visit', 'visit-9', 'Moving to Pune, wants no more visits', 'ops@localhost', ?1)`,
      ).bind(at),
      // The visit ops closed by hand when Imran's phone was lost, and another they cancelled for him.
      env.DB.prepare(
        `INSERT INTO visits (id, appointment_id, outcome, updated_at, closed_by, close_reason)
         VALUES ('visit-row-9', 'visit-9', 'partial', ?1, 'ops@localhost', 'He had to leave for the hospital')`,
      ).bind(at),
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, synced_at)
         VALUES ('visit-10', 'visit-10', ?1, 'service', 'cancelled', '2026-09-24T03:30:00.000Z', ?2)`,
      ).bind(FRIEND, at),
      env.DB.prepare(
        `INSERT INTO visit_changes (id, appointment_id, person_id, kind, notice, was_start, created_at, cancelled_by,
           cancel_reason, ops_terms)
         VALUES ('change-10', 'visit-10', ?1, 'cancelled', 'late', '2026-09-24T03:30:00.000Z', ?2, 'ops@localhost',
           'His mother is unwell', 'free')`,
      ).bind(FRIEND, at),
      // A visit of his ops moved onto a day they had blacked out.
      env.DB.prepare(
        `INSERT INTO dispatch_moves (id, appointment_id, was_technician_id, now_technician_id, was_start, now_start,
           reason, actor, fsm_write_state, created_at, updated_at, blackout_reason)
         VALUES ('move-9', 'visit-9', 't1', 't1', '2026-09-18T03:30:00.000Z', '2026-09-19T03:30:00.000Z',
           'client_asked', 'ops@localhost', 'written', ?1, ?1, 'His only day off before the wedding')`,
      ).bind(at),
    ]);
  }

  const reasons = () =>
    env.DB.prepare(
      `SELECT (SELECT review_reason FROM referral_attributions) AS review,
         (SELECT attach_reason FROM referral_attributions) AS attach,
         (SELECT decision_reason FROM no_show_cases) AS no_show,
         (SELECT reason FROM task_closures) AS closed,
         (SELECT close_reason FROM visits) AS closed_by_hand,
         (SELECT cancel_reason FROM visit_changes) AS cancelled,
         (SELECT blackout_reason FROM dispatch_moves) AS moved_onto_blackout`,
    ).first();

  it("blanks the reasons ops gave about the friend: the invite attached, the grant's review, the no-show ruling, a visit's task closed, a visit closed by hand, one cancelled and one moved onto a blacked-out day", async () => {
    await reasonsWritten();

    expect(await erasePerson({ env, personId: FRIEND, now: NOW, log: createLogger() })).not.toBeNull();

    expect(await reasons()).toEqual({
      review: null,
      attach: null,
      no_show: null,
      closed: null,
      closed_by_hand: null,
      cancelled: null,
      moved_onto_blackout: null,
    });
    // The decisions themselves stay, as records.
    const ruled = await env.DB.prepare(
      "SELECT (SELECT grant_state FROM referral_attributions) AS grant_state, (SELECT decision FROM no_show_cases) AS decision",
    ).first();
    expect(ruled).toEqual({ grant_state: "rejected", decision: "charged" });
  });

  // Which member of staff took their address on the phone is about the client too (docs/decisions/0092-task-owners.md);
  // the audit log, which an erasure cannot reach, still says who saved one.
  it("blanks who in ops took the friend's address on the phone, and keeps the log's entry", async () => {
    await reasonsWritten();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode, given_to_staff)
         VALUES ('address-9', ?1, ?2, 'Flat 9, Palm Grove', 'Sector 65', 'Gurgaon', '122018', 'priya@maneman.in')`,
      ).bind(FRIEND, NOW.toISOString()),
      // The check-in was measured against it, so it is blanked rather than deleted.
      env.DB.prepare("UPDATE checkins SET address_id = 'address-9' WHERE id = 'checkin-9'"),
      env.DB.prepare(
        `INSERT INTO audit_log (at, surface, actor_kind, actor, action, subject_kind, subject_id, request_id)
         VALUES (?2, 'ops', 'staff', 'priya@maneman.in', 'address.given_to_ops', 'person', ?1, 'r')`,
      ).bind(FRIEND, NOW.toISOString()),
    ]);

    await erasePerson({ env, personId: FRIEND, now: NOW, log: createLogger() });

    expect(await env.DB.prepare("SELECT line1, given_to_staff FROM addresses").all()).toMatchObject({
      results: [{ line1: "Erased", given_to_staff: null }],
    });
    expect(await env.DB.prepare("SELECT actor FROM audit_log WHERE action = 'address.given_to_ops'").first()).toEqual({
      actor: "priya@maneman.in",
    });
  });

  it("blanks the grant's review reason when the referrer is the one erased", async () => {
    await reasonsWritten();

    await erasePerson({ env, personId: REFERRER, now: NOW, log: createLogger() });

    expect(await reasons()).toEqual({
      review: null,
      attach: null,
      no_show: "His wife said he forgets",
      closed: "Moving to Pune, wants no more visits",
      closed_by_hand: "He had to leave for the hospital",
      cancelled: "His mother is unwell",
      moved_onto_blackout: "His only day off before the wedding",
    });
  });

  it("blanks nothing when the database refuses the erasure", async () => {
    await reasonsWritten();
    await databaseRefusesErasure();

    await expect(erasePerson({ env, personId: FRIEND, now: NOW, log: createLogger() })).rejects.toThrow();

    expect(await reasons()).toEqual({
      review: "Same flat as Vikram",
      attach: "Named Vikram on WhatsApp",
      no_show: "His wife said he forgets",
      closed: "Moving to Pune, wants no more visits",
      closed_by_hand: "He had to leave for the hospital",
      cancelled: "His mother is unwell",
      moved_onto_blackout: "His only day off before the wedding",
    });
  });
});

describe("erasure blanks a check-in's coordinates", () => {
  const checkins = () =>
    env.DB.prepare(
      `SELECT id, lat, lng, accuracy_m, at, address_id, distance_m, radius_m, passed FROM checkins ORDER BY id`,
    ).all();

  it("takes where the technician's phone was off each of the client's check-ins, and keeps whether it passed", async () => {
    const personId = await clientWithEverything();
    const at = NOW.toISOString();
    // A second check-in of theirs, with nothing to measure against, and another client's, at their own door.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO checkins (id, appointment_id, technician_id, at, lat, lng, accuracy_m, radius_m, passed, created_at)
         VALUES ('checkin-2', ?1, 't1', ?2, 28.41, 77.05, 9.5, 200, 1, ?2)`,
      ).bind(VISIT, at),
      env.DB.prepare(
        "INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('other', ?1, '+919810000077', 'Kabir Anand')",
      ).bind(at),
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, technician_id, synced_at)
         VALUES ('visit-other', 'visit-other', 'other', 'service', 'completed', ?1, 't1', ?1)`,
      ).bind(at),
      env.DB.prepare(
        `INSERT INTO checkins (id, appointment_id, technician_id, at, lat, lng, accuracy_m, radius_m, passed, created_at)
         VALUES ('checkin-other', 'visit-other', 't1', ?1, 28.5, 77.1, 6, 200, 1, ?1)`,
      ).bind(at),
    ]);

    expect(await statusOf(personId)).toBe(200);

    const kept = { at, radius_m: 200, passed: 1 };
    expect((await checkins()).results).toEqual([
      { id: "checkin-1", lat: null, lng: null, accuracy_m: null, address_id: "address-1", distance_m: 12, ...kept },
      { id: "checkin-2", lat: null, lng: null, accuracy_m: null, address_id: null, distance_m: null, ...kept },
      { id: "checkin-other", lat: 28.5, lng: 77.1, accuracy_m: 6, address_id: null, distance_m: null, ...kept },
    ]);
  });
});

describe("erasure blanks what a pay step kept on a hold", () => {
  it("takes the purposes shown and the client's hashed address off their holds, and keeps the hold", async () => {
    const personId = await clientWithEverything();
    const at = NOW.toISOString();
    await env.DB.prepare(
      `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount,
         amount_ex_gst, gst_percent, state, expires_at, created_at, updated_at, consents_shown, consents_ip_hash)
       VALUES ('hold-1', ?1, 'service', '2026-09-24', 'afternoon', 't1', 2, 200000, 169492, 18, 'released', ?2, ?2,
         ?2, 'photos_own_record,photos_referral_cards', 'a-hash')`,
    )
      .bind(personId, at)
      .run();

    expect(await statusOf(personId)).toBe(200);

    const hold = await env.DB.prepare(
      "SELECT state, consents_shown, consents_ip_hash FROM slot_holds WHERE id = 'hold-1'",
    ).first();
    expect(hold).toEqual({ state: "released", consents_shown: null, consents_ip_hash: null });
  });
});
