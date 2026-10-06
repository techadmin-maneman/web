// The statements an erasure's one batch runs (./erasure.ts): the person blanked, and what they left in every table
// that holds rows about them, ops' own words about them among it.

import type { NoticePurpose } from "../../config/notices.ts";
import { blankProfiles } from "../clients/hair-profiles.ts";
import { recordConsent } from "./consents.ts";

/** Of the person's addresses, one a technician's check-in was measured against. */
const MEASURED_AGAINST = "EXISTS (SELECT 1 FROM checkins c WHERE c.address_id = addresses.id)";
/**
 * Everything else the batch changes, in an order the foreign keys allow: what
 * points at a row is dealt with before the row is deleted.
 */
export async function personalDataStatements(
  db: D1Database,
  personId: string,
  at: string,
): Promise<D1PreparedStatement[]> {
  // One withdrawal row for each purpose the person had agreed to, recorded as the erasure's. Consents are append-only.
  const { results: granted } = await db
    .prepare("SELECT DISTINCT purpose FROM consents WHERE person_id = ?1 AND granted = 1")
    .bind(personId)
    .all<{ purpose: NoticePurpose }>();
  const withdrawals = granted.map(
    ({ purpose }) =>
      recordConsent(db, {
        person: { id: personId },
        purpose,
        granted: false,
        notice: "withdrawal",
        source: "erasure",
        rule: "always",
        ipHash: null,
        givenAt: at,
      }).statement,
  );

  return [
    // Expired jobs stop any render storing its result; the files go after the batch.
    db
      .prepare(
        "UPDATE tryon_jobs SET state = CASE WHEN state = 'failed' THEN state ELSE 'expired' END WHERE person_id = ?1",
      )
      .bind(personId),
    db.prepare("DELETE FROM tryon_sessions WHERE person_id = ?1").bind(personId),
    // The client app: every session ends, and every open login code stops working (docs/decisions/0029, 0030).
    db
      .prepare(
        "UPDATE sessions SET revoked_at = ?2 WHERE subject_kind = 'client' AND subject_id = ?1 AND revoked_at IS NULL",
      )
      .bind(personId, at),
    db
      .prepare("UPDATE otp_challenges SET voided_at = ?2, code_hash = NULL WHERE person_id = ?1 AND voided_at IS NULL")
      .bind(personId, at),
    // Waiting for a pincode needs the person's number; an invite they sent stays, with the house card
    // (docs/decisions/0048-referrals.md). The card's file is deleted after the batch.
    db.prepare("DELETE FROM waitlist_entries WHERE person_id = ?1").bind(personId),
    db
      .prepare(
        `UPDATE referral_codes SET card_state = 'house', card_version = card_version + 1, updated_at = ?2
         WHERE person_id = ?1 AND card_state = 'personal'`,
      )
      .bind(personId, at),
    ...appPersonalData(db, personId),
    ...opsWordsAbout(db, personId),
    // Their first name on a referral, which the referrer's tracker shows until now; blank, it reads "A friend",
    // which says nothing of the erasure. Counsel may rule it can stay (docs/open-points.md, item 63).
    db
      .prepare("UPDATE referral_attributions SET friend_first_name = NULL WHERE referred_person_id = ?1")
      .bind(personId),
    // And the client's own words to the technician on a visit (src/domain/clients/client-notes.ts), and why they disputed a
    // no-show's charge (src/domain/no-shows/no-show-disputes.ts).
    db.prepare("UPDATE appointments SET client_note = NULL, client_note_at = NULL WHERE person_id = ?1").bind(personId),
    db.prepare("UPDATE no_show_disputes SET reason = NULL WHERE person_id = ?1").bind(personId),
    // What a pay step showed them, kept on the hold until the booking is confirmed, and their hashed address.
    db
      .prepare("UPDATE slot_holds SET consents_shown = NULL, consents_ip_hash = NULL WHERE person_id = ?1")
      .bind(personId),
    // Their hair profile, its fit spec and their health history, in every version; who took each, and when, stay
    // (docs/decisions/0106-a-clients-hair-profile.md).
    blankProfiles(db, personId),
    // Where the technician's phone was at their door (ADR 0025, ruling 34). The check-in's time, the distance
    // measured, the radius and whether it passed stay: they place nobody, and a no-show is ruled on them
    // (docs/decisions/0094-where-a-consent-was-given.md).
    db
      .prepare(
        `UPDATE checkins SET lat = NULL, lng = NULL, accuracy_m = NULL
         WHERE appointment_id IN (SELECT id FROM appointments WHERE person_id = ?1)`,
      )
      .bind(personId),
    // The number is replaced, not kept: a later booking from it starts afresh, with a new consent.
    db
      .prepare(
        `UPDATE people SET erased_at = ?2, name = 'Erased', email = NULL, mobile_e164 = 'erased:' || id,
           contactable = 0
         WHERE id = ?1`,
      )
      .bind(personId, at),
    ...withdrawals,
  ];
}

