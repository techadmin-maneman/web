// When a visit can be booked, and holding it while the client pays
// (docs/decisions/0034-clash-check.md, 0035-window-slot-map.md).
//
// A technician's day is eight half-slots. What takes them: slots held
// (slot_claims), live visits in the mirror, whether ops booked them in FSM or a
// hold became one, and leave ops recorded (ADR 0062). A technician holds one
// live job per window. A hold writes its claims in one batch, and the claims'
// key stops two holds taking the same time; once a hold is booked, its visit in
// the mirror takes the time instead. A visit being moved keeps its technician,
// and its own time does not count against the move
// (docs/decisions/0046-moving-and-cancelling.md).
//
// A hold keeps its time while it is waiting for payment, for its ten minutes
// and the grace after them, and from the moment it is paid for (or booked free)
// until it is booked or refunded, however long that takes
// (docs/decisions/0067-a-paid-hold-is-kept.md). Nobody's hold lets a paid one
// go. The days ops black out (visit_blackouts) are not offered at all.

import {
  BOOKING_WINDOWS,
  PAYMENT_GRACE_SECONDS,
  UNIT_STARTS,
  UNITS_PER_DAY,
  VISIT_BLOCKS,
  WINDOW_SLOT_MAP,
  WINDOW_TIMES,
  type BookingWindow,
} from "../config/scheduling.ts";
import type { VisitType } from "../config/visit-types.ts";
import { addDays, indiaDate, indiaInstant, indiaTime } from "../lib/india-time.ts";
import { clashes } from "../policy/dispatch.ts";
import { isFitted } from "./client-visits.ts";
import { loadBlackouts } from "./leads.ts";
import type { Price } from "./price-book.ts";

/** What one technician's day already holds. */
export interface Day {
  readonly units: Set<number>;
  readonly windows: Set<BookingWindow>;
  /** Leave: the whole day is out, whatever else is on it. */
  onLeave: boolean;
}

const emptyDay = (): Day => ({ units: new Set(), windows: new Set(), onLeave: false });

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
  if (day.onLeave || clashes(day, window)) return null;
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

/** Who can take a booking: every active technician, or, for a move, the visit's own. */
async function techniciansFor(db: D1Database, moving: Moving | null): Promise<Technician[]> {
  const technicians = await activeTechnicians(db);
  return moving === null ? technicians : technicians.filter((technician) => technician.id === moving.technicianId);
}

/** Technicians FSM lists as active. Whether one is away on a given day is `occupancy`'s answer, not this one's. */
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

/** A visit being moved: only its technician can take the move, and its own time is left out. */
export interface Moving {
  readonly visitId: string;
  readonly technicianId: string;
}

/** Until when an unpaid hold made before `now` keeps its time: its ten minutes, then the grace. */
const graceStart = (now: Date): string => new Date(now.getTime() - PAYMENT_GRACE_SECONDS * 1000).toISOString();

