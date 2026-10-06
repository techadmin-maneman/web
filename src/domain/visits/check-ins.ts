// "I have arrived" (src/policy/check-in.ts).
//
// Every check-in is recorded, whether it passed the geofence or not, with the
// distance measured and the radius in force, "so the value can be tuned from
// real data" (docs/open-points.md, item 56). Only a check-in that passed starts
// the job: the technician who is too far away moves closer and tries again.
//
// The address's coordinates come from the client's chosen building
// (docs/decisions/0054-address-capture.md). An address without them cannot be
// measured against, so the check-in is accepted with no distance: the row
// names no address and holds no distance.
//
// Where the address's pin is wrong, a building's pin far from its door, ops may let the technician check in to that
// one visit wherever he is (waiveCheckIn). The distance is still measured and kept, and a check-in that passed only
// by the waiver names who gave it, as the no-show's evidence shows.
//
// A check-in keeps three times (docs/decisions/0065-a-technicians-writes-reach-fsm.md):
// `at`, the phone's time held within bounds, which the no-show wait runs from;
// `claimed_at`, what the phone said; and `created_at`, when we received it.
//
// A check-in that passed is written with the job event it lands as, and names it: once however often the phone sends
// it, and never for an event that did not land.

import { checkIn, type Point } from "../../policy/check-in.ts";
import { auditStatement, type AuditEntry } from "../ops/audit.ts";

/** How far the phone was from the visit's address, and whether that is near enough. */
export interface Measured {
  /** The address measured against; null when it had no coordinates, so nothing could be measured. */
  readonly addressId: string | null;
  readonly distanceM: number | null;
  readonly radiusM: number;
  readonly passed: boolean;
  /** Who let him in, where the check-in passed only because ops waived the geofence for the visit; else null. */
  readonly waivedBy: string | null;
}

export interface ArrivalInput {
  readonly appointmentId: string;
  readonly technicianId: string;
  readonly device: Point;
  readonly accuracyM: number | null;
  /** The phone's time, within bounds (src/policy/phone-clock.ts). */
  readonly at: Date;
  /** What the phone said, before the bounds; null when it said nothing. */
  readonly claimedAt: Date | null;
  readonly now: Date;
  readonly measured: Measured;
}

/** A check-in that passed, as recorded: what it measured, and the times a no-show's wait runs from. */
export interface LatestArrival {
  readonly id: string;
  readonly at: Date;
  readonly receivedAt: Date;
  /** Null when nothing was measured. */
  readonly distanceM: number | null;
  readonly radiusM: number;
}

/** The address a visit goes to, with the coordinates to measure against. */
export async function visitAddress(
  db: D1Database,
  personId: string | null,
): Promise<{ id: string; point: Point | null } | null> {
  if (personId === null) return null;
  const row = await db
    .prepare(
      `SELECT id, lat, lng FROM addresses WHERE person_id = ?1 AND replaced_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(personId)
    .first<{ id: string; lat: number | null; lng: number | null }>();
  if (row === null) return null;
  return { id: row.id, point: row.lat === null || row.lng === null ? null : { lat: row.lat, lng: row.lng } };
}

/** Measures the phone's position against the visit's address, and ops' waiver of the geofence. Nothing is written. */
export async function measureArrival(
  db: D1Database,
  input: { appointmentId: string; personId: string | null; device: Point; radiusM: number },
): Promise<Measured> {
  const address = await visitAddress(db, input.personId);
  const point = address?.point ?? null;
  if (address === null || point === null) {
    return { addressId: null, distanceM: null, radiusM: input.radiusM, passed: true, waivedBy: null };
  }
  const measured = checkIn(input.device, point, input.radiusM);
  const waivedBy = measured.passed ? null : await waiverOf(db, input.appointmentId);
  return {
    addressId: address.id,
    distanceM: measured.distanceM,
    radiusM: input.radiusM,
    passed: measured.passed || waivedBy !== null,
    waivedBy,
  };
}

/** Who waived the geofence for the visit; null while nobody has. */
async function waiverOf(db: D1Database, appointmentId: string): Promise<string | null> {
  return db
    .prepare("SELECT checkin_waived_by FROM appointments WHERE id = ?1 AND checkin_waived_at IS NOT NULL")
    .bind(appointmentId)
    .first<string>("checkin_waived_by");
}

/**
 * Ops let the technician check in to the visit wherever he is, with their reason, while it is still to be checked in
 * to. Audited in the same batch. False when the visit is not one he can still check in to.
 */
export async function waiveCheckIn(
  db: D1Database,
  input: { appointmentId: string; by: string; reason: string; audit: AuditEntry; now: Date },
): Promise<boolean> {
  const open = await db
    .prepare("SELECT 1 FROM appointments WHERE id = ?1 AND status = 'scheduled' AND deleted_at IS NULL")
    .bind(input.appointmentId)
    .first();
  if (open === null) return false;
  await db.batch([
    db
      .prepare(
        `UPDATE appointments SET checkin_waived_at = ?2, checkin_waived_by = ?3, checkin_waived_reason = ?4
         WHERE id = ?1`,
      )
      .bind(input.appointmentId, input.now.toISOString(), input.by, input.reason),
    auditStatement(db, input.audit, input.now),
  ]);
  return true;
}

const CHECKIN_COLUMNS = `id, appointment_id, technician_id, job_event_id, address_id, at, claimed_at, lat, lng,
  accuracy_m, distance_m, radius_m, passed, created_at, waived_by`;

/** Records a check-in that failed the geofence. It lands no event and starts nothing. */
export async function recordFailedArrival(db: D1Database, input: ArrivalInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO checkins (${CHECKIN_COLUMNS})
       VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, ?12, ?13)`,
    )
    .bind(crypto.randomUUID(), ...arrivalValues(input))
    .run();
}

