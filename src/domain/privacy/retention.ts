// What the retention periods let go of (src/policy/retention.ts), a few at a time, from the cron's hourly job:
// dormant people who never became clients, erased as any erasure is; check-in coordinates once no no-show charge can
// still be disputed; and waitlist entries a year after their area launched.

import {
  CHECKIN_COORDINATES_GRACE_DAYS,
  DORMANT_MONTHS,
  monthsBefore,
  WAITLIST_AFTER_LAUNCH_MONTHS,
} from "../../policy/retention.ts";
import { DAY_MS } from "../../lib/durations.ts";

/**
 * People who never had a visit or a payment (`client_since`, which migration 0099's triggers keep), are on no waitlist, and have done nothing with us since `DORMANT_MONTHS`
 * ago: no booking held, no form sent, no sign-in, no try-on. The oldest first.
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
