// The night's learning of drive times (docs/decisions/0294-learned-drive-times.md): every technician's drives of the
// weeks ops set, each from one job's close to their check-in at the next that day, against what the estimate gives for
// the drive between the two addresses they checked in at; each city's slots learned afresh from them
// (src/policy/learned-drives.ts), and the ones before them replaced.

import { statusIn, VISIT_ON_THE_BOARD } from "../../config/statuses.ts";
import type { Pin } from "../../lib/geo.ts";
import { addDays, indiaDate, indiaInstant } from "../../lib/india-time.ts";
import { minuteOf } from "../../policy/day-plan.ts";
import type { DriveEstimate } from "../../policy/drive-estimate.ts";
import { drivesOf, learn, type Away, type DoneJob, type DriveDone } from "../../policy/learned-drives.ts";
import type { BookingRules } from "../../policy/start-times.ts";

interface JobRow {
  readonly technician_id: string;
  readonly name: string;
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

/** A drive between two of a technician's jobs, with their name and city. */
export interface CityDrive extends DriveDone {
  readonly name: string;
  readonly city: string;
}

/** The drives between each technician's jobs on India's dates from `from` up to `to`, `to` not among them. */
export async function drivesDone(
  db: D1Database,
  given: {
    readonly from: string;
    readonly to: string;
    readonly estimate: DriveEstimate;
    readonly booking: BookingRules;
  },
): Promise<CityDrive[]> {
  const { from, to } = given;
  const [jobs, leave] = await db.batch([
    // A job's first check-in that passed is its arrival, at the address it was made at; one passed only by ops' waiver,
    // for a pin far from the door, is not, as the estimate to that pin is wrong. Its last outcome standing is its close.
    db
      .prepare(
        `SELECT a.technician_id, t.name, t.city, a.window_start, c.at AS arrived, d.lat, d.lng,
           (SELECT MAX(e.occurred_at) FROM job_events e
             WHERE e.appointment_id = a.id AND e.kind = 'outcome' AND e.superseded = 0) AS closed
         FROM appointments a JOIN technicians t ON t.id = a.technician_id
         LEFT JOIN checkins c ON c.id = (SELECT first.id FROM checkins first
           WHERE first.appointment_id = a.id AND first.technician_id = a.technician_id AND first.passed = 1
             AND first.waived_by IS NULL
           ORDER BY first.at LIMIT 1)
         LEFT JOIN addresses d ON d.id = c.address_id
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
  const technicians = new Map(rows.map((row) => [row.technician_id, row]));
  return drivesOf(rows.map(done), { ...given, away }).map((drive) => {
    const technician = technicians.get(drive.technicianId);
    return { ...drive, name: technician?.name ?? "", city: technician?.city ?? "" };
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
  const drives = await drivesDone(db, { ...given, from: addDays(to, -7 * given.weeks), to });
  const cities = [...new Set(drives.map((drive) => drive.city))];
  const learned = cities.flatMap((city) => {
    const own = drives.filter((drive) => drive.city === city);
    return learn(own, given.booking.break).map((slot) => ({ city, ...slot }));
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