/**
 * The row of a check-in that passed, for its job event's own batch: it names the event the phone sent, and is written
 * only where that event landed and only once for it.
 */
export function passedArrivalStatement(db: D1Database, input: ArrivalInput, eventId: string): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO checkins (${CHECKIN_COLUMNS})
       SELECT ?1, ?2, ?3, e.id, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, ?12, ?13
       FROM job_events e WHERE e.appointment_id = ?2 AND e.event_id = ?14 AND e.superseded = 0
       ON CONFLICT DO NOTHING`,
    )
    .bind(crypto.randomUUID(), ...arrivalValues(input), eventId);
}

/** The values ?2 to ?13 of a check-in's row. */
function arrivalValues(input: ArrivalInput): (string | number | null)[] {
  return [
    input.appointmentId,
    input.technicianId,
    input.measured.addressId,
    input.at.toISOString(),
    input.claimedAt?.toISOString() ?? null,
    input.device.lat,
    input.device.lng,
    input.accuracyM,
    input.measured.distanceM,
    input.measured.radiusM,
    input.now.toISOString(),
    input.measured.waivedBy,
  ];
}

interface ArrivalRow {
  id: string;
  at: string;
  created_at: string;
  distance_m: number | null;
  radius_m: number;
}

function arrivalOf(row: ArrivalRow): LatestArrival {
  return {
    id: row.id,
    at: new Date(row.at),
    receivedAt: new Date(row.created_at),
    distanceM: row.distance_m,
    radiusM: row.radius_m,
  };
}

/** The check-in a job event landed as; null for any other event. */
export async function arrivalOfEvent(db: D1Database, jobEventId: string): Promise<LatestArrival | null> {
  const row = await db
    .prepare("SELECT id, at, created_at, distance_m, radius_m FROM checkins WHERE job_event_id = ?1")
    .bind(jobEventId)
    .first<ArrivalRow>();
  return row === null ? null : arrivalOf(row);
}

/**
 * The check-in a no-show's wait runs from: the latest that passed, by the job's technician, of an event still
 * standing. A move that clears a check-in supersedes its event, and a check-in by the technician the job was taken
 * from is not his successor's.
 */
export async function latestArrival(
  db: D1Database,
  job: { id: string; technicianId: string },
): Promise<LatestArrival | null> {
  const row = await db
    .prepare(
      `SELECT c.id, c.at, c.created_at, c.distance_m, c.radius_m FROM checkins c
       JOIN job_events e ON e.id = c.job_event_id
       WHERE c.appointment_id = ?1 AND c.technician_id = ?2 AND c.passed = 1 AND e.superseded = 0
       ORDER BY c.at DESC, c.created_at DESC LIMIT 1`,
    )
    .bind(job.id, job.technicianId)
    .first<ArrivalRow>();
  return row === null ? null : arrivalOf(row);
}
