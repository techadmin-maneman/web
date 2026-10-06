// What the console's client tests share (ops-clients, ops-client-record, ops-client-photos, ops-client-consents): the
// clients, a visit with its photographs and payment, and a client's record as the console reads it.

import { env } from "cloudflare:workers";
import { grantCredits } from "../../../src/domain/money/credits.ts";
import { NOW } from "../helpers.ts";

export const PERSON = "11111111-1111-4111-8111-111111111111";

export const OTHER = "11111111-1111-4111-8111-111111111112";

export const UNKNOWN = "99999999-9999-4999-8999-999999999999";

export const VISIT = "22222222-2222-4222-8222-222222222222";

export const UPCOMING = "22222222-2222-4222-8222-222222222229";

export const SET = "33333333-3333-4333-8333-333333333333";

export const FRONT = "44444444-4444-4444-8444-444444444441";

export const TOP = "44444444-4444-4444-8444-444444444442";

export const PAYMENT = "55555555-5555-4555-8555-555555555555";

export const MOBILE = "+919810000001";

export async function person(id: string, name: string, mobile: string) {
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)")
    .bind(id, "2026-08-01T06:00:00.000Z", mobile, name)
    .run();
}

/** A finished service visit with a technician, an address, two photographs, a payment and a credit. */
export async function record() {
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'fsm-t1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
       technician_id, service_city, service_pincode, fsm_modified_at, synced_at)
     VALUES (?1, 'fsm-1', ?2, 'service', 'completed', 'Completed', '2026-09-10T04:30:00.000Z',
       '2026-09-10T07:30:00.000Z', 't1', 'Gurgaon', '122018', ?3, ?3)`,
  )
    .bind(VISIT, PERSON, NOW.toISOString())
    .run();
  await env.DB.prepare(
    "INSERT INTO visits (id, appointment_id, outcome, duration_minutes, updated_at) VALUES ('v1', ?1, 'partial', 95, ?2)",
  )
    .bind(VISIT, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO addresses (id, person_id, created_at, line1, line2, locality, city, pincode, access_notes)
     VALUES ('addr-1', ?1, ?2, 'House 7', NULL, 'Sector 65', 'Gurgaon', '122018', 'Gate 4417, visitor bay B')`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  await env.DB.prepare("INSERT INTO photo_sets (id, appointment_id, phase, created_at) VALUES (?1, ?2, 'after', ?3)")
    .bind(SET, VISIT, NOW.toISOString())
    .run();
  for (const [id, angle] of [
    [TOP, "top"],
    [FRONT, "front"],
  ] as const) {
    await env.DB.prepare(
      `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, width, height, taken_at, created_at)
       VALUES (?1, ?2, ?3, ?4, 'image/jpeg', 3, 600, 800, ?5, ?5)`,
    )
      .bind(id, SET, angle, `visits/${VISIT}/after-${angle}.jpg`, NOW.toISOString())
      .run();
    await env.CLIENT_PHOTOS.put(`visits/${VISIT}/after-${angle}.jpg`, new Uint8Array([1, 2, 3]));
  }
  await env.DB.prepare(
    `INSERT INTO payments (id, reference, person_id, appointment_id, razorpay_payment_id, amount, currency, method,
       status, created_at, updated_at)
     VALUES (?1, 'MM-2026-0841', ?2, ?3, 'pay_1', 236000, 'INR', 'upi', 'captured', ?4, ?4)`,
  )
    .bind(PAYMENT, PERSON, VISIT, "2026-09-09T06:00:00.000Z")
    .run();
  await grantCredits(env.DB, { personId: PERSON, visits: 2, source: "ops", sourceId: "o1", now: NOW }).run();
}

/** A service visit on Friday the 25th, booked and not yet paid for. */
export async function upcomingVisit() {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, tier, status, fsm_status, window_start, window_end,
       technician_id, service_city, service_pincode, fsm_modified_at, synced_at)
     VALUES (?1, 'fsm-2', ?2, 'service', 'natural', 'scheduled', 'Scheduled', '2026-09-25T04:30:00.000Z',
       '2026-09-25T07:30:00.000Z', 't1', 'Gurgaon', '122018', ?3, ?3)`,
  )
    .bind(UPCOMING, PERSON, NOW.toISOString())
    .run();
}
