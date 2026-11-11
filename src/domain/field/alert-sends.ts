// The alerts the cron writes and sends (docs/decisions/0250-guides-and-alerts.md). Every five minutes: time to leave
// and running over, read from each working technician's day as their phone reads it (./tech-jobs.ts); then a push for
// each alert not yet pushed, to each phone signed in as its technician. At 8 pm, the next day's jobs. A job's changes
// are written by triggers (migrations/0209_tech_alerts.sql), so whatever changed it, the next run pushes them.

import { statusIn, VISIT_LIVE, VISIT_NOT_BEGUN } from "../../config/statuses.ts";
import type { CallBudget } from "../../lib/call-budget.ts";
import { DAY_MS } from "../../lib/durations.ts";
import { addDays, indiaDate, indiaInstant } from "../../lib/india-time.ts";
import type { DriveEstimate } from "../../policy/drive-estimate.ts";
import type { BookingRules } from "../../policy/start-times.ts";
import { INBOX_DAYS, leaveDue, PUSH_TTL_SECONDS, runsOver, type AlertKind } from "../../policy/tech-alerts.ts";
import type { Push } from "../../providers/web-push.ts";
import { alertSettingsOf } from "./alert-settings.ts";
import { jobsOn, type DayJob } from "./tech-jobs.ts";

/** A job still to do, as a query asks. */
const toDo = (column: string): string => statusIn(column, VISIT_LIVE);

interface Written {
  readonly kind: AlertKind;
  readonly appointmentId: string;
  readonly date: string;
  readonly startsAt: string;
  readonly onceKey: string;
  readonly leaveBy?: string | null;
  readonly driveMinutes?: number | null;
  readonly finishBy?: string | null;
  readonly jobs?: number;
}

function insertOf(db: D1Database, technicianId: string, alert: Written, now: Date): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO tech_alerts (id, technician_id, kind, appointment_id, date, starts_at, leave_by,
         drive_minutes, finish_by, jobs, once_key, sent_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    )
    .bind(
      crypto.randomUUID(),
      technicianId,
      alert.kind,
      alert.appointmentId,
      alert.date,
      alert.startsAt,
      alert.leaveBy ?? null,
      alert.driveMinutes ?? null,
      alert.finishBy ?? null,
      alert.jobs ?? null,
      alert.onceKey,
      now.toISOString(),
    );
}

/** The day's alerts due now: leave for a job not begun, and a job under way that will make the next one late. */
export function timedAlertsOf(
  jobs: readonly DayJob[],
  now: Date,
  on: { readonly time_to_leave: boolean; readonly running_over: boolean },
): Written[] {
  const due: Written[] = [];
  jobs.forEach((job, index) => {
    const started = job.progress.started_at !== null || job.status === "in_progress";
    if (on.time_to_leave && STILL_TO_COME.has(job.status) && leaveDue({ leave_by: job.leave_by, started }, now)) {
      due.push({
        kind: "time_to_leave",
        appointmentId: job.id,
        date: job.date,
        startsAt: job.starts_at,
        leaveBy: job.leave_by,
        driveMinutes: job.drive_minutes,
        onceKey: `time_to_leave:${job.id}`,
      });
    }
    const next = jobs.slice(index + 1).find((later) => STILL_TO_COME.has(later.status));
    const underWay = job.status === "in_progress" && job.progress.outcome === null;
    const timing = { starts_at: job.starts_at, started_at: job.progress.started_at, minutes: job.minutes };
    if (
      on.running_over &&
      underWay &&
      next !== undefined &&
      runsOver({ ...timing, finish_by: job.next?.finish_by ?? null }, now)
    ) {
      due.push({
        kind: "running_over",
        appointmentId: next.id,
        date: next.date,
        startsAt: next.starts_at,
        finishBy: job.next?.finish_by ?? null,
        onceKey: `running_over:${job.id}`,
      });
    }
  });
  return due;
}

const STILL_TO_COME: ReadonlySet<string> = new Set(VISIT_NOT_BEGUN);

/** The technicians with a job still to do on the day. */
async function workingOn(db: D1Database, date: string): Promise<string[]> {
  const from = indiaInstant(date, "00:00").toISOString();
  const to = indiaInstant(addDays(date, 1), "00:00").toISOString();
  const { results } = await db
    .prepare(
      `SELECT DISTINCT technician_id FROM appointments
        WHERE technician_id IS NOT NULL AND deleted_at IS NULL AND ${toDo("status")}
          AND window_start >= ?1 AND window_start < ?2`,
    )
    .bind(from, to)
    .all<{ technician_id: string }>();
  return results.map((row) => row.technician_id);
}

/** What the day's list is read with: the hour a job unlocks, and the booking and drive rules. */
export interface DayRules {
  readonly unlockHour: number;
  readonly rules: { readonly booking: BookingRules; readonly drive: DriveEstimate };
}

