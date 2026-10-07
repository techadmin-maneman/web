// The technician's day (src/policy/job-visibility.ts). The day's jobs are here; one job's card is ./job-card.ts,
// and the job a step is written to, with what has been sent for it, ./workable-job.ts.
//
// "Today's jobs in order; tomorrow collapsed. Jobs further out show only time,
// type and sector. The address, access notes and client card unlock the day
// before, and the API enforces this, not just the screen." The enforcement is
// here: a locked job is built without the fields, not merely without them
// rendered, so no response carries an address the technician may not have yet.
//
// "No money anywhere in the technician app": a job carries a Prepaid, Credit or
// Free badge, and no amount leaves the database. Whether the price book charges
// nothing for the visit's own service on its day is asked in SQL, as a yes or a
// no (docs/decisions/0085-services-ops-can-edit.md).
//
// An unlocked card also carries what the technician needs at the door and no
// route gave them before: the client's pieces (the job card's pieces, and the
// piece step's "Pick from the list"), the last visit's after photograph, the
// no-show wait, and whether the day-before WhatsApp reached the client (board
// B5). The photograph itself is served on its own, and never cached.
//
// A consultation and fit in one visit also carries the products the client may
// choose at it, by name and never by price, what they chose once the piece step
// lands, and where the payment link closing it sent stands
// (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
// Every unlocked card carries the client's hair profile as it stands, for the
// piece card and for the profile step to start from
// (docs/decisions/0106-a-clients-hair-profile.md).

import type { BookingWindow } from "../../config/scheduling.ts";
import type { VisitType } from "../../config/visit-types.ts";
import { addDays, indiaDate, indiaInstant } from "../../lib/india-time.ts";
import { type JobEventKind } from "../../policy/in-job-steps.ts";
import {
  jobDay,
  paymentBadge,
  unlocked,
  unlocksAt,
  type JobDay,
  type PaymentBadge,
} from "../../policy/job-visibility.ts";
import { slotsFor } from "../../policy/dispatch.ts";
import { paidAtTheVisit, type OneVisitState } from "../../policy/one-visit.ts";
import { namesMoreThanItsKind } from "../../policy/services.ts";
import { unitsFor } from "../../policy/visit-length.ts";
import { loadSlotSchedule, type SlotSchedule } from "../booking/slot-times.ts";
import type { AppointmentStatus } from "../visits/visit-status.ts";
import { bookedMinutes } from "../booking/occupancy.ts";
import { isOneOf } from "../../lib/one-of.ts";
import { storedOutcomeOf } from "./job-event-bodies.ts";
import { creditSpentOn } from "../visits/visit-facts.ts";

/** The statuses of a job in the list: still live, or closed today so the technician can see what they did. */
const SHOWN = ["scheduled", "dispatched", "in_progress", "completed", "terminated"] as const;

export interface JobSummary {
  readonly id: string;
  readonly day: JobDay;
  readonly date: string;
  readonly starts_at: string;
  readonly ends_at: string | null;
  readonly window_label: BookingWindow;
  readonly type: VisitType | null;
  /** A consultation and fit in one visit, which runs the first fit's steps with the client's choice at the piece. */
  readonly one_visit: boolean;
  /** The service the visit was sold as, where it names more than the kind: a first fit's hair system, say. */
  readonly service: JobService | null;
  /** Where the visit is, at the coarsest useful grain: a locked job shows this and nothing else of the place. */
  readonly sector: string | null;
  readonly status: AppointmentStatus;
  readonly badge: PaymentBadge;
  /** How much of the day the visit takes: 1, 1.5 or 2 slots. */
  readonly slots: number | null;
  /** How long the visit is booked for, which the technician's day reads beside the time. */
  readonly minutes: number | null;
  readonly unlocked: boolean;
  readonly unlocks_at: string;
  /** The client's name once the job unlocks, as the card gives it, so the day's list can say whom each job is for. */
  readonly client_name: string | null;
  /** When the job began and how it closed, from the events that landed, so the list says what the card says. */
  readonly progress: JobState;
}

export interface JobState {
  readonly started_at: string | null;
  readonly outcome: string | null;
}

/** A service by its code, which the hair profile names a product by, and its name in the console. */
interface JobService {
  readonly tier: string;
  readonly name: string;
}

export interface JobRow {
  id: string;
  window_start: string;
  window_end: string | null;
  type: VisitType | null;
  /** The visit's service within its kind; null where it names none. */
  tier: string | null;
  one_visit: OneVisitState | null;
  status: AppointmentStatus;
  person_id: string | null;
  service_city: string | null;
  /** The area of the pincode the visit is booked for, where the service area names it. */
  pincode_area: string | null;
  /** The client's note from the app (src/domain/clients/client-notes.ts). */
  client_note: string | null;
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
  /** The length of the visit's service, from the services table; null where no service is it. */
  service_minutes: number | null;
  /** The visit's service's name in the console; null where no service is it. */
  service_name: string | null;
}

