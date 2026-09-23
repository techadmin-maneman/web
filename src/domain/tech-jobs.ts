// The technician's day, read from the FSM mirror (src/policy/job-visibility.ts,
// docs/decisions/0032-fsm-mirror.md).
//
// "Today's jobs in order; tomorrow collapsed. Jobs further out show only time,
// type and sector. The address, access notes and client card unlock the day
// before, and the API enforces this, not just the screen." The enforcement is
// here: a locked job is built without the fields, not merely without them
// rendered, so no response carries an address the technician may not have yet.
//
// "No money anywhere in the technician app": a job carries a Prepaid or Credit
// badge, and no amount is read from the database at all.

import type { VisitType } from "../config/visit-types.ts";
import { addDays, indiaDate, indiaInstant, indiaTime } from "../lib/india-time.ts";
import type { JobEventKind } from "../policy/in-job-steps.ts";
import { jobDay, unlocked, unlocksAt, type JobDay, type PaymentBadge } from "../policy/job-visibility.ts";
import type { AppointmentStatus } from "./fsm-mirror.ts";
import { windowAt } from "./scheduling.ts";
import type { BookingWindow } from "../config/scheduling.ts";

/** The statuses a job the technician still has work on can be in. */
const LIVE = ["scheduled", "dispatched", "in_progress"] as const;

export interface JobSummary {
  readonly id: string;
  readonly day: JobDay;
  readonly date: string;
  readonly starts_at: string;
  readonly ends_at: string | null;
  readonly window_label: BookingWindow;
  readonly type: VisitType | null;
  /** Where the visit is, at the coarsest useful grain: a locked job shows this and nothing else of the place. */
  readonly sector: string | null;
  readonly status: AppointmentStatus;
  readonly badge: PaymentBadge;
  readonly unlocked: boolean;
  readonly unlocks_at: string;
}

export interface JobClient {
  readonly name: string;
  readonly mobile: string;
  readonly note: string | null;
}

export interface JobAddress {
  readonly line1: string;
  readonly line2: string | null;
  readonly locality: string;
  readonly city: string;
  readonly pincode: string;
  readonly lat: number | null;
  readonly lng: number | null;
}

export interface JobProgress {
  readonly checked_in_at: string | null;
  readonly started_at: string | null;
  /** The steps sent so far, in the order they were taken. */
  readonly steps_done: JobEventKind[];
  readonly outcome: string | null;
}

export interface JobDetail extends JobSummary {
  /** Null while the job is locked, whatever the mirror holds. */
  readonly address: JobAddress | null;
  readonly access_notes: string | null;
  readonly client: JobClient | null;
  readonly progress: JobProgress;
}

interface JobRow {
  id: string;
  window_start: string;
  window_end: string | null;
  type: VisitType | null;
  status: AppointmentStatus;
  person_id: string | null;
  service_city: string | null;
  client_name: string | null;
  client_mobile: string | null;
  line1: string | null;
  line2: string | null;
  locality: string | null;
  city: string | null;
  pincode: string | null;
  access_notes: string | null;
  lat: number | null;
  lng: number | null;
  on_credit: number;
}

const SELECT_JOB = `
  SELECT a.id, a.window_start, a.window_end, a.type, a.status, a.person_id, a.service_city,
    p.name AS client_name, p.mobile_e164 AS client_mobile,
    d.line1, d.line2, d.locality, d.city, d.pincode, d.access_notes, d.lat, d.lng,
    EXISTS (SELECT 1 FROM credit_ledger l WHERE l.kind = 'redeem' AND l.source_id = a.id) AS on_credit
  FROM appointments a
  LEFT JOIN people p ON p.id = a.person_id
  LEFT JOIN addresses d ON d.person_id = a.person_id AND d.replaced_at IS NULL
  WHERE a.technician_id = ?1 AND a.deleted_at IS NULL AND a.window_start IS NOT NULL`;

/** The jobs on one India date, in time order. Statuses the technician can still act on, and what he closed today. */
export async function jobsOn(db: D1Database, technicianId: string, date: string, now: Date): Promise<JobSummary[]> {
  const { results } = await db
    .prepare(`${SELECT_JOB} AND a.window_start >= ?2 AND a.window_start < ?3 ORDER BY a.window_start`)
    .bind(
      technicianId,
      indiaInstant(date, "00:00").toISOString(),
      indiaInstant(addDays(date, 1), "00:00").toISOString(),
    )
    .all<JobRow>();
  return results.filter(worthShowing).map((row) => summaryOf(row, now));
}

