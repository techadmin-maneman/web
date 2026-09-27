// The waitlist by pincode, and what launching one does (Ops Console, C3; docs/decisions/0048-referrals.md).
// Launching marks the pincode served from a day, and tells those who asked to be told. The alerts are paced, so
// a launch does not send a hundred WhatsApps in a second and cost us the number.

import { PUBLIC_ORIGIN } from "../config/environments.ts";
import type { EnvironmentName } from "../config/environments.ts";
import { indiaInstant } from "../lib/india-time.ts";
import { auditStatement, type AuditEntry } from "./audit.ts";
import { consentGiven, latestConsentSql } from "./messages.ts";
import { firstNameOf } from "../lib/names.ts";

export interface WaitlistArea {
  readonly pincode: string;
  readonly area: string | null;
  readonly city: string | null;
  readonly served: boolean;
  readonly launchedAt: string | null;
  readonly waiting: number;
  readonly oldest: string | null;
  /** How many of them came through an invite. */
  readonly referred: number;
  /** How many asked to be told when we launch. */
  readonly alerts: number;
}

/** The pincodes with someone waiting, the longest wait first, `limit` of them at most. */
export async function waitlistByPincode(db: D1Database, limit: number): Promise<WaitlistArea[]> {
  const { results } = await db
    .prepare(
      `SELECT w.pincode, p.area, p.city, p.served, p.launched_at, COUNT(*) AS waiting, MIN(w.created_at) AS oldest,
         SUM(CASE WHEN w.referral_code IS NOT NULL THEN 1 ELSE 0 END) AS referred,
         SUM(w.launch_alert) AS alerts
       FROM waitlist_entries w LEFT JOIN serviceable_pincodes p ON p.pincode = w.pincode
       GROUP BY w.pincode ORDER BY oldest, w.pincode LIMIT ?1`,
    )
    .bind(limit)
    .all<{
      pincode: string;
      area: string | null;
      city: string | null;
      served: number | null;
      launched_at: string | null;
      waiting: number;
      oldest: string | null;
      referred: number;
      alerts: number;
    }>();
  return results.map((row) => ({
    pincode: row.pincode,
    area: row.area,
    city: row.city,
    served: row.served === 1,
    launchedAt: row.launched_at,
    waiting: row.waiting,
    oldest: row.oldest,
    referred: row.referred,
    alerts: row.alerts,
  }));
}

/**
 * Who a launch tells, as a condition on a waitlist entry `w` and its person
 * `p`: they asked to be told, have not been yet, are not erased, and still
 * consent to launch alerts. The one rule, for the count ops see before a launch
 * and for the launch itself.
 */
const TOLD_ON_LAUNCH = `w.launch_alert = 1 AND w.alerted_at IS NULL AND p.erased_at IS NULL
  AND ${latestConsentSql("w.person_id", "whatsapp_launches")} = 1`;

/** Those waiting for a pincode whom a launch would tell. */
async function toAlert(db: D1Database, pincode: string): Promise<{ id: string; person_id: string }[]> {
  const { results } = await db
    .prepare(
      `SELECT w.id, w.person_id FROM waitlist_entries w JOIN people p ON p.id = w.person_id
       WHERE w.pincode = ?1 AND ${TOLD_ON_LAUNCH}
       ORDER BY w.created_at`,
    )
    .bind(pincode)
    .all<{ id: string; person_id: string }>();
  return results;
}

/** What launching a pincode would do: how many hear about it. */
export async function launchPreview(db: D1Database, pincode: string): Promise<{ waiting: number; alerts: number }> {
  const waiting = await db
    .prepare("SELECT COUNT(*) AS waiting FROM waitlist_entries WHERE pincode = ?1")
    .bind(pincode)
    .first<{ waiting: number }>();
  return { waiting: waiting?.waiting ?? 0, alerts: (await toAlert(db, pincode)).length };
}

/** For every pincode anyone waits for: how many wait, and how many a launch would tell now. */
export async function waitingByPincode(
  db: D1Database,
): Promise<ReadonlyMap<string, { readonly waiting: number; readonly toAlert: number }>> {
  const { results } = await db
    .prepare(
      `SELECT w.pincode, COUNT(*) AS waiting, SUM(CASE WHEN ${TOLD_ON_LAUNCH} THEN 1 ELSE 0 END) AS to_alert
       FROM waitlist_entries w JOIN people p ON p.id = w.person_id
       GROUP BY w.pincode`,
    )
    .all<{ pincode: string; waiting: number; to_alert: number }>();
  return new Map(results.map((row) => [row.pincode, { waiting: row.waiting, toAlert: row.to_alert }]));
}

/** How many alerts go out a minute, so a launch does not flood the number. */
export const ALERTS_PER_MINUTE = 10;

/** A launch alert queued, with the seconds to hold it back so the alerts leave in a paced line. */
export interface LaunchAlert {
  readonly id: string;
  readonly delaySeconds: number;
}

/**
 * The launch alerts for one pincode's waitlist, and the statements that queue
 * them and mark each entry told, for the caller's batch. `pacedAfter` is how
 * many alerts that batch queues before these, so several pincodes launched
 * together still leave ALERTS_PER_MINUTE a minute.
 */
