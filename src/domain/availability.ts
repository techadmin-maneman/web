// What a client may book, and the days and windows still open to them, with who could take each.

import { paidNotBooked } from "./hold-stages.ts";
import { windowsFitting, type BookingWindow } from "../config/scheduling.ts";
import type { VisitType } from "../config/visit-types.ts";
import { addDays } from "../lib/india-time.ts";
import { unitsFor } from "../policy/visit-length.ts";
import { FITTED } from "./fitted.ts";
import { loadSlotSchedule } from "./slot-times.ts";
import {
  loadBlackouts,
  occupancy,
  placement,
  regularTechnician,
  techniciansFor,
  type Moving,
  type Technician,
} from "./occupancy.ts";
import { statusIn, VISIT_LIVE } from "../config/statuses.ts";

/** A visit booked and still to happen. */
const STILL_TO_HAPPEN = `deleted_at IS NULL AND ${statusIn("status", VISIT_LIVE)}`;

const PAID_HOLD = paidNotBooked("slot_holds");

/** What decides the types a client ?1 may book, in one statement. */
const STAGE = `SELECT
  ${FITTED} AS fitted,
  EXISTS (SELECT 1 FROM appointments WHERE person_id = ?1 AND deleted_at IS NULL AND status = 'completed'
    AND type = 'consultation') AS consulted,
  EXISTS (SELECT 1 FROM appointments WHERE person_id = ?1 AND ${STILL_TO_HAPPEN}
      AND (type = 'consultation' OR one_visit = 'booked'))
    OR EXISTS (SELECT 1 FROM slot_holds WHERE person_id = ?1 AND ${PAID_HOLD}
      AND (type = 'consultation' OR one_visit = 1)) AS consultation_live,
  EXISTS (SELECT 1 FROM appointments WHERE person_id = ?1 AND ${STILL_TO_HAPPEN} AND type = 'first_fit')
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
export async function bookableTypes(db: D1Database, personId: string): Promise<VisitType[]> {
  const row = await db.prepare(STAGE).bind(personId).first<StageRow>();
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
  type: VisitType,
  exceptHoldId: string | null = null,
): Promise<LiveVisit | null> {
  if (!ONE_AT_A_TIME.includes(type)) return null;
  const [booked, paid] = await Promise.all([
    db
      .prepare(
        `SELECT window_start FROM appointments
         WHERE person_id = ?1 AND (type = ?2 OR (?2 = 'consultation' AND one_visit = 'booked')) AND ${STILL_TO_HAPPEN}
         ORDER BY window_start LIMIT 1`,
      )
      .bind(personId, type)
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
  /** Who would come: the client's regular technician, another, or nobody (the window is full). */
  readonly with: "regular" | "another" | null;
}

/** A window of a day, and the technicians free to take the visit in it, the client's regular technician first. */
interface WindowTechnicians {
  readonly window: BookingWindow;
  readonly technicians: Technician[];
}

/** A visit to place: how long it takes, and the day its service is retired from, if it is. */
interface VisitToPlace {
  readonly minutes: number;
  readonly until?: string | null;
}

/** Whose time is offered first: a move's own technician, else the client's regular one; nobody's for no client. */
function firstChoice(db: D1Database, personId: string | null, moving: Moving | null): Promise<string | null> {
  if (moving !== null) return Promise.resolve(moving.technicianId);
  if (personId === null) return Promise.resolve(null);
  return regularTechnician(db, personId);
}

/**
 * Each window of each day from `from` that a visit this long can start in: the technicians free to take it, the
 * regular technician first, and who the regular technician is. A window the visit is too long to start in, as a first
 * fit's evening, is left out. A day ops black out, or from `until` on, is offered to nobody.
 */
async function windowsOf(
  db: D1Database,
  personId: string | null,
  visit: VisitToPlace,
  range: { readonly from: string; readonly days: number },
  now: Date,
  moving: Moving | null,
  ownUnpaidOf: string | null = null,
): Promise<{ regular: string | null; days: { date: string; windows: WindowTechnicians[] }[] }> {
  const units = unitsFor(visit.minutes);
  const to = addDays(range.from, range.days - 1);
  const [technicians, regular, held, closed] = await Promise.all([
    techniciansFor(db, moving),
    firstChoice(db, personId, moving),
    occupancy(db, range.from, to, now, moving?.visitId ?? null, null, ownUnpaidOf),
    loadBlackouts(db, range.from, to),
  ]);
  const retired = (date: string) => visit.until !== undefined && visit.until !== null && date >= visit.until;
  const regularFirst = [...technicians].sort((a, b) => Number(b.id === regular) - Number(a.id === regular));
  const startable = windowsFitting(units);
  const days = Array.from({ length: range.days }, (_, index) => {
    const date = addDays(range.from, index);
    const windows = startable.map((window): WindowTechnicians => {
      if (closed.has(date) || retired(date)) return { window, technicians: [] };
      const free = regularFirst.filter((technician) => placement(held(technician.id, date), window, units) !== null);
      return { window, technicians: free };
    });
    return { date, windows };
  });
  return { regular, days };
}

/**
 * Each window of each day from `from` that a visit of this many minutes can start in: who could take it, the regular
 * technician first. A window the visit is too long to start in, as a first fit's evening, is left out. A day from
 * `until` on, the day a service is retired from, is offered to nobody. With no person, as for the site's form, nobody
 * is anyone's regular. `forTheApp` leaves out the client's own unpaid holds, which the app's hold would let go.
 */
export async function availability(
  db: D1Database,
  personId: string | null,
  visit: VisitToPlace,
  from: string,
  days: number,
  now: Date,
  moving: Moving | null = null,
  forTheApp = false,
): Promise<{ date: string; windows: WindowOffer[] }[]> {
  const offered = await windowsOf(db, personId, visit, { from, days }, now, moving, forTheApp ? personId : null);
  const whoComes = (free: readonly Technician[]): WindowOffer["with"] => {
    if (free.some((technician) => technician.id === offered.regular)) return "regular";
    return free.length > 0 ? "another" : null;
  };
  return offered.days.map(({ date, windows }) => ({
    date,
    windows: windows.map(({ window, technicians }) => ({ window, with: whoComes(technicians) })),
  }));
}

/**
 * Each window of each day from `from` that a visit this long can start in: the technicians free to take it, the
 * client's regular technician first, for ops to choose from as they book.
 */
export async function freeTechnicians(
  db: D1Database,
  personId: string,
  visit: VisitToPlace,
  from: string,
  days: number,
  now: Date,
): Promise<{ date: string; windows: WindowTechnicians[] }[]> {
  return (await windowsOf(db, personId, visit, { from, days }, now, null)).days;
}
