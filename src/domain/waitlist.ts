// The waitlist by pincode, and what launching one does (Ops Console, C3; docs/decisions/0048-referrals.md).
// Launching marks the pincode served from a day, and tells those who asked to be told. The alerts are paced, so
// a launch does not send a hundred WhatsApps in a second and cost us the number.

import { PUBLIC_ORIGIN } from "../config/environments.ts";
import type { EnvironmentName } from "../config/environments.ts";
import { indiaInstant } from "../lib/india-time.ts";
import { auditStatement, type AuditEntry } from "./audit.ts";

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

/** Every pincode with someone waiting, the longest wait first. */
export async function waitlistByPincode(db: D1Database): Promise<WaitlistArea[]> {
  const { results } = await db
    .prepare(
      `SELECT w.pincode, p.area, p.city, p.served, p.launched_at, COUNT(*) AS waiting, MIN(w.created_at) AS oldest,
         SUM(CASE WHEN w.referral_code IS NOT NULL THEN 1 ELSE 0 END) AS referred,
         SUM(w.launch_alert) AS alerts
       FROM waitlist_entries w LEFT JOIN serviceable_pincodes p ON p.pincode = w.pincode
       GROUP BY w.pincode ORDER BY oldest`,
    )
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

/** Those waiting for a pincode who asked to be told, and still consent to launch alerts. */
async function toAlert(db: D1Database, pincode: string): Promise<{ id: string; person_id: string }[]> {
  const { results } = await db
    .prepare(
      `SELECT w.id, w.person_id FROM waitlist_entries w JOIN people p ON p.id = w.person_id
       WHERE w.pincode = ?1 AND w.launch_alert = 1 AND w.alerted_at IS NULL AND p.erased_at IS NULL
         AND (SELECT c.granted FROM consents c WHERE c.person_id = w.person_id AND c.purpose = 'whatsapp_launches'
              ORDER BY c.created_at DESC, c.rowid DESC LIMIT 1) = 1
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

/** How many alerts go out a minute, so a launch does not flood the number. */
export const ALERTS_PER_MINUTE = 10;

/**
 * Marks the pincode served from the day given, and queues a launch alert for each person who asked for one,
 * in one batch with the launch's audit entry, which counts the alerts (src/domain/audit.ts). Returns the
 * messages, each with the seconds to hold it back, so they leave in a paced line.
 */
export async function launchPincode(
  db: D1Database,
  input: { pincode: string; launchOn: string; audit: AuditEntry; now: Date },
): Promise<{ alerts: { id: string; delaySeconds: number }[] }> {
  const at = input.now.toISOString();
  const waiting = await toAlert(db, input.pincode);
  const alerts = waiting.map((entry, index) => ({
    id: crypto.randomUUID(),
    entryId: entry.id,
    personId: entry.person_id,
    delaySeconds: Math.floor(index / ALERTS_PER_MINUTE) * 60,
  }));
  await db.batch([
    db
      .prepare(`UPDATE serviceable_pincodes SET served = 1, launched_at = COALESCE(launched_at, ?2) WHERE pincode = ?1`)
      .bind(input.pincode, indiaInstant(input.launchOn, "00:00").toISOString()),
    ...alerts.flatMap((alert) => [
      db
        .prepare(
          `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at)
           VALUES (?1, ?2, ?3, 'launch_alert', 'pincode', ?4, 'queued', ?2)`,
        )
        .bind(alert.id, at, alert.personId, input.pincode),
      db.prepare("UPDATE waitlist_entries SET alerted_at = ?2 WHERE id = ?1").bind(alert.entryId, at),
    ]),
    auditStatement(db, { ...input.audit, detail: { alerts: alerts.length } }, input.now),
  ]);
  return { alerts: alerts.map(({ id, delaySeconds }) => ({ id, delaySeconds })) };
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
    params: [row.name.split(" ")[0] ?? row.name, row.area ?? row.city ?? pincode, `${PUBLIC_ORIGIN[environment]}/book`],
  };
}
