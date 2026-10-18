// A job as a move by ops sees it, whether it may move, and where it would land on the technician's day plan
// (docs/decisions/0210-booking-by-start-time.md): the start asked for, the window's earliest with room, or its own
// start kept where only the technician changes. dispatch.ts makes the move; its room query asks the same questions.

import type { BookingWindow } from "../../config/scheduling.ts";
import { isAFitting, type VisitType } from "../../config/visit-types.ts";
import { MINUTE_MS } from "../../lib/durations.ts";
import { indiaDate, indiaInstant, indiaTime } from "../../lib/india-time.ts";
import type { TargetTime, MoveRefusal } from "../../policy/dispatch.ts";
import {
  minuteOf,
  placedAt,
  placements,
  timeOf,
  type PlanDay,
  type PlanRules,
  type VisitToPlan,
} from "../../policy/day-plan.ts";
import { windowAt, windowTimesOf } from "../../policy/slot-times.ts";
import { paidNotBooked } from "../booking/hold-stages.ts";
import { loadDayPlans } from "../booking/day-plans.ts";
import { bookedMinutes, loadBlackouts } from "../booking/occupancy.ts";
import { pinOfVisit, planRulesOf } from "../booking/start-offers.ts";
import { readOpsInputs } from "../platform/ops-settings.ts";
import type { SlotSchedule } from "../booking/slot-times.ts";
import { visitBegun, begunPastArrival } from "../visits/visit-begun.ts";
import type { AppointmentStatus } from "../visits/visit-status.ts";
import { tierOf } from "../../config/visit-types.ts";
import { statusIn, VISIT_LIVE } from "../../config/statuses.ts";

export interface LiveJob {
  id: string;
  person_id: string;
  type: VisitType;
  status: AppointmentStatus;
  window_start: string;
  window_end: string | null;
  start_before_move: string | null;
  technician_id: string | null;
  /** Where the visit is, which says the city a technician taking it must work in. */
  service_pincode: string | null;
  service_minutes: number | null;
  /** 1 once the technician has begun it (src/domain/visits/visit-begun.ts). */
  begun: number;
  /** 1 once they have begun it by more than their check-in. */
  begun_past_arrival: number;
  /** 1 while a move the client has paid for, or booked free, waits to be booked onto it. */
  client_moving: number;
}

/**
 * Whether a move the client has paid for, or booked free, waits to be booked onto visit `a`. It is booked onto the visit
 * as it was when the client chose the time, so ops' move waits for it.
 */
export const CLIENT_MOVING = `EXISTS (SELECT 1 FROM slot_holds h WHERE h.moves_appointment_id = a.id AND ${paidNotBooked("h")})`;
/** A job still to finish; null for one done, cancelled, deleted, or with no type or time. */
export function liveJob(db: D1Database, appointmentId: string): Promise<LiveJob | null> {
  return db
    .prepare(
      `SELECT a.id, a.person_id, a.type, a.status, a.window_start, a.window_end, a.start_before_move,
         a.technician_id, a.service_pincode, s.minutes AS service_minutes, ${visitBegun("a")} AS begun,
         ${begunPastArrival("a")} AS begun_past_arrival, ${CLIENT_MOVING} AS client_moving
       FROM appointments a LEFT JOIN services s ON s.kind = a.type AND s.tier = ${tierOf("a.tier")}
       WHERE a.id = ?1 AND a.deleted_at IS NULL AND ${statusIn("a.status", VISIT_LIVE)} AND a.type IS NOT NULL
         AND a.window_start IS NOT NULL`,
    )
    .bind(appointmentId)
    .first<LiveJob>();
}

/**
 * A job the technician has begun, by their phone's steps or its status, stays where they are working it: moved, their phone
 * would carry on with a visit now on another day or another technician's.
 */
export const isUnderWay = (job: LiveJob): boolean => job.status === "in_progress" || job.begun === 1;
/** A job begun by the technician's check-in and nothing more: ops may still move it by clearing the check-in. */
const isOnlyCheckedIn = (job: LiveJob): boolean =>
  job.status !== "in_progress" && job.begun === 1 && job.begun_past_arrival === 0;
/** Whether the job may move as it is: not begun, or only checked in and ops chose to clear the check-in. */
export const mayMove = ({ job, clearingCheckIn }: { job: LiveJob; clearingCheckIn: boolean }): boolean =>
  !isUnderWay(job) || (clearingCheckIn && isOnlyCheckedIn(job));
/**
 * Where a move puts the job: the start asked for; or, given a day and window, its own start where they are its own and
 * still ahead, only the technician changing, else the window's earliest start the technician's day has room for; or,
 * given neither, its own start.
 */
