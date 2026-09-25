// The technician's day, read from the FSM mirror (src/policy/job-visibility.ts,
// docs/decisions/0032-fsm-mirror.md).
//
// "Today's jobs in order; tomorrow collapsed. Jobs further out show only time,
// type and sector. The address, access notes and client card unlock the day
// before, and the API enforces this, not just the screen." The enforcement is
// here: a locked job is built without the fields, not merely without them
// rendered, so no response carries an address the technician may not have yet.
//
// "No money anywhere in the technician app": a job carries a Prepaid, Credit or
// Free badge, and no amount leaves the database. Whether the price book charges
// nothing for the visit is asked in SQL, as a yes or a no.

import type { VisitType } from "../config/visit-types.ts";
import { addDays, indiaDate, indiaInstant, indiaTime } from "../lib/india-time.ts";
import type { JobEventKind } from "../policy/in-job-steps.ts";
import { jobDay, unlocked, unlocksAt, type JobDay, type PaymentBadge } from "../policy/job-visibility.ts";
import { noShowWaitEnds, type Waits } from "../policy/no-show.ts";
import { latestArrival } from "./check-ins.ts";
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

/** The address as the client saved it, the parts ADR 0054 added included: what gets him to the right door. */
export interface JobAddress {
  readonly line1: string;
  readonly line2: string | null;
  readonly building: string | null;
  readonly tower: string | null;
  readonly floor: string | null;
  readonly flat: string | null;
  readonly landmark: string | null;
  readonly locality: string;
  readonly city: string;
  readonly pincode: string;
  readonly lat: number | null;
  readonly lng: number | null;
}

export interface JobProgress {
  readonly checked_in_at: string | null;
  /**
   * When the job may close as a no-show, from the check-in the server holds, so
   * a phone that lost its own copy still knows (src/policy/no-show.ts).
   */
  readonly wait_ends_at: string | null;
  /** How far from the door that check-in was; null when nothing was measured. */
  readonly distance_m: number | null;
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
  building: string | null;
  tower: string | null;
  floor: string | null;
  flat: string | null;
  landmark: string | null;
  locality: string | null;
  city: string | null;
  pincode: string | null;
  access_notes: string | null;
  lat: number | null;
  lng: number | null;
  on_credit: number;
  free: number;
}

// `free`: the price book's row for the visit type on the visit's day in India
// charges nothing, as it does a consultation.
const SELECT_JOB = `
  SELECT a.id, a.window_start, a.window_end, a.type, a.status, a.person_id, a.service_city,
    p.name AS client_name, p.mobile_e164 AS client_mobile,
    d.line1, d.line2, d.building, d.tower, d.floor, d.flat, d.landmark, d.locality, d.city, d.pincode,
    d.access_notes, d.lat, d.lng,
    EXISTS (SELECT 1 FROM credit_ledger l WHERE l.kind = 'redeem' AND l.source_id = a.id) AS on_credit,
    COALESCE((SELECT b.amount_ex_gst = 0 FROM price_book b
              WHERE b.item = a.type AND b.tier = 'standard' AND b.valid_from <= date(a.window_start, '+330 minutes')
              ORDER BY b.valid_from DESC LIMIT 1), 0) AS free
  FROM appointments a
  LEFT JOIN people p ON p.id = a.person_id
  LEFT JOIN addresses d ON d.person_id = a.person_id AND d.replaced_at IS NULL
  WHERE a.technician_id = ?1 AND a.deleted_at IS NULL AND a.window_start IS NOT NULL`;

/** The jobs on one India date, in time order. Statuses the technician can still act on, and what he closed today. */
export async function jobsOn(
  db: D1Database,
  technicianId: string,
  date: string,
  now: Date,
  unlockHour: number,
): Promise<JobSummary[]> {
  const { results } = await db
    .prepare(`${SELECT_JOB} AND a.window_start >= ?2 AND a.window_start < ?3 ORDER BY a.window_start`)
    .bind(
      technicianId,
      indiaInstant(date, "00:00").toISOString(),
      indiaInstant(addDays(date, 1), "00:00").toISOString(),
    )
    .all<JobRow>();
  return results.filter(worthShowing).map((row) => summaryOf(row, now, unlockHour));
}

/** One job of this technician's, with everything the day-before unlock allows. */
export async function jobDetail(
  db: D1Database,
  options: { technicianId: string; jobId: string; now: Date; unlockHour: number; waits: Waits },
): Promise<JobDetail | null> {
  const row = await db.prepare(`${SELECT_JOB} AND a.id = ?2`).bind(options.technicianId, options.jobId).first<JobRow>();
  if (row === null) return null;
  const summary = summaryOf(row, options.now, options.unlockHour);
  const progress = await progressOf(db, { id: row.id, type: row.type ?? "service" }, options.waits);
  if (!summary.unlocked) {
    return { ...summary, address: null, access_notes: null, client: null, progress };
  }
  return {
    ...summary,
    address: addressOf(row),
    access_notes: row.access_notes,
    client:
      row.client_name === null || row.client_mobile === null
        ? null
        : { name: row.client_name, mobile: row.client_mobile, note: null },
    progress,
  };
}

function addressOf(row: JobRow): JobAddress | null {
  if (row.line1 === null) return null;
  return {
    line1: row.line1,
    line2: row.line2,
    building: row.building,
    tower: row.tower,
    floor: row.floor,
    flat: row.flat,
    landmark: row.landmark,
    locality: row.locality ?? "",
    city: row.city ?? "",
    pincode: row.pincode ?? "",
    lat: row.lat,
    lng: row.lng,
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

function summaryOf(row: JobRow, now: Date, unlockHour: number): JobSummary {
  const starts = new Date(row.window_start);
  const open = unlocked(starts, now, unlockHour);
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
    badge: badgeOf(row),
    unlocked: open,
    unlocks_at: unlocksAt(starts, unlockHour).toISOString(),
  };
}

function badgeOf(row: JobRow): PaymentBadge {
  if (row.on_credit === 1) return "credit";
  if (row.free === 1) return "free";
  return "prepaid";
}

/** What the phone has already sent for this job, from the events it landed. */
export async function progressOf(
  db: D1Database,
  job: { id: string; type: VisitType },
  waits: Waits,
): Promise<JobProgress> {
  const { results } = await db
    .prepare(
      `SELECT kind, body, occurred_at FROM job_events
       WHERE appointment_id = ?1 AND superseded = 0 ORDER BY received_at, rowid`,
    )
    .bind(job.id)
    .all<{ kind: JobEventKind; body: string; occurred_at: string }>();
  const checkIn = results.find((event) => event.kind === "check_in");
  const start = results.find((event) => event.kind === "start");
  const outcome = results.findLast((event) => event.kind === "outcome");
  const arrival = checkIn === undefined ? null : await latestArrival(db, job.id);
  return {
    checked_in_at: checkIn?.occurred_at ?? null,
    wait_ends_at: arrival === null ? null : noShowWaitEnds(arrival, job.type, waits).toISOString(),
    distance_m: arrival?.distanceM ?? null,
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
