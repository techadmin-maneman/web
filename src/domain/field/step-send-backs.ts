// A step of a visit ops sent back to its technician, with why (docs/decisions/0246-closed-and-sent-back.md). The phone
// opens the step again and says why; the step may land after the visit has closed until it does; landing it again
// clears it. One is open at a time for each step of a visit. Audited by the visit and the step, never the words.

import type { VisitType } from "../../config/visit-types.ts";
import { SENT_BACK_KINDS, type SentBackKind } from "../../policy/in-job-steps.ts";
import { auditStatementIfWritten, type AuditEntry } from "../platform/audit.ts";
import { unlocked } from "../../policy/job-visibility.ts";

/** A step sent back and not yet landed again, as the phone and the console are told it. */
export interface SentBack {
  readonly kind: SentBackKind;
  readonly reason: string;
  readonly sent_at: string;
}

export type SendingBack = "sent" | "not_found" | "not_landed" | "already_sent_back";

/**
 * Sends a landed step of a visit back to its technician: refused where the visit is cancelled, where the step has not
 * landed, or where it is sent back already.
 */
export async function sendBackStep(
  db: D1Database,
  input: {
    appointmentId: string;
    kind: SentBackKind;
    reason: string;
    by: string;
    audit: Omit<AuditEntry, "action" | "subject" | "detail">;
    now: Date;
  },
): Promise<SendingBack> {
  const visit = await db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM job_events e
                       WHERE e.appointment_id = a.id AND e.kind = ?2 AND e.superseded = 0) AS landed,
              EXISTS (SELECT 1 FROM step_send_backs s
                       WHERE s.appointment_id = a.id AND s.kind = ?2 AND s.cleared_at IS NULL) AS open
         FROM appointments a
        WHERE a.id = ?1 AND a.status <> 'cancelled' AND a.deleted_at IS NULL`,
    )
    .bind(input.appointmentId, input.kind)
    .first<{ landed: number; open: number }>();
  if (visit === null) return "not_found";
  if (visit.landed === 0) return "not_landed";
  if (visit.open === 1) return "already_sent_back";

  const id = crypto.randomUUID();
  const at = input.now.toISOString();
  await db.batch([
    // A second send back at the same moment loses to the open one.
    db
      .prepare(
        `INSERT OR IGNORE INTO step_send_backs (id, appointment_id, kind, reason, sent_by, sent_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(id, input.appointmentId, input.kind, input.reason, input.by, at),
    auditStatementIfWritten(
      db,
      {
        ...input.audit,
        action: "visit.step_send_back",
        subject: { kind: "appointment", id: input.appointmentId },
        detail: { step: input.kind },
      },
      input.now,
      { table: "step_send_backs", id },
    ),
  ]);
  return "sent";
}

/** The visit's steps sent back and not yet landed again, oldest first. */
export async function sentBackOf(db: D1Database, appointmentId: string): Promise<SentBack[]> {
  const { results } = await db
    .prepare(
      `SELECT kind, reason, sent_at FROM step_send_backs
        WHERE appointment_id = ?1 AND cleared_at IS NULL ORDER BY sent_at`,
    )
    .bind(appointmentId)
    .all<SentBack>();
  return results;
}

/**
 * What the visit's drawer offers: the steps sent back and not yet landed again, and the landed steps that may be sent
 * back now. A cancelled visit offers none.
 */
export async function sendBacksOf(
  db: D1Database,
  appointmentId: string,
  landed: ReadonlySet<string>,
): Promise<{ open: SentBack[]; may: SentBackKind[] }> {
  const [visit, open] = await Promise.all([
    db
      .prepare("SELECT 1 FROM appointments WHERE id = ?1 AND status <> 'cancelled' AND deleted_at IS NULL")
      .bind(appointmentId)
      .first(),
    sentBackOf(db, appointmentId),
  ]);
  if (visit === null) return { open, may: [] };
  const sent = new Set(open.map((one) => one.kind));
  const may = SENT_BACK_KINDS.filter((kind) => landed.has(kind) && !sent.has(kind));
  return { open, may };
}

/** A visit of the technician's with steps sent back and not yet landed again, whatever its day. */
export interface VisitToFix {
  readonly id: string;
  readonly starts_at: string;
  readonly type: VisitType | null;
  readonly client_name: string | null;
  readonly steps: SentBackKind[];
}

/**
 * The technician's visits with a step sent back and not yet landed again, oldest first: their Today lists each, from
 * whatever day, until it is put right. Read from the open rows alone. The client is named only while the visit is
 * unlocked, as on the day's list (src/policy/job-visibility.ts): past it, the phone names the visit by its kind.
 */
export async function visitsToFix(
  db: D1Database,
  input: { technicianId: string; now: Date; unlockHour: number },
): Promise<VisitToFix[]> {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.window_start AS starts_at, a.type, p.name AS client_name, s.kind
         FROM step_send_backs s
         JOIN appointments a ON a.id = s.appointment_id
         LEFT JOIN people p ON p.id = a.person_id
        WHERE s.cleared_at IS NULL AND a.technician_id = ?1 AND a.deleted_at IS NULL AND a.status <> 'cancelled'
        ORDER BY a.window_start, s.sent_at`,
    )
    .bind(input.technicianId)
    .all<{ id: string; starts_at: string; type: VisitType | null; client_name: string | null; kind: SentBackKind }>();
  const visits = new Map<string, VisitToFix>();
  for (const row of results) {
    const known = visits.get(row.id);
    if (known === undefined) {
      const { kind, client_name: name, ...visit } = row;
      const open = unlocked(new Date(row.starts_at), input.now, input.unlockHour);
      visits.set(row.id, { ...visit, client_name: open ? name : null, steps: [kind] });
    } else known.steps.push(row.kind);
  }
  return [...visits.values()];
}

/** Whether this step of the visit is sent back and not yet landed again: it may land after the close. */
export async function isSentBack(db: D1Database, appointmentId: string, kind: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 FROM step_send_backs WHERE appointment_id = ?1 AND kind = ?2 AND cleared_at IS NULL")
    .bind(appointmentId, kind)
    .first();
  return row !== null;
}

/** Clears the step's send back, for the batch that lands it again; it changes nothing where none is open. */
export function clearSentBackStatement(
  db: D1Database,
  input: { appointmentId: string; kind: string; now: Date },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE step_send_backs SET cleared_at = ?3
        WHERE appointment_id = ?1 AND kind = ?2 AND cleared_at IS NULL`,
    )
    .bind(input.appointmentId, input.kind, input.now.toISOString());
}
