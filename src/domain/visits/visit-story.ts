// What happened on a visit, in order, for its drawer on the dispatch board: each step the technician's phone landed,
// when the phone took it and by whom, and how the visit ended. A step overtaken by a change of FSM's is left out.

import type { JobEventKind } from "../../policy/in-job-steps.ts";

export interface StoryStep {
  readonly kind: JobEventKind;
  /** The phone's clock when the step was taken. */
  readonly at: string;
  readonly technician: string | null;
  /** How the visit ended, on its outcome: "done", "partial", "no_show"; null on every other step. */
  readonly outcome: string | null;
}

/** The visit's steps, the first landed first; null for no visit of that ID. */
export async function visitStory(db: D1Database, appointmentId: string): Promise<StoryStep[] | null> {
  const visit = await db.prepare("SELECT 1 FROM appointments WHERE id = ?1").bind(appointmentId).first();
  if (visit === null) return null;
  const { results } = await db
    .prepare(
      `SELECT e.kind, e.occurred_at, t.name AS technician, json_extract(e.body, '$.outcome') AS outcome
       FROM job_events e LEFT JOIN technicians t ON t.id = e.technician_id
       WHERE e.appointment_id = ?1 AND e.superseded = 0
       ORDER BY e.occurred_at, e.received_at, e.rowid`,
    )
    .bind(appointmentId)
    .all<{ kind: JobEventKind; occurred_at: string; technician: string | null; outcome: string | null }>();
  return results.map((row) => ({
    kind: row.kind,
    at: row.occurred_at,
    technician: row.technician,
    outcome: row.kind === "outcome" ? row.outcome : null,
  }));
}