/** What each technician's days already hold, from `from` to `to` (India's dates), as of `now`. */
export async function occupancy(
  db: D1Database,
  from: string,
  to: string,
  now: Date,
  exceptVisitId: string | null = null,
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
       WHERE c.date BETWEEN ?1 AND ?2 AND h.state = 'held' AND (h.confirmed_at IS NOT NULL OR h.expires_at > ?3)`,
    )
    .bind(from, to, graceStart(now))
    .all<{ technician_id: string; date: string; claim: string }>();
  for (const { technician_id: technicianId, date, claim } of claims.results) {
    const [kind, value = ""] = claim.split(":");
    const day = dayOf(technicianId, date);
    if (kind === "unit") day.units.add(Number(value));
    else day.windows.add(value as BookingWindow);
  }

  // Leave takes the whole day, so the day is marked rather than its slots filled:
  // ops are told the technician is away, not that every window happens to be busy.
  const leave = await db
    .prepare(
      `SELECT technician_id, from_date, to_date FROM technician_leave
       WHERE cancelled_at IS NULL AND from_date <= ?2 AND to_date >= ?1`,
    )
    .bind(from, to)
    .all<{ technician_id: string; from_date: string; to_date: string }>();
  for (const period of leave.results) {
    // Both ends are inclusive, and the dates sort as they read, so a plain comparison walks the period.
    let date = period.from_date < from ? from : period.from_date;
    for (; date <= period.to_date && date <= to; date = addDays(date, 1)) {
      dayOf(period.technician_id, date).onLeave = true;
    }
  }

  const visits = await db
    .prepare(
      `SELECT technician_id, type, window_start FROM appointments
       WHERE deleted_at IS NULL AND technician_id IS NOT NULL AND status IN ('scheduled', 'dispatched', 'in_progress')
         AND window_start >= ?1 AND window_start < ?2 AND id IS NOT ?3`,
    )
    .bind(indiaInstant(from, "00:00").toISOString(), indiaInstant(addDays(to, 1), "00:00").toISOString(), exceptVisitId)
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

/**
 * The types a client may book: a consultation first, then a first fit, then service visits and replacements.
 * A consultation or a first fit is booked once at a time: not while one is still to happen.
 */
export async function bookableTypes(db: D1Database, personId: string): Promise<VisitType[]> {
  const open: VisitType[] = [];
  for (const type of await typesAtStage(db, personId)) {
    if ((await liveVisitOf(db, personId, type)) === null) open.push(type);
  }
  return open;
}

async function typesAtStage(db: D1Database, personId: string): Promise<VisitType[]> {
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

/** The kinds of visit a client has one of at a time. */
export const ONE_AT_A_TIME: readonly VisitType[] = ["consultation", "first_fit"];

export interface LiveVisit {
  readonly date: string;
  readonly window: BookingWindow;
}

/**
 * The client's visit of this kind still to happen: booked, or paid for and on its way to FSM, other than the
 * hold `exceptHoldId`. Null when there is none, and always for a kind a client may have several of.
 */
export async function liveVisitOf(
  db: D1Database,
  personId: string,
  type: VisitType,
  exceptHoldId: string | null = null,
): Promise<LiveVisit | null> {
  if (!ONE_AT_A_TIME.includes(type)) return null;
  const booked = await db
    .prepare(
      `SELECT window_start FROM appointments
       WHERE person_id = ?1 AND type = ?2 AND deleted_at IS NULL AND status IN ('scheduled', 'dispatched', 'in_progress')
       ORDER BY window_start LIMIT 1`,
    )
    .bind(personId, type)
    .first<{ window_start: string }>();
  if (booked !== null) {
    const starts = new Date(booked.window_start);
    return { date: indiaDate(starts), window: windowAt(indiaTime(starts)) };
  }
  const paid = await db
    .prepare(
      `SELECT date, window_label FROM slot_holds
       WHERE person_id = ?1 AND type = ?2 AND state = 'held' AND confirmed_at IS NOT NULL AND id IS NOT ?3 LIMIT 1`,
    )
    .bind(personId, type, exceptHoldId)
    .first<{ date: string; window_label: BookingWindow }>();
  return paid === null ? null : { date: paid.date, window: paid.window_label };
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
  moving: Moving | null = null,
): Promise<{ date: string; windows: WindowOffer[] }[]> {
  const to = addDays(from, days - 1);
  const [technicians, regular, held, closed] = await Promise.all([
    techniciansFor(db, moving),
    moving === null ? regularTechnician(db, personId) : moving.technicianId,
    occupancy(db, from, to, now, moving?.visitId ?? null),
    loadBlackouts(db, from, to),
  ]);
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(from, index);
    const windows = BOOKING_WINDOWS.map((window): WindowOffer => {
      if (closed.has(date)) return { window, with: null };
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
 * Holds nobody is paying for any more: unpaid, and past their ten minutes and the grace. With ?3 = 1, the
 * client's own other unpaid holds too: in the app a client has one hold at a time. A paid hold is never here.
 */
const LET_GO = `SELECT id FROM slot_holds WHERE state = 'held' AND confirmed_at IS NULL
  AND (expires_at <= ?1 OR (?3 = 1 AND person_id = ?2))`;

/**
 * Holds a window for the client: their regular technician if free, else whoever has the least that day.
 * Holds nobody is paying for are let go first. Null when nobody is free, or the day is blacked out.
 */
export async function holdSlot(
  db: D1Database,
  input: {
    personId: string;
    type: VisitType;
    date: string;
    window: BookingWindow;
    price: Price;
    /** What moving it late would cost as it stands now, kept on the hold for the visit's terms. */
    lateFee?: Price | null;
    /** Where the visit is, where the booking says. */
    pincode?: string | null;
    /** Paid for with a service-visit credit instead of money (ADR 0033). */
    useCredit?: boolean;
    /** A move in place, which keeps the visit's technician; or a new visit replacing it. */
    moves?: { readonly visit: Moving; readonly kind: "move" | "replace" };
    /**
     * Where it is held. In the app the client's other unpaid holds are let go. The site lets none of theirs go,
     * and books its free consultation at once, so its hold is confirmed as it is made.
     */
    from?: "app" | "site";
    /** Written in the same batch, so they stand or fall with the hold: the person and their consent, from the site. */
    alongside?: readonly D1PreparedStatement[];
  },
  now: Date,
  holdSeconds: number,
): Promise<Hold | null> {
  const { personId, type, date, window, price, moves, useCredit = false, from = "app" } = input;
  if ((await loadBlackouts(db, date, date)).has(date)) return null;
  const moving = moves?.kind === "move" ? moves.visit : null;
  const [technicians, regular, held] = await Promise.all([
    techniciansFor(db, moving),
    moving === null ? regularTechnician(db, personId) : moving.technicianId,
    occupancy(db, date, date, now, moving?.visitId ?? null),
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
  const confirmedAt = from === "site" ? at : null;
  const ownToo = from === "app" ? 1 : 0;
  for (const { technician, start } of candidates) {
    const id = crypto.randomUUID();
    try {
      await db.batch([
        ...(input.alongside ?? []),
        db.prepare(`DELETE FROM slot_claims WHERE hold_id IN (${LET_GO})`).bind(graceStart(now), personId, ownToo),
        db
          .prepare(`UPDATE slot_holds SET state = 'released', updated_at = ?4 WHERE id IN (${LET_GO})`)
          .bind(graceStart(now), personId, ownToo, at),
        db
          .prepare(
            `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount,
               amount_ex_gst, gst_percent, state, expires_at, created_at, updated_at, moves_appointment_id, move_kind,
               use_credit, pincode, late_fee_ex_gst, late_fee_gst_percent, confirmed_at, queued_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'held', ?11, ?12, ?12, ?13, ?14, ?15, ?16, ?17, ?18,
               ?19, ?19)`,
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
            moves?.visit.visitId ?? null,
            moves?.kind ?? null,
            useCredit ? 1 : 0,
            input.pincode ?? null,
            input.lateFee?.amount_ex_gst ?? null,
            input.lateFee?.gst_percent ?? null,
            confirmedAt,
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
