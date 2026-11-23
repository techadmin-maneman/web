// Where a visit not yet closed stands for the client (./client-visits.ts): still to come, at the door, under way,
// closed as done from the technician's phone, otherwise over and waiting to be closed, or missed.

import type { AppointmentStatus, VisitOutcome } from "./visit-status.ts";

/**
 * Where a visit not yet closed stands for the client: still to come, under
 * way, closed as done from the technician's phone, or otherwise over and waiting
 * to be closed. A visit stays the client's until it is closed, so it
 * never drops out of both lists.
 */
export type VisitStage = "booked" | "arrived" | "in_progress" | "done" | "closing" | "missed";

/** The statuses of a visit not yet closed. */
export const NOT_CLOSED: readonly AppointmentStatus[] = ["scheduled", "dispatched", "in_progress"];

/** 1 while the client's sign-off of the appointment `a`'s fit is asked for, or flagged to be put right (ADR 0254). */
export const SIGN_OFF_PENDING = `EXISTS (SELECT 1 FROM fit_sign_offs f WHERE f.appointment_id = a.id
  AND f.state IN ('asked', 'flagged'))`;

/** What a visit's stage is read from. */
interface StageRow {
  readonly status: AppointmentStatus;
  readonly window_end: string;
  readonly begun: number;
  /** 1 once the technician has started the work, past checking in at the door. */
  readonly started: number;
  readonly landed_outcome: VisitOutcome | null;
  /** SIGN_OFF_PENDING. */
  readonly sign_off_pending: number;
}

/**
 * The technician's steps come before the visit's status, which follows them: a visit they closed as done is done; one
 * they closed otherwise, or whose window has ended after they arrived, is being closed, unless the client's sign-off is
 * still asked for, when it is under way until they answer; one whose window ended with nobody arriving was missed; one
 * they have started is in progress, and one they have only checked in at is arrived.
 */
export function stageOf(row: StageRow, now: Date): VisitStage | null {
  if (!NOT_CLOSED.includes(row.status)) return null;
  if (row.landed_outcome === "done") return "done";
  if (row.landed_outcome !== null) return "closing";
  if (Date.parse(row.window_end) < now.getTime()) {
    if (row.begun !== 1) return "missed";
    return row.sign_off_pending === 1 ? "in_progress" : "closing";
  }
  if (row.started === 1 || row.status === "in_progress") return "in_progress";
  if (row.begun === 1) return "arrived";
  return "booked";
}
