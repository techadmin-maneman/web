// Ops add a technician, change their name, number, zone or city, and switch them off or back on
// (src/routes/ops/technicians.ts).
//
// A technician added here gets an ID of our own, written as their FSM ID too (docs/schema.md). Two active technicians
// never share a number: the number is how they sign in (src/domain/dispatch/technicians.ts).
//
// A technician added by mistake is deleted, with their leave, phones, sign-in codes and sessions, but only while nothing
// records any work of theirs; one who has worked is switched off instead, and stays on record.
//
// Switching a technician off ends their sessions at once and takes their visits still to come off them, so they wait in
// the dispatch board's tray. Their phone is not revoked: it keeps the work it has not sent, should they be switched back
// on (src/http/technician-session.ts).

import type { VisitType } from "../../config/visit-types.ts";
import { initialsOf } from "../../lib/names.ts";
import { auditStatement, auditStatementIfDeleted, auditStatementIfWritten, type AuditEntry } from "../ops/audit.ts";
import { visitBegun } from "../visits/visit-begun.ts";
import { statusIn, VISIT_NOT_BEGUN } from "../../config/statuses.ts";

/** A technician as the console lists them. */
export interface RosterTechnician {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
  readonly zone: string | null;
  /** One of our cities, which staff access by place reads; null for none, reached only nationally. */
  readonly city: string | null;
  readonly mobile: string | null;
  readonly active: boolean;
  /** When a revoked phone stopped them signing in; null while they may (src/domain/dispatch/technicians.ts). */
  readonly signInStoppedAt: string | null;
}

interface RosterRow {
  id: string;
  name: string;
  initials: string;
  zone: string | null;
  city: string | null;
  mobile_e164: string | null;
  active: number;
  sign_in_stopped_at: string | null;
}

const rosterTechnicianOf = (row: RosterRow): RosterTechnician => ({
  id: row.id,
  name: row.name,
  initials: row.initials,
  zone: row.zone,
  city: row.city,
  mobile: row.mobile_e164,
  active: row.active === 1,
  signInStoppedAt: row.sign_in_stopped_at,
});

const ROSTER_COLUMNS = "id, name, initials, zone, city, mobile_e164, active, sign_in_stopped_at";

/** Every technician, active or switched off, by name. */
export async function roster(db: D1Database): Promise<RosterTechnician[]> {
  const { results } = await db.prepare(`SELECT ${ROSTER_COLUMNS} FROM technicians ORDER BY name`).all<RosterRow>();
  return results.map(rosterTechnicianOf);
}

export async function rosterTechnician(db: D1Database, id: string): Promise<RosterTechnician | null> {
  const row = await db.prepare(`SELECT ${ROSTER_COLUMNS} FROM technicians WHERE id = ?1`).bind(id).first<RosterRow>();
  return row === null ? null : rosterTechnicianOf(row);
}

/** Whether another active technician signs in with this number. */
const NUMBER_TAKEN = "EXISTS (SELECT 1 FROM technicians WHERE mobile_e164 = ?2 AND active = 1 AND id <> ?1)";

interface NewTechnician {
  readonly id: string;
  readonly name: string;
  readonly mobileE164: string;
  readonly zone: string | null;
  readonly city: string | null;
}

