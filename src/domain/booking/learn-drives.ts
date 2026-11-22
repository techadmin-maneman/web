// The night's learning of drive times (docs/decisions/0294-learned-drive-times.md): every technician's drives of the
// weeks ops set, each from one job's close to their check-in at the next that day, against what the estimate gives for
// the drive between the two clients' pins, as booking plans it; each city's slots learned afresh from them
// (src/policy/learned-drives.ts), and the ones before them replaced.

import { statusIn, VISIT_ON_THE_BOARD } from "../../config/statuses.ts";
import type { Pin } from "../../lib/geo.ts";
import { addDays, indiaDate, indiaInstant } from "../../lib/india-time.ts";
import { minuteOf } from "../../policy/day-plan.ts";
import type { DriveEstimate } from "../../policy/drive-estimate.ts";
import { drivesOf, learn, type Away, type DoneJob } from "../../policy/learned-drives.ts";
import type { BookingRules } from "../../policy/start-times.ts";
import { PIN, VISIT_PLACE } from "./day-plans.ts";

interface JobRow {
  readonly technician_id: string;
  readonly city: string;
  readonly window_start: string;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly arrived: string | null;
  readonly closed: string | null;
}

interface LeaveRow {
  readonly technician_id: string;
  readonly from_date: string;
  readonly to_date: string;
  readonly from_time: string | null;
  readonly to_time: string | null;
}

const pinOf = (row: JobRow): Pin | null =>
  row.lat === null || row.lng === null ? null : { lat: row.lat, lng: row.lng };

/** Each day of a period of leave inside the weeks learned from, all of it away where it names no times. */
function awayOf(rows: readonly LeaveRow[], from: string, to: string): Away[] {
  return rows.flatMap((row) => {
    const days: Away[] = [];
    const whole = row.from_time === null || row.to_time === null;
    for (
      let date = row.from_date > from ? row.from_date : from;
      date <= row.to_date && date < to;
      date = addDays(date, 1)
    ) {
      days.push({
        technicianId: row.technician_id,
        date,
        from: whole ? 0 : minuteOf(row.from_time),
        to: whole ? 24 * 60 : minuteOf(row.to_time),
      });
    }
    return days;
  });
}

/** Learns each city's drive times from the weeks before today, and keeps them; how many cities and drives. */
export async function learnDrives(
  db: D1Database,
  given: {
    readonly now: Date;
    readonly weeks: number;
    readonly estimate: DriveEstimate;
    readonly booking: BookingRules;
  },
): Promise<{ cities: number; drives: number }> {
  const to = indiaDate(given.now);
  const from = addDays(to, -7 * given.weeks);
  const [jobs, leave] = await db.batch([
    // A job is where its client is as booking plans it; the first check-in that passed is its arrival, and its last
    // outcome standing its close.
    db
      .prepare(
        `SELECT a.technician_id, t.city, a.window_start, ${PIN},
           (SELECT MIN(c.at) FROM checkins c
             WHERE c.appointment_id = a.id AND c.technician_id = a.technician_id AND c.passed = 1) AS arrived,
           (SELECT MAX(e.occurred_at) FROM job_events e
             WHERE e.appointment_id = a.id AND e.kind = 'outcome' AND e.superseded = 0) AS closed
         FROM appointments a JOIN technicians t ON t.id = a.technician_id ${VISIT_PLACE}
         WHERE a.deleted_at IS NULL AND t.city IS NOT NULL AND ${statusIn("a.status", VISIT_ON_THE_BOARD)}
           AND a.window_start >= ?1 AND a.window_start < ?2
         ORDER BY a.technician_id, a.window_start`,
      )
      .bind(indiaInstant(from, "00:00").toISOString(), indiaInstant(to, "00:00").toISOString()),
    db
      .prepare(
        `SELECT technician_id, from_date, to_date, from_time, to_time FROM technician_leave
         WHERE cancelled_at IS NULL AND from_date < ?2 AND to_date >= ?1`,
      )
      .bind(from, to),
  ]);
  const rows = (jobs?.results ?? []) as JobRow[];
  const away = awayOf((leave?.results ?? []) as LeaveRow[], from, to);
  const done = (row: JobRow): DoneJob => ({
    technicianId: row.technician_id,
    date: indiaDate(new Date(row.window_start)),
    arrived: row.arrived,
    closed: row.closed,
    pin: pinOf(row),
  });
  const cities = [...new Set(rows.map((row) => row.city))];
  const learned = cities.flatMap((city) => {
    const drives = drivesOf(rows.filter((row) => row.city === city).map(done), { ...given, away });
    return learn(drives, given.booking.break).map((slot) => ({ city, ...slot }));
  });
  // Written in two statements however many cities there are, the night's run inside the cron's budget.
  await db.batch([
    db.prepare("DELETE FROM drive_factors"),
    db
      .prepare(
        `INSERT INTO drive_factors (city, day_kind, hour, factor_pct, drives, learned_at)
         SELECT json_extract(value, '$.city'), json_extract(value, '$.dayKind'), json_extract(value, '$.hour'),
           json_extract(value, '$.factorPct'), json_extract(value, '$.drives'), ?2
         FROM json_each(?1)`,
      )
      .bind(JSON.stringify(learned), given.now.toISOString()),
  ]);
  return {
    cities: new Set(learned.map((slot) => slot.city)).size,
    drives: learned.reduce((sum, slot) => sum + slot.drives, 0),
  };
}
