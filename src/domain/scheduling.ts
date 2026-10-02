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
// (docs/decisions/0068-a-paid-hold-is-kept.md). Nobody's hold lets a paid one
// go. The days ops black out (visit_blackouts) are not offered at all.
//
// A move on the dispatch board claims its new time the same way while FSM is
// written, and the claims count here for as long as the move can still finish
// (docs/decisions/0069-dispatch-under-concurrency.md).
//
// A visit holds the half-slots its length needs (src/policy/visit-length.ts):
// a hold, its service's length as it was made; a visit already booked, the
// longer of its service's length and the time FSM books it for
// (docs/decisions/0085-services-ops-can-edit.md).

import {
  MOVE_CLAIM_SECONDS,
  PAYMENT_GRACE_SECONDS,
  UNITS_PER_DAY,
  VISIT_BLOCKS,
  WINDOW_SLOT_MAP,
  windowsFitting,
  type BookingWindow,
} from "../config/scheduling.ts";
import type { VisitType } from "../config/visit-types.ts";
import { addDays, indiaInstant } from "../lib/india-time.ts";
import { clashes } from "../policy/dispatch.ts";
import type { SoldTerms } from "../policy/moving-a-visit.ts";
import { bookedLength, unitsFor } from "../policy/visit-length.ts";
import { unitAt } from "../policy/slot-times.ts";
import { isFitted } from "./client-visits.ts";
import type { Price } from "./price-book.ts";
import { loadSlotSchedule, type SlotSchedule } from "./slot-times.ts";
import { MINUTE_MS, minutesBetween } from "../lib/durations.ts";

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

/** Where a visit of this many half-slots can start in this window, given the day; null if it cannot. */
export function placement(day: Day, window: BookingWindow, units: number): number | null {
  if (day.onLeave || clashes(day, window)) return null;
  return WINDOW_SLOT_MAP[window].find((start) => fitsAt(day, start, units)) ?? null;
}

/** What a visit starting at a half-slot claims: each half-slot it covers, and its window. */
export function claimsOf(start: number, units: number, window: BookingWindow): string[] {
  const covered = Array.from({ length: units }, (_, index) => `unit:${String(start + index)}`);
  return [...covered, `window:${window}`];
}

/** A visit already booked, as the mirror holds it: its kind, its service's length where the table has it, its times. */
export interface BookedVisit {
  readonly type: VisitType | null;
  /** The length of the service it is, from the services table; null where no service is it. */
  readonly service_minutes: number | null;
  readonly window_start: string;
  readonly window_end: string | null;
}

/**
 * How long a visit already booked takes (src/policy/visit-length.ts): the longer of its service's length, or its
 * kind's where no service is it, and the time FSM books it for, where FSM gives one.
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

/**
 * When an unpaid hold stops keeping its time: its countdown, then the grace it was made with, or the committed two
 * minutes for a hold made before holds kept one. `hold` names the slot_holds row in the query it goes into.
 */
export const graceEnds = (hold: string): string =>
  `strftime('%Y-%m-%dT%H:%M:%fZ', ${hold}.expires_at, '+' || COALESCE(${hold}.grace_seconds, ${String(PAYMENT_GRACE_SECONDS)}) || ' seconds')`;

