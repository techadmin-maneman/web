// A job as a move by ops sees it, whether it may move, and where it would land: the window's first free half-slot
// still to start, or its own start kept where only the technician changes. dispatch.ts makes the move; its room
// query asks the same questions.

import type { BookingWindow } from "../../config/scheduling.ts";
import type { VisitType } from "../../config/visit-types.ts";
import { MINUTE_MS } from "../../lib/durations.ts";
import { indiaDate, indiaTime } from "../../lib/india-time.ts";
import { moveRefusal, targetTime, type TargetTime, type MoveRefusal } from "../../policy/dispatch.ts";
import { firstUnitAfter, type SlotTimes, unitAt } from "../../policy/slot-times.ts";
import { unitsFor } from "../../policy/visit-length.ts";
import { paidNotBooked } from "../booking/hold-stages.ts";
import { fitsAt, loadBlackouts, type Day, placement } from "../booking/occupancy.ts";
import type { SlotSchedule } from "../booking/slot-times.ts";
import { visitBegun, begunPastArrival } from "../visits/visit-begun.ts";
import type { AppointmentStatus } from "../visits/visit-status.ts";
import { visitTimes } from "../visits/visit-times.ts";
import { LIVE } from "./dispatch-board.ts";

export interface LiveJob {
  id: string;
  person_id: string | null;
  type: VisitType;
  status: AppointmentStatus;
  window_start: string;
  window_end: string | null;
  start_before_move: string | null;
  technician_id: string | null;
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
         a.technician_id, s.minutes AS service_minutes, ${visitBegun("a")} AS begun,
         ${begunPastArrival("a")} AS begun_past_arrival, ${CLIENT_MOVING} AS client_moving
       FROM appointments a LEFT JOIN services s ON s.kind = a.type AND s.tier = COALESCE(a.tier, 'standard')
       WHERE a.id = ?1 AND a.deleted_at IS NULL AND a.status IN ${LIVE} AND a.type IS NOT NULL
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
 * Where a move puts the job. A day and window that are the job's own keep its start while that start is still ahead:
 * only the technician changes. Otherwise the job takes the window's first free half-slot still to start.
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
  place: { readonly date: string; readonly window: BookingWindow };
  schedule: SlotSchedule;
  now: Date;
}): Target {
  const { date, window } = place;
  const was = schedule.at(job.window_start);
  const today = schedule.at(now);
  const times = schedule.on(date);
  const startIsAhead = Date.parse(job.window_start) > now.getTime();
  const keepsTime = date === was.date && window === was.window && startIsAhead;
  const earliest = date === today.date ? firstUnitAfter(today.time, times) : 0;
  const time = keepsTime ? "ahead" : targetTime(place, { date: today.date, firstUnitAhead: earliest });
  return { technicianId, date, window, keepsTime, times, earliest, time };
}

/** Whether the move puts the job onto a day ops blacked out, from another day. */
export async function movesOntoBlackout(db: D1Database, job: LiveJob, date: string): Promise<boolean> {
  if (date === indiaDate(new Date(job.window_start))) return false;
  return (await loadBlackouts(db, date, date)).has(date);
}

/** Where the job already is: no move at all. */
export const isWhereItIs = (job: LiveJob, target: Target): boolean =>
  target.keepsTime && target.technicianId === job.technician_id;
/** Where a move puts a job, and whether it keeps the time it has. */
interface Target {
  readonly technicianId: string;
  readonly date: string;
  readonly window: BookingWindow;
  /** Only the technician changes: the visit keeps its own start, still ahead, and its half-slots are checked there. */
  readonly keepsTime: boolean;
  /** The target day's times, which its half-slots are read by. */
  readonly times: SlotTimes;
  /** The first half-slot the visit may start in there: any on a day ahead, only one still to start today. */
  readonly earliest: number;
  readonly time: TargetTime;
}

type Landing =
  { readonly kind: "lands"; readonly start: number } | { readonly kind: "refused"; readonly reason: MoveRefusal };
/** A job as a move places it: how long it is, and when it starts now. */
interface Placing {
  readonly minutes: number;
  readonly start: Date;
}

/** The half-slot a job would start in on the target's day, or null where it has no room. */
function startOn(day: Day, job: Placing, target: Target): number | null {
  const units = unitsFor(job.minutes);
  if (!target.keepsTime) return placement(day, target.window, units, target.earliest);
  const start = unitAt(indiaTime(job.start), target.times);
  return fitsAt(day, start, units) ? start : null;
}

/** Where the job lands on the target's day, or why it cannot. */
export function landingOf({
  day,
  job,
  target,
  blackoutWithoutReason,
  beside,
}: {
  day: Day;
  job: Placing;
  target: Target;
  blackoutWithoutReason: boolean;
  beside: boolean;
}): Landing {
  const start = startOn(day, job, target);
  const check = { time: target.time, fits: start !== null, blackoutWithoutReason, besideTheClient: beside };
  const refusal = moveRefusal(day, target.window, check);
  if (refusal !== null) return { kind: "refused", reason: refusal };
  return start === null ? { kind: "refused", reason: "does_not_fit" } : { kind: "lands", start };
}

/** When the job starts and ends where it lands: its own times where it keeps them, else from its half-slot there. */
export function timesAt(
  target: Target,
  startUnit: number,
  job: Placing,
  schedule: SlotSchedule,
): { start: Date; end: Date } {
  if (!target.keepsTime) return visitTimes(target.date, startUnit, job.minutes, schedule);
  return { start: job.start, end: new Date(job.start.getTime() + job.minutes * MINUTE_MS) };
}
