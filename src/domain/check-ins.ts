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
// A check-in keeps three times (docs/decisions/0065-a-technicians-writes-reach-fsm.md):
// `at`, the phone's time held within bounds, which the no-show wait runs from;
// `claimed_at`, what the phone said; and `created_at`, when we received it.

import { checkIn, type Point } from "../policy/check-in.ts";

export interface Arrival {
  readonly id: string;
  /** Null when the address has no coordinates, so nothing could be measured. */
  readonly distanceM: number | null;
  readonly radiusM: number;
  readonly passed: boolean;
  readonly at: string;
}

export interface ArrivalInput {
  readonly appointmentId: string;
  readonly technicianId: string;
  readonly personId: string | null;
  readonly device: Point;
  readonly accuracyM: number | null;
  /** The phone's time, within bounds (src/policy/phone-clock.ts). */
  readonly at: Date;
  /** What the phone said, before the bounds; null when it said nothing. */
  readonly claimedAt: Date | null;
  readonly now: Date;
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

/** Measures the arrival and records it. The distance is logged either way. */
export async function recordArrival(db: D1Database, input: ArrivalInput): Promise<Arrival> {
  const address = await visitAddress(db, input.personId);
  const point = address?.point ?? null;
  const measured = point === null ? null : checkIn(input.device, point, input.radiusM);
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO checkins (id, appointment_id, technician_id, address_id, at, claimed_at, lat, lng, accuracy_m,
         distance_m, radius_m, passed, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    )
    .bind(
      id,
      input.appointmentId,
      input.technicianId,
      measured === null ? null : (address?.id ?? null),
      input.at.toISOString(),
      input.claimedAt?.toISOString() ?? null,
      input.device.lat,
      input.device.lng,
      input.accuracyM,
      measured?.distanceM ?? null,
      input.radiusM,
      measured === null || measured.passed ? 1 : 0,
      input.now.toISOString(),
    )
    .run();
  return {
    id,
    distanceM: measured?.distanceM ?? null,
    radiusM: input.radiusM,
    passed: measured === null || measured.passed,
    at: input.at.toISOString(),
  };
}

/** The check-in a no-show's wait runs from, with both its times and what it measured. */
export interface LatestArrival {
  readonly id: string;
  readonly at: Date;
  readonly receivedAt: Date;
  /** Null when nothing was measured. */
  readonly distanceM: number | null;
}

/** The check-in the wait ran from: the latest one of this job that passed. */
export async function latestArrival(db: D1Database, appointmentId: string): Promise<LatestArrival | null> {
  const row = await db
    .prepare(
      `SELECT id, at, created_at, distance_m FROM checkins WHERE appointment_id = ?1 AND passed = 1
       ORDER BY at DESC, created_at DESC LIMIT 1`,
    )
    .bind(appointmentId)
    .first<{ id: string; at: string; created_at: string; distance_m: number | null }>();
  if (row === null) return null;
  return { id: row.id, at: new Date(row.at), receivedAt: new Date(row.created_at), distanceM: row.distance_m };
}
