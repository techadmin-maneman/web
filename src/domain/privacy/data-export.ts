// Everything held about a client, for their data export: the right of access. The route audits the export before
// this reads anything, so an export the log could not record is never given.
//
// Each part gives its columns as stored. What a part leaves out of its table, and why, is in
// src/policy/personal-data.ts; the readable copy (src/domain/privacy/my-data-page.ts) labels each column and writes its time
// in India.

import { exportedProfiles } from "../clients/hair-profiles.ts";
import { allViews } from "../field/photo-views.ts";

/** The hair system a fit or replacement was for, by the name the client was sold it under; none for other visits. */
const HAIR_SYSTEM = (row: string) =>
  `SELECT s.name FROM services s WHERE s.kind = ${row}.type AND s.tier = ${row}.tier
     AND ${row}.type IN ('first_fit', 'replacement')`;

/** Each part of the export one query reads, by its key in the file. */
export const EXPORT_QUERIES = {
  person: "SELECT name, mobile_e164 AS mobile, email, contactable, created_at FROM people WHERE id = ?1",
  // Whether they gave it to us on the phone, never which member of staff took it down.
  addresses: `SELECT flat, floor, tower, building, line1, line2, landmark, locality, city, pincode, access_notes, lat, lng,
      given_to_staff IS NOT NULL AS given_on_the_phone, created_at, replaced_at
    FROM addresses WHERE person_id = ?1 ORDER BY created_at`,
  consents: `SELECT purpose, granted, notice_version, source, created_at FROM consents WHERE person_id = ?1
    ORDER BY created_at, rowid`,
  visits: `SELECT a.type, a.tier, (${HAIR_SYSTEM("a")}) AS hair_system, a.window_start, a.window_end, a.status, a.one_visit, a.asked_window,
      t.name AS technician, a.service_city, a.service_pincode, a.client_note, a.client_note_at
    FROM appointments a LEFT JOIN technicians t ON t.id = a.technician_id
    WHERE a.person_id = ?1 AND a.deleted_at IS NULL ORDER BY a.window_start`,
  visit_changes: `SELECT kind, was_start, now_start, notice, ops_terms, refund_amount, kept_amount, created_at
    FROM visit_changes WHERE person_id = ?1 ORDER BY created_at`,
  bookings_started: `SELECT reference, h.type, tier, (${HAIR_SYSTEM("h")}) AS hair_system, minutes, date, window_label, pincode, move_kind, one_visit, amount,
      use_credit, pay_by_link, change_notice_hours, late_change_charge, no_show_charge, consents_shown, state,
      auto_refund_reason, created_at, confirmed_at
    FROM slot_holds h WHERE person_id = ?1 ORDER BY created_at`,
  hair_systems: `SELECT piece_code, base, fitted_at, replacement_due_at, failed_at, failure_reason FROM pieces
    WHERE person_id = ?1 AND deleted_at IS NULL ORDER BY fitted_at`,
  payments: `SELECT reference, kind, amount, amount_ex_gst, gst_percent, method, card_network, status, refunded_amount,
      created_at, captured_at
    FROM payments WHERE person_id = ?1 ORDER BY created_at`,
  refunds: `SELECT p.reference AS payment, r.amount, r.status, r.created_at, r.processed_at FROM refunds r
    JOIN payments p ON p.id = r.payment_id WHERE p.person_id = ?1 ORDER BY r.created_at`,
  // Who entered a code is a role, never which member of staff.
  discount_codes: `SELECT c.code, u.amount_off, u.given_by, u.created_at, u.removed_at, u.removed_by
    FROM discount_code_uses u JOIN discount_codes c ON c.id = u.code_id WHERE u.person_id = ?1 ORDER BY u.created_at`,
  credits: "SELECT kind, visits, expires_at, created_at FROM credit_ledger WHERE person_id = ?1 ORDER BY created_at",
  // In the client's words, and how ops ruled; never ops' own note on it.
  no_show_disputes: `SELECT a.window_start AS visit, d.reason, d.created_at, d.ruling, d.ruled_at FROM no_show_disputes d
    JOIN no_show_cases n ON n.id = d.case_id JOIN appointments a ON a.id = n.appointment_id
    WHERE d.person_id = ?1 ORDER BY d.created_at`,
  referral: "SELECT code, card_state, opens, created_at FROM referral_codes WHERE person_id = ?1",
  referred_by: `SELECT code, via, first_touch_at, pincode, friend_first_name, told_notice, grant_state, friend_visits,
      credit_valid_days, created_at
    FROM referral_attributions WHERE referred_person_id = ?1`,
  consultation_requests: `SELECT pincode, requested_date, requested_window, one_visit, referral_code, discount_code,
      booked, created_at
    FROM consultation_requests WHERE person_id = ?1 ORDER BY created_at`,
  first_fit_requests: "SELECT preferred_window, created_at FROM first_fit_requests WHERE person_id = ?1",
  waitlist: `SELECT pincode, referral_code, contact_consent_at, launch_alert, alerted_at, created_at FROM waitlist_entries
    WHERE person_id = ?1 ORDER BY created_at`,
  leads: `SELECT source, city, loss_extent, first_choice_window, proposed_visit_date, referrer, landing_path, utm_source,
      utm_medium, utm_campaign, utm_content, gclid, fbclid, created_at
    FROM leads WHERE person_id = ?1 ORDER BY created_at`,
  try_ons: `SELECT stage, preset, hair_color, state, photo_consent_version, photo_consent_at, kept_at, upload_deleted_at,
      created_at
    FROM tryon_jobs WHERE person_id = ?1 ORDER BY created_at`,
  // What was sent and when, never its words.
  messages: `SELECT kind, state, created_at, sent_at, delivered_at, read_at FROM outbound_messages WHERE person_id = ?1
    ORDER BY created_at`,
  grievances:
    "SELECT text, state, response, resolved_at, created_at FROM grievances WHERE person_id = ?1 ORDER BY created_at",
  number_changes: `SELECT new_mobile_e164, replaced_mobile_e164, state, old_verified_at, new_verified_at, decided_at, reason,
      created_at
    FROM number_change_requests WHERE person_id = ?1 ORDER BY created_at`,
  deletion_requests: `SELECT state, decided_at, reason, created_at FROM deletion_requests WHERE person_id = ?1
    ORDER BY created_at`,
  sessions: `SELECT device_label, created_at, last_seen_at, expires_at, revoked_at FROM sessions
    WHERE subject_kind = 'client' AND subject_id = ?1 ORDER BY created_at`,
} as const;

type ExportQuery = keyof typeof EXPORT_QUERIES;

/** The parts that are one row, or nothing; every other query's part is a list. */
const ONE_ROW: readonly ExportQuery[] = ["person", "referral"];

export async function readPersonData(db: D1Database, personId: string): Promise<Record<string, unknown>> {
  const queries = Object.keys(EXPORT_QUERIES) as ExportQuery[];
  const answers = await db.batch(queries.map((query) => db.prepare(EXPORT_QUERIES[query]).bind(personId)));
  const parts: Record<string, unknown> = {};
  queries.forEach((query, index) => {
    const rows = answers[index]?.results ?? [];
    parts[query] = ONE_ROW.includes(query) ? (rows[0] ?? null) : rows;
  });
  return {
    ...parts,
    photo_views: await allViews(db, personId),
    hair_profile: await exportedProfiles(db, personId),
  };
}
