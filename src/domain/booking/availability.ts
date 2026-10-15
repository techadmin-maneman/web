// What a client may book, and the days and windows still open to them, with who could take each.

import { paidNotBooked } from "./hold-stages.ts";
import { windowsFitting, type BookingWindow } from "../../config/scheduling.ts";
import type { VisitType } from "../../config/visit-types.ts";
import { addDays } from "../../lib/india-time.ts";
import { unitsFor } from "../../policy/visit-length.ts";
import { FITTED } from "../clients/fitted.ts";
import { loadSlotSchedule } from "./slot-times.ts";
import { loadBlackouts, occupancy, placement, techniciansFor, type Moving, type Technician } from "./occupancy.ts";
import { statusIn, VISIT_LIVE } from "../../config/statuses.ts";
import { allowedTechnicians, techniciansBarredOn } from "../../policy/technician-rotation.ts";
import { visitsOfClient } from "./technician-rotation.ts";
import type { Fitting } from "./occupancy.ts";
import { missedDayOver, todayStartsOf } from "../visits/visit-begun.ts";

/**
 * The client ?1's visit booked and still to happen: not one nobody arrived at, once its day is over (missedDayOver).
 * ?2 is the start of today in India.
 */
const STILL_TO_HAPPEN = `a.person_id = ?1 AND a.deleted_at IS NULL
  AND ${statusIn("a.status", VISIT_LIVE)} AND NOT ${missedDayOver("a", "?2")}`;

const PAID_HOLD = paidNotBooked("slot_holds");

/** What decides the types a client ?1 may book today, which began at ?2, in one statement. */
const STAGE = `SELECT
  ${FITTED} AS fitted,
  EXISTS (SELECT 1 FROM appointments WHERE person_id = ?1 AND deleted_at IS NULL AND status = 'completed'
    AND type = 'consultation') AS consulted,
  EXISTS (SELECT 1 FROM appointments a WHERE ${STILL_TO_HAPPEN}
      AND (a.type = 'consultation' OR a.one_visit = 'booked'))
    OR EXISTS (SELECT 1 FROM slot_holds WHERE person_id = ?1 AND ${PAID_HOLD}
      AND (type = 'consultation' OR one_visit = 1)) AS consultation_live,
  EXISTS (SELECT 1 FROM appointments a WHERE ${STILL_TO_HAPPEN} AND a.type = 'first_fit')
    OR EXISTS (SELECT 1 FROM slot_holds WHERE person_id = ?1 AND ${PAID_HOLD} AND type = 'first_fit')
    AS first_fit_live`;

interface StageRow {
  fitted: number;
  consulted: number;
  consultation_live: number;
  first_fit_live: number;
}

/**
 * The types a client may book: a consultation first, then a first fit, then service visits and replacements.
 * A consultation or a first fit is booked once at a time: not while one is still to happen (liveVisitOf).
 */
export async function bookableTypes(db: D1Database, personId: string, now: Date): Promise<VisitType[]> {
  const row = await db.prepare(STAGE).bind(personId, todayStartsOf(now)).first<StageRow>();
  if (row?.fitted === 1) return ["service", "replacement"];
  if (row?.consulted === 1) return row.first_fit_live === 1 ? [] : ["first_fit"];
  return row?.consultation_live === 1 ? [] : ["consultation"];
}

/** The kinds of visit a client has one of at a time. */
export const ONE_AT_A_TIME: readonly VisitType[] = ["consultation", "first_fit"];

export interface LiveVisit {
  readonly date: string;
  readonly window: BookingWindow;
}

/**
 * The client's visit of this kind still to happen: booked, or paid for and still to be booked, other than the
 * hold `exceptHoldId`. Null when there is none, and always for a kind a client may have several of. A consultation
 * and fit in one visit is the client's consultation still to happen as well as their first fit
 * (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
 */
export async function liveVisitOf(
  db: D1Database,
  personId: string,
  { type, now }: { readonly type: VisitType; readonly now: Date },
  exceptHoldId: string | null = null,
): Promise<LiveVisit | null> {
  if (!ONE_AT_A_TIME.includes(type)) return null;
  const [booked, paid] = await Promise.all([
    db
      .prepare(
        `SELECT a.window_start FROM appointments a
         WHERE ${STILL_TO_HAPPEN} AND (a.type = ?3 OR (?3 = 'consultation' AND a.one_visit = 'booked'))
         ORDER BY a.window_start LIMIT 1`,
      )
      .bind(personId, todayStartsOf(now), type)
      .first<{ window_start: string }>(),
    db
      .prepare(
        `SELECT date, window_label FROM slot_holds
         WHERE person_id = ?1 AND (type = ?2 OR (?2 = 'consultation' AND one_visit = 1)) AND ${PAID_HOLD}
           AND id IS NOT ?3 LIMIT 1`,
      )
      .bind(personId, type, exceptHoldId)
      .first<{ date: string; window_label: BookingWindow }>(),
  ]);
  if (booked !== null) {
    const { date, window } = (await loadSlotSchedule(db)).at(booked.window_start);
    return { date, window };
  }
  return paid === null ? null : { date: paid.date, window: paid.window_label };
}