/** Adds an active technician, unless another active technician has their number. */
export async function addTechnician(
  db: D1Database,
  technician: NewTechnician,
  audit: AuditEntry,
  now: Date,
): Promise<"added" | "number_in_use"> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, city, mobile_e164, updated_at, hand_written)
         SELECT ?1, ?1, ?3, ?4, 1, ?5, ?7, ?2, ?6, 1 WHERE NOT ${NUMBER_TAKEN}`,
      )
      .bind(
        technician.id,
        technician.mobileE164,
        technician.name,
        initialsOf(technician.name),
        technician.zone,
        now.toISOString(),
        technician.city,
      ),
    auditStatementIfWritten(db, audit, now, { table: "technicians", id: technician.id }),
  ]);
  const added = await db.prepare("SELECT 1 FROM technicians WHERE id = ?1").bind(technician.id).first();
  return added === null ? "number_in_use" : "added";
}

/** What ops change of a technician; a field left out is kept. */
interface TechnicianChange {
  readonly name?: string;
  readonly mobileE164?: string;
  readonly zone?: string | null;
  readonly city?: string | null;
}

/** Changes what was sent, unless the new number is another active technician's. */
export async function changeTechnician({
  db,
  current,
  change,
  audit,
  now,
}: {
  db: D1Database;
  current: RosterTechnician;
  change: TechnicianChange;
  audit: AuditEntry;
  now: Date;
}): Promise<"changed" | "number_in_use"> {
  const name = change.name ?? current.name;
  const mobile = change.mobileE164 ?? current.mobile;
  const zone = change.zone === undefined ? current.zone : change.zone;
  const city = change.city === undefined ? current.city : change.city;
  if (mobile !== null && (await numberTaken(db, current.id, mobile))) return "number_in_use";
  await db.batch([
    db
      .prepare(
        `UPDATE technicians SET name = ?2, initials = ?3, mobile_e164 = ?4, zone = ?5, city = ?6, updated_at = ?7
         WHERE id = ?1`,
      )
      .bind(current.id, name, initialsOf(name), mobile, zone, city, now.toISOString()),
    auditStatement(db, audit, now),
  ]);
  return "changed";
}

async function numberTaken(db: D1Database, technicianId: string, mobileE164: string): Promise<boolean> {
  const taken = await db
    .prepare(`SELECT ${NUMBER_TAKEN} AS taken`)
    .bind(technicianId, mobileE164)
    .first<number>("taken");
  return taken === 1;
}

/** A visit a technician switched off no longer holds, as the console lists it. */
interface ReturnedVisit {
  readonly appointment_id: string;
  readonly starts_at: string;
  readonly type: VisitType | null;
  /** The client's name; null for a visit with no client on our records. */
  readonly client: string | null;
}

/** Their visits still to come: live, not begun, and starting from now. A visit already under way stays theirs. */
const STILL_TO_COME = `a.technician_id = ?1 AND a.deleted_at IS NULL AND ${statusIn("a.status", VISIT_NOT_BEGUN)}
  AND a.window_start >= ?2 AND NOT ${visitBegun("a")}`;

/**
 * Switches an active technician off: their sessions end, and their visits still to come are given back unassigned,
 * all in one batch with the audit entry. Answers the visits given back, soonest first.
 */
export async function deactivateTechnician(
  db: D1Database,
  technicianId: string,
  audit: AuditEntry,
  now: Date,
): Promise<ReturnedVisit[]> {
  const at = now.toISOString();
  const { results: visits } = await db
    .prepare(
      `SELECT a.id AS appointment_id, a.window_start AS starts_at, a.type, p.name AS client
       FROM appointments a LEFT JOIN people p ON p.id = a.person_id AND p.erased_at IS NULL
       WHERE ${STILL_TO_COME} ORDER BY a.window_start`,
    )
    .bind(technicianId, at)
    .all<ReturnedVisit>();
  const visitIds = JSON.stringify(visits.map((visit) => visit.appointment_id));

  await db.batch([
    db.prepare("UPDATE technicians SET active = 0, updated_at = ?2 WHERE id = ?1").bind(technicianId, at),
    db
      .prepare(
        `UPDATE sessions SET revoked_at = ?2
         WHERE subject_kind = 'technician' AND subject_id = ?1 AND revoked_at IS NULL`,
      )
      .bind(technicianId, at),
    db
      .prepare(
        `UPDATE appointments AS a SET technician_id = NULL
         WHERE a.id IN (SELECT value FROM json_each(?3)) AND ${STILL_TO_COME}`,
      )
      .bind(technicianId, at, visitIds),
    auditStatement(db, { ...audit, detail: { visits_unassigned: visits.length } }, now),
  ]);
  return visits;
}

/** Switches a technician back on, unless another active technician has their number meanwhile. */
export async function reactivateTechnician(
  db: D1Database,
  technician: RosterTechnician,
  audit: AuditEntry,
  now: Date,
): Promise<"reactivated" | "number_in_use"> {
  if (technician.mobile !== null && (await numberTaken(db, technician.id, technician.mobile))) return "number_in_use";
  await db.batch([
    db
      .prepare("UPDATE technicians SET active = 1, updated_at = ?2 WHERE id = ?1")
      .bind(technician.id, now.toISOString()),
    auditStatement(db, audit, now),
  ]);
  return "reactivated";
}

/** Whether anything records work of theirs: a visit, a hold, a step, a check-in, a move, a claim, stock or a profile. */
const HAS_WORK = `(EXISTS (SELECT 1 FROM appointments WHERE technician_id = ?1)
  OR EXISTS (SELECT 1 FROM slot_holds WHERE technician_id = ?1)
  OR EXISTS (SELECT 1 FROM job_events WHERE technician_id = ?1)
  OR EXISTS (SELECT 1 FROM checkins WHERE technician_id = ?1)
  OR EXISTS (SELECT 1 FROM dispatch_moves WHERE was_technician_id = ?1 OR now_technician_id = ?1)
  OR EXISTS (SELECT 1 FROM slot_claims WHERE technician_id = ?1)
  OR EXISTS (SELECT 1 FROM stock_movements WHERE technician_id = ?1)
  OR EXISTS (SELECT 1 FROM hair_profiles WHERE technician_id = ?1))`;

/**
 * Deletes a technician nothing records any work of, with what is theirs alone, all in one batch with the audit entry.
 * Every statement asks the same question, so a technician who has worked keeps everything.
 */
export async function deleteTechnician(
  db: D1Database,
  technicianId: string,
  audit: AuditEntry,
  now: Date,
): Promise<"deleted" | "has_work"> {
  const theirs = (statement: string) => db.prepare(`${statement} AND NOT ${HAS_WORK}`).bind(technicianId);
  try {
    await db.batch([
      theirs("DELETE FROM technician_leave WHERE technician_id = ?1"),
      theirs("DELETE FROM technician_devices WHERE technician_id = ?1"),
      theirs("DELETE FROM otp_challenges WHERE technician_id = ?1"),
      theirs("DELETE FROM sessions WHERE subject_kind = 'technician' AND subject_id = ?1"),
      theirs("DELETE FROM technicians WHERE id = ?1"),
      auditStatementIfDeleted(db, audit, now, { table: "technicians", key: "id", value: technicianId }),
    ]);
  } catch (error) {
    // A row the question missed still names them; the foreign key refuses the whole batch, and nothing changes.
    if (String(error).includes("FOREIGN KEY")) return "has_work";
    throw error;
  }
  const kept = await db.prepare("SELECT 1 FROM technicians WHERE id = ?1").bind(technicianId).first();
  return kept === null ? "deleted" : "has_work";
}
