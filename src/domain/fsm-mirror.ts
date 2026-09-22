// The FSM mirror (docs/decisions/0032-fsm-mirror.md): one appointment at a
// time, read fresh from FSM and written over its copy in D1, with the client,
// technician and visit type it names. A webhook or the reconciliation only
// says which appointment to read; FSM's answer is what is stored.

import { visitTypeOfService, type VisitType } from "../config/visit-types.ts";
import { toE164 } from "../lib/mobile.ts";
import { initialsOf } from "../lib/names.ts";
import type { FsmAppointment, FsmProvider } from "../providers/fsm.ts";

export type AppointmentStatus =
  "scheduled" | "dispatched" | "in_progress" | "completed" | "cancelled" | "terminated" | "other";

/** FSM's status words, as the mirror stores them. Any other word is kept as "other", with FSM's own. */
const STATUSES: Readonly<Record<string, AppointmentStatus>> = {
  Scheduled: "scheduled",
  Dispatched: "dispatched",
  "In Progress": "in_progress",
  Completed: "completed",
  Cancelled: "cancelled",
  Terminated: "terminated",
};

export function statusOf(fsmStatus: string): AppointmentStatus {
  return STATUSES[fsmStatus] ?? "other";
}

export interface SyncResult {
  /** "written" when the copy now matches FSM; "gone" when FSM no longer has the appointment. */
  readonly outcome: "written" | "gone";
  readonly appointmentId: string | null;
  /** The appointment's status as written; null when it is gone. */
  readonly status: AppointmentStatus | null;
}

/** Reads one appointment from FSM and makes the mirror match it. */
export async function syncAppointment(db: D1Database, fsm: FsmProvider, fsmId: string, now: Date): Promise<SyncResult> {
  const at = now.toISOString();
  const appointment = await fsm.appointment(fsmId);
  if (appointment === null) {
    const existing = await db
      .prepare(
        "UPDATE appointments SET deleted_at = COALESCE(deleted_at, ?2), synced_at = ?2 WHERE fsm_id = ?1 RETURNING id",
      )
      .bind(fsmId, at)
      .first<{ id: string }>();
    return { outcome: "gone", appointmentId: existing?.id ?? null, status: null };
  }

  const personId = appointment.contactId === null ? null : await personFor(db, fsm, appointment.contactId, at);
  const leadTechnician = appointment.technicianIds[0];
  const technicianId = leadTechnician === undefined ? null : await technicianFor(db, fsm, leadTechnician, at);
  const type = await visitTypeOf(db, fsm, appointment.serviceIds, at);

  const existing = await db
    .prepare("SELECT id FROM appointments WHERE fsm_id = ?1")
    .bind(fsmId)
    .first<{ id: string }>();
  const id = existing?.id ?? crypto.randomUUID();
  const status = statusOf(appointment.status);

  const statements = [
    db
      .prepare(
        `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, window_start, window_end,
           technician_id, status, fsm_status, service_city, service_pincode, fsm_invoice_id, fsm_modified_at, synced_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
         ON CONFLICT (fsm_id) DO UPDATE SET
           fsm_work_order_id = excluded.fsm_work_order_id, person_id = excluded.person_id, type = excluded.type,
           window_start = excluded.window_start, window_end = excluded.window_end,
           technician_id = excluded.technician_id, status = excluded.status, fsm_status = excluded.fsm_status,
           service_city = excluded.service_city, service_pincode = excluded.service_pincode,
           fsm_invoice_id = excluded.fsm_invoice_id, fsm_modified_at = excluded.fsm_modified_at,
           synced_at = excluded.synced_at, deleted_at = NULL`,
      )
      .bind(
        id,
        fsmId,
        appointment.workOrderId,
        personId,
        type,
        utc(appointment.scheduledStart),
        utc(appointment.scheduledEnd),
        technicianId,
        status,
        appointment.status,
        appointment.serviceCity,
        appointment.servicePincode,
        appointment.invoiceId,
        utc(appointment.modifiedAt),
        at,
      ),
  ];
  const visit = visitOf(appointment, status);
  if (visit !== null) {
    statements.push(
      db
        .prepare(
          `INSERT INTO visits (id, appointment_id, started_at, ended_at, duration_minutes, outcome, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
           ON CONFLICT (appointment_id) DO UPDATE SET
             started_at = excluded.started_at, ended_at = excluded.ended_at,
             duration_minutes = excluded.duration_minutes, outcome = excluded.outcome, updated_at = excluded.updated_at`,
        )
        .bind(crypto.randomUUID(), id, visit.startedAt, visit.endedAt, visit.durationMinutes, visit.outcome, at),
    );
  }
  await db.batch(statements);
  return { outcome: "written", appointmentId: id, status };
}