// `free`: the price book's row for the visit's own service, its kind and its tier (the standard tier's where the
// visit names no other), on the visit's day in India charges nothing, as it does a consultation.
export const SELECT_JOB = `
  SELECT a.id, a.window_start, a.window_end, a.type, a.tier, a.one_visit, a.status, a.person_id, a.service_city,
    a.client_note,
    sp.area AS pincode_area,
    p.name AS client_name, p.mobile_e164 AS client_mobile,
    d.line1, d.line2, d.building, d.tower, d.floor, d.flat, d.landmark, d.locality, d.city, d.pincode,
    d.access_notes, d.lat, d.lng, ${creditSpentOn("a.id")} AS on_credit,
    COALESCE((SELECT b.amount_ex_gst = 0 FROM price_book b
              WHERE b.item = a.type AND b.tier = COALESCE(a.tier, 'standard')
                AND b.valid_from <= date(a.window_start, '+330 minutes')
              ORDER BY b.valid_from DESC LIMIT 1), 0) AS free,
    s.minutes AS service_minutes, s.name AS service_name
  FROM appointments a
  LEFT JOIN people p ON p.id = a.person_id
  LEFT JOIN addresses d ON d.person_id = a.person_id AND d.replaced_at IS NULL
  LEFT JOIN serviceable_pincodes sp ON sp.pincode = a.service_pincode
  LEFT JOIN services s ON s.kind = a.type AND s.tier = COALESCE(a.tier, 'standard')
  WHERE a.technician_id = ?1 AND a.deleted_at IS NULL AND a.window_start IS NOT NULL`;

/** The jobs on one India date, in time order. Statuses the technician can still act on, and what they closed today. */
export async function jobsOn({
  db,
  technicianId,
  date,
  now,
  unlockHour,
}: {
  db: D1Database;
  technicianId: string;
  date: string;
  now: Date;
  unlockHour: number;
}): Promise<JobSummary[]> {
  const from = indiaInstant(date, "00:00").toISOString();
  const to = indiaInstant(addDays(date, 1), "00:00").toISOString();
  const [jobs, schedule, landed] = await Promise.all([
    db
      .prepare(`${SELECT_JOB} AND a.window_start >= ?2 AND a.window_start < ?3 ORDER BY a.window_start`)
      .bind(technicianId, from, to)
      .all<JobRow>(),
    loadSlotSchedule(db),
    startsAndOutcomesOn(db, technicianId, from, to),
  ]);
  return jobs.results
    .filter((row) => isOneOf(SHOWN, row.status))
    .map((row) => listingOf({ row, now, unlockHour, schedule, progress: stateOf(landed.get(row.id) ?? []) }));
}

/** A job event as the job's state is read from it. */
interface LandedEvent {
  appointment_id: string;
  kind: JobEventKind;
  body: string;
  occurred_at: string;
}

/** Each of the technician's jobs between two instants: the starts and outcomes that landed, in the order they did. */
async function startsAndOutcomesOn(
  db: D1Database,
  technicianId: string,
  from: string,
  to: string,
): Promise<Map<string, LandedEvent[]>> {
  const { results } = await db
    .prepare(
      `SELECT e.appointment_id, e.kind, e.body, e.occurred_at FROM job_events e
       JOIN appointments a ON a.id = e.appointment_id
       WHERE a.technician_id = ?1 AND a.deleted_at IS NULL AND a.window_start >= ?2 AND a.window_start < ?3
         AND e.superseded = 0 AND e.kind IN ('start', 'outcome')
       ORDER BY e.received_at, e.rowid`,
    )
    .bind(technicianId, from, to)
    .all<LandedEvent>();
  const byJob = new Map<string, LandedEvent[]>();
  for (const event of results) {
    const events = byJob.get(event.appointment_id) ?? [];
    events.push(event);
    byJob.set(event.appointment_id, events);
  }
  return byJob;
}

/** When the job began and how it closed: its first start that landed, and its last outcome. */
export function stateOf(events: readonly Pick<LandedEvent, "kind" | "body" | "occurred_at">[]): JobState {
  const start = events.find((event) => event.kind === "start");
  const outcome = events.findLast((event) => event.kind === "outcome");
  return {
    started_at: start?.occurred_at ?? null,
    outcome: outcome === undefined ? null : outcomeOf(outcome.body),
  };
}

export function listingOf({
  row,
  now,
  unlockHour,
  schedule,
  progress,
}: {
  row: JobRow;
  now: Date;
  unlockHour: number;
  schedule: SlotSchedule;
  progress: JobState;
}): JobSummary {
  const starts = new Date(row.window_start);
  const open = unlocked(starts, now, unlockHour);
  return {
    id: row.id,
    day: jobDay(starts, now),
    date: indiaDate(starts),
    starts_at: starts.toISOString(),
    ends_at: row.window_end,
    window_label: schedule.at(starts).window,
    type: row.type,
    one_visit: row.one_visit !== null,
    service: soldServiceOf(row),
    // "only time, type and sector": the area, never the street, whether the job is unlocked or not. The visit's
    // pincode names it first, as the dispatch board does (ADR 0069).
    sector: row.pincode_area ?? row.locality ?? row.service_city,
    status: row.status,
    badge: badgeOf(row),
    slots: row.type === null ? null : slotsFor(unitsFor(bookedMinutes(row))),
    minutes: row.type === null ? null : bookedMinutes(row),
    unlocked: open,
    unlocks_at: unlocksAt(starts, unlockHour).toISOString(),
    client_name: open ? row.client_name : null,
    progress: { started_at: progress.started_at, outcome: progress.outcome },
  };
}

function soldServiceOf(row: JobRow): JobService | null {
  if (row.tier === null || row.service_name === null) return null;
  if (!namesMoreThanItsKind(row.tier, row.one_visit)) return null;
  return { tier: row.tier, name: row.service_name };
}

function badgeOf(row: JobRow): PaymentBadge {
  return paymentBadge({ onCredit: row.on_credit === 1, free: row.free === 1, oneVisit: paidAtTheVisit(row.one_visit) });
}

const outcomeOf = (body: string): string | null => storedOutcomeOf(JSON.parse(body))?.outcome ?? null;
