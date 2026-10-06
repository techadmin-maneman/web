// The job a technician's step is written to, and what the phone has already sent for it (./tech-jobs.ts).

import type { VisitType } from "../../config/visit-types.ts";
import type { AppointmentStatus } from "../visits/visit-status.ts";
import type { OneVisitState } from "../../policy/one-visit.ts";

/** The job the technician may write to now: his own, live, and of a type we know. */
export interface WorkableJob {
  readonly id: string;
  readonly personId: string | null;
  readonly type: VisitType;
  /** Where a consultation and fit in one visit stands; null for any other visit. */
  readonly oneVisit: OneVisitState | null;
  readonly fsmId: string;
  readonly status: AppointmentStatus;
  readonly windowStart: Date;
  readonly technicianId: string;
}

export async function workableJob(db: D1Database, jobId: string): Promise<WorkableJob | null> {
  const row = await db
    .prepare(
      `SELECT id, person_id, type, one_visit, fsm_id, status, window_start, technician_id FROM appointments
       WHERE id = ?1 AND deleted_at IS NULL AND type IS NOT NULL AND window_start IS NOT NULL`,
    )
    .bind(jobId)
    .first<{
      id: string;
      person_id: string | null;
      type: VisitType;
      one_visit: OneVisitState | null;
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
    oneVisit: row.one_visit,
    fsmId: row.fsm_id,
    status: row.status,
    windowStart: new Date(row.window_start),
    technicianId,
  };
}
