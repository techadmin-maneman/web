// A technician's day in minutes, and where a visit can start in it (docs/decisions/0210-booking-by-start-time.md).
//
// A day runs from when the technician opens to when they close, India's clock, in minutes from midnight. Already on
// it are its stops: visits booked and holds keeping their time, each from its start to the end of its service, and
// where it is. A visit can start where it fits whole inside the day, clear of leave, with its wrap-up after it, and
// with the drive to it from the stop before, or from home for the day's first, and the drive from it to the stop
// after. The day must still have room for its break, and stay inside its caps on visits and fits. A stop or a visit
// with no pin is reached in the shortest drive.

import type { Pin } from "../lib/geo.ts";
import { driveMinutes, type DriveEstimate } from "./drive-estimate.ts";
import type { BookingRules } from "./start-times.ts";

/** Something already on the day, from its start to the end of its service, in minutes from midnight. */
export interface Stop {
  readonly start: number;
  readonly end: number;
  readonly pin: Pin | null;
  /** A first fit or a replacement, which the fits cap counts. */
  readonly fit: boolean;
}

export interface PlanDay {
  readonly opens: number;
  readonly closes: number;
  /** Where the day starts; null where ops have not set it, and the first visit's drive is not counted. */
  readonly home: Pin | null;
  readonly stops: readonly Stop[];
  /** Leave over part of the day. */
  readonly away: readonly { readonly from: number; readonly to: number }[];
}

export interface VisitToPlan {
  readonly minutes: number;
  readonly pin: Pin | null;
  readonly fit: boolean;
}

export interface PlanRules {
  readonly booking: BookingRules;
  readonly drive: DriveEstimate;
}

/** Where a visit can start, and the driving it adds to the day, in minutes. */
export interface Placed {
  readonly start: number;
  readonly addedDrive: number;
}

const drive = (from: Pin | null, to: Pin | null, setsOff: number, estimate: DriveEstimate): number =>
  from === null || to === null ? estimate.least : driveMinutes(from, to, Math.floor(setsOff / 60) % 24, estimate);

/** The drive into a stop from the one before it, or from home for the day's first; none from nowhere. */
function driveIn(day: PlanDay, before: Stop | undefined, to: Pin | null, estimate: DriveEstimate): number {
  if (before === undefined) return day.home === null ? 0 : drive(day.home, to, day.opens, estimate);
  return drive(before.pin, to, before.end, estimate);
}

/**
 * The day's free spans with these stops on it, in order: before the first, between each two once the one before is
 * wrapped up and the drive made, and after the last.
 */
function freeSpans(day: PlanDay, stops: readonly Stop[], rules: PlanRules): { from: number; to: number }[] {
  const wrap = rules.booking.wrap_up;
  const spans: { from: number; to: number }[] = [];
  let free = day.opens;
  let before: Stop | undefined;
  for (const stop of stops) {
    spans.push({ from: free, to: stop.start - driveIn(day, before, stop.pin, rules.drive) });
    free = stop.end + wrap;
    before = stop;
  }
  spans.push({ from: free, to: day.closes });
  return spans;
}

/** Whether a day with these stops still has its break: a free span inside the break's hours as long as it. */
export function breakFits(day: PlanDay, stops: readonly Stop[], rules: PlanRules): boolean {
  const { booking } = rules;
  const from = Math.max(booking.break_from * 60, day.opens);
  const to = Math.min(booking.break_to * 60, day.closes);
  // A day that does not reach the break's hours owes none.
  if (booking.break === 0 || to - from < booking.break) return true;
  return freeSpans(day, stops, rules).some(
    (span) => Math.min(span.to, to) - Math.max(span.from, from) >= booking.break,
  );
}

/** Where a visit could start at `start` on the day, and the driving it adds; null where it cannot. */
export function placedAt(day: PlanDay, visit: VisitToPlan, start: number, rules: PlanRules): Placed | null {
  const { booking } = rules;
  const wrap = booking.wrap_up;
  const end = start + visit.minutes;
  if (start < day.opens || end + wrap > day.closes) return null;
  if (day.away.some((away) => start < away.to && end + wrap > away.from)) return null;
  const stops = [...day.stops].sort((a, b) => a.start - b.start);
  if (stops.length >= booking.visits) return null;
  if (visit.fit && stops.filter((stop) => stop.fit).length >= booking.fits) return null;
  if (stops.some((stop) => stop.start < end + wrap && stop.end + wrap > start)) return null;

  const before = stops.filter((stop) => stop.start < start).at(-1);
  const after = stops.find((stop) => stop.start >= end);
  const arriving = driveIn(day, before, visit.pin, rules.drive);
  const readyFrom = before === undefined ? day.opens : before.end + wrap;
  if (readyFrom + arriving > start) return null;
  let leaving = 0;
  let saved = 0;
  if (after !== undefined) {
    leaving = drive(visit.pin, after.pin, end + wrap, rules.drive);
    if (end + wrap + leaving > after.start) return null;
    saved = driveIn(day, before, after.pin, rules.drive);
  }
  const placed: Stop = { start, end, pin: visit.pin, fit: visit.fit };
  if (!breakFits(day, [...stops, placed].sort((a, b) => a.start - b.start), rules)) return null;
  return { start, addedDrive: arriving + leaving - saved };
}

/** Every start a step apart, from `earliest` on, where the visit fits the day. */
export function placements(day: PlanDay, visit: VisitToPlan, rules: PlanRules, earliest: number): Placed[] {
  const { step } = rules.booking;
  const first = Math.ceil(Math.max(day.opens, earliest) / step) * step;
  const placed: Placed[] = [];
  for (let start = first; start + visit.minutes <= day.closes; start += step) {
    const fits = placedAt(day, visit, start, rules);
    if (fits !== null) placed.push(fits);
  }
  return placed;
}

/** Minutes from midnight of an "HH:MM" time. */
export const minuteOf = (time: string): number => {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

/** An "HH:MM" time of minutes from midnight. */
export const timeOf = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
