// How long a drive between two pins takes, estimated without a call (docs/decisions/0210-booking-by-start-time.md): the
// straight line, lengthened by the road factor, at the city's speed for the hour the drive sets off in, plus the time
// to park and reach the door, and never less than the least drive. Booking estimates every start it offers this way;
// Google checks the drives of the one a client chooses, where the routes provider is on.

import { kmBetween, type Pin } from "../lib/geo.ts";

export const DRIVE_ESTIMATE_KEYS = [
  "road_factor",
  "peak_kmh",
  "offpeak_kmh",
  "parking",
  "least",
  "morning_from",
  "morning_to",
  "evening_from",
  "evening_to",
] as const;
export type DriveEstimate = Readonly<Record<(typeof DRIVE_ESTIMATE_KEYS)[number], number>>;

/**
 * Roads 40% longer than the straight line; 18 km/h from 8 to 11 am and 5 to 9 pm, 24 km/h otherwise; ten minutes to
 * park and reach the door; ten minutes at the least.
 */
export const DRIVE_ESTIMATE: DriveEstimate = {
  road_factor: 140,
  peak_kmh: 18,
  offpeak_kmh: 24,
  parking: 10,
  least: 10,
  morning_from: 8,
  morning_to: 11,
  evening_from: 17,
  evening_to: 21,
};

export function driveEstimateConflicts(estimate: DriveEstimate): (readonly [string, string])[] {
  const conflicts: (readonly [string, string])[] = [];
  if (estimate.morning_to <= estimate.morning_from) conflicts.push(["morning_to", "morning_from"]);
  if (estimate.evening_from < estimate.morning_to) conflicts.push(["evening_from", "morning_to"]);
  if (estimate.evening_to <= estimate.evening_from) conflicts.push(["evening_to", "evening_from"]);
  return conflicts;
}

/** Whether a drive setting off in this hour of the day, in India, meets the rush. */
const inThePeak = (hour: number, estimate: DriveEstimate): boolean =>
  (hour >= estimate.morning_from && hour < estimate.morning_to) ||
  (hour >= estimate.evening_from && hour < estimate.evening_to);

/** The minutes a drive from one pin to another takes, setting off in `hour` (0 to 23, India's clock). */
export function driveMinutes(from: Pin, to: Pin, hour: number, estimate: DriveEstimate = DRIVE_ESTIMATE): number {
  const km = (kmBetween(from, to) * estimate.road_factor) / 100;
  const speed = inThePeak(hour, estimate) ? estimate.peak_kmh : estimate.offpeak_kmh;
  return Math.max(estimate.least, Math.ceil((km / speed) * 60 + estimate.parking));
}
