// The FSM mirror (docs/decisions/0032-fsm-mirror.md): one appointment at a
// time, read fresh from FSM and written over its copy in D1, with the client,
// technician and visit type it names. A webhook or the reconciliation only
// says which appointment to read; FSM's answer is what is stored.
//
// The visit's service, its kind and its tier, comes from its FSM item: the
// service whose item it is by the ID kept on it, else the one of its name,
// else, for an item scripts/setup-fsm.ts made, its kind's standard service.
// A visit a hold booked keeps the hold's tier, since the hold is what was
// sold, and FSM may hold it on its kind's item where it had none of its own
// (docs/decisions/0085-services-ops-can-edit.md).

import { STANDARD_TIER, visitTypeOfService, type VisitType } from "../config/visit-types.ts";
import { toE164 } from "../lib/mobile.ts";
import { initialsOf } from "../lib/names.ts";
import type { Logger } from "../log.ts";
import type { FsmAppointment, FsmProvider } from "../providers/fsm.ts";
import { minutesBetween } from "../lib/durations.ts";

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
  /** FSM IDs of the technicians made inactive when the appointment named one new to us and the list was read again. */
  readonly techniciansDeactivated: readonly string[];
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
    return { outcome: "gone", appointmentId: existing?.id ?? null, status: null, techniciansDeactivated: [] };
  }

  const personId = appointment.contactId === null ? null : await personFor(db, fsm, appointment.contactId, at);
  const leadTechnician = appointment.technicianIds[0];
  const lead = leadTechnician === undefined ? null : await technicianFor(db, fsm, leadTechnician, at);
  const service = await serviceOfItems(db, fsm, appointment.serviceIds, at);

  const existing = await db
    .prepare("SELECT id FROM appointments WHERE fsm_id = ?1")
    .bind(fsmId)
    .first<{ id: string }>();
  const id = existing?.id ?? crypto.randomUUID();
  const status = statusOf(appointment.status);

  const statements = [
    db
      .prepare(
        // fsm_invoice_id is not written here: FSM leaves the appointment's own Invoice_Id
        // null, and the invoice pass fills the column with Books' ID (ADR 0055). Where FSM
        // holds no place for it yet, the visit keeps the one our booking gave it (ADR 0068).
        // first_seen_at is the first sync's alone, so an update leaves it. The tier is the hold's that booked the
        // visit, where one did, else its item's. A time FSM holds that the mirror did not is a move made in FSM,
        // by ops, since our own moves write the mirror as they write FSM: the client's notice goes on counting
        // from the time before it (ADR 0096). A one visit stays on the first fit's item in FSM whatever the client
        // decided, so it keeps the product they were fitted with, and one they declined stays a consultation; and a
        // first fit first seen for a client whose one visit asked for while booking was off still waits is the one
        // ops booked for it by hand, and is marked as one (ADR 0105).
        `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, tier, window_start, window_end,
           technician_id, status, fsm_status, service_city, service_pincode, fsm_modified_at, synced_at, first_seen_at,
           one_visit)
         VALUES (?1, ?2, ?3, ?4, ?5,
           COALESCE((SELECT h.tier FROM slot_holds h WHERE h.appointment_id = ?1 AND h.state = 'booked'
             ORDER BY h.created_at LIMIT 1), ?15),
           ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14,
           iif(?5 = 'first_fit' AND EXISTS (SELECT 1 FROM consultation_requests r
             WHERE r.person_id = ?4 AND r.one_visit = 1 AND r.booked = 0), 'booked', NULL))
         ON CONFLICT (fsm_id) DO UPDATE SET
           fsm_work_order_id = excluded.fsm_work_order_id, person_id = excluded.person_id,
           type = iif(appointments.one_visit = 'declined', appointments.type, excluded.type),
           tier = iif(appointments.one_visit IN ('fitted', 'declined'), appointments.tier, excluded.tier),
           start_before_move = iif(julianday(excluded.window_start) <> julianday(appointments.window_start),
             COALESCE(appointments.start_before_move, appointments.window_start), appointments.start_before_move),
           window_start = excluded.window_start, window_end = excluded.window_end,
           technician_id = excluded.technician_id, status = excluded.status, fsm_status = excluded.fsm_status,
           service_city = COALESCE(excluded.service_city, appointments.service_city),
           service_pincode = COALESCE(excluded.service_pincode, appointments.service_pincode),
           fsm_modified_at = excluded.fsm_modified_at, synced_at = excluded.synced_at, deleted_at = NULL`,
      )
      .bind(
        id,
        fsmId,
        appointment.workOrderId,
        personId,
        service?.type ?? null,
        utc(appointment.scheduledStart),
        utc(appointment.scheduledEnd),
        lead?.id ?? null,
        status,
        appointment.status,
        appointment.serviceCity,
        appointment.servicePincode,
        utc(appointment.modifiedAt),
        at,
        service?.tier ?? null,
      ),
  ];
  const visit = visitOf(appointment, status);
  if (visit !== null) {
    const closed = visit.done ? { outcome: "done" as const, partialReason: null } : await terminatedAs(db, id);
    statements.push(
      db
        .prepare(
          `INSERT INTO visits (id, appointment_id, started_at, ended_at, duration_minutes, outcome, partial_reason,
             updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
           ON CONFLICT (appointment_id) DO UPDATE SET
             started_at = excluded.started_at, ended_at = excluded.ended_at,
             duration_minutes = excluded.duration_minutes, outcome = excluded.outcome,
             partial_reason = excluded.partial_reason, updated_at = excluded.updated_at`,
        )
        .bind(
          crypto.randomUUID(),
          id,
          visit.startedAt,
          visit.endedAt,
          visit.durationMinutes,
          closed.outcome,
          closed.partialReason,
          at,
        ),
    );
  }
  await db.batch(statements);
  return { outcome: "written", appointmentId: id, status, techniciansDeactivated: lead?.deactivated ?? [] };
}

