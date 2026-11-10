// A client's alerts (docs/decisions/0242-client-record.md): what every technician sees in red before they start,
// "Allergic to latex". They belong to the client, not a job. Ops and Care raise and take them off on the client's
// page, audited by the client's and the alert's IDs, never a word of it; a technician raises one at a visit's close.
// One taken off is marked so, never deleted, so what was raised, by whom and when stays.

import { auditStatementIfWritten, auditStatementWhen, type AuditEntry } from "../platform/audit.ts";
import { firstNameOf } from "../../lib/names.ts";

export interface ClientAlert {
  readonly id: string;
  readonly body: string;
  readonly written_at: string;
  /** A member of staff by their work e-mail, or a technician by first name at a visit's close. */
  readonly raised_by:
    { readonly kind: "staff"; readonly staff: string } | { readonly kind: "technician"; readonly name: string };
}

type Audit = Omit<AuditEntry, "action" | "subject" | "detail">;

/** The client's alerts still on, newest first. */
export async function alertsOf(db: D1Database, personId: string): Promise<ClientAlert[]> {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.body, a.written_at, a.staff, t.name AS technician FROM client_alerts a
       LEFT JOIN technicians t ON t.id = a.technician_id
       WHERE a.person_id = ?1 AND a.taken_off_at IS NULL ORDER BY a.written_at DESC, a.rowid DESC`,
    )
    .bind(personId)
    .all<{ id: string; body: string; written_at: string; staff: string | null; technician: string | null }>();
  return results.map((row) => ({
    id: row.id,
    body: row.body,
    written_at: row.written_at,
    raised_by:
      row.staff === null
        ? { kind: "technician", name: firstNameOf(row.technician ?? "") }
        : { kind: "staff", staff: row.staff },
  }));
}

/** An alert as a technician's card and history give it: raised by staff, never which member of staff. */
export interface TechnicianAlert extends Omit<ClientAlert, "raised_by"> {
  readonly raised_by: { readonly kind: "staff" } | { readonly kind: "technician"; readonly name: string };
}

/** The client's alerts still on, newest first, for a technician. */
export async function alertsForTechnician(db: D1Database, personId: string): Promise<TechnicianAlert[]> {
  return (await alertsOf(db, personId)).map(({ raised_by: by, ...alert }) => ({
    ...alert,
    raised_by: by.kind === "staff" ? { kind: "staff" } : by,
  }));
}

/** An alert raised by a member of staff, with its audit entry. */
export async function raiseAlert(
  db: D1Database,
  input: {
    readonly personId: string;
    readonly body: string;
    readonly staff: string;
    readonly now: Date;
    readonly audit: Audit;
  },
): Promise<void> {
  const id = crypto.randomUUID();
  const entry = {
    ...input.audit,
    action: "client_alert.raise" as const,
    subject: { kind: "person", id: input.personId },
    detail: { alert: id },
  };
  await db.batch([
    db
      .prepare("INSERT INTO client_alerts (id, person_id, body, staff, written_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(id, input.personId, input.body, input.staff, input.now.toISOString()),
    auditStatementIfWritten(db, entry, input.now, { table: "client_alerts", id }),
  ]);
}

/** The alert taken off the client; one already off stays as it was. */
export async function takeOffAlert(
  db: D1Database,
  input: {
    readonly personId: string;
    readonly alertId: string;
    readonly staff: string;
    readonly now: Date;
    readonly audit: Audit;
  },
): Promise<void> {
  const at = input.now.toISOString();
  const entry = {
    ...input.audit,
    action: "client_alert.take_off" as const,
    subject: { kind: "person", id: input.personId },
    detail: { alert: input.alertId },
  };
  await db.batch([
    db
      .prepare(
        `UPDATE client_alerts SET taken_off_at = ?3, taken_off_by = ?4
         WHERE id = ?1 AND person_id = ?2 AND taken_off_at IS NULL`,
      )
      .bind(input.alertId, input.personId, at, input.staff),
    auditStatementWhen(db, entry, input.now, {
      sql: "EXISTS (SELECT 1 FROM client_alerts WHERE id = ?10 AND taken_off_at = ?11 AND taken_off_by = ?12)",
      binds: [input.alertId, at, input.staff],
    }),
  ]);
}

/** An alert a technician raised at a visit's close: once however often the phone sends the close. */
export function alertAtClose(
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
      `INSERT OR IGNORE INTO client_alerts (id, person_id, body, technician_id, appointment_id, written_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(
      crypto.randomUUID(),
      input.personId,
      input.body,
      input.technicianId,
      input.appointmentId,
      input.now.toISOString(),
    );
}