/** One job of this technician's, with everything the day-before unlock allows. */
export async function jobDetail(
  db: D1Database,
  technicianId: string,
  jobId: string,
  now: Date,
): Promise<JobDetail | null> {
  const row = await db.prepare(`${SELECT_JOB} AND a.id = ?2`).bind(technicianId, jobId).first<JobRow>();
  if (row === null) return null;
  const summary = summaryOf(row, now);
  const progress = await progressOf(db, jobId);
  if (!summary.unlocked) {
    return { ...summary, address: null, access_notes: null, client: null, progress };
  }
  return {
    ...summary,
    address:
      row.line1 === null
        ? null
        : {
            line1: row.line1,
            line2: row.line2,
            locality: row.locality ?? "",
            city: row.city ?? "",
            pincode: row.pincode ?? "",
            lat: row.lat,
            lng: row.lng,
          },
    access_notes: row.access_notes,
    client:
      row.client_name === null || row.client_mobile === null
        ? null
        : { name: row.client_name, mobile: row.client_mobile, note: null },
    progress,
  };
}

/** The job the technician may write to now: his own, live, and of a type we know. */
export interface WorkableJob {
  readonly id: string;
  readonly personId: string | null;
  readonly type: VisitType;
  readonly fsmId: string;
  readonly status: AppointmentStatus;
  readonly windowStart: Date;
  readonly technicianId: string;
}

export async function workableJob(db: D1Database, jobId: string): Promise<WorkableJob | null> {
  const row = await db
    .prepare(
      `SELECT id, person_id, type, fsm_id, status, window_start, technician_id FROM appointments
       WHERE id = ?1 AND deleted_at IS NULL AND type IS NOT NULL AND window_start IS NOT NULL`,
    )
    .bind(jobId)
    .first<{
      id: string;
      person_id: string | null;
      type: VisitType;
      fsm_id: string;
      status: AppointmentStatus;
      window_start: string;
      technician_id: string | null;
    }>();
  const technicianId = row?.technician_id ?? null;
  if (row === null || technicianId === null) return null;
  return {
    id: row.id,
    personId: row.person_id,
    type: row.type,
    fsmId: row.fsm_id,
    status: row.status,
    windowStart: new Date(row.window_start),
    technicianId,
  };
}

/** A job in the list: still live, or closed today so the technician can see what he did. */
function worthShowing(row: JobRow): boolean {
  return (LIVE as readonly string[]).includes(row.status) || row.status === "completed" || row.status === "terminated";
}

function summaryOf(row: JobRow, now: Date): JobSummary {
  const starts = new Date(row.window_start);
  const open = unlocked(starts, now);
  return {
    id: row.id,
    day: jobDay(starts, now),
    date: indiaDate(starts),
    starts_at: starts.toISOString(),
    ends_at: row.window_end,
    window_label: windowAt(indiaTime(starts)),
    type: row.type,
    // "only time, type and sector": the area, never the street, whether the job is unlocked or not.
    sector: row.locality ?? row.service_city,
    status: row.status,
    badge: row.on_credit === 1 ? "credit" : "prepaid",
    unlocked: open,
    unlocks_at: unlocksAt(starts).toISOString(),
  };
}

/** What the phone has already sent for this job, from the events it landed. */
export async function progressOf(db: D1Database, jobId: string): Promise<JobProgress> {
  const { results } = await db
    .prepare(
      `SELECT kind, body, occurred_at FROM job_events
       WHERE appointment_id = ?1 AND superseded = 0 ORDER BY received_at`,
    )
    .bind(jobId)
    .all<{ kind: JobEventKind; body: string; occurred_at: string }>();
  const checkIn = results.find((event) => event.kind === "check_in");
  const start = results.find((event) => event.kind === "start");
  const outcome = results.findLast((event) => event.kind === "outcome");
  return {
    checked_in_at: checkIn?.occurred_at ?? null,
    started_at: start?.occurred_at ?? null,
    steps_done: results
      .filter((event) => event.kind !== "check_in" && event.kind !== "start")
      .map((event) => event.kind),
    outcome: outcome === undefined ? null : outcomeOf(outcome.body),
  };
}

function outcomeOf(body: string): string | null {
  const parsed = JSON.parse(body) as { outcome?: unknown };
  return typeof parsed.outcome === "string" ? parsed.outcome : null;
}

/** The two days the app caches, and the dates beyond them the list still names. */
export const jobDates = (now: Date): { today: string; tomorrow: string } => {
  const today = indiaDate(now);
  return { today, tomorrow: addDays(today, 1) };
};