/** An instant as UTC, as every other time in D1 is kept. FSM sends India's offset. */
function utc(instant: string | null): string | null {
  return instant === null ? null : new Date(instant).toISOString();
}

/** How a closed visit ended: done, partly done with the technician's reason, or not at all, the client not home. */
export const VISIT_OUTCOMES = ["done", "partial", "no_show"] as const;
export type VisitOutcome = (typeof VISIT_OUTCOMES)[number];

/** A closed appointment's visit, with its times: done when FSM completed it; otherwise FSM terminated it. */
function visitOf(appointment: FsmAppointment, status: AppointmentStatus) {
  if (status !== "completed" && status !== "terminated") return null;
  const startedAt = utc(appointment.actualStart);
  const endedAt = utc(appointment.actualEnd);
  const durationMinutes = startedAt !== null && endedAt !== null ? minutesBetween(startedAt, endedAt) : null;
  return { startedAt, endedAt, durationMinutes, done: status === "completed" };
}

/**
 * How a visit FSM terminated ended: a no-show where the technician closed it
 * as one (BIZ-21), else partial, with the reason he chose from the app's list
 * (src/config/job-sheet.ts). FSM holds either only as prose in the closing
 * note, so it comes from the job's own outcome event. A visit closed in FSM's
 * own screen is partial with no reason.
 */
