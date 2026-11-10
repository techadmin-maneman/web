// The note a technician leaves at a visit's close for whoever takes the client's next job
// (docs/decisions/0242-client-record.md): kept on the client's record, one a visit, and shown as Handoff on their
// next job's card, whoever takes it.

import { firstNameOf } from "../../lib/names.ts";
import { indiaDate } from "../../lib/india-time.ts";

export interface Handoff {
  readonly note: string;
  /** The technician who left it, by first name. */
  readonly technician: string | null;
  /** The visit it was left at, and its day in India. */
  readonly visit_id: string;
  readonly date: string;
}

/** The note left at a visit's close: once however often the phone sends the close. */
export function noteAtClose(
  db: D1Database,
  input: {
    readonly personId: string;
    readonly appointmentId: string;
    readonly technicianId: string;
    readonly body: string;
    readonly now: Date;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO handoff_notes (appointment_id, person_id, technician_id, body, written_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(input.appointmentId, input.personId, input.technicianId, input.body, input.now.toISOString());
}

/** The latest note left for the client at a visit before `before`, by that visit's start; null for none. */
export async function handoffFor(
  db: D1Database,
  job: { readonly personId: string; readonly id: string; readonly startsAt: string },
): Promise<Handoff | null> {
  const row = await db
    .prepare(
      `SELECT h.body, h.appointment_id, a.window_start, t.name AS technician FROM handoff_notes h
       JOIN appointments a ON a.id = h.appointment_id
       LEFT JOIN technicians t ON t.id = h.technician_id
       WHERE h.person_id = ?1 AND h.appointment_id <> ?2 AND a.window_start < ?3
       ORDER BY a.window_start DESC LIMIT 1`,
    )
    .bind(job.personId, job.id, job.startsAt)
    .first<{ body: string; appointment_id: string; window_start: string; technician: string | null }>();
  if (row === null) return null;
  return {
    note: row.body,
    technician: row.technician === null ? null : firstNameOf(row.technician),
    visit_id: row.appointment_id,
    date: indiaDate(new Date(row.window_start)),
  };
}
