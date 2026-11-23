// A technician's own past week on Schedule (docs/decisions/0298-past-weeks-on-schedule.md): each job's time, length,
// kind and how it closed, and nothing of its client. A job's card relocks the day after its visit
// (src/policy/job-visibility.ts), so paging back through the weeks must give no name, number, address or area.

import { tierOf, type VisitType } from "../../config/visit-types.ts";
import { addDays, indiaDate, indiaInstant } from "../../lib/india-time.ts";
import { isOneOf } from "../../lib/one-of.ts";
import { bookedMinutes } from "../booking/occupancy.ts";
import type { AppointmentStatus } from "../visits/visit-status.ts";
import { SHOWN, startsAndOutcomesOn, stateOf, type JobState } from "./tech-jobs.ts";

interface PastJob {
  readonly id: string;
  readonly starts_at: string;
  /** How long the visit was booked for. */
  readonly minutes: number;
  readonly type: VisitType | null;
  readonly one_visit: boolean;
  readonly status: AppointmentStatus;
  /** When it began and how it closed, as the day's list says it. */
  readonly progress: JobState;
}

export interface PastDay {
  readonly date: string;
  readonly jobs: PastJob[];
}

interface PastRow {
  readonly id: string;
  readonly window_start: string;
  readonly window_end: string | null;
  readonly type: VisitType | null;
  readonly one_visit: string | null;
  readonly status: AppointmentStatus;
  readonly service_minutes: number | null;
}

/** The seven days from `from`, India's, each with the jobs that were the technician's, in time order. */
export async function pastWeek(
  db: D1Database,
  week: { readonly technicianId: string; readonly from: string },
): Promise<PastDay[]> {
  const start = indiaInstant(week.from, "00:00").toISOString();
  const end = indiaInstant(addDays(week.from, 7), "00:00").toISOString();
  const [rows, landed] = await Promise.all([
    db
      .prepare(
        `SELECT a.id, a.window_start, a.window_end, a.type, a.one_visit, a.status, s.minutes AS service_minutes
         FROM appointments a
         LEFT JOIN services s ON s.kind = a.type AND s.tier = ${tierOf("a.tier")}
         WHERE a.technician_id = ?1 AND a.deleted_at IS NULL AND a.technician_draft = 0
           AND a.window_start >= ?2 AND a.window_start < ?3
         ORDER BY a.window_start`,
      )
      .bind(week.technicianId, start, end)
      .all<PastRow>(),
    startsAndOutcomesOn(db, week.technicianId, start, end),
  ]);
  const jobs = rows.results
    .filter((row) => isOneOf(SHOWN, row.status))
    .map((row) => ({
      id: row.id,
      starts_at: new Date(row.window_start).toISOString(),
      minutes: bookedMinutes({ ...row, type: row.type ?? "service" }),
      type: row.type,
      one_visit: row.one_visit !== null,
      status: row.status,
      progress: stateOf(landed.get(row.id) ?? []),
    }));
  return Array.from({ length: 7 }, (_, at) => {
    const date = addDays(week.from, at);
    return { date, jobs: jobs.filter((job) => indiaDate(new Date(job.starts_at)) === date) };
  });
}
