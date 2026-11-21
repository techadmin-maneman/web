// How far a technician goes from home (docs/decisions/0289-who-takes-a-visit.md): a radius in straight-line km, their
// own where ops set one, else the business's, and past it an overflow ring they reach only when nobody nearer can
// take the visit. A technician with no home pin stands in the ring wherever the visit is, so a city whose pins are not
// set yet still books; booking puts them after everyone whose home is known (src/domain/booking/start-offers.ts).

import { kmBetween, type Pin } from "../lib/geo.ts";

/** Ten kilometres from home, until ops set the business's own figure or a technician's. */
export const TECHNICIAN_RADIUS_KM = 10;

/** Where a visit's pin sits for a technician: inside their radius, in the overflow ring past it, or beyond both. */
export type Standing = "inside" | "overflow" | "beyond";

/** The ring's outer edge, in km: the radius stretched by the overflow, a percentage of it. */
export const ringKm = (radiusKm: number, overflow: number): number => (radiusKm * overflow) / 100;

export function standingOf(input: {
  readonly home: Pin | null;
  readonly to: Pin | null;
  readonly radiusKm: number;
  /** The ring's edge as a percentage of the radius: 150 is half as far again. */
  readonly overflow: number;
}): Standing {
  if (input.home === null) return "overflow";
  // A visit with no pin to measure is left to the city, as before radii.
  if (input.to === null) return "inside";
  const km = kmBetween(input.home, input.to);
  if (km <= input.radiusKm) return "inside";
  return km <= ringKm(input.radiusKm, input.overflow) ? "overflow" : "beyond";
}
