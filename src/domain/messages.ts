// What outbound_messages may hold (migrations/0006_outbound_messages_v2.sql).
// The database leaves kind and subject_kind unchecked, so that a new kind needs
// no table rebuild; these lists are where they are checked instead.

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
  "reschedule_confirmation",
  "cancel_confirmation",
  "visit_moved", // ops moved the visit: the new window
  "arrival_notice", // the technician has arrived
  "friend_fitted", // to the referrer
  "launch_alert", // the person's pincode went live
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** Whether the person's latest word on this purpose is yes. Consents are append-only, so the latest one stands. */
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

/** What a message is about: the table its subject_id is in. */
export const MESSAGE_SUBJECTS = [
  "tryon_job",
  "appointment",
  "referral",
  "waitlist_entry",
  "payment",
  "pincode",
] as const;
export type MessageSubject = (typeof MESSAGE_SUBJECTS)[number];