export function targetOf({
  job,
  technicianId,
  place,
  schedule,
  now,
}: {
  job: LiveJob;
  technicianId: string;
  place: { readonly date: string; readonly window: BookingWindow | null; readonly startsAt: Date | null };
  schedule: SlotSchedule;
  now: Date;
}): Target {
  const was = schedule.at(job.window_start);
  const today = schedule.at(now);
  const asked = place.startsAt;
  const date = asked === null ? place.date : indiaDate(asked);
  const startText = asked === null ? null : indiaTime(asked);
  const window = startText === null ? (place.window ?? was.window) : windowAt(startText, schedule.on(date));
  const startIsAhead = Date.parse(job.window_start) > now.getTime();
  const keepsTime =
    (asked !== null && asked.getTime() === Date.parse(job.window_start)) ||
    (asked === null && date === was.date && window === was.window && startIsAhead);
  const askedStart = startText === null ? null : minuteOf(startText);
  const start = keepsTime ? minuteOf(was.time) : askedStart;
  const hours = windowTimesOf(schedule.on(date))[window];
  const earliest = date === today.date ? minuteOf(today.time) + 1 : 0;
  const time = timeOfTarget({ date, start, hoursEnd: minuteOf(hours.end) }, { date: today.date, earliest });
  return {
    technicianId,
    date,
    window,
    keepsTime,
    start,
    earliest,
    hours: { from: minuteOf(hours.start), to: minuteOf(hours.end) },
    time,
  };
}

/** Whether a move's start is still ahead: a day gone, today's window or start already passed, or ahead. */
function timeOfTarget(
  target: { readonly date: string; readonly start: number | null; readonly hoursEnd: number },
  today: { readonly date: string; readonly earliest: number },
): TargetTime {
  if (target.date < today.date) return "past_day";
  if (target.date > today.date) return "ahead";
  return (target.start ?? target.hoursEnd - 1) >= today.earliest ? "ahead" : "window_passed";
}

/** Whether the move puts the job onto a day ops blacked out, from another day. */
export async function movesOntoBlackout(db: D1Database, job: LiveJob, date: string): Promise<boolean> {
  if (date === indiaDate(new Date(job.window_start))) return false;
  return (await loadBlackouts(db, date, date, { pincode: job.service_pincode, personId: job.person_id })).has(date);
}

/** Where the job already is: no move at all. */
export const isWhereItIs = (job: LiveJob, target: Target): boolean =>
  target.keepsTime && target.technicianId === job.technician_id;

/** Where a move puts a job, and whether it keeps the time it has. */
interface Target {
  readonly technicianId: string;
  readonly date: string;
  readonly window: BookingWindow;
  /** Only the technician changes: the visit keeps its own start. */
  readonly keepsTime: boolean;
  /** The start, in minutes from midnight in India; null to take the window's earliest with room. */
  readonly start: number | null;
  /** The earliest a start may be: after now on today, any on a day ahead. */
  readonly earliest: number;
  /** The window's hours that day, in minutes from midnight. */
  readonly hours: { readonly from: number; readonly to: number };
  readonly time: TargetTime;
}

type Landing =
  { readonly kind: "lands"; readonly start: number } | { readonly kind: "refused"; readonly reason: MoveRefusal };

/**
 * Where the job lands on the technician's day, by its plan (src/policy/day-plan.ts), or why it cannot: a time gone,
 * away that day, beside the client's visit before or after, a visit already at that time, no room, or a blacked-out
 * day without a reason.
 */
export function landingOf({
  day,
  job,
  target,
  rules,
  blackoutWithoutReason,
  beside,
}: {
  day: PlanDay | null;
  job: VisitToPlan;
  target: Target;
  rules: PlanRules;
  blackoutWithoutReason: boolean;
  beside: boolean;
}): Landing {
  if (target.time !== "ahead") return { kind: "refused", reason: target.time };
  if (day === null) return { kind: "refused", reason: "on_leave" };
  if (beside) return { kind: "refused", reason: "back_to_back" };
  const asked = target.start;
  if (asked !== null && day.stops.some((stop) => stop.start < asked + job.minutes && stop.end > asked)) {
    return { kind: "refused", reason: "clash" };
  }
  const from = Math.max(target.earliest, target.hours.from);
  const start =
    target.start === null
      ? placements(day, job, rules, from).find((placed) => placed.start < target.hours.to)?.start
      : placedAt(day, job, target.start, rules)?.start;
  if (start === undefined) return { kind: "refused", reason: "does_not_fit" };
  return blackoutWithoutReason ? { kind: "refused", reason: "blackout" } : { kind: "lands", start };
}

/** When the job starts and ends where it lands. */
export function timesAt(target: Target, start: number, minutes: number): { start: Date; end: Date } {
  const begins = indiaInstant(target.date, timeOf(start));
  return { start: begins, end: new Date(begins.getTime() + minutes * MINUTE_MS) };
}

/** A landing checked for room alone: no blackout to answer for, and nobody barred by the client's visits. */
export const UNBARRED = { blackoutWithoutReason: false, beside: false };

/** The days a move is checked on, read without the job, the rules they are planned to, and the job as a visit on them. */
export async function moveDays(
  db: D1Database,
  job: LiveJob,
  range: { readonly from: string; readonly to: string },
  now: Date,
) {
  const reading = readOpsInputs(db, now);
  const [plans, inputs, pin] = await Promise.all([
    loadDayPlans({
      db,
      technicianIds: null,
      ...range,
      now,
      hours: reading.then((read) => read.workingHours),
      leaving: { visitId: job.id },
    }),
    reading,
    pinOfVisit(db, { personId: job.person_id, pincode: job.service_pincode }),
  ]);
  const visit: VisitToPlan = { minutes: bookedMinutes(job), pin, fit: isAFitting(job.type) };
  return { plans, rules: planRulesOf(inputs), visit };
}
