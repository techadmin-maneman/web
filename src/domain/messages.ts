// What outbound_messages may hold (migrations/0006_outbound_messages_v2.sql).
// The database leaves kind and subject_kind unchecked, so that a new one needs
// no table rebuild. The list below is every kind the code writes, and its type
// is the check; subject_kind names the table a message's subject_id is in.

import type { NoticePurpose } from "../config/notices.ts";

/** Each kind of WhatsApp message we send a person. */
export const MESSAGE_KINDS = [
  // Phase 1: the try-on result, with its image.
  "tryon_result",
  // Phase 2 (docs/prompts/phase2-backend.md, "Providers and integrations"):
  "consultation_confirmation",
  "visit_reminder", // the day before
  "waitlist_confirmation",
  "payment_receipt",
  "nothing_to_pay", // a one visit a discount code left nothing to pay for, once the client is fitted (ADR 0108)
  "link_paid", // the receipt for a one visit paid by its payment link, once the client is fitted
  "reschedule_confirmation",
  "cancel_confirmation",
  "visit_cancelled", // ops cancelled the visit from the console
  "visit_moved", // ops moved the visit: the new window
  "arrival_notice", // the technician has arrived
  "no_show_decided", // ops ruled on a visit the client was not home for
  "no_show_dispute_ruled", // ops refunded or upheld a no-show's charge the client disputed
  "booking_refunded", // a booking given back, by ops or by itself; its subject is the hold
  "next_service_reminder", // the next visit falls due soon, and nothing is booked (ADR 0086)
  "friend_fitted", // to the referrer
  "friend_credited", // to the friend: the invite's credits are theirs
  "referral_rejected", // to either side: ops refused a held grant
  "credits_expiring", // free service visits run out: a month before their last day, and a week before
  "launch_alert", // the person's pincode went live
  // The site's booking form, for a number we know (src/domain/site-notices.ts): what the page tells no one.
  "consultation_exists",
  "book_in_app",
  "address_on_account",
  "address_not_served",
  // Ops kept the account the client asked us to delete, with their reason (src/domain/deletion.ts).
  "deletion_rejected",
  "messages_stopped", // the answer to a STOP reply (src/domain/stop-messages.ts)
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/**
 * The person's latest word on a purpose as a subquery: 1, 0, or NULL where they never gave one. `personColumn`
 * names the person's ID in the query it sits in. Consents are append-only, so the latest one stands.
 */
export const latestConsentSql = (personColumn: string, purpose: NoticePurpose): string =>
  `(SELECT c.granted FROM consents c WHERE c.person_id = ${personColumn} AND c.purpose = '${purpose}'
    ORDER BY c.created_at DESC, c.rowid DESC LIMIT 1)`;

/** Whether the person's latest word on this purpose is yes. */
export async function consentGiven(db: D1Database, personId: string, purpose: NoticePurpose): Promise<boolean> {
  const latest = await db
    .prepare(
      `SELECT granted FROM consents WHERE person_id = ?1 AND purpose = ?2
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .bind(personId, purpose)
    .first<{ granted: number }>();
  return latest?.granted === 1;
}
