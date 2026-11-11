// A technician's safety on a visit (docs/decisions/0248-safety.md). From check-in to the close their phone sends where
// they are every two minutes, and the visit keeps the latest alone; the close, a call-off or a move to another
// technician deletes it (migration 0207's trigger), and the hourly sweep any left past POSITION_KEPT_HOURS. An SOS is
// kept until ops mark it handled, its position brought up to date while it is open and blanked once handled.

import { POSITION_KEPT_HOURS } from "../../policy/safety.ts";

/** Where the phone was, and when it read it. */
export interface Position {
  readonly lat: number;
  readonly lng: number;
  readonly accuracy_m: number | null;
  readonly at: string;
}

export type Keeping = "kept" | "not_found" | "not_sharing";

/**
 * Keeps the visit's latest position, from its check-in to its close, a later reading in place of an earlier one; and
 * brings the technician's open SOS up to date with it. Refused for a visit not theirs, and outside that time.
 */
export async function keepPosition(
  db: D1Database,
  input: { appointmentId: string; technicianId: string; position: Position; now: Date },
): Promise<Keeping> {
  const visit = await db
    .prepare("SELECT technician_id, status FROM appointments WHERE id = ?1 AND deleted_at IS NULL")
    .bind(input.appointmentId)
    .first<{ technician_id: string | null; status: string }>();
  if (visit?.technician_id !== input.technicianId) return "not_found";
  if (visit.status !== "dispatched" && visit.status !== "in_progress") return "not_sharing";
  const { lat, lng, accuracy_m: accuracy, at } = input.position;
  await db.batch([
    db
      .prepare(
        `INSERT INTO visit_positions (appointment_id, technician_id, lat, lng, accuracy_m, at, received_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (appointment_id) DO UPDATE SET
           lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m, at = excluded.at,
           received_at = excluded.received_at
         WHERE excluded.at >= visit_positions.at`,
      )
      .bind(input.appointmentId, input.technicianId, lat, lng, accuracy, at, input.now.toISOString()),
    sosPositionStatement(db, input.technicianId, input.position),
  ]);
  return "kept";
}

