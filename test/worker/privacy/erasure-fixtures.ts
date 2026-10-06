// What the erasure tests share (erasure*.test.ts): a booked client, one with a history, one with everything, and the
// erasure itself, called as ops call it.

import { env } from "cloudflare:workers";
import type { Dependencies } from "../../../src/dependencies.ts";
import { appFor, fakeDependencies, fakeQueue, NOW, phaseOneLead, request } from "../helpers.ts";
import { insertJob, syntheticJpeg, syntheticPng } from "../tryon-fixtures.ts";

export const MOBILE_E164 = "+919810000001";

/** A person with a booking, as the site's first form left one, and an e-mail address. */
export async function book(): Promise<string> {
  await phaseOneLead(MOBILE_E164);
  // The booking form takes no e-mail; set one to show that it is blanked too.
  const person = await env.DB.prepare(
    "UPDATE people SET email = 'arjun@example.com' WHERE mobile_e164 = ? RETURNING id",
  )
    .bind(MOBILE_E164)
    .first<{ id: string }>();
  return person?.id ?? "";
}

/** A person with a booking, three try-ons in different states, messages, a session and a try-on consent. */
export async function personWithHistory(): Promise<string> {
  const personId = await book();
  await insertJob({ id: "ready", person_id: personId, state: "ready", result_key: "results/ready.png" });
  await insertJob({ id: "running", person_id: personId, state: "rendering" });
  await insertJob({ id: "failed", person_id: personId, state: "failed", upload_deleted_at: NOW.toISOString() });
  await env.UPLOADS.put("uploads/ready", syntheticJpeg(800, 800));
  await env.UPLOADS.put("uploads/running", syntheticJpeg(800, 800));
  await env.RESULTS.put("results/ready.png", syntheticPng(512, 512));

  const at = NOW.toISOString();
  await env.DB.batch([
    ...["waiting", "queued", "sent"].map((state) =>
      env.DB.prepare(
        `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state)
         VALUES (?, ?, ?, 'tryon_result', 'ready', ?)`,
      ).bind(`message-${state}`, at, personId, state),
    ),
    env.DB.prepare("INSERT INTO tryon_sessions (id, person_id, created_at, expires_at) VALUES ('s', ?, ?, ?)").bind(
      personId,
      at,
      at,
    ),
    env.DB.prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
       VALUES ('c-tryon', ?, 'result_delivery', 'gate-v1', 1, ?)`,
    ).bind(personId, at),
  ]);
  return personId;
}

export interface Erasing {
  readonly body?: Record<string, unknown>;
  readonly queues?: Partial<Env>;
  readonly deps?: Dependencies;
  readonly surface?: "ops" | "public";
}

/** Ops erasing the client from their page in the console. */
export function erase(personId: string, erasing: Erasing = {}) {
  return request(
    appFor("local", erasing.deps ?? fakeDependencies(), {}, erasing.surface ?? "ops"),
    `/api/clients/${personId}/erasure`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify(erasing.body ?? {}),
    },
    erasing.queues ?? { CRM_QUEUE: fakeQueue() },
  );
}

export const statusOf = async (personId: string, erasing: Erasing = {}) => (await erase(personId, erasing)).status;

export const VISIT = "visit-1";

export const VISIT_PHOTO = `visits/${VISIT}/after-front-1.jpg`;

export const CARD = "cards/ARJUN1/v2.jpg";

/**
 * A client with something in every table erasure deletes from, and a row in
 * each table that points at one of those: a check-in measured against their
 * address, and the two codes of a number change still under way.
 */
export async function clientWithEverything(): Promise<string> {
  const personId = await personWithHistory();
  const at = NOW.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1)",
    ).bind(at),
    env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, technician_id, synced_at)
       VALUES (?1, ?1, ?2, 'service', 'completed', '2026-09-01T06:30:00.000Z', 't1', ?3)`,
    ).bind(VISIT, personId, at),
    env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode, lat, lng, access_notes, flat)
       VALUES ('address-1', ?1, ?2, 'House 7', 'Sector 65', 'Gurgaon', '122018', 28.39, 77.06, 'Gate code 4417', '7B')`,
    ).bind(personId, at),
    env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode, replaced_at)
       VALUES ('address-0', ?1, ?2, 'Old house', 'Sector 56', 'Gurgaon', '122011', ?2)`,
    ).bind(personId, at),
    env.DB.prepare(
      `INSERT INTO checkins (id, appointment_id, technician_id, address_id, at, lat, lng, distance_m, radius_m, passed,
         created_at)
       VALUES ('checkin-1', ?1, 't1', 'address-1', ?2, 28.39, 77.06, 12, 200, 1, ?2)`,
    ).bind(VISIT, at),
    env.DB.prepare(
      "INSERT INTO photo_sets (id, appointment_id, phase, created_at) VALUES ('set-1', ?1, 'after', ?2)",
    ).bind(VISIT, at),
    env.DB.prepare(
      `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, width, height, taken_at, created_at)
       VALUES ('photo-1', 'set-1', 'front', ?1, 'image/jpeg', 3, 600, 800, ?2, ?2)`,
    ).bind(VISIT_PHOTO, at),
    env.DB.prepare(
      `INSERT INTO number_change_requests (id, person_id, created_at, new_mobile_e164, state)
       VALUES ('change-1', ?1, ?2, '+919810000009', 'verifying')`,
    ).bind(personId, at),
    ...["number_change_old", "number_change_new"].map((purpose) =>
      env.DB.prepare(
        `INSERT INTO otp_challenges (id, created_at, person_id, purpose, channel, code_hash, last_sent_at, expires_at,
           number_change_id)
         VALUES (?1, ?2, ?3, ?4, 'whatsapp', 'a-hash', ?2, ?2, 'change-1')`,
      ).bind(`code-${purpose}`, at, personId, purpose),
    ),
    env.DB.prepare(
      `INSERT INTO referral_codes (code, person_id, card_state, card_version, card_key, created_at, updated_at)
       VALUES ('ARJUN1', ?1, 'personal', 2, ?2, ?3, ?3)`,
    ).bind(personId, CARD, at),
    env.DB.prepare(
      `INSERT INTO waitlist_entries (id, pincode, person_id, contact_consent_at, created_at)
       VALUES ('wait-1', '400050', ?1, ?2, ?2)`,
    ).bind(personId, at),
    env.DB.prepare(
      "INSERT INTO grievances (id, person_id, text, state, created_at) VALUES ('g-1', ?1, 'Please call first.', 'open', ?2)",
    ).bind(personId, at),
  ]);
  await env.CLIENT_PHOTOS.put(VISIT_PHOTO, syntheticJpeg(600, 800));
  await env.REFERRAL_CARDS.put(CARD, syntheticJpeg(1200, 630));
  return personId;
}

