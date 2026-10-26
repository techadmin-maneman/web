// How far a technician goes from home (docs/decisions/0223-reach-from-home.md): minutes of driving by the estimate
// booking plans with (./drive-estimate.ts), at an hour off the rush, so a reach is one figure all day. A technician's
// own, where ops set one; else the ops setting's. Booking offers a start only to those whose reach takes in the
// address, and the Areas map draws each reach as the circle it covers.

import type { Pin } from "../lib/geo.ts";
import { driveMinutes, type DriveEstimate } from "./drive-estimate.ts";

/** Forty-five minutes from home, until ops set the business's own figure or a technician's. */
export const TECHNICIAN_REACH_MIN = 45;

/** The hour a reach is measured at: early afternoon, between the two rushes. */
const OFF_THE_RUSH = 13;

/** The drive from a technician's home to a pin, as a reach measures it. */
export const reachMinutes = (home: Pin, to: Pin, estimate: DriveEstimate): number =>
  driveMinutes(home, to, OFF_THE_RUSH, estimate);

/** Whether a pin is within a reach; a home or a pin not known leaves it to the city, as before reaches. */
export function withinReach(input: {
  readonly home: Pin | null;
  readonly to: Pin | null;
  readonly reach: number;
  readonly estimate: DriveEstimate;
}): boolean {
  if (input.home === null || input.to === null) return true;
  return reachMinutes(input.home, input.to, input.estimate) <= input.reach;
}

/** The straight-line kilometres a reach covers, for the circle the map draws: the estimate run backwards. */
export function reachKm(reach: number, estimate: DriveEstimate): number {
  const driving = Math.max(0, reach - estimate.parking);
  return ((driving / 60) * estimate.offpeak_kmh * 100) / estimate.road_factor;
}
