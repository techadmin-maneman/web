// When a visit can be booked, and holding it while the client pays
// (docs/decisions/0034-clash-check.md, 0035-window-slot-map.md).
//
// A technician's day is eight half-slots. What takes them: slots held and not
// yet expired (slot_claims), and live visits in the mirror, whether ops booked
// them in FSM or a hold became one. A technician holds one live job per
// window. A hold writes its claims in one batch, and the claims' key stops two
// holds taking the same time; once a hold is booked, its visit in the mirror
// takes the time instead.

import {
  BOOKING_WINDOWS,
  UNIT_STARTS,
  UNITS_PER_DAY,
  VISIT_BLOCKS,
  WINDOW_SLOT_MAP,
  WINDOW_TIMES,
  type BookingWindow,
} from "../config/scheduling.ts";
import type { VisitType } from "../config/visit-types.ts";
import { addDays, indiaDate, indiaInstant, indiaTime } from "../lib/india-time.ts";
import { isFitted } from "./client-visits.ts";
import type { Price } from "./price-book.ts";

/** What one technician's day already holds. */
export interface Day {
  readonly units: Set<number>;
  readonly windows: Set<BookingWindow>;
}

const emptyDay = (): Day => ({ units: new Set(), windows: new Set() });

/** The window a time of day in India falls in. */
export function windowAt(time: string): BookingWindow {
  return time < WINDOW_TIMES.afternoon.start ? "morning" : time < WINDOW_TIMES.evening.start ? "afternoon" : "evening";
}

/** The half-slot a time of day in India falls in: the last one starting at or before it. */
export function unitAt(time: string): number {
  let unit = 0;
  UNIT_STARTS.forEach((start, index) => {
    if (start <= time) unit = index;
  });
  return unit;
}

/** Where a visit of this type can start in this window, given the day; null if it cannot. */
export function placement(day: Day, window: BookingWindow, type: VisitType): number | null {
  if (day.windows.has(window)) return null;
  const { units } = VISIT_BLOCKS[type];
  for (const start of WINDOW_SLOT_MAP[window]) {
    if (start + units > UNITS_PER_DAY) continue;
    let free = true;
    for (let unit = start; unit < start + units; unit += 1) if (day.units.has(unit)) free = false;
    if (free) return start;
  }
  return null;
}

/** What a visit starting at a half-slot claims: each half-slot it covers, and its window. */
export function claimsOf(start: number, type: VisitType, window: BookingWindow): string[] {
  const units = Array.from({ length: VISIT_BLOCKS[type].units }, (_, index) => `unit:${String(start + index)}`);
  return [...units, `window:${window}`];
}

export interface Technician {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
}

/** Technicians FSM lists as active. Leave from FSM's availability arrives with dispatch (P2-M4). */
export async function activeTechnicians(db: D1Database): Promise<Technician[]> {
  const { results } = await db
    .prepare("SELECT id, name, initials FROM technicians WHERE active = 1 ORDER BY name")
    .all<Technician>();
  return results;
}

