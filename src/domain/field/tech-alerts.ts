// A technician's alerts (docs/decisions/0250-guides-and-alerts.md): the inbox, newest first over the last seven days,
// each with its job's kind and area, and the client's name and the way there only while the job is the technician's
// and unlocked; the alerts marked read; and the phone that takes the pushes (./alert-sends.ts sends them), which stops
// taking them once signed out or revoked. The kinds on are ./alert-settings.ts.

import { wayTo } from "@maneman/web-kit/address";
import type { VisitType } from "../../config/visit-types.ts";
import { DAY_MS } from "../../lib/durations.ts";
import { unlocked } from "../../policy/job-visibility.ts";
import { INBOX_DAYS, type AlertKind } from "../../policy/tech-alerts.ts";
import { addressOf, SELECT_JOB, sectorOf, type JobRow } from "./tech-jobs.ts";

/** The kinds that offer Navigate: those about a job still to drive to. */
const NAVIGABLE: readonly AlertKind[] = ["time_to_leave", "running_over", "job_moved"];

interface AlertRow {
  id: string;
  kind: AlertKind;
  appointment_id: string | null;
  date: string;
  starts_at: string | null;
  was_starts_at: string | null;
  leave_by: string | null;
  drive_minutes: number | null;
  finish_by: string | null;
  jobs: number | null;
  sent_at: string;
  read_at: string | null;
}

export interface TechAlert {
  readonly id: string;
  readonly kind: AlertKind;
  readonly read: boolean;
  readonly sent_at: string;
  readonly job_id: string | null;
  readonly date: string;
  readonly type: VisitType | null;
  readonly sector: string | null;
  /** The client's name while the job is the technician's and unlocked; null otherwise. */
  readonly client_name: string | null;
  readonly starts_at: string | null;
  readonly was_starts_at: string | null;
  readonly leave_by: string | null;
  readonly drive_minutes: number | null;
  readonly finish_by: string | null;
  readonly jobs: number | null;
  /** Navigate's map link while the job is the technician's and unlocked, for an alert about driving to it. */
  readonly navigate: string | null;
}

function alertOf(alert: AlertRow, row: JobRow | undefined, now: Date, unlockHour: number): TechAlert {
  const open = row !== undefined && unlocked(new Date(row.window_start), now, unlockHour);
  const address = open && NAVIGABLE.includes(alert.kind) ? addressOf(row) : null;
  return {
    id: alert.id,
    kind: alert.kind,
    read: alert.read_at !== null,
    sent_at: alert.sent_at,
    job_id: alert.appointment_id,
    date: alert.date,
    type: row?.type ?? null,
    sector: row === undefined ? null : sectorOf(row),
    client_name: open ? row.client_name : null,
    starts_at: alert.starts_at,
    was_starts_at: alert.was_starts_at,
    leave_by: alert.leave_by,
    drive_minutes: alert.drive_minutes,
    finish_by: alert.finish_by,
    jobs: alert.jobs,
    navigate: address === null ? null : wayTo(address),
  };
}

/** The technician's alerts of the last seven days, newest first; a job no longer theirs is read without its client. */
export async function inboxOf(
  db: D1Database,
  technicianId: string,
  { now, unlockHour }: { readonly now: Date; readonly unlockHour: number },
): Promise<TechAlert[]> {
  const since = new Date(now.getTime() - INBOX_DAYS * DAY_MS).toISOString();
  const [alerts, jobs] = await Promise.all([
    db
      .prepare(
        `SELECT id, kind, appointment_id, date, starts_at, was_starts_at, leave_by, drive_minutes, finish_by, jobs,
                sent_at, read_at
           FROM tech_alerts WHERE technician_id = ?1 AND sent_at >= ?2
          ORDER BY sent_at DESC, rowid DESC`,
      )
      .bind(technicianId, since)
      .all<AlertRow>(),
    // The jobs list's own read, which holds only the technician's jobs.
    db
      .prepare(
        `${SELECT_JOB} AND a.id IN (SELECT appointment_id FROM tech_alerts WHERE technician_id = ?1 AND sent_at >= ?2)`,
      )
      .bind(technicianId, since)
      .all<JobRow>(),
  ]);
  const byId = new Map(jobs.results.map((row) => [row.id, row]));
  return alerts.results.map((alert) => alertOf(alert, byId.get(alert.appointment_id ?? ""), now, unlockHour));
}

/** Every alert the technician has, read: the inbox was opened. */
export async function markAlertsRead(db: D1Database, technicianId: string, now: Date): Promise<void> {
  await db
    .prepare("UPDATE tech_alerts SET read_at = ?2 WHERE technician_id = ?1 AND read_at IS NULL")
    .bind(technicianId, now.toISOString())
    .run();
}

/**
 * The phone's push subscription, one a phone. A browser keeps one subscription whoever signs in on it, so the address
 * moves to the phone row of whoever signed in last.
 */
export async function subscribeForPushes(
  db: D1Database,
  { deviceRowId, endpoint, now }: { readonly deviceRowId: string; readonly endpoint: string; readonly now: Date },
): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?2 AND device_id <> ?1").bind(deviceRowId, endpoint),
    db
      .prepare(
        `INSERT INTO push_subscriptions (device_id, endpoint, subscribed_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (device_id) DO UPDATE SET endpoint = excluded.endpoint, subscribed_at = excluded.subscribed_at`,
      )
      .bind(deviceRowId, endpoint, now.toISOString()),
  ]);
}
