// What each technician has done, counted from the jobs themselves at the moment
// ops look, as board D2's tasks are. There is no tally kept anywhere, so nothing
// can drift from the appointments it counts.
//
// A job done is a completed appointment. Its service time is the technician's
// own two events, because "duration runs from Start job to the outcome. The
// technician never types a time" (src/policy/in-job-steps.ts). How far back they
// reach, and how far over an average runs before it is flagged, are ops'
// (src/policy/technician-work.ts). The board's third figure, Skill, is nowhere at
// all: the owner ruled it out (docs/open-points.md, item 59).
//
// One statement answers the whole board: a row per technician per visit type
// and length, which is a few rows a technician however many jobs they hold. A
// job was planned for its service's length, or its kind's where no service is
// it (docs/decisions/0085-services-ops-can-edit.md), so the arithmetic
// comparing the two is here rather than in SQL.

import { VISIT_BLOCKS } from "../config/scheduling.ts";
import type { VisitType } from "../config/visit-types.ts";
import { indiaInstant } from "../lib/india-time.ts";

/**
 * How long a visit was planned to take, which its service time is read against:
 * its service's length, or its kind's. FSM books the visit for this long, so it
 * is the "planned slot" the board's note means.
 */
const plannedMinutes = (row: { type: VisitType; service_minutes: number | null }): number =>
  row.service_minutes ?? VISIT_BLOCKS[row.type].minutes;

export interface TechnicianWork {
  readonly technician_id: string;
  /** Completed visits in the period, whatever the phone recorded of them. */
  readonly jobs: number;
  /** Of those, the ones the phone timed from Start to the outcome: the average's base. */
  readonly timed_jobs: number;
  /** The mean of those jobs, in minutes; null when the phone timed none of them. */
  readonly average_minutes: number | null;
  /** What the same jobs were planned to take, so the two can be read against each other. */
  readonly average_planned_minutes: number | null;
}

/**
 * Every active technician, with the jobs they finished in the period and what
 * the phone timed of them.
 *
 * The technicians drive the join, so one who finished nothing still answers
 * with a nought rather than being left out for the console to guess at. A start
 * without an outcome after it is not a duration, and neither is an outcome
 * before its start, which a phone with a wrong clock can send.
 */
const WORK = `SELECT t.id AS technician_id, a.type AS type, sv.minutes AS service_minutes,
    COUNT(a.id) AS jobs,
    SUM(CASE WHEN o.at > s.at THEN 1 ELSE 0 END) AS timed,
    SUM(CASE WHEN o.at > s.at THEN (julianday(o.at) - julianday(s.at)) * 1440 ELSE 0 END) AS minutes
  FROM technicians t
  LEFT JOIN appointments a ON a.technician_id = t.id AND a.deleted_at IS NULL AND a.status = 'completed'
    AND a.window_start >= ?1 AND a.window_start < ?2
  LEFT JOIN (SELECT appointment_id, MIN(occurred_at) AS at FROM job_events
               WHERE kind = 'start' AND superseded = 0 GROUP BY appointment_id) s ON s.appointment_id = a.id
  LEFT JOIN (SELECT appointment_id, MAX(occurred_at) AS at FROM job_events
               WHERE kind = 'outcome' AND superseded = 0 GROUP BY appointment_id) o ON o.appointment_id = a.id
  LEFT JOIN services sv ON sv.kind = a.type AND sv.tier = COALESCE(a.tier, 'standard')
  WHERE t.active = 1
  GROUP BY t.id, a.type, sv.minutes
  ORDER BY t.name`;

interface Row {
  technician_id: string;
  /** Null on the row a technician with no job in the period answers with, and on a visit of none of our four kinds. */
  type: VisitType | null;
  /** The length of the service its jobs were, where one is. */
  service_minutes: number | null;
  jobs: number;
  timed: number;
  minutes: number;
}

/** The counts board D3 draws, for every active technician, over the days given. */
export async function technicianWork(db: D1Database, period: { from: string; to: string }): Promise<TechnicianWork[]> {
  const { results } = await db
    .prepare(WORK)
    .bind(indiaInstant(period.from, "00:00").toISOString(), indiaInstant(period.to, "00:00").toISOString())
    .all<Row>();

  const byTechnician = new Map<string, Row[]>();
  for (const row of results) byTechnician.set(row.technician_id, [...(byTechnician.get(row.technician_id) ?? []), row]);

  return [...byTechnician].map(([technicianId, rows]) => {
    const jobs = rows.reduce((total, row) => total + row.jobs, 0);
    // A visit of none of our four kinds was planned for no length we know, so it
    // counts as a job done and stands outside the average.
    const known = rows.flatMap((row) => (row.type === null ? [] : [{ ...row, type: row.type }]));
    const timed = known.reduce((total, row) => total + row.timed, 0);
    const minutes = known.reduce((total, row) => total + row.minutes, 0);
    const planned = known.reduce((total, row) => total + row.timed * plannedMinutes(row), 0);
    return {
      technician_id: technicianId,
      jobs,
      timed_jobs: timed,
      average_minutes: timed === 0 ? null : Math.round(minutes / timed),
      average_planned_minutes: timed === 0 ? null : Math.round(planned / timed),
    };
  });
}