/** The technician's open SOS brought up to date with a later reading; nothing where none is open. */
function sosPositionStatement(db: D1Database, technicianId: string, position: Position): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE sos_alerts SET lat = ?2, lng = ?3, accuracy_m = ?4, position_at = ?5
        WHERE technician_id = ?1 AND handled_at IS NULL AND (position_at IS NULL OR position_at <= ?5)`,
    )
    .bind(technicianId, position.lat, position.lng, position.accuracy_m, position.at);
}

/** Deletes the positions kept past POSITION_KEPT_HOURS, as a visit whose close never came would leave them. */
export function sweepPositionsStatement(db: D1Database, now: Date): D1PreparedStatement {
  const before = new Date(now.getTime() - POSITION_KEPT_HOURS * 60 * 60 * 1000).toISOString();
  return db.prepare("DELETE FROM visit_positions WHERE received_at < ?1").bind(before);
}

/** An SOS as the technician's phone is told it. */
export interface OwnSos {
  readonly id: string;
  readonly sent_at: string;
  readonly safe: boolean;
}

/** The technician's SOS not yet handled; null for none. */
export async function openSosOf(db: D1Database, technicianId: string): Promise<OwnSos | null> {
  const row = await db
    .prepare("SELECT id, sent_at, safe_at FROM sos_alerts WHERE technician_id = ?1 AND handled_at IS NULL")
    .bind(technicianId)
    .first<{ id: string; sent_at: string; safe_at: string | null }>();
  return row === null ? null : { id: row.id, sent_at: row.sent_at, safe: row.safe_at !== null };
}

/**
 * Raises the technician's SOS, on the visit they are on where there is one: a second while the first is open is the
 * first, its position brought up to date. `fresh` says whether this one raised it, so ops are paged once.
 */
export async function raiseSos(
  db: D1Database,
  input: { technicianId: string; appointmentId: string | null; position: Position | null; now: Date },
): Promise<OwnSos & { readonly fresh: boolean }> {
  const { position } = input;
  const [raised] = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO sos_alerts (id, technician_id, appointment_id, lat, lng, accuracy_m, position_at, sent_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        crypto.randomUUID(),
        input.technicianId,
        input.appointmentId,
        position?.lat ?? null,
        position?.lng ?? null,
        position?.accuracy_m ?? null,
        position?.at ?? null,
        input.now.toISOString(),
      ),
    ...(position === null ? [] : [sosPositionStatement(db, input.technicianId, position)]),
  ]);
  const open = await openSosOf(db, input.technicianId);
  if (open === null) throw new Error("sos_not_kept");
  return { ...open, fresh: (raised?.meta.changes ?? 0) > 0 };
}

/** The technician says they are safe; their SOS stays open until ops mark it handled. */
export async function sayingSafe(
  db: D1Database,
  input: { id: string; technicianId: string; now: Date },
): Promise<"said" | "not_found"> {
  const said = await db
    .prepare(
      `UPDATE sos_alerts SET safe_at = COALESCE(safe_at, ?3)
        WHERE id = ?1 AND technician_id = ?2 AND handled_at IS NULL`,
    )
    .bind(input.id, input.technicianId, input.now.toISOString())
    .run();
  return said.meta.changes > 0 ? "said" : "not_found";
}

/** An SOS as the console's banner shows it. */
export interface OpenSos {
  readonly id: string;
  readonly technician: { readonly id: string; readonly name: string };
  readonly visit: { readonly id: string; readonly starts_at: string; readonly client_name: string | null } | null;
  readonly position: {
    readonly lat: number;
    readonly lng: number;
    readonly accuracy_m: number | null;
    readonly at: string;
  } | null;
  readonly sent_at: string;
  readonly safe_at: string | null;
}

interface OpenSosRow {
  id: string;
  technician_id: string;
  technician_name: string;
  appointment_id: string | null;
  starts_at: string | null;
  client_name: string | null;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  position_at: string | null;
  sent_at: string;
  safe_at: string | null;
}

/** Every SOS not yet handled, oldest first, with whose it is, the visit they were on and where they were last. */
export async function openSosList(db: D1Database): Promise<OpenSos[]> {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.technician_id, t.name AS technician_name, s.appointment_id, a.window_start AS starts_at,
              p.name AS client_name, s.lat, s.lng, s.accuracy_m, s.position_at, s.sent_at, s.safe_at
         FROM sos_alerts s
         JOIN technicians t ON t.id = s.technician_id
         LEFT JOIN appointments a ON a.id = s.appointment_id
         LEFT JOIN people p ON p.id = a.person_id AND p.erased_at IS NULL
        WHERE s.handled_at IS NULL
        ORDER BY s.sent_at`,
    )
    .all<OpenSosRow>();
  return results.map((row) => ({
    id: row.id,
    technician: { id: row.technician_id, name: row.technician_name },
    visit:
      row.appointment_id === null || row.starts_at === null
        ? null
        : { id: row.appointment_id, starts_at: row.starts_at, client_name: row.client_name },
    position:
      row.lat === null || row.lng === null || row.position_at === null
        ? null
        : { lat: row.lat, lng: row.lng, accuracy_m: row.accuracy_m, at: row.position_at },
    sent_at: row.sent_at,
    safe_at: row.safe_at,
  }));
}

/** Ops mark an SOS handled: who and when are kept, and where the technician was is blanked. */
export async function handleSos(
  db: D1Database,
  input: { id: string; by: string; now: Date },
): Promise<"handled" | "not_found"> {
  const handled = await db
    .prepare(
      `UPDATE sos_alerts SET handled_at = ?2, handled_by = ?3, lat = NULL, lng = NULL, accuracy_m = NULL,
              position_at = NULL
        WHERE id = ?1 AND handled_at IS NULL`,
    )
    .bind(input.id, input.now.toISOString(), input.by)
    .run();
  return handled.meta.changes > 0 ? "handled" : "not_found";
}
