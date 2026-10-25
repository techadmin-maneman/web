// A city's reach (docs/decisions/0223-reach-from-home.md): its active technicians, each with their home and how far
// they go from it, and its pincodes, each with the nearest of them by the drive estimate and whether any reaches it.
// What Areas draws as the city's map and lists as the pincodes out of reach.

import type { Pin } from "../../lib/geo.ts";
import type { DriveEstimate } from "../../policy/drive-estimate.ts";
import { reachKm, reachMinutes } from "../../policy/reach.ts";

export interface ReachTechnician {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
  readonly home: Pin | null;
  /** Their own reach, or the business's. */
  readonly reach_min: number;
  /** The straight-line kilometres that reach covers, for the circle the map draws. */
  readonly reach_km: number;
}

export interface ReachPincode {
  readonly pincode: string;
  readonly area: string;
  readonly served: boolean;
  readonly paused_until: string | null;
  readonly centre: Pin | null;
  /** The nearest technician by the estimate, with the minutes; null with no centre or no home to measure from. */
  readonly nearest: { readonly technician_id: string; readonly minutes: number } | null;
  /** Whether any technician's reach takes it in; null where nothing could be measured. */
  readonly reached: boolean | null;
  /** The technicians whose reach takes it in. */
  readonly reached_by: string[];
}

const pinOf = (lat: number | null, lng: number | null): Pin | null =>
  lat === null || lng === null ? null : { lat, lng };

export async function cityReach(
  db: D1Database,
  city: string,
  inputs: { readonly technicianReachMin: number; readonly driveEstimate: DriveEstimate },
): Promise<{ technicians: ReachTechnician[]; pincodes: ReachPincode[] }> {
  const [technicianRows, pincodeRows] = await Promise.all([
    db
      .prepare(
        `SELECT id, name, initials, home_lat, home_lng, reach_min FROM technicians
         WHERE active = 1 AND city = ?1 ORDER BY name COLLATE NOCASE`,
      )
      .bind(city)
      .all<{
        id: string;
        name: string;
        initials: string;
        home_lat: number | null;
        home_lng: number | null;
        reach_min: number | null;
      }>(),
    db
      .prepare(
        `SELECT pincode, area, served, paused_until, centre_lat, centre_lng FROM serviceable_pincodes
         WHERE city = ?1 ORDER BY pincode`,
      )
      .bind(city)
      .all<{
        pincode: string;
        area: string;
        served: number;
        paused_until: string | null;
        centre_lat: number | null;
        centre_lng: number | null;
      }>(),
  ]);
  const estimate = inputs.driveEstimate;
  const technicians = technicianRows.results.map((row): ReachTechnician => {
    const reach = row.reach_min ?? inputs.technicianReachMin;
    return {
      id: row.id,
      name: row.name,
      initials: row.initials,
      home: pinOf(row.home_lat, row.home_lng),
      reach_min: reach,
      reach_km: Math.round(reachKm(reach, estimate) * 10) / 10,
    };
  });
  const pincodes = pincodeRows.results.map((row): ReachPincode => {
    const centre = pinOf(row.centre_lat, row.centre_lng);
    const measured = technicians.flatMap((technician) =>
      centre === null || technician.home === null
        ? []
        : [{ technician, minutes: reachMinutes(technician.home, centre, estimate) }],
    );
    const nearest = measured.toSorted((a, b) => a.minutes - b.minutes)[0];
    return {
      pincode: row.pincode,
      area: row.area,
      served: row.served === 1,
      paused_until: row.paused_until,
      centre,
      nearest: nearest === undefined ? null : { technician_id: nearest.technician.id, minutes: nearest.minutes },
      reached: measured.length === 0 ? null : measured.some((each) => each.minutes <= each.technician.reach_min),
      reached_by: measured
        .filter((each) => each.minutes <= each.technician.reach_min)
        .map((each) => each.technician.id),
    };
  });
  return { technicians, pincodes };
}
