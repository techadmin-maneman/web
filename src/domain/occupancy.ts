// What a technician's days already hold (docs/decisions/0034-clash-check.md): eight half-slots a day, taken by
// holds' claims, live visits and leave. Days ops black out are never offered.

import { keepingItsTime, ownUnpaid } from "./hold-stages.ts";
import { UNITS_PER_DAY, VISIT_BLOCKS, WINDOW_SLOT_MAP, type BookingWindow } from "../config/scheduling.ts";
import type { VisitType } from "../config/visit-types.ts";
import { addDays, indiaInstant } from "../lib/india-time.ts";
import { clashes } from "../policy/dispatch.ts";
import { bookedLength, unitsFor } from "../policy/visit-length.ts";
import { unitAt } from "../policy/slot-times.ts";
import { loadSlotSchedule } from "./slot-times.ts";
import { minutesBetween } from "../lib/durations.ts";
import { statusIn, VISIT_LIVE } from "../config/statuses.ts";

/** What one technician's day already holds. */
export interface Day {
  readonly units: Set<number>;
  readonly windows: Set<BookingWindow>;
  /** Leave: the whole day is out, whatever else is on it. */
  onLeave: boolean;
}

const emptyDay = (): Day => ({ units: new Set(), windows: new Set(), onLeave: false });

/** The days ops black out between two dates: nobody is offered a visit on them. */
export async function loadBlackouts(db: D1Database, from: string, to: string): Promise<Set<string>> {
  const { results } = await db
    .prepare("SELECT date FROM visit_blackouts WHERE date BETWEEN ?1 AND ?2")
    .bind(from, to)
    .all<{ date: string }>();
  return new Set(results.map((row) => row.date));
}

/** Whether every one of a visit's half-slots, starting at `start`, is free, and inside the day. */
export function fitsAt(day: Day, start: number, units: number): boolean {
  if (start + units > UNITS_PER_DAY) return false;
  for (let unit = start; unit < start + units; unit += 1) if (day.units.has(unit)) return false;
  return true;
}

/**
 * Where a visit of this many half-slots can start in this window, given the day, at half-slot `earliest` or later;
 * null if it cannot.
 */
export function placement(day: Day, window: BookingWindow, units: number, earliest = 0): number | null {
  if (day.onLeave || clashes(day, window)) return null;
  return WINDOW_SLOT_MAP[window].find((start) => start >= earliest && fitsAt(day, start, units)) ?? null;
}

/** What a visit starting at a half-slot claims: each half-slot it covers, and its window. */
export function claimsOf(start: number, units: number, window: BookingWindow): string[] {
  const covered = Array.from({ length: units }, (_, index) => `unit:${String(start + index)}`);
  return [...covered, `window:${window}`];
}

/** A visit already booked: its kind, its service's length where the table has it, its times. */
interface BookedVisit {
  readonly type: VisitType | null;
  /** The length of the service it is, from the services table; null where no service is it. */
  readonly service_minutes: number | null;
  readonly window_start: string;
  readonly window_end: string | null;
}

/**
 * How long a visit already booked takes (src/policy/visit-length.ts): the longer of its service's length, or its
 * kind's where no service is it, and its booked window, where it has one.
 */
export function bookedMinutes(visit: BookedVisit): number {
  const service = visit.service_minutes ?? VISIT_BLOCKS[visit.type ?? "service"].minutes;
  const booked = visit.window_end === null ? 0 : minutesBetween(visit.window_start, visit.window_end);
  return bookedLength(service, booked > 0 ? booked : null);
}

export interface Technician {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
}

/** Who can take a booking: every active technician, or, for a move, the visit's own. */
export async function techniciansFor(db: D1Database, moving: Moving | null): Promise<Technician[]> {
  const technicians = await activeTechnicians(db);
  return moving === null ? technicians : technicians.filter((technician) => technician.id === moving.technicianId);
}

/** Technicians switched on. Whether one is away on a given day is `occupancy`'s answer, not this one's. */
export async function activeTechnicians(db: D1Database): Promise<Technician[]> {
  const { results } = await db
    .prepare("SELECT id, name, initials FROM technicians WHERE active = 1 ORDER BY name")
    .all<Technician>();
  return results;
}

