// What a technician's days already hold (docs/decisions/0034-clash-check.md): eight half-slots a day, taken by
// holds' claims, live visits and leave. Days ops black out are never offered.

import { keepingItsTime, ownAtCheckout, ownUnpaid } from "./hold-stages.ts";
import {
  BOOKING_WINDOWS,
  UNITS_PER_DAY,
  VISIT_BLOCKS,
  WINDOW_SLOT_MAP,
  type BookingWindow,
} from "../../config/scheduling.ts";
import { isAFitting, tierOf, type VisitType } from "../../config/visit-types.ts";
import { addDays, indiaInstant } from "../../lib/india-time.ts";
import { clashes } from "../../policy/dispatch.ts";
import { bookedLength, unitsFor } from "../../policy/visit-length.ts";
import { unitAt } from "../../policy/slot-times.ts";
import { loadSlotSchedule } from "./slot-times.ts";
import { minutesBetween } from "../../lib/durations.ts";
import { statusIn, VISIT_LIVE } from "../../config/statuses.ts";
import { fitCode } from "../inventory/stock-gap.ts";
import { isOneOf } from "../../lib/one-of.ts";

/** What one technician's day already holds. */
export interface Day {
  readonly units: Set<number>;
  readonly windows: Set<BookingWindow>;
  /** Leave: the whole day is out, whatever else is on it. */
  onLeave: boolean;
}

const emptyDay = (): Day => ({ units: new Set(), windows: new Set(), onLeave: false });

