// Arriving at a job (docs/prompts/phase2-backend.md, "Technician and dispatch rules, from the designs").
//
// The address's coordinates come from the geocoder, Google where one is connected
// (docs/decisions/0054-address-capture.md). Until an address has them there is
// nothing to measure against, and src/domain/check-ins.ts, not this module,
// decides what to do then.

/**
 * How close to the address a check-in must be. A placeholder until the owner
 * rules it (docs/open-points.md, item 56): the design's own open question,
 * given GPS error in Gurgaon high-rises. Every check-in records the distance it
 * measured and the radius in force, which is what the owner tunes it from.
 */
export const CHECKIN_RADIUS_M = 200;

/** Where the phone or the address is, in degrees. */
export interface Point {
  readonly lat: number;
  readonly lng: number;
}

const EARTH_RADIUS_M = 6_371_000;
const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Whole metres between two points, over the earth's surface. A sphere is close
 * enough: the distances here are hundreds of metres, and the phone's own fix is
 * the larger error.
 */
export function distanceMetres(from: Point, to: Point): number {
  const fromLat = radians(from.lat);
  const toLat = radians(to.lat);
  const half =
    Math.sin((toLat - fromLat) / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(radians(to.lng - from.lng) / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(half))));
}

interface CheckIn {
  readonly distanceM: number;
  readonly radiusM: number;
  readonly passed: boolean;
}

/**
 * Whether an arrival is inside the geofence. The distance comes back whether it
 * passed or not, because every check-in logs it.
 */
export function checkIn(device: Point, address: Point, radiusM: number = CHECKIN_RADIUS_M): CheckIn {
  const distanceM = distanceMetres(device, address);
  return { distanceM, radiusM, passed: distanceM <= radiusM };
}
