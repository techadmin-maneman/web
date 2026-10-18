// Who may take a visit, and what booking reads beside each technician's day plan (./day-plans.ts): the days ops black
// out, which are never offered, how long a visit already booked takes, and the fit a visit is.

import { VISIT_BLOCKS } from "../../config/scheduling.ts";
import { isAFitting, type VisitType } from "../../config/visit-types.ts";
import { bookedLength } from "../../policy/visit-length.ts";
import { minutesBetween } from "../../lib/durations.ts";
import { fitCode } from "../inventory/stock-gap.ts";

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
 * ops set one (docs/decisions/0117-a-technician-takes-visits-in-their-own-city.md). Staging's test records stay apart:
 * a test client is booked only with a test technician, and a real client never is.
 */
const TECHNICIANS_IN_THE_CITY = `SELECT t.id, t.name, t.initials FROM technicians t
  WHERE t.active = 1 AND (t.id = ?3 OR (t.city = ${bookingCity("?1", "?2")} AND (?4 = 0 OR t.fits_trained = 1)
    AND (?2 IS NULL OR t.test_record = (SELECT COALESCE(MAX(p.test_record), 0) FROM people p WHERE p.id = ?2))
    AND (?5 IS NULL OR EXISTS (
      SELECT 1 FROM stock_balances b WHERE b.consumable_code = ?5 AND b.quantity > 0
        AND (b.place = t.id OR (?6 = 0 AND b.place IN (SELECT r.id FROM stock_places r
                                           WHERE r.kind = 'stockroom' AND r.city = t.city AND r.active = 1)))))))
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
 * 0119) whose own kit holds a piece of the client's exact spec; where none does, those whose city's stockroom holds
 * one; where none does, any trained fitter, and the evening's kit check tells ops what is short. A client's move may go to any of them, its own
 * technician first, who keeps it wherever they work.
 */
export async function techniciansFor(
  db: D1Database,
  moving: Moving | null,
  place: VisitPlace,
  fitting: Fitting | null = null,
): Promise<Technician[]> {
  const read = async (code: string | null, kitOnly = false) => {
    const { results } = await db
      .prepare(TECHNICIANS_IN_THE_CITY)
      .bind(
        place.pincode,
        place.personId,
        moving?.technicianId ?? null,
        fitting === null ? 0 : 1,
        code,
        kitOnly ? 1 : 0,
      )
      .all<Technician>();
    return results;
  };
  const code = fitting === null || place.personId === null ? null : await fitCode(db, place.personId, fitting.product);
  if (code === null) return read(null);
  for (const kitOnly of [true, false]) {
    const holding = await read(code, kitOnly);
    if (holding.length > 0) return holding;
  }
  return read(null);
}

/** A visit being moved: only its technician can take the move, and its own time is left out. */
export interface Moving {
  readonly visitId: string;
  readonly technicianId: string;
}