/** A visit being moved: only its technician can take the move, and its own time is left out. */
export interface Moving {
  readonly visitId: string;
  readonly technicianId: string;
}

/**
 * What each technician's days already hold, from `from` to `to` (India's dates), as of `now`. The visit
 * `exceptVisitId` and the claims of the hold `exceptHoldId` are left out, and so are the claims of the client
 * `ownUnpaidOf`'s own unpaid holds, which the hold they are asking for lets go.
 */
export async function occupancy(
  db: D1Database,
  from: string,
  to: string,
  now: Date,
  exceptVisitId: string | null = null,
  exceptHoldId: string | null = null,
  ownUnpaidOf: string | null = null,
): Promise<(technicianId: string, date: string) => Day> {
  const days = new Map<string, Day>();
  const dayOf = (technicianId: string, date: string) => {
    const key = `${technicianId}/${date}`;
    const day = days.get(key) ?? emptyDay();
    days.set(key, day);
    return day;
  };

  const [claims, leave, visits, schedule] = await Promise.all([
    // A hold's claims. A dispatch move's claims are let go in the batch that writes it.
    db
      .prepare(
        `SELECT c.technician_id, c.date, c.claim FROM slot_claims c JOIN slot_holds h ON h.id = c.hold_id
         WHERE c.date BETWEEN ?1 AND ?2 AND ${keepingItsTime("h", "?3")}
           AND h.id IS NOT ?4 AND NOT (?5 IS NOT NULL AND ${ownUnpaid("h", "?5")})`,
      )
      .bind(from, to, now.toISOString(), exceptHoldId, ownUnpaidOf)
      .all<{ technician_id: string; date: string; claim: string }>(),
    db
      .prepare(
        `SELECT technician_id, from_date, to_date FROM technician_leave
         WHERE cancelled_at IS NULL AND from_date <= ?2 AND to_date >= ?1`,
      )
      .bind(from, to)
      .all<{ technician_id: string; from_date: string; to_date: string }>(),
    // A visit is the standard tier's where it names no other (migration 0050).
    db
      .prepare(
        `SELECT a.technician_id, a.type, a.window_start, a.window_end, s.minutes AS service_minutes FROM appointments a
         LEFT JOIN services s ON s.kind = a.type AND s.tier = COALESCE(a.tier, 'standard')
         WHERE a.deleted_at IS NULL AND a.technician_id IS NOT NULL
           AND ${statusIn("a.status", VISIT_LIVE)}
           AND a.window_start >= ?1 AND a.window_start < ?2 AND a.id IS NOT ?3`,
      )
      .bind(
        indiaInstant(from, "00:00").toISOString(),
        indiaInstant(addDays(to, 1), "00:00").toISOString(),
        exceptVisitId,
      )
      .all<BookedVisit & { technician_id: string }>(),
    loadSlotSchedule(db),
  ]);

  for (const { technician_id: technicianId, date, claim } of claims.results) {
    const [kind, value = ""] = claim.split(":");
    const day = dayOf(technicianId, date);
    if (kind === "unit") day.units.add(Number(value));
    else day.windows.add(value as BookingWindow);
  }

  // Leave takes the whole day, so the day is marked rather than its slots filled:
  // ops are told the technician is away, not that every window happens to be busy.
  for (const period of leave.results) {
    // Both ends are inclusive, and the dates sort as they read, so a plain comparison walks the period.
    let date = period.from_date < from ? from : period.from_date;
    for (; date <= period.to_date && date <= to; date = addDays(date, 1)) {
      dayOf(period.technician_id, date).onLeave = true;
    }
  }

  for (const visit of visits.results) {
    const { date, time, window } = schedule.at(visit.window_start);
    const day = dayOf(visit.technician_id, date);
    const start = unitAt(time, schedule.on(date));
    const units = unitsFor(bookedMinutes(visit));
    for (let unit = start; unit < Math.min(start + units, UNITS_PER_DAY); unit += 1) day.units.add(unit);
    day.windows.add(window);
  }

  return (technicianId, date) => days.get(`${technicianId}/${date}`) ?? emptyDay();
}