/** Whether each file the client left is still in its bucket. */
export async function filesLeft() {
  return {
    upload: (await env.UPLOADS.head("uploads/ready")) !== null,
    result: (await env.RESULTS.head("results/ready.png")) !== null,
    visitPhoto: (await env.CLIENT_PHOTOS.head(VISIT_PHOTO)) !== null,
    card: (await env.REFERRAL_CARDS.head(CARD)) !== null,
  };
}

/** Makes D1 refuse the erasure's batch, as any failure part-way through it would. */
export async function databaseRefusesErasure(): Promise<void> {
  await env.DB.prepare(
    `CREATE TRIGGER refuse_erasure BEFORE UPDATE OF erased_at ON people
     BEGIN SELECT RAISE(ABORT, 'refused for the test'); END`,
  ).run();
}

/** A visit still to happen, paid for, as a client's Monday service is. */
export async function bookedVisit(personId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, synced_at)
     VALUES ('visit-live', 'visit-live', ?1, 'service', 'scheduled', '2026-09-28T03:30:00.000Z', ?2)`,
  )
    .bind(personId, NOW.toISOString())
    .run();
}

/** A consultation and fit in one visit, fitted last week, whose link Razorpay sent and nobody has paid. */
export async function fittedVisitUnpaid(personId: string): Promise<void> {
  const at = NOW.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, synced_at, one_visit)
       VALUES ('visit-fitted', 'visit-fitted', ?1, 'first_fit', 'completed', '2026-09-14T03:30:00.000Z', ?2, 'booked')`,
    ).bind(personId, at),
    env.DB.prepare(
      `INSERT INTO payment_links (id, appointment_id, tier, amount, amount_ex_gst, gst_percent, razorpay_link_id,
         short_url, sent_at, reference, created_at, updated_at)
       VALUES ('link-1', 'visit-fitted', 'standard', 4500000, 3813559, 18, 'plink_visit', 'https://rzp.io/i/v', ?1,
         'MM-2026-0003', ?1, ?1)`,
    ).bind(at),
  ]);
}