/**
 * The app's own personal data (docs/decisions/0049-dpdp.md): where they live, the numbers they changed
 * between, and the words of any grievance. Visits, payments and credits stay, as records. An address a
 * technician's check-in was measured against is blanked to its city and pincode rather than deleted: the
 * check-in points at it, and stays as the evidence ops rule a no-show on.
 */
function appPersonalData(db: D1Database, personId: string): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `UPDATE addresses SET line1 = 'Erased', line2 = NULL, locality = 'Erased', access_notes = NULL, lat = NULL,
         lng = NULL, geocoded_at = NULL, building = NULL, flat = NULL, floor = NULL, tower = NULL, landmark = NULL,
         place_id = NULL, geocode_source = NULL, given_to_staff = NULL
       WHERE person_id = ?1 AND ${MEASURED_AGAINST}`,
      )
      .bind(personId),
    db.prepare(`DELETE FROM addresses WHERE person_id = ?1 AND NOT ${MEASURED_AGAINST}`).bind(personId),
    db
      .prepare(
        "DELETE FROM otp_challenges WHERE number_change_id IN (SELECT id FROM number_change_requests WHERE person_id = ?1)",
      )
      .bind(personId),
    db.prepare("DELETE FROM number_change_requests WHERE person_id = ?1").bind(personId),
    db.prepare("UPDATE grievances SET text = 'Erased', response = NULL WHERE person_id = ?1").bind(personId),
    // How they reached us, and how much hair they had lost; the lead stays, as the record of a booking.
    db
      .prepare(
        `UPDATE leads SET loss_extent = NULL, utm_source = NULL, utm_medium = NULL, utm_campaign = NULL,
         utm_content = NULL, gclid = NULL, fbclid = NULL, referrer = NULL, landing_path = NULL
       WHERE person_id = ?1`,
      )
      .bind(personId),
  ];
}

/**
 * Ops' own words about the person, kept with a decision (docs/decisions/0072-ops-clients-and-queues.md): the review
 * of a grant they were either side of, why ops attached an invite they were either side of (ADR 0089), the ruling on
 * a visit of theirs they were not home for and on their dispute of its charge (ADR 0096), why ops closed a visit
 * of theirs left partly done without a follow-up (ADR 0092), why ops cancelled a visit of theirs or closed one by
 * hand, and why ops moved one onto a blacked-out day. The decisions themselves stay, as records.
 */
function opsWordsAbout(db: D1Database, personId: string): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `UPDATE referral_attributions SET review_reason = NULL, attach_reason = NULL
         WHERE referred_person_id = ?1 OR code IN (SELECT code FROM referral_codes WHERE person_id = ?1)`,
      )
      .bind(personId),
    // Found through the check-in, which each case is keyed on, so the lookup is indexed.
    db
      .prepare(
        `UPDATE no_show_cases SET decision_reason = NULL
         WHERE checkin_id IN (
           SELECT c.id FROM checkins c JOIN appointments a ON a.id = c.appointment_id WHERE a.person_id = ?1)`,
      )
      .bind(personId),
    db.prepare("UPDATE no_show_disputes SET ruling_reason = NULL WHERE person_id = ?1").bind(personId),
    // Found through the visit, which each is keyed on, so the lookups are indexed.
    db
      .prepare(
        `UPDATE visit_changes SET cancel_reason = NULL
         WHERE appointment_id IN (SELECT id FROM appointments WHERE person_id = ?1)`,
      )
      .bind(personId),
    db
      .prepare(
        `UPDATE visits SET close_reason = NULL
         WHERE appointment_id IN (SELECT id FROM appointments WHERE person_id = ?1)`,
      )
      .bind(personId),
    db
      .prepare(
        `UPDATE task_closures SET reason = NULL
         WHERE task_group = 'partial_visit' AND subject_id IN (SELECT id FROM appointments WHERE person_id = ?1)`,
      )
      .bind(personId),
    db
      .prepare(
        `UPDATE dispatch_moves SET blackout_reason = NULL
         WHERE appointment_id IN (SELECT id FROM appointments WHERE person_id = ?1)`,
      )
      .bind(personId),
  ];
}