/** The days ops black out between two dates: nobody is offered a visit on them. */
export async function loadBlackouts(
  db: D1Database,
  from: string,
  to: string,
  place: VisitPlace | null = null,
): Promise<Set<string>> {
  // Closed everywhere, and closed in the visit's own city (docs/decisions/0119-blackouts-by-city-and-trained-fitters.md).
  const { results } = await db
    .prepare(
      `SELECT date FROM visit_blackouts WHERE date BETWEEN ?1 AND ?2
       UNION SELECT date FROM city_blackouts WHERE date BETWEEN ?1 AND ?2 AND city = ${bookingCity("?3", "?4")}`,
    )
    .bind(from, to, place?.pincode ?? null, place?.personId ?? null)
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

/**
 * The city a visit being booked or moved is in, as SQL: the city of the pincode it is at, else of its client's current
 * address; null where neither is known. `pincode` and `person` are the statement's parameters for them. A visit once
 * booked keeps the city it was booked in (src/domain/clients/places.ts, visitCity).
 */
export const bookingCity = (pincode: string, person: string): string => `COALESCE(
    (SELECT p.city FROM serviceable_pincodes p WHERE p.pincode = ${pincode}),
    (SELECT p.city FROM addresses a JOIN serviceable_pincodes p ON p.pincode = a.pincode
      WHERE a.person_id = ${person} AND a.replaced_at IS NULL))`;

/** Where a visit is: the pincode it is booked at, else the client's current address. Either may be unknown. */
interface VisitPlace {
  readonly pincode: string | null;
  readonly personId: string | null;
}

/**
 * The active technicians ops placed in the city a visit is in: the city of the pincode it is booked at, else of the
 * client's current address. Nobody where that city is unknown, and a technician with no city takes no booking until
 * ops set one (docs/decisions/0117-a-technician-takes-visits-in-their-own-city.md).
 */
const TECHNICIANS_IN_THE_CITY = `SELECT t.id, t.name, t.initials FROM technicians t
  WHERE t.active = 1 AND (t.id = ?3 OR (t.city = ${bookingCity("?1", "?2")} AND (?4 = 0 OR t.fits_trained = 1)
    AND (?5 IS NULL OR EXISTS (
      SELECT 1 FROM stock_balances b WHERE b.consumable_code = ?5 AND b.quantity > 0
        AND (b.place = t.id OR b.place IN (SELECT r.id FROM stock_places r
                                           WHERE r.kind = 'stockroom' AND r.city = t.city AND r.active = 1))))))
  ORDER BY t.id = ?3 DESC, t.name`;

/** A fit to place: the product a first fit was paid for, which its piece is of; null on a replacement. */
export interface Fitting {
  readonly product: string | null;
}

/** A one visit's fit, whose client has no profile yet to match a piece to: any trained fitter takes it. */
export const ONE_VISIT_FIT: Fitting = { product: null };

/** The fit a visit of `type` is, a first fit's of the tier paid for; null for a visit that fits nothing. */
export const fittingOf = (type: VisitType | null, tier: string | null): Fitting | null =>
  isAFitting(type) ? { product: type === "first_fit" ? tier : null } : null;

/**
 * Who can take a booking: the active technicians in the visit's city, and for a fit only those trained to fit (ADR
 * 0119) whose kit, or their city's stockroom, holds a piece of the client's exact spec. Where none does, any trained
 * fitter takes it, and the evening's kit check tells ops what is short. A client's move may go to any of them, its own
 * technician first, who keeps it wherever they work.
 */
export async function techniciansFor(
  db: D1Database,
  moving: Moving | null,
  place: VisitPlace,
  fitting: Fitting | null = null,
): Promise<Technician[]> {
  const read = async (code: string | null) => {
    const { results } = await db
      .prepare(TECHNICIANS_IN_THE_CITY)
      .bind(place.pincode, place.personId, moving?.technicianId ?? null, fitting === null ? 0 : 1, code)
      .all<Technician>();
    return results;
  };
  const code = fitting === null || place.personId === null ? null : await fitCode(db, place.personId, fitting.product);
  const withPiece = await read(code);
  return code === null || withPiece.length > 0 ? withPiece : read(null);
}

/** A visit being moved: only its technician can take the move, and its own time is left out. */
export interface Moving {
  readonly visitId: string;
  readonly technicianId: string;
}

/** A client and the service they are booking, whose own hold already at Checkout is theirs to take again. */
interface OwnCheckout {
  readonly personId: string;
  readonly type: string;
  readonly tier: string;
}

/**
 * The claims of the holds keeping their time from `from` to `to`, but those occupancy leaves out. A dispatch move's
 * claims are let go in the batch that writes it.
 */
function claimsHeld(held: {
  db: D1Database;
  from: string;
  to: string;
  now: Date;
  exceptHoldId: string | null;
  ownUnpaidOf: string | null;
  ownCheckoutOf: OwnCheckout | null;
}) {
  return held.db
    .prepare(
      `SELECT c.technician_id, c.date, c.claim FROM slot_claims c JOIN slot_holds h ON h.id = c.hold_id
       WHERE c.date BETWEEN ?1 AND ?2 AND ${keepingItsTime("h", "?3")}
         AND h.id IS NOT ?4 AND NOT (?5 IS NOT NULL AND ${ownUnpaid("h", "?5")})
         AND NOT (?6 IS NOT NULL AND ${ownAtCheckout("h", { person: "?6", type: "?7", tier: "?8", now: "?3" })})`,
    )
    .bind(
      held.from,
      held.to,
      held.now.toISOString(),
      held.exceptHoldId,
      held.ownUnpaidOf,
      held.ownCheckoutOf?.personId ?? null,
      held.ownCheckoutOf?.type ?? null,
      held.ownCheckoutOf?.tier ?? null,
    )
    .all<{ technician_id: string; date: string; claim: string }>();
}

/**
 * What each technician's days already hold, from `from` to `to` (India's dates), as of `now`. The visit
 * `exceptVisitId` and the claims of the hold `exceptHoldId` are left out, and so are the claims of the client
 * `ownUnpaidOf`'s own unpaid holds, which the hold they are asking for lets go, and of `ownCheckoutOf`'s own hold
 * already at Checkout for the same service, which asking again gives back.
 */
export async function occupancy({
  db,
  from,
  to,
  now,
  exceptVisitId = null,
  exceptHoldId = null,
  ownUnpaidOf = null,
  ownCheckoutOf = null,
}: {
  db: D1Database;
  from: string;
  to: string;
  now: Date;
  exceptVisitId?: string | null;
  exceptHoldId?: string | null;
  ownUnpaidOf?: string | null;
  ownCheckoutOf?: OwnCheckout | null;
}): Promise<(technicianId: string, date: string) => Day> {
  const days = new Map<string, Day>();
  const dayOf = (technicianId: string, date: string) => {
    const key = `${technicianId}/${date}`;
    const day = days.get(key) ?? emptyDay();
    days.set(key, day);
    return day;
  };

  const [claims, leave, visits, schedule] = await Promise.all([
    claimsHeld({ db, from, to, now, exceptHoldId, ownUnpaidOf, ownCheckoutOf }),
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
         LEFT JOIN services s ON s.kind = a.type AND s.tier = ${tierOf("a.tier")}
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
    else if (isOneOf(BOOKING_WINDOWS, value)) day.windows.add(value);
    else throw new Error(`slot_claims.claim names no window: ${claim}`);
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