async function terminatedAs(
  db: D1Database,
  appointmentId: string,
): Promise<{ outcome: VisitOutcome; partialReason: string | null }> {
  const row = await db
    .prepare(
      `SELECT json_extract(body, '$.outcome') AS outcome, json_extract(body, '$.reason') AS reason FROM job_events
       WHERE appointment_id = ?1 AND kind = 'outcome' AND superseded = 0 ORDER BY received_at DESC LIMIT 1`,
    )
    .bind(appointmentId)
    .first<{ outcome: unknown; reason: unknown }>();
  if (row?.outcome === "no_show") return { outcome: "no_show", partialReason: null };
  return { outcome: "partial", partialReason: typeof row?.reason === "string" ? row.reason : null };
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

/**
 * Our technician for an FSM service resource, refreshing the list from FSM when it is new to us, with the FSM IDs
 * that refresh made inactive.
 */
async function technicianFor(
  db: D1Database,
  fsm: FsmProvider,
  fsmId: string,
  at: string,
): Promise<{ id: string | null; deactivated: string[] }> {
  const known = await db.prepare("SELECT id FROM technicians WHERE fsm_id = ?1").bind(fsmId).first<{ id: string }>();
  if (known !== null) return { id: known.id, deactivated: [] };

  const deactivated = await syncTechnicians(db, fsm, at);
  const found = await db.prepare("SELECT id FROM technicians WHERE fsm_id = ?1").bind(fsmId).first<{ id: string }>();
  return { id: found?.id ?? null, deactivated };
}

/**
 * Writes FSM's service resources over our copy: name, whether FSM still lists
 * each as active, the number he logs in with and the territory the board groups
 * him by. The technician login and the dispatch board both read this copy.
 *
 * FSM's list leaves out a user whose service resource was removed, so a
 * technician missing from it is one FSM no longer lists at all, and is made
 * inactive here too (ADR 0052). A technician written by hand into staging's
 * database for a test (`hand_written`, migration 0046) was never FSM's to list,
 * so his absence from the list says nothing, and he is left alone. An empty list
 * is taken as a failed read, never as an org with nobody in it, and changes
 * nothing.
 *
 * Answers the FSM IDs of the technicians it made inactive, for the caller to log.
 */
export async function syncTechnicians(db: D1Database, fsm: FsmProvider, at: string): Promise<string[]> {
  const technicians = await fsm.technicians();
  if (technicians.length === 0) return [];
  const listed = JSON.stringify(technicians.map((technician) => technician.id));
  const results = await db.batch<{ fsm_id: string }>([
    ...technicians.map((technician) =>
      db
        .prepare(
          `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
           ON CONFLICT (fsm_id) DO UPDATE SET
             name = excluded.name, initials = excluded.initials, active = excluded.active, zone = excluded.zone,
             mobile_e164 = excluded.mobile_e164, updated_at = excluded.updated_at`,
        )
        .bind(
          crypto.randomUUID(),
          technician.id,
          technician.name,
          initialsOf(technician.name),
          technician.active ? 1 : 0,
          technician.zone,
          technician.mobile === null ? null : toE164(technician.mobile),
          at,
        ),
    ),
    db
      .prepare(
        `UPDATE technicians SET active = 0, updated_at = ?2
         WHERE active = 1 AND hand_written = 0 AND fsm_id NOT IN (SELECT value FROM json_each(?1))
         RETURNING fsm_id`,
      )
      .bind(listed, at),
  ]);
  return (results.at(-1)?.results ?? []).map((row) => row.fsm_id);
}

/**
 * The one line each caller of syncTechnicians writes when it made anyone inactive, so a technician who can no
 * longer sign in can be traced to the read that stopped him. FSM's IDs only: never a name or a number.
 */
export function logDeactivated(log: Logger, fsmIds: readonly string[]): void {
  if (fsmIds.length > 0) log.info("technicians_deactivated", { count: fsmIds.length, fsm_ids: fsmIds });
}

/** The service of the first of an appointment's service items that is one of ours: its kind and its tier. */
async function serviceOfItems(
  db: D1Database,
  fsm: FsmProvider,
  serviceIds: readonly string[],
  at: string,
): Promise<{ type: VisitType; tier: string } | null> {
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
    const service = await serviceByItem(db, serviceId, names.get(serviceId) ?? null);
    if (service !== null) return service;
  }
  return null;
}

/**
 * The service an FSM item is: the one its ID is kept on, else the one of its name, else, for an item named as
 * scripts/setup-fsm.ts names a kind's, that kind's standard service. Null for an item that is no service of ours.
 */
async function serviceByItem(
  db: D1Database,
  itemId: string,
  name: string | null,
): Promise<{ type: VisitType; tier: string } | null> {
  const service = await db
    .prepare(
      `SELECT kind AS type, tier, 0 AS rank FROM services WHERE fsm_item_id = ?1
       UNION ALL SELECT kind AS type, tier, 1 AS rank FROM services WHERE name = ?2 COLLATE NOCASE
       ORDER BY rank LIMIT 1`,
    )
    .bind(itemId, name)
    .first<{ type: VisitType; tier: string }>();
  if (service !== null) return service;
  const type = visitTypeOfService(name ?? "");
  return type === null ? null : { type, tier: STANDARD_TIER };
}

async function itemNames(db: D1Database, ids: readonly string[]): Promise<Map<string, string>> {
  const placeholders = ids.map((_, index) => `?${String(index + 1)}`).join(", ");
  const { results } = await db
    .prepare(`SELECT fsm_id, name FROM fsm_items WHERE fsm_id IN (${placeholders})`)
    .bind(...ids)
    .all<{ fsm_id: string; name: string }>();
  return new Map(results.map((row) => [row.fsm_id, row.name]));
}
