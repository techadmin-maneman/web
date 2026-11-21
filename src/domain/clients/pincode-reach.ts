// A city's reach (docs/decisions/0223-reach-from-home.md, 0289): its active technicians, each with their home, their
// radius and the overflow ring past it, and its pincodes, each with the nearest of them in a straight line and whether
// any ring takes it in, so that a start can be offered there. What Areas draws as the city's map and lists as the
// pincodes out of reach.

import { ALERT_WORDS } from "../../config/alert-words.ts";
import type { Pin } from "../../lib/geo.ts";
import type { AlertOnce, ResolveAlert } from "../platform/alerts.ts";
import { kmBetween } from "../../lib/geo.ts";
import type { Allotment } from "../../policy/allotment.ts";
import { ringKm } from "../../policy/reach.ts";

export interface ReachTechnician {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
  readonly home: Pin | null;
  /** Their own radius in km, or the business's: the circle the map draws. */
  readonly radius_km: number;
  /** How far past it they still go, when nobody nearer can. */
  readonly ring_km: number;
}

export interface ReachPincode {
  readonly pincode: string;
  readonly area: string;
  readonly served: boolean;
  readonly paused_until: string | null;
  readonly centre: Pin | null;
  /** The nearest technician, with the km; null with no centre or no home to measure from. */
  readonly nearest: { readonly technician_id: string; readonly km: number } | null;
  /** Whether any technician's ring takes it in; null where nothing could be measured. */
  readonly reached: boolean | null;
  /** The technicians whose radius takes it in. */
  readonly reached_by: string[];
}

const pinOf = (lat: number | null, lng: number | null): Pin | null =>
  lat === null || lng === null ? null : { lat, lng };

export async function cityReach(
  db: D1Database,
  city: string,
  inputs: { readonly technicianRadiusKm: number; readonly allotment: Allotment },
): Promise<{ technicians: ReachTechnician[]; pincodes: ReachPincode[] }> {
  const [technicianRows, pincodeRows] = await Promise.all([
    db
      .prepare(
        `SELECT id, name, initials, home_lat, home_lng, radius_km FROM technicians
         WHERE active = 1 AND city = ?1 ORDER BY name COLLATE NOCASE`,
      )
      .bind(city)
      .all<{
        id: string;
        name: string;
        initials: string;
        home_lat: number | null;
        home_lng: number | null;
        radius_km: number | null;
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
  const technicians = technicianRows.results.map((row): ReachTechnician => {
    const radius = row.radius_km ?? inputs.technicianRadiusKm;
    return {
      id: row.id,
      name: row.name,
      initials: row.initials,
      home: pinOf(row.home_lat, row.home_lng),
      radius_km: radius,
      ring_km: Math.round(ringKm(radius, inputs.allotment.overflow) * 10) / 10,
    };
  });
  const pincodes = pincodeRows.results.map((row): ReachPincode => {
    const centre = pinOf(row.centre_lat, row.centre_lng);
    const measured = technicians.flatMap((technician) =>
      centre === null || technician.home === null ? [] : [{ technician, km: kmBetween(technician.home, centre) }],
    );
    const nearest = measured.toSorted((a, b) => a.km - b.km)[0];
    return {
      pincode: row.pincode,
      area: row.area,
      served: row.served === 1,
      paused_until: row.paused_until,
      centre,
      nearest:
        nearest === undefined ? null : { technician_id: nearest.technician.id, km: Math.round(nearest.km * 10) / 10 },
      reached: measured.length === 0 ? null : measured.some((each) => each.km <= each.technician.ring_km),
      reached_by: measured.filter((each) => each.km <= each.technician.radius_km).map((each) => each.technician.id),
    };
  });
  return { technicians, pincodes };
}

const UNREACHED = "pincodes_unreached:";

/**
 * Ops told once a day of each city with served pincodes no technician's reach takes in, where clients there are
 * offered no start (ADR 0224); the alert closes itself once every one is reached again or no longer served.
 */
export async function tellOfUnreachedPincodes(
  db: D1Database,
  deps: { readonly alertOnce: AlertOnce; readonly resolveAlert: ResolveAlert },
  inputs: { readonly technicianRadiusKm: number; readonly allotment: Allotment },
): Promise<void> {
  const { results: cities } = await db
    .prepare("SELECT DISTINCT city FROM serviceable_pincodes WHERE served = 1")
    .all<{ city: string }>();
  const still = new Set<string>();
  for (const { city } of cities) {
    const reach = await cityReach(db, city, inputs);
    const pincodes = reach.pincodes.filter((each) => each.served && each.reached === false).length;
    if (pincodes === 0) continue;
    still.add(`${UNREACHED}${city}`);
    await deps.alertOnce({
      key: `${UNREACHED}${city}`,
      message: ALERT_WORDS.pincodes_unreached({ city, pincodes }),
      link: "/settings/areas",
    });
  }
  const { results: open } = await db
    .prepare("SELECT key FROM alerts WHERE resolved_at IS NULL AND key >= ?1 AND key < ?2")
    .bind(UNREACHED, `${UNREACHED.slice(0, -1)};`)
    .all<{ key: string }>();
  for (const { key } of open) if (!still.has(key)) await deps.resolveAlert(key);
}
