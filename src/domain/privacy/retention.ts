// What the retention periods let go of (src/policy/retention.ts), a few at a time, from the cron's hourly job:
// dormant people who never became clients, erased as any erasure is; check-in coordinates once no no-show charge can
// still be disputed; waitlist entries a year after their area launched; and the rows of the tables that only grew.

import {
  AUDIT_LOG_MONTHS,
  CHECKIN_COORDINATES_GRACE_DAYS,
  DORMANT_MONTHS,
  monthsBefore,
  PURGED_PER_RUN,
  RAZORPAY_EVENT_MONTHS,
  RESOLVED_ALERT_MONTHS,
  SENT_MESSAGE_MONTHS,
  STRANGER_CHAT_MONTHS,
  WAITLIST_AFTER_LAUNCH_MONTHS,
} from "../../policy/retention.ts";
import { DAY_MS } from "../../lib/durations.ts";

/**
 * People who never had a visit or a payment (`client_since`, which a visit's write stamps, and migration 0099's
 * triggers for a payment), are on no waitlist, and have done nothing with us since `DORMANT_MONTHS` ago: no booking
 * held, no form sent, no sign-in, no try-on. The oldest first.
 */
export async function dormantPeople(db: D1Database, now: Date, limit: number): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id FROM people p
       WHERE p.erased_at IS NULL AND p.client_since IS NULL AND p.created_at < ?1
         AND NOT EXISTS (SELECT 1 FROM waitlist_entries w WHERE w.person_id = p.id)
         AND NOT EXISTS (SELECT 1 FROM slot_holds h WHERE h.person_id = p.id AND h.created_at >= ?1)
         AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.person_id = p.id AND l.created_at >= ?1)
         AND NOT EXISTS (SELECT 1 FROM tryon_jobs t WHERE t.person_id = p.id AND t.created_at >= ?1)
         AND NOT EXISTS (
           SELECT 1 FROM sessions s WHERE s.subject_kind = 'client' AND s.subject_id = p.id AND s.last_seen_at >= ?1)
       ORDER BY p.created_at LIMIT ?2`,
    )
    .bind(monthsBefore(now, DORMANT_MONTHS), limit)
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

/**
 * Blanks the coordinates of check-ins no no-show charge can still be disputed over: older than the dispute window and
 * a week's grace, and not the evidence of a case still to rule on, ruled within that time, or disputed and open.
 * Returns how many.
 */
export async function blankOldCoordinates(db: D1Database, now: Date, disputeWindowDays: number): Promise<number> {
  const before = new Date(now.getTime() - (disputeWindowDays + CHECKIN_COORDINATES_GRACE_DAYS) * DAY_MS).toISOString();
  const result = await db
    .prepare(
      `UPDATE checkins SET lat = NULL, lng = NULL, accuracy_m = NULL
       WHERE lat IS NOT NULL AND created_at < ?1
         AND NOT EXISTS (
           SELECT 1 FROM no_show_cases n WHERE n.checkin_id = checkins.id
             AND (n.decision = 'undecided' OR n.decided_at >= ?1
                  OR EXISTS (SELECT 1 FROM no_show_disputes d WHERE d.case_id = n.id AND d.ruling IS NULL)))`,
    )
    .bind(before)
    .run();
  return result.meta.changes;
}

/** Deletes the waitlist entries of areas launched over a year ago. Returns how many. */
export async function dropLaunchedWaitlist(db: D1Database, now: Date): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM waitlist_entries WHERE pincode IN (
         SELECT pincode FROM serviceable_pincodes WHERE served = 1 AND launched_at IS NOT NULL AND launched_at < ?1)`,
    )
    .bind(monthsBefore(now, WAITLIST_AFTER_LAUNCH_MONTHS))
    .run();
  return result.meta.changes;
}

// The closed chats of numbers we never knew, nor any technician's, that no city matter names; ?1 the cut-off.
const STRANGER_CHATS = `SELECT c.id FROM conversations c INDEXED BY conversations_by_state
  WHERE c.state = 'closed' AND c.last_message_at < ?1 AND c.person_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM technicians t WHERE t.mobile_e164 = c.mobile_e164)
    AND NOT EXISTS (SELECT 1 FROM city_matters m WHERE m.conversation_id = c.id)
  ORDER BY c.last_message_at LIMIT ?2`;

/**
 * The rows of the tables that only grew, past their periods, a run's worth of each, the oldest first: resolved
 * alerts, Razorpay's event IDs, strangers' closed chats, messages sent that nothing holds as evidence, and the audit
 * log past its two years. How many went.
 */
export async function dropExpired(db: D1Database, now: Date): Promise<number> {
  const before = (months: number) => monthsBefore(now, months);
  const run = (sql: string, months: number) => db.prepare(sql).bind(before(months), PURGED_PER_RUN);
  const results = await db.batch([
    run(
      `DELETE FROM alerts WHERE id IN (
         SELECT id FROM alerts INDEXED BY alerts_resolved WHERE resolved_at < ?1 ORDER BY resolved_at LIMIT ?2)`,
      RESOLVED_ALERT_MONTHS,
    ),
    run(
      `DELETE FROM razorpay_events WHERE event_id IN (
         SELECT event_id FROM razorpay_events WHERE received_at < ?1 ORDER BY received_at LIMIT ?2)`,
      RAZORPAY_EVENT_MONTHS,
    ),
    run(`DELETE FROM chat_messages WHERE conversation_id IN (${STRANGER_CHATS})`, STRANGER_CHAT_MONTHS),
    run(`DELETE FROM conversations WHERE id IN (${STRANGER_CHATS})`, STRANGER_CHAT_MONTHS),
    run(
      `DELETE FROM outbound_messages WHERE id IN (
         SELECT m.id FROM outbound_messages m WHERE m.created_at < ?1
           AND NOT EXISTS (SELECT 1 FROM no_show_cases n WHERE n.message_id = m.id)
           AND NOT EXISTS (SELECT 1 FROM dispatch_moves d WHERE d.message_id = m.id)
         ORDER BY m.created_at LIMIT ?2)`,
      SENT_MESSAGE_MONTHS,
    ),
    run(
      `DELETE FROM audit_log WHERE id IN (SELECT id FROM audit_log WHERE at < ?1 ORDER BY at LIMIT ?2)`,
      AUDIT_LOG_MONTHS,
    ),
  ]);
  return results.reduce((sum, result) => sum + (result.meta.changes ?? 0), 0);
}
