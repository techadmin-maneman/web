// What the Tasks tests share (ops-tasks*.test.ts): the people, visits and records each task waits on, made one at a
// time, and the console asked as a service token.

import { env } from "cloudflare:workers";
import { appFor, fakeDependencies, NOW } from "../helpers.ts";

export const PERSON = "11111111-1111-4111-8111-111111111111";

export const REFERRED = "11111111-1111-4111-8111-111111111112";

export const OTHER = "11111111-1111-4111-8111-111111111113";

export const VISIT = "22222222-2222-4222-8222-222222222222";

export const HELD = "33333333-3333-4333-8333-333333333332";

export const CASE = "33333333-3333-4333-8333-333333333333";

export const CHANGE = "33333333-3333-4333-8333-333333333334";

export const ERASURE = "33333333-3333-4333-8333-333333333335";

export const CHECK_IN = "44444444-4444-4444-8444-444444444441";

export const REQUEST = "33333333-3333-4333-8333-333333333336";

export const CONSULTATION = "22222222-2222-4222-8222-222222222223";

export const GRIEVANCE = "33333333-3333-4333-8333-333333333337";

/** The console as a service token sees it: Access let it in, and it names no member of staff. */
export const asServiceToken = () =>
  appFor(
    "local",
    fakeDependencies({
      access: { verify: () => Promise.resolve({ ok: true, identity: { kind: "service", clientId: "ci.access" } }) },
    }),
    {},
    "ops",
  );

export async function person(id: string, name: string, mobile: string) {
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, '2026-08-01T06:00:00.000Z', ?2, ?3)",
  )
    .bind(id, mobile, name)
    .run();
}

/** A grant the fraud rules held for review, against the referrer's own code. */
export async function heldGrant(signals: string) {
  await env.DB.prepare(
    "INSERT INTO referral_codes (code, person_id, created_at, updated_at) VALUES ('RM4417', ?1, ?2, ?2)",
  )
    .bind(PERSON, "2026-09-01T06:00:00.000Z")
    .run();
  await env.DB.prepare(
    `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, grant_state,
       fraud_signals, created_at, updated_at)
     VALUES (?1, 'RM4417', ?2, '2026-09-01T06:00:00.000Z', 'consultation', 'held', ?3,
       '2026-09-01T06:00:00.000Z', '2026-09-18T06:00:00.000Z')`,
  )
    .bind(HELD, REFERRED, signals)
    .run();
}

/** A job closed as a no-show, with the check-in the wait ran from, and nobody has ruled on it. */
export async function noShowCase(decision: "undecided" | "charged") {
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'fsm-t1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
       technician_id, fsm_modified_at, synced_at)
     VALUES (?1, 'fsm-1', ?2, 'service', 'completed', 'Completed', '2026-09-19T04:30:00.000Z',
       '2026-09-19T07:30:00.000Z', 't1', ?3, ?3)`,
  )
    .bind(VISIT, PERSON, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO checkins (id, appointment_id, technician_id, at, lat, lng, distance_m, radius_m, passed, created_at)
     VALUES (?1, ?2, 't1', '2026-09-19T06:01:00.000Z', 28.4, 77.0, 240, 200, 1, '2026-09-19T06:01:00.000Z')`,
  )
    .bind(CHECK_IN, VISIT)
    .run();
  await env.DB.prepare(
    `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, closed_at,
       decision, created_at)
     VALUES (?1, ?2, ?3, '2026-09-19T06:01:00.000Z', '2026-09-19T06:16:00.000Z', '2026-09-19T06:17:00.000Z',
       ?4, '2026-09-19T06:17:00.000Z')`,
  )
    .bind(CASE, CHECK_IN, VISIT, decision)
    .run();
}

export async function numberChange(state: string) {
  await env.DB.prepare(
    `INSERT INTO number_change_requests (id, person_id, created_at, new_mobile_e164, old_verified_at,
       new_verified_at, state)
     VALUES (?1, ?2, '2026-09-19T06:00:00.000Z', '+919810000099', '2026-09-20T06:00:00.000Z',
       '2026-09-20T06:30:00.000Z', ?3)`,
  )
    .bind(CHANGE, PERSON, state)
    .run();
}

/** A consultation asked for while self-serve booking was off, which no slot was held for. */
export async function consultationRequest() {
  await env.DB.prepare(
    `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, created_at)
     VALUES (?1, ?2, '122018', '2026-09-23', 'morning', '2026-09-20T06:00:00.000Z')`,
  )
    .bind(REQUEST, PERSON)
    .run();
}

/** The consultation ops booked for them, which takes the request off the board. */
export async function consultationFor(personId: string, status: string) {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, status, fsm_status, fsm_modified_at,
       synced_at)
     VALUES (?1, 'fsm-appt-consult', ?2, 'consultation', '2026-09-23T03:30:00.000Z', ?3, 'Scheduled', ?4, ?4)`,
  )
    .bind(CONSULTATION, personId, status, NOW.toISOString())
    .run();
}

/** A concern the client raised from their own app, which ops answer in the console. */
export async function grievance(id: string, raisedAt = "2026-09-20T06:00:00.000Z") {
  await env.DB.prepare(
    `INSERT INTO grievances (id, person_id, text, state, created_at)
     VALUES (?1, ?2, 'Why do you keep my photographs?', 'open', ?3)`,
  )
    .bind(id, PERSON, raisedAt)
    .run();
}

export async function erasureRequest(state: string) {
  await env.DB.prepare("INSERT INTO deletion_requests (id, person_id, created_at, state) VALUES (?1, ?2, ?3, ?4)")
    .bind(ERASURE, PERSON, "2026-09-20T06:00:00.000Z", state)
    .run();
}