interface WindowOffer {
  readonly window: BookingWindow;
  /** Whether a technician is free to take the visit in it: never the one who took the client's visit before or after. */
  readonly open: boolean;
}

/** A window of a day, and the technicians free to take the visit in it. */
interface WindowTechnicians {
  readonly window: BookingWindow;
  readonly technicians: Technician[];
}

/** A visit to place: how long it takes, and the day its service is retired from, if it is. */
interface VisitToPlace {
  readonly minutes: number;
  readonly until?: string | null;
  /** A fit, which only a technician trained to fit takes (ADR 0119), and one who can reach its piece. */
  readonly fitting?: Fitting | null;
}

/** Whose visit it is, and what it stands in for: a move in place keeps its technician, a replaced visit gives way. */
interface Placing {
  readonly personId: string | null;
  /** A move in place: only its own technician may take it, and its own time is left out. */
  readonly moving?: Moving | null;
  /** The visit a charged move books this one in place of, which stands next to it no longer. */
  readonly replacing?: string | null;
  /** The client's own unpaid holds are left out, which the app's hold would let go. */
  readonly ownUnpaid?: boolean;
  /** The service of a new visit, whose window the client's own hold at Checkout leaves open to them. */
  readonly atCheckout?: { readonly type: string; readonly tier: string } | null;
  /** The pincode the visit is booked at, as the site's form gives it; left out, the client's current address. */
  readonly pincode?: string | null;
}

/**
 * Each window of each day from `from` that a visit this long can start in, and the technicians free to take it: none
 * who took the client's visit just before or just after that day, unless nobody else is free (src/policy/technician-rotation.ts). A window the visit
 * is too long to start in, as a first fit's evening, is left out. A day ops black out, or from `until` on, is offered to
 * nobody.
 */
async function windowsOf({
  db,
  placing,
  visit,
  range,
  now,
}: {
  db: D1Database;
  placing: Placing;
  visit: VisitToPlace;
  range: { readonly from: string; readonly days: number };
  now: Date;
}): Promise<{ date: string; windows: WindowTechnicians[] }[]> {
  const { personId, moving = null, replacing = null, ownUnpaid = false, atCheckout = null, pincode = null } = placing;
  const units = unitsFor(visit.minutes);
  const to = addDays(range.from, range.days - 1);
  const [technicians, held, closed, visits] = await Promise.all([
    techniciansFor(db, moving, { pincode, personId }, visit.fitting ?? null),
    occupancy({
      db,
      from: range.from,
      to,
      now,
      exceptVisitId: moving?.visitId ?? null,
      exceptHoldId: null,
      ownUnpaidOf: ownUnpaid ? personId : null,
      ownCheckoutOf: atCheckout === null || personId === null ? null : { personId, ...atCheckout },
    }),
    loadBlackouts(db, range.from, to, { pincode, personId }),
    visitsOfClient(db, personId, moving?.visitId ?? replacing),
  ]);
  const retired = (date: string) => visit.until !== undefined && visit.until !== null && date >= visit.until;
  const startable = windowsFitting(units);
  return Array.from({ length: range.days }, (_, index) => {
    const date = addDays(range.from, index);
    const beside = techniciansBarredOn(visits, date);
    const windows = startable.map((window): WindowTechnicians => {
      if (closed.has(date) || retired(date)) return { window, technicians: [] };
      const free = technicians.filter((technician) => placement(held(technician.id, date), window, units) !== null);
      return { window, technicians: allowedTechnicians(free, (technician) => beside.has(technician.id)) };
    });
    return { date, windows };
  });
}

/**
 * Each window of each day from `from` that a visit of this many minutes can start in, and whether anyone can take it.
 * A window the visit is too long to start in, as a first fit's evening, is left out. A day from `until` on, the day a
 * service is retired from, is offered to nobody. With no person, as for the site's form, nobody stands beside it.
 */
export async function availability({
  db,
  placing,
  visit,
  from,
  days,
  now,
}: {
  db: D1Database;
  placing: Placing;
  visit: VisitToPlace;
  from: string;
  days: number;
  now: Date;
}): Promise<{ date: string; windows: WindowOffer[] }[]> {
  const offered = await windowsOf({ db, placing, visit, range: { from, days }, now });
  return offered.map(({ date, windows }) => ({
    date,
    windows: windows.map(({ window, technicians }) => ({ window, open: technicians.length > 0 })),
  }));
}

/**
 * Each window of each day from `from` that a visit this long can start in: the technicians free to take it, none who
 * took the client's visit before or after it, for ops to choose from as they book.
 */
export async function freeTechnicians({
  db,
  personId,
  visit,
  from,
  days,
  now,
}: {
  db: D1Database;
  personId: string;
  visit: VisitToPlace;
  from: string;
  days: number;
  now: Date;
}): Promise<{ date: string; windows: WindowTechnicians[] }[]> {
  return windowsOf({ db, placing: { personId }, visit, range: { from, days }, now });
}