/** An instant as UTC, as every other time in D1 is kept. FSM sends India's offset. */
function utc(instant: string | null): string | null {
  return instant === null ? null : new Date(instant).toISOString();
}

/** A closed appointment's visit: done when completed, partial when FSM terminated it. */
function visitOf(appointment: FsmAppointment, status: AppointmentStatus) {
  if (status !== "completed" && status !== "terminated") return null;
  const startedAt = utc(appointment.actualStart);
  const endedAt = utc(appointment.actualEnd);
  const durationMinutes =
    startedAt !== null && endedAt !== null ? Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60_000) : null;
  return { startedAt, endedAt, durationMinutes, outcome: status === "completed" ? "done" : "partial" };
}

/**
 * The person an FSM contact is. Matched once by mobile number, then by the
 * contact's ID. A contact whose number matches no one becomes a new person,
 * since ops add clients in FSM too. A contact with no usable number is no one.
 */
async function personFor(db: D1Database, fsm: FsmProvider, contactId: string, at: string): Promise<string | null> {
  const linked = await db
    .prepare("SELECT id FROM people WHERE fsm_contact_id = ?1")
    .bind(contactId)
    .first<{ id: string }>();
  if (linked !== null) return linked.id;

  const contact = await fsm.contact(contactId);
  if (contact === null) return null;
  const mobile = contact.mobile === null ? null : toE164(contact.mobile);
  if (mobile === null) return null;

  const byMobile = await db
    .prepare("SELECT id FROM people WHERE mobile_e164 = ?1")
    .bind(mobile)
    .first<{ id: string }>();
  if (byMobile !== null) {
    // The first FSM contact with this number stays the linked one.
    await db
      .prepare("UPDATE people SET fsm_contact_id = ?2 WHERE id = ?1 AND fsm_contact_id IS NULL")
      .bind(byMobile.id, contactId)
      .run();
    return byMobile.id;
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO people (id, created_at, mobile_e164, name, email, contactable, fsm_contact_id)
       VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)`,
    )
    .bind(id, at, mobile, contact.name, contact.email, contactId)
    .run();
  return id;
}

/** Our technician for an FSM service resource, refreshing the list from FSM when it is new to us. */
async function technicianFor(db: D1Database, fsm: FsmProvider, fsmId: string, at: string): Promise<string | null> {
  const known = await db.prepare("SELECT id FROM technicians WHERE fsm_id = ?1").bind(fsmId).first<{ id: string }>();
  if (known !== null) return known.id;

  const technicians = await fsm.technicians();
  if (technicians.length === 0) return null;
  await db.batch(
    technicians.map((technician) =>
      db
        .prepare(
          `INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
           ON CONFLICT (fsm_id) DO UPDATE SET
             name = excluded.name, initials = excluded.initials, active = excluded.active, updated_at = excluded.updated_at`,
        )
        .bind(
          crypto.randomUUID(),
          technician.id,
          technician.name,
          initialsOf(technician.name),
          technician.active ? 1 : 0,
          at,
        ),
    ),
  );
  const found = await db.prepare("SELECT id FROM technicians WHERE fsm_id = ?1").bind(fsmId).first<{ id: string }>();
  return found?.id ?? null;
}

/** The visit type of the first of an appointment's services that is one of ours. */
async function visitTypeOf(
  db: D1Database,
  fsm: FsmProvider,
  serviceIds: readonly string[],
  at: string,
): Promise<VisitType | null> {
  if (serviceIds.length === 0) return null;
  let names = await itemNames(db, serviceIds);
  if (names.size < new Set(serviceIds).size) {
    const items = await fsm.items();
    if (items.length === 0) return null;
    await db.batch(
      items.map((item) =>
        db
          .prepare(
            `INSERT INTO fsm_items (fsm_id, name, type, updated_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (fsm_id) DO UPDATE SET name = excluded.name, type = excluded.type, updated_at = excluded.updated_at`,
          )
          .bind(item.id, item.name, item.type, at),
      ),
    );
    names = await itemNames(db, serviceIds);
  }
  for (const serviceId of serviceIds) {
    const type = visitTypeOfService(names.get(serviceId) ?? "");
    if (type !== null) return type;
  }
  return null;
}

async function itemNames(db: D1Database, ids: readonly string[]): Promise<Map<string, string>> {
  const placeholders = ids.map((_, index) => `?${String(index + 1)}`).join(", ");
  const { results } = await db
    .prepare(`SELECT fsm_id, name FROM fsm_items WHERE fsm_id IN (${placeholders})`)
    .bind(...ids)
    .all<{ fsm_id: string; name: string }>();
  return new Map(results.map((row) => [row.fsm_id, row.name]));
}