export async function launchAlerts(
  db: D1Database,
  input: { pincode: string; now: Date; pacedAfter: number },
): Promise<{ alerts: LaunchAlert[]; statements: D1PreparedStatement[] }> {
  const at = input.now.toISOString();
  const waiting = await toAlert(db, input.pincode);
  const alerts = waiting.map((entry, index) => ({
    id: crypto.randomUUID(),
    entryId: entry.id,
    personId: entry.person_id,
    delaySeconds: Math.floor((input.pacedAfter + index) / ALERTS_PER_MINUTE) * 60,
  }));
  const statements = alerts.flatMap((alert) => [
    db
      .prepare(
        `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at)
         VALUES (?1, ?2, ?3, 'launch_alert', 'pincode', ?4, 'queued', ?2)`,
      )
      .bind(alert.id, at, alert.personId, input.pincode),
    db.prepare("UPDATE waitlist_entries SET alerted_at = ?2 WHERE id = ?1").bind(alert.entryId, at),
  ]);
  return { alerts: alerts.map(({ id, delaySeconds }) => ({ id, delaySeconds })), statements };
}

/**
 * Marks the pincode served from the day given, and queues a launch alert for each person who asked for one,
 * in one batch with the launch's audit entry, which counts the alerts (src/domain/audit.ts). Returns the
 * messages, each with the seconds to hold it back, so they leave in a paced line.
 */
export async function launchPincode(
  db: D1Database,
  input: { pincode: string; launchOn: string; audit: AuditEntry; now: Date },
): Promise<{ alerts: LaunchAlert[] }> {
  const { alerts, statements } = await launchAlerts(db, { pincode: input.pincode, now: input.now, pacedAfter: 0 });
  await db.batch([
    db
      .prepare(`UPDATE serviceable_pincodes SET served = 1, launched_at = COALESCE(launched_at, ?2) WHERE pincode = ?1`)
      .bind(input.pincode, indiaInstant(input.launchOn, "00:00").toISOString()),
    ...statements,
    auditStatement(db, { ...input.audit, detail: { alerts: alerts.length } }, input.now),
  ]);
  return { alerts };
}

/** What a launch alert says: the area we now come to, and where to book. */
export async function composeLaunchAlert(
  db: D1Database,
  pincode: string,
  personId: string,
  environment: EnvironmentName,
): Promise<{ template: string; params: string[] } | { skip: string }> {
  const row = await db
    .prepare(
      `SELECT p.name, s.area, s.city, s.served FROM people p LEFT JOIN serviceable_pincodes s ON s.pincode = ?2
       WHERE p.id = ?1`,
    )
    .bind(personId, pincode)
    .first<{ name: string; area: string | null; city: string | null; served: number | null }>();
  if (row === null) return { skip: "no such person" };
  if (row.served !== 1) return { skip: "the pincode is not served after all" };
  return {
    template: "launch_alert_v1",
    params: [firstNameOf(row.name), row.area ?? row.city ?? pincode, `${PUBLIC_ORIGIN[environment]}/book`],
  };
}

/**
 * The confirmation of a place on a pincode's list (REQ-03; ADR 0041 lists it), about the person's entry there,
 * once: joining again writes nothing. For the same batch as the entry, which it reads its ID from; the message's
 * ID comes back from the batch, as `RETURNING id`.
 */
export function waitlistConfirmation(
  db: D1Database,
  input: { personId: string; pincode: string; now: Date },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at)
       SELECT ?1, ?2, ?3, 'waitlist_confirmation', 'waitlist_entry', w.id, 'queued', ?2
       FROM waitlist_entries w WHERE w.pincode = ?4 AND w.person_id = ?3
         AND NOT EXISTS (
           SELECT 1 FROM outbound_messages m WHERE m.subject_id = w.id AND m.kind = 'waitlist_confirmation')
       RETURNING id`,
    )
    .bind(crypto.randomUUID(), input.now.toISOString(), input.personId, input.pincode);
}

/**
 * What the confirmation says: the area they wait for, and that they will hear of its launch only if they asked
 * to and still consent to it. Sent only while they consent to being contacted about the request, which joining
 * the list asks for (the landing's notice `waitlist-v1`).
 */
export async function composeWaitlistConfirmation(
  db: D1Database,
  entryId: string,
  personId: string,
): Promise<{ template: string; params: string[] } | { skip: string }> {
  if (!(await consentGiven(db, personId, "contact"))) return { skip: "no consent to be contacted about the request" };
  const row = await db
    .prepare(
      `SELECT p.name, w.pincode, w.launch_alert, s.area FROM waitlist_entries w JOIN people p ON p.id = w.person_id
       LEFT JOIN serviceable_pincodes s ON s.pincode = w.pincode
       WHERE w.id = ?1 AND w.person_id = ?2`,
    )
    .bind(entryId, personId)
    .first<{ name: string; pincode: string; launch_alert: number; area: string | null }>();
  if (row === null) return { skip: "no longer on the waitlist" };
  const told = row.launch_alert === 1 && (await consentGiven(db, personId, "whatsapp_launches"));
  return {
    template: told ? "waitlist_listed_alert_v1" : "waitlist_listed_v1",
    params: [firstNameOf(row.name), row.area ?? row.pincode],
  };
}
