// Everything held about a client, for their data export: the right of access
// (docs/decisions/0049-dpdp.md). The route audits the export before this reads
// anything, so an export the log could not record is never given.
//
// Since 27 September 2026 it carries who in ops opened the client's
// photographs, and when, as the owner ruled (docs/open-points.md, item 68),
// and what they asked for on the site's form while no visit was booked: a
// consultation's day and window, and a first fit (ADR 0086). And each no-show
// charge they disputed, in their words, and how ops ruled (ADR 0096). And each
// discount code entered on a booking of theirs (ADR 0108).

import { allViews } from "./photo-views.ts";

/** Each no-show charge the client disputed, in their words, and how ops ruled; never ops' reason. */
const DISPUTES = `SELECT n.appointment_id, d.reason, d.created_at, d.ruling, d.ruled_at FROM no_show_disputes d
  JOIN no_show_cases n ON n.id = d.case_id WHERE d.person_id = ?1 ORDER BY d.created_at`;

/**
 * Each discount code entered on a booking of theirs, what it took off and who entered it (ADR 0108); never which
 * member of staff.
 */
const DISCOUNT_CODES = `SELECT c.code, u.amount_off, u.given_by, u.created_at, u.removed_at FROM discount_code_uses u
  JOIN discount_codes c ON c.id = u.code_id WHERE u.person_id = ?1 ORDER BY u.created_at`;

export async function everythingHeldAbout(db: D1Database, personId: string): Promise<Record<string, unknown>> {
  const all = (sql: string) =>
    db
      .prepare(sql)
      .bind(personId)
      .all()
      .then((rows) => rows.results);
  const [
    person,
    addresses,
    consents,
    visits,
    payments,
    refunds,
    credits,
    referral,
    messages,
    grievances,
    tryOns,
    consultationRequests,
    firstFitRequests,
    disputes,
    discountCodes,
  ] = await Promise.all([
    db
      .prepare("SELECT name, mobile_e164 AS mobile, email, created_at FROM people WHERE id = ?1")
      .bind(personId)
      .first(),
    all(
      `SELECT line1, line2, locality, city, pincode, access_notes, created_at, replaced_at FROM addresses
         WHERE person_id = ?1 ORDER BY created_at`,
    ),
    all(
      `SELECT purpose, granted, notice_version, source, created_at FROM consents WHERE person_id = ?1
         ORDER BY created_at, rowid`,
    ),
    all(
      `SELECT a.type, a.window_start, a.status, t.name AS technician FROM appointments a
         LEFT JOIN technicians t ON t.id = a.technician_id
         WHERE a.person_id = ?1 AND a.deleted_at IS NULL ORDER BY a.window_start`,
    ),
    all(
      `SELECT created_at, amount, method, reference, status, refunded_amount FROM payments WHERE person_id = ?1
         ORDER BY created_at`,
    ),
    all(
      `SELECT r.created_at, r.amount, r.status FROM refunds r JOIN payments p ON p.id = r.payment_id
         WHERE p.person_id = ?1 ORDER BY r.created_at`,
    ),
    all("SELECT kind, visits, expires_at, created_at FROM credit_ledger WHERE person_id = ?1 ORDER BY created_at"),
    db.prepare("SELECT code, card_state FROM referral_codes WHERE person_id = ?1").bind(personId).first(),
    all("SELECT kind, state, created_at FROM outbound_messages WHERE person_id = ?1 ORDER BY created_at"),
    all("SELECT text, state, response, created_at FROM grievances WHERE person_id = ?1 ORDER BY created_at"),
    all("SELECT state, created_at FROM tryon_jobs WHERE person_id = ?1 ORDER BY created_at"),
    all(
      `SELECT pincode, requested_date, requested_window, created_at FROM consultation_requests
         WHERE person_id = ?1 ORDER BY created_at`,
    ),
    all("SELECT preferred_window, created_at FROM first_fit_requests WHERE person_id = ?1"),
    all(DISPUTES),
    all(DISCOUNT_CODES),
  ]);
  return {
    person,
    addresses,
    consents,
    visits,
    payments,
    refunds,
    credits,
    referral,
    messages,
    grievances,
    try_ons: tryOns,
    consultation_requests: consultationRequests,
    first_fit_requests: firstFitRequests,
    no_show_disputes: disputes,
    discount_codes: discountCodes,
    photo_views: await allViews(db, personId),
  };
}