/** Whoever did the client's latest visit: their regular technician. */
export async function regularTechnician(db: D1Database, personId: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT technician_id FROM appointments WHERE person_id = ?1 AND deleted_at IS NULL AND status = 'completed'
         AND technician_id IS NOT NULL ORDER BY window_start DESC LIMIT 1`,
    )
    .bind(personId)
    .first<{ technician_id: string }>();
  return row?.technician_id ?? null;
}

/** What each technician's days already hold, from `from` to `to` (India's dates), as of `now`. */
export async function occupancy(
  db: D1Database,
  from: string,
  to: string,
  now: Date,
): Promise<(technicianId: string, date: string) => Day> {
  const days = new Map<string, Day>();
  const dayOf = (technicianId: string, date: string) => {
    const key = `${technicianId}/${date}`;
    const day = days.get(key) ?? emptyDay();
    days.set(key, day);
    return day;
  };

  const claims = await db
    .prepare(
      `SELECT c.technician_id, c.date, c.claim FROM slot_claims c JOIN slot_holds h ON h.id = c.hold_id
       WHERE c.date BETWEEN ?1 AND ?2 AND h.state = 'held' AND h.expires_at > ?3`,
    )
    .bind(from, to, now.toISOString())
    .all<{ technician_id: string; date: string; claim: string }>();
  for (const { technician_id: technicianId, date, claim } of claims.results) {
    const [kind, value = ""] = claim.split(":");
    const day = dayOf(technicianId, date);
    if (kind === "unit") day.units.add(Number(value));
    else day.windows.add(value as BookingWindow);
  }

  const visits = await db
    .prepare(
      `SELECT technician_id, type, window_start FROM appointments
       WHERE deleted_at IS NULL AND technician_id IS NOT NULL AND status IN ('scheduled', 'dispatched', 'in_progress')
         AND window_start >= ?1 AND window_start < ?2`,
    )
    .bind(indiaInstant(from, "00:00").toISOString(), indiaInstant(addDays(to, 1), "00:00").toISOString())
    .all<{ technician_id: string; type: VisitType | null; window_start: string }>();
  for (const visit of visits.results) {
    const starts = new Date(visit.window_start);
    const time = indiaTime(starts);
    const day = dayOf(visit.technician_id, indiaDate(starts));
    const start = unitAt(time);
    const units = VISIT_BLOCKS[visit.type ?? "service"].units;
    for (let unit = start; unit < Math.min(start + units, UNITS_PER_DAY); unit += 1) day.units.add(unit);
    day.windows.add(windowAt(time));
  }

  return (technicianId, date) => days.get(`${technicianId}/${date}`) ?? emptyDay();
}

/** The types a client may book: a consultation first, then a first fit, then service visits and replacements. */
export async function bookableTypes(db: D1Database, personId: string): Promise<VisitType[]> {
  if (await isFitted(db, personId)) return ["service", "replacement"];
  const consulted = await db
    .prepare(
      `SELECT 1 FROM appointments WHERE person_id = ?1 AND deleted_at IS NULL AND status = 'completed'
         AND type = 'consultation' LIMIT 1`,
    )
    .bind(personId)
    .first();
  return consulted === null ? ["consultation"] : ["first_fit"];
}

export interface WindowOffer {
  readonly window: BookingWindow;
  /** Who would come: the client's regular technician, another, or nobody (the window is full). */
  readonly with: "regular" | "another" | null;
}

/** Each window of each day from `from`, for this type: who could take it, the regular technician first. */
export async function availability(
  db: D1Database,
  personId: string,
  type: VisitType,
  from: string,
  days: number,
  now: Date,
): Promise<{ date: string; windows: WindowOffer[] }[]> {
  const to = addDays(from, days - 1);
  const [technicians, regular, held] = await Promise.all([
    activeTechnicians(db),
    regularTechnician(db, personId),
    occupancy(db, from, to, now),
  ]);
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(from, index);
    const windows = BOOKING_WINDOWS.map((window): WindowOffer => {
      const free = technicians.filter((technician) => placement(held(technician.id, date), window, type) !== null);
      if (free.some((technician) => technician.id === regular)) return { window, with: "regular" };
      return { window, with: free.length > 0 ? "another" : null };
    });
    return { date, windows };
  });
}

export interface Hold {
  readonly id: string;
  readonly type: VisitType;
  readonly date: string;
  readonly window: BookingWindow;
  readonly technician: Technician;
  readonly startUnit: number;
  readonly price: Price;
  readonly expiresAt: string;
}

/**
 * Holds a window for the client: their regular technician if free, else whoever has the least that day.
 * Their earlier holds are let go, and so are claims whose holds have expired. Null when nobody is free.
 */
export async function holdSlot(
  db: D1Database,
  input: { personId: string; type: VisitType; date: string; window: BookingWindow; price: Price },
  now: Date,
  holdSeconds: number,
): Promise<Hold | null> {
  const { personId, type, date, window, price } = input;
  const [technicians, regular, held] = await Promise.all([
    activeTechnicians(db),
    regularTechnician(db, personId),
    occupancy(db, date, date, now),
  ]);
  const candidates = technicians
    .map((technician) => ({ technician, start: placement(held(technician.id, date), window, type) }))
    .filter((candidate): candidate is { technician: Technician; start: number } => candidate.start !== null)
    .sort(
      (a, b) =>
        Number(b.technician.id === regular) - Number(a.technician.id === regular) ||
        held(a.technician.id, date).units.size - held(b.technician.id, date).units.size,
    );

  const at = now.toISOString();
  const expiresAt = new Date(now.getTime() + holdSeconds * 1000).toISOString();
  for (const { technician, start } of candidates) {
    const id = crypto.randomUUID();
    const letGo = `SELECT id FROM slot_holds WHERE state = 'held' AND (expires_at <= ?1 OR person_id = ?2)`;
    try {
      await db.batch([
        db.prepare(`DELETE FROM slot_claims WHERE hold_id IN (${letGo})`).bind(at, personId),
        db
          .prepare(`UPDATE slot_holds SET state = 'released', updated_at = ?1 WHERE id IN (${letGo})`)
          .bind(at, personId),
        db
          .prepare(
            `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount,
               amount_ex_gst, gst_percent, state, expires_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'held', ?11, ?12, ?12)`,
          )
          .bind(
            id,
            personId,
            type,
            date,
            window,
            technician.id,
            start,
            price.amount,
            price.amount_ex_gst,
            price.gst_percent,
            expiresAt,
            at,
          ),
        ...claimsOf(start, type, window).map((claim) =>
          db
            .prepare("INSERT INTO slot_claims (technician_id, date, claim, hold_id) VALUES (?1, ?2, ?3, ?4)")
            .bind(technician.id, date, claim, id),
        ),
      ]);
      return { id, type, date, window, technician, startUnit: start, price, expiresAt };
    } catch (error) {
      // Another hold took this technician's time between the look and the write: the next one, then.
      if (!(error instanceof Error && error.message.includes("UNIQUE"))) throw error;
    }
  }
  return null;
}

/** When a held visit starts and ends, as FSM books it. */
export function visitTimes(date: string, startUnit: number, type: VisitType): { start: Date; end: Date } {
  const start = indiaInstant(date, UNIT_STARTS[startUnit] ?? WINDOW_TIMES.morning.start);
  return { start, end: new Date(start.getTime() + VISIT_BLOCKS[type].minutes * 60_000) };
}
