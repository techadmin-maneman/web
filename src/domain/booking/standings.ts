// Where a visit is, and where it stands for each technician who may take it (docs/decisions/0289-who-takes-a-visit.md):
// inside their radius, in the overflow ring past it, or beyond both. Booking (./start-offers.ts), the re-plan
// (./replan-day.ts) and the room booking makes (./make-room.ts) read it alike.

import type { Pin } from "../../lib/geo.ts";
import { standingOf, type Standing } from "../../policy/reach.ts";
import type { OpsInputs } from "../platform/ops-settings.ts";
import type { Technician } from "./occupancy.ts";

/** The pincode a visit is at: the one it is booked at, else its client's current address's. */
const pincodeOf = (person: string, pincode: string) =>
  `COALESCE(${pincode}, (SELECT d.pincode FROM addresses d WHERE d.person_id = ${person} AND d.replaced_at IS NULL))`;

/**
 * Where a visit is, as two columns, `lat` and `lng`, of a query that names its client's ID and its booked pincode: its
 * client's current pin, else the centre of the pincode it is booked at or the client's.
 */
export const pinColumns = (person: string, pincode: string): string => `COALESCE(
    (SELECT d.lat FROM addresses d WHERE d.person_id = ${person} AND d.replaced_at IS NULL AND d.lng IS NOT NULL),
    (SELECT sp.centre_lat FROM serviceable_pincodes sp WHERE sp.pincode = ${pincodeOf(person, pincode)})) AS lat,
  COALESCE(
    (SELECT d.lng FROM addresses d WHERE d.person_id = ${person} AND d.replaced_at IS NULL AND d.lat IS NOT NULL),
    (SELECT sp.centre_lng FROM serviceable_pincodes sp WHERE sp.pincode = ${pincodeOf(person, pincode)})) AS lng`;

/** Where the visit sits for a technician, and whether their home is known to measure it from. */
export interface Placing {
  readonly standing: Standing;
  readonly homeKnown: boolean;
}

export interface Radius {
  readonly id: string;
  readonly home_lat: number | null;
  readonly home_lng: number | null;
  readonly radius_km: number | null;
}

/**
 * Where the visit's pin sits for each technician who may take it, inside their radius or in the overflow ring past it,
 * those beyond both left out. A move's own technician, `keeping`, may keep it wherever they are; anyone else is
 * measured as for a new booking.
 */
export function standings(
  technicians: readonly Technician[],
  rows: ReadonlyMap<string, Radius>,
  at: { readonly pin: Pin | null; readonly keeping: string | null; readonly inputs: OpsInputs },
): Map<string, Placing> {
  const placed = new Map<string, Placing>();
  for (const technician of technicians) {
    if (technician.id === at.keeping) {
      placed.set(technician.id, { standing: "inside", homeKnown: true });
      continue;
    }
    const row = rows.get(technician.id);
    const lat = row?.home_lat ?? null;
    const lng = row?.home_lng ?? null;
    const home = lat === null || lng === null ? null : { lat, lng };
    const standing = standingOf({
      home,
      to: at.pin,
      radiusKm: row?.radius_km ?? at.inputs.technicianRadiusKm,
      overflow: at.inputs.allotment.overflow,
    });
    if (standing !== "beyond") placed.set(technician.id, { standing, homeKnown: home !== null });
  }
  return placed;
}