/** A dispatch move opened before this, and still open, never finished. */
export const movesOpenSince = (now: Date): string => new Date(now.getTime() - MOVE_CLAIM_SECONDS * 1000).toISOString();

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

  // A hold's claims, and a dispatch move's while it can still finish.
  const claims = await db
    .prepare(
      `SELECT c.technician_id, c.date, c.claim FROM slot_claims c JOIN slot_holds h ON h.id = c.hold_id
       WHERE c.date BETWEEN ?1 AND ?2 AND h.state = 'held' AND (h.confirmed_at IS NOT NULL OR ${graceEnds("h")} > ?3)
       UNION ALL
       SELECT c.technician_id, c.date, c.claim FROM slot_claims c JOIN dispatch_moves m ON m.id = c.move_id
       WHERE c.date BETWEEN ?1 AND ?2 AND m.fsm_write_state = 'pending' AND m.created_at > ?4`,
    )
    .bind(from, to, now.toISOString(), movesOpenSince(now))
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

  // A visit is the standard tier's where the mirror knows no other (migration 0050).
  const visits = await db
    .prepare(
      `SELECT a.technician_id, a.type, a.window_start, a.window_end, s.minutes AS service_minutes FROM appointments a
       LEFT JOIN services s ON s.kind = a.type AND s.tier = COALESCE(a.tier, 'standard')
       WHERE a.deleted_at IS NULL AND a.technician_id IS NOT NULL
         AND a.status IN ('scheduled', 'dispatched', 'in_progress')
         AND a.window_start >= ?1 AND a.window_start < ?2 AND a.id IS NOT ?3`,
    )
    .bind(indiaInstant(from, "00:00").toISOString(), indiaInstant(addDays(to, 1), "00:00").toISOString(), exceptVisitId)
    .all<BookedVisit & { technician_id: string }>();
  const schedule = await loadSlotSchedule(db);
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
  const booked = await db
    .prepare(
      `SELECT window_start FROM appointments
       WHERE person_id = ?1 AND (type = ?2 OR (?2 = 'consultation' AND one_visit = 'booked')) AND deleted_at IS NULL
         AND status IN ('scheduled', 'dispatched', 'in_progress')
       ORDER BY window_start LIMIT 1`,
    )
    .bind(personId, type)
    .first<{ window_start: string }>();
  if (booked !== null) {
    const { date, window } = (await loadSlotSchedule(db)).at(booked.window_start);
    return { date, window };
  }
  const paid = await db
    .prepare(
      `SELECT date, window_label FROM slot_holds
       WHERE person_id = ?1 AND (type = ?2 OR (?2 = 'consultation' AND one_visit = 1)) AND state = 'held'
         AND confirmed_at IS NOT NULL AND id IS NOT ?3 LIMIT 1`,
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

/** Whose time is offered first: a move's own technician, else the client's regular one; nobody's for no client. */
function firstChoice(db: D1Database, personId: string | null, moving: Moving | null): Promise<string | null> {
  if (moving !== null) return Promise.resolve(moving.technicianId);
  if (personId === null) return Promise.resolve(null);
  return regularTechnician(db, personId);
}

/** A window of a day, and the technicians free to take the visit in it, the client's regular technician first. */
export interface WindowTechnicians {
  readonly window: BookingWindow;
  readonly technicians: Technician[];
}

/** A visit to place: how long it takes, and the day its service is retired from, if it is. */
interface VisitToPlace {
  readonly minutes: number;
  readonly until?: string | null;
}

/**
 * Each window of each day from `from` that a visit this long can start in: the technicians free to take it, the
 * regular technician first, and who the regular technician is. A day ops black out, or from `until` on, is offered to
 * nobody.
 */
async function windowsOf(
  db: D1Database,
  personId: string | null,
  visit: VisitToPlace,
  range: { readonly from: string; readonly days: number },
  now: Date,
  moving: Moving | null,
): Promise<{ regular: string | null; days: { date: string; windows: WindowTechnicians[] }[] }> {
  const units = unitsFor(visit.minutes);
  const to = addDays(range.from, range.days - 1);
  const [technicians, regular, held, closed] = await Promise.all([
    techniciansFor(db, moving),
    firstChoice(db, personId, moving),
    occupancy(db, range.from, to, now, moving?.visitId ?? null),
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
 * is anyone's regular.
 */
export async function availability(
  db: D1Database,
  personId: string | null,
  visit: VisitToPlace,
  from: string,
  days: number,
  now: Date,
  moving: Moving | null = null,
): Promise<{ date: string; windows: WindowOffer[] }[]> {
  const offered = await windowsOf(db, personId, visit, { from, days }, now, moving);
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
 * Each window of each day from `from`, for a visit this long: the technicians free to take it, the client's regular
 * technician first, for ops to choose from as they book.
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

/**
 * What a hold is for: its service's kind and tier, and the length it is held and booked for, copied onto the hold as
 * it is made, so a change to the service after never moves what the client was sold.
 */
export interface HeldService {
  readonly type: VisitType;
  readonly tier: string;
  readonly minutes: number;
}

export interface Hold {
  readonly id: string;
  readonly service: HeldService;
  readonly date: string;
  readonly window: BookingWindow;
  readonly technician: Technician;
  readonly startUnit: number;
  readonly price: Price;
  readonly expiresAt: string;
}

/**
 * Holds nobody is paying for any more at ?1: unpaid, and past their countdown and their grace. With ?3 = 1, the
 * client's own other unpaid holds too: in the app a client has one hold at a time, though not one ops sent a payment
 * link for, which stays open until the link closes. A paid hold is never here. A hold past its grace is past its
 * countdown too, which the index on expires_at finds.
 */
const LET_GO = `SELECT id FROM slot_holds WHERE state = 'held' AND confirmed_at IS NULL
  AND ((expires_at <= ?1 AND ${graceEnds("slot_holds")} <= ?1) OR (?3 = 1 AND person_id = ?2 AND pay_by_link = 0))`;

/**
 * Lets go of the holds nobody is paying for, and, given a client, that client's own other unpaid holds too. For
 * the batch that writes new claims, so a dead hold's claims never stand in their way.
 */
export function lettingGo(db: D1Database, now: Date, clientToo: string | null = null): D1PreparedStatement[] {
  const ownToo = clientToo === null ? 0 : 1;
  return [
    db.prepare(`DELETE FROM slot_claims WHERE hold_id IN (${LET_GO})`).bind(now.toISOString(), clientToo, ownToo),
    db
      .prepare(`UPDATE slot_holds SET state = 'released', updated_at = ?1 WHERE id IN (${LET_GO})`)
      .bind(now.toISOString(), clientToo, ownToo),
  ];
}

/**
 * Holds a window for the client: their regular technician if free, else whoever has the least that day.
 * Holds nobody is paying for are let go first. Null when nobody is free, or the day is blacked out. The hold waits
 * `holdSeconds` for payment, and keeps its time for `graceSeconds` after, both as ops set them when it is made.
 */
export async function holdSlot(
  db: D1Database,
  input: {
    personId: string;
    /** The service it is for, and the length its time is held for. */
    service: HeldService;
    date: string;
    window: BookingWindow;
    price: Price;
    /** What moving it late would cost as it stands now, kept on the hold for the visit's terms. */
    lateFee?: Price | null;
    /**
     * The terms in force as it is made, kept on the hold so the visit keeps them; left out, it is sold under the
     * committed ones, as the site's free consultation is.
     */
    terms?: SoldTerms;
    /** Where the visit is, where the booking says. */
    pincode?: string | null;
    /** Paid for with a service-visit credit instead of money (ADR 0033). */
    useCredit?: boolean;
    /** A consultation and fit in one visit, booked from the site with nothing paid (ADR 0105). */
    oneVisit?: boolean;
    /** A move in place, which keeps the visit's technician; or a new visit replacing it. */
    moves?: { readonly visit: Moving; readonly kind: "move" | "replace" };
    /**
     * Where it is held. In the app the client's other unpaid holds are let go. The site lets none of theirs go,
     * and books its free consultation at once, so its hold is confirmed as it is made. Ops let none go either, and
     * confirm a hold nothing is paid for as they book it.
     */
    from?: "app" | "site" | "ops";
    /** Only this technician may take it: the one ops chose. */
    technicianId?: string;
    /** Paid for by a payment link ops send, rather than at the app's Checkout. */
    payByLink?: boolean;
    /** Written in the same batch, so they stand or fall with the hold: the person and their consent, from the site. */
    alongside?: readonly D1PreparedStatement[];
    /** Written after the hold, in its batch, given its ID: the site's discount code (docs/decisions/0108-discount-codes.md). */
    afterHold?: (holdId: string) => readonly D1PreparedStatement[];
  },
  now: Date,
  holdSeconds: number,
  graceSeconds: number = PAYMENT_GRACE_SECONDS,
): Promise<Hold | null> {
  const { personId, service, date, window, price, moves, useCredit = false, oneVisit = false, from = "app" } = input;
  const units = unitsFor(service.minutes);
  if ((await loadBlackouts(db, date, date)).has(date)) return null;
  const moving = moves?.kind === "move" ? moves.visit : null;
  const [technicians, regular, held] = await Promise.all([
    techniciansFor(db, moving),
    moving === null ? regularTechnician(db, personId) : moving.technicianId,
    occupancy(db, date, date, now, moving?.visitId ?? null),
  ]);
  const chosen =
    input.technicianId === undefined
      ? technicians
      : technicians.filter((technician) => technician.id === input.technicianId);
  const candidates = chosen
    .map((technician) => ({ technician, start: placement(held(technician.id, date), window, units) }))
    .filter((candidate): candidate is { technician: Technician; start: number } => candidate.start !== null)
    .sort(
      (a, b) =>
        Number(b.technician.id === regular) - Number(a.technician.id === regular) ||
        held(a.technician.id, date).units.size - held(b.technician.id, date).units.size,
    );

  const at = now.toISOString();
  const expiresAt = new Date(now.getTime() + holdSeconds * 1000).toISOString();
  const confirmedAt = from === "site" ? at : null;
  for (const { technician, start } of candidates) {
    const id = crypto.randomUUID();
    try {
      await db.batch([
        ...(input.alongside ?? []),
        ...lettingGo(db, now, from === "app" ? personId : null),
        db
          .prepare(
            `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount,
               amount_ex_gst, gst_percent, state, expires_at, created_at, updated_at, moves_appointment_id, move_kind,
               use_credit, pincode, late_fee_ex_gst, late_fee_gst_percent, confirmed_at, queued_at, tier, minutes,
               grace_seconds, change_notice_hours, late_change_charge, no_show_charge, one_visit, pay_by_link)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'held', ?11, ?12, ?12, ?13, ?14, ?15, ?16, ?17, ?18,
               ?19, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27)`,
          )
          .bind(
            id,
            personId,
            service.type,
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
            service.tier,
            service.minutes,
            graceSeconds,
            input.terms?.noticeHours ?? null,
            input.terms?.lateCharge ?? null,
            input.terms?.noShowCharge ?? null,
            oneVisit ? 1 : 0,
            input.payByLink === true ? 1 : 0,
          ),
        ...claimsOf(start, units, window).map((claim) =>
          db
            .prepare("INSERT INTO slot_claims (technician_id, date, claim, hold_id) VALUES (?1, ?2, ?3, ?4)")
            .bind(technician.id, date, claim, id),
        ),
        ...(input.afterHold?.(id) ?? []),
      ]);
      return { id, service, date, window, technician, startUnit: start, price, expiresAt };
    } catch (error) {
      // Another hold took this technician's time between the look and the write: the next one, then.
      if (!(error instanceof Error && error.message.includes("UNIQUE"))) throw error;
    }
  }
  return null;
}

/**
 * When a visit starting in a half-slot starts and ends, as FSM books it: from the half-slot's start by the times in
 * force on its day, for its length.
 */
export function visitTimes(
  date: string,
  startUnit: number,
  minutes: number,
  schedule: SlotSchedule,
): { start: Date; end: Date } {
  const { unitStarts } = schedule.on(date);
  const start = indiaInstant(date, unitStarts[startUnit] ?? unitStarts[0] ?? "09:00");
  return { start, end: new Date(start.getTime() + minutes * MINUTE_MS) };
}

/** How long a hold's visit is booked for: the length it was held for, or its kind's for a hold made before lengths. */
export const heldMinutes = (hold: { readonly type: VisitType; readonly minutes: number | null }): number =>
  hold.minutes ?? VISIT_BLOCKS[hold.type].minutes;

/** When a hold's visit starts and ends, from its half-slot by the times in force on its day. */
export async function heldVisitTimes(
  db: D1Database,
  hold: {
    readonly date: string;
    readonly start_unit: number;
    readonly type: VisitType;
    readonly minutes: number | null;
  },
): Promise<{ start: Date; end: Date }> {
  return visitTimes(hold.date, hold.start_unit, heldMinutes(hold), await loadSlotSchedule(db));
}
