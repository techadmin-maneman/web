// A technician's week and home (docs/decisions/0210-booking-by-start-time.md): the hours of each day they work, which
// ops set in the console, and the place their day starts from, which the drive to their first visit is counted from.
// A technician with no week of their own works their city's hours every day.

import type { WorkingDay } from "../../policy/start-times.ts";
import { auditStatement, type AuditEntry } from "../platform/audit.ts";

/** Where a technician's day starts: the place ops chose, as Google names it, and its coordinate. */
export interface Home {
  readonly label: string;
  readonly lat: number;
  readonly lng: number;
}

/** Every technician's own week, the days they work in weekday order; one with none of their own is not in it. */
export async function weeksOf(db: D1Database): Promise<Map<string, WorkingDay[]>> {
  const { results } = await db
    .prepare("SELECT technician_id, weekday, starts, ends FROM technician_hours ORDER BY technician_id, weekday")
    .all<WorkingDay & { technician_id: string }>();
  const weeks = new Map<string, WorkingDay[]>();
  for (const { technician_id: id, weekday, starts, ends } of results) {
    weeks.set(id, [...(weeks.get(id) ?? []), { weekday, starts, ends }]);
  }
  return weeks;
}

/** Every technician's home, where ops have set one. */
export async function homesOf(db: D1Database): Promise<Map<string, Home>> {
  const { results } = await db
    .prepare(
      `SELECT id, home_label AS label, home_lat AS lat, home_lng AS lng FROM technicians
       WHERE home_lat IS NOT NULL AND home_lng IS NOT NULL AND home_label IS NOT NULL`,
    )
    .all<Home & { id: string }>();
  return new Map(results.map(({ id, label, lat, lng }) => [id, { label, lat, lng }]));
}

/**
 * Sets a technician's own week in one batch with its audit entry: each day they work, with its hours, in place of the
 * week before. An empty week returns them to their city's hours.
 */
export async function setWeek(
  db: D1Database,
  input: { technicianId: string; days: readonly WorkingDay[]; actor: string; audit: AuditEntry; now: Date },
): Promise<void> {
  const at = input.now.toISOString();
  await db.batch([
    db.prepare("DELETE FROM technician_hours WHERE technician_id = ?1").bind(input.technicianId),
    ...input.days.map((day) =>
      db
        .prepare(
          `INSERT INTO technician_hours (technician_id, weekday, starts, ends, set_by, set_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        )
        .bind(input.technicianId, day.weekday, day.starts, day.ends, input.actor, at),
    ),
    auditStatement(db, input.audit, input.now),
  ]);
}

/** Sets where a technician's day starts, in one batch with its audit entry. */
export async function setHome(
  db: D1Database,
  input: { technicianId: string; home: Home & { readonly placeId: string }; audit: AuditEntry; now: Date },
): Promise<void> {
  const { home } = input;
  await db.batch([
    db
      .prepare(
        `UPDATE technicians SET home_label = ?2, home_place_id = ?3, home_lat = ?4, home_lng = ?5, updated_at = ?6
         WHERE id = ?1`,
      )
      .bind(input.technicianId, home.label, home.placeId, home.lat, home.lng, input.now.toISOString()),
    auditStatement(db, input.audit, input.now),
  ]);
}