/** Today's time to leave and running over, for every technician with a job still to do; the rules read only then. */
export async function writeTimedAlerts(
  db: D1Database,
  { now, rules }: { readonly now: Date; readonly rules: () => Promise<DayRules> },
): Promise<number> {
  const date = indiaDate(now);
  const working = await workingOn(db, date);
  if (working.length === 0) return 0;
  const given = await rules();
  let written = 0;
  for (const technicianId of working) {
    const [jobs, on] = await Promise.all([
      jobsOn({ db, technicianId, date, now, unlockHour: given.unlockHour, rules: given.rules }),
      alertSettingsOf(db, technicianId),
    ]);
    const due = timedAlertsOf(jobs, now, on);
    if (due.length > 0) await db.batch(due.map((alert) => insertOf(db, technicianId, alert, now)));
    written += due.length;
  }
  return written;
}

/** The next day's jobs, for each technician with any who has the day ahead on: how many, from when, and the first. */
export async function writeDayAhead(db: D1Database, { now, date }: { readonly now: Date; readonly date: string }) {
  const from = indiaInstant(date, "00:00").toISOString();
  const to = indiaInstant(addDays(date, 1), "00:00").toISOString();
  const [days, off] = await Promise.all([
    // The first job is the least of each start with its ID beside it: one pass over the day.
    db
      .prepare(
        `SELECT technician_id, COUNT(*) AS jobs, MIN(window_start || ' ' || id) AS first
           FROM appointments
          WHERE technician_id IS NOT NULL AND deleted_at IS NULL AND ${toDo("status")}
            AND window_start >= ?1 AND window_start < ?2
          GROUP BY technician_id`,
      )
      .bind(from, to)
      .all<{ technician_id: string; jobs: number; first: string }>(),
    db
      .prepare("SELECT technician_id FROM tech_alert_kinds_off WHERE kind = 'day_ahead'")
      .all<{ technician_id: string }>(),
  ]);
  const turnedOff = new Set(off.results.map((row) => row.technician_id));
  const due = days.results.filter((row) => !turnedOff.has(row.technician_id));
  if (due.length === 0) return 0;
  await db.batch(
    due.map((row) => {
      const [startsAt = "", firstId = ""] = row.first.split(" ");
      const alert = { kind: "day_ahead" as const, appointmentId: firstId, date, startsAt, jobs: row.jobs };
      return insertOf(db, row.technician_id, { ...alert, onceKey: `day_ahead:${date}` }, now);
    }),
  );
  return due.length;
}

interface ToPush {
  alert_id: string;
  device_id: string;
  endpoint: string;
}

/**
 * A push for each alert not yet pushed, to each phone signed in as its technician, as the run's calls allow; an alert
 * left by a run cut short is pushed by the next, unless it is older than a push service would keep it. An alert with
 * no phone to push to is never pushed, and waits in the inbox. A subscription the push service no longer has is
 * deleted.
 */
export async function pushNewAlerts(
  db: D1Database,
  { push, budget, now }: { readonly push: Push; readonly budget: CallBudget; readonly now: Date },
): Promise<number> {
  const at = now.toISOString();
  const fresh = new Date(now.getTime() - PUSH_TTL_SECONDS * 1000).toISOString();
  const { results } = await db
    .prepare(
      `SELECT al.id AS alert_id, s.device_id, s.endpoint
         FROM tech_alerts al
        -- From the few alerts not yet pushed outward, never from every phone there has been.
        CROSS JOIN technician_devices d ON d.technician_id = al.technician_id AND d.revoked_at IS NULL
        CROSS JOIN sessions se ON se.id = d.session_id AND se.revoked_at IS NULL AND se.expires_at > ?1
        CROSS JOIN push_subscriptions s ON s.device_id = d.id
        WHERE al.pushed_at IS NULL AND al.sent_at >= ?2
        ORDER BY al.sent_at`,
    )
    .bind(at, fresh)
    .all<ToPush>();
  const done = new Set<string>();
  const left = new Set<string>();
  const gone: string[] = [];
  for (const each of results) {
    if (left.has(each.alert_id) || !budget.spend(1)) {
      left.add(each.alert_id);
      continue;
    }
    if ((await push(each.endpoint, PUSH_TTL_SECONDS)) === "gone") gone.push(each.device_id);
    done.add(each.alert_id);
  }
  // An alert pushed to some of its phones before the calls ran out is pushed to the rest by the next run.
  const pushed = [...done].filter((id) => !left.has(id));
  if (pushed.length === 0 && gone.length === 0) return 0;
  await db.batch([
    ...gone.map((device) => db.prepare("DELETE FROM push_subscriptions WHERE device_id = ?1").bind(device)),
    db
      .prepare("UPDATE tech_alerts SET pushed_at = ?1 WHERE id IN (SELECT value FROM json_each(?2))")
      .bind(at, JSON.stringify(pushed)),
  ]);
  return pushed.length;
}

/** Alerts older than the inbox shows. */
export async function dropOldAlerts(db: D1Database, now: Date): Promise<void> {
  const before = new Date(now.getTime() - (INBOX_DAYS + 1) * DAY_MS).toISOString();
  await db.prepare("DELETE FROM tech_alerts WHERE sent_at < ?1").bind(before).run();
}
