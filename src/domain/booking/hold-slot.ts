// Holding a window while the client pays. The claims' key stops two holds taking the same time, and a booked visit
// then holds it itself; holds nobody is paying for are let go first.

import { failedUniqueOn } from "../../lib/d1-errors.ts";
import { compareTechniciansForHold, tieRange } from "./technician-choice.ts";
import { techniciansBarredOn, visitsOfClient } from "./technician-rotation.ts";
import { graceEnds, ownUnpaid } from "./hold-stages.ts";
import { PAYMENT_GRACE_SECONDS, type BookingWindow } from "../../config/scheduling.ts";
import type { VisitType } from "../../config/visit-types.ts";
import { clashes } from "../../policy/dispatch.ts";
import type { SoldTerms } from "../../policy/moving-a-visit.ts";
import { unitsFor } from "../../policy/visit-length.ts";
import type { Price } from "../money/price-book.ts";
import {
  claimsOf,
  fitsAt,
  loadBlackouts,
  occupancy,
  placement,
  techniciansFor,
  type Moving,
  type Technician,
} from "./occupancy.ts";
import { heldMinutes } from "../visits/visit-times.ts";
import { insertRow, type SqlValue } from "../../lib/sql.ts";

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
 * client's own other unpaid holds too, since in the app a client has one hold at a time; but not one with a Razorpay
 * order, which a payment may still land on until its grace ends, nor one ops sent a payment link for, which stays open
 * until the link closes. A paid hold is never here. A hold past its grace is past its countdown too, which the index on
 * expires_at finds.
 */
const LET_GO = `SELECT id FROM slot_holds WHERE state = 'held' AND confirmed_at IS NULL
  AND ((expires_at <= ?1 AND ${graceEnds("slot_holds")} <= ?1)
    OR (?3 = 1 AND ${ownUnpaid("slot_holds", "?2")}))`;

/**
 * Lets go of the holds nobody is paying for, and, given a client, that client's own other unpaid holds too. For
 * the batch that writes new claims, so a dead hold's claims never stand in their way.
 */
export function releaseDeadHolds(db: D1Database, now: Date, clientToo: string | null = null): D1PreparedStatement[] {
  const ownToo = clientToo === null ? 0 : 1;
  return [
    db.prepare(`DELETE FROM slot_claims WHERE hold_id IN (${LET_GO})`).bind(now.toISOString(), clientToo, ownToo),
    db
      .prepare(`UPDATE slot_holds SET state = 'released', updated_at = ?1 WHERE id IN (${LET_GO})`)
      .bind(now.toISOString(), clientToo, ownToo),
  ];
}

/** What a hold is asked for: who, which service, which day and window, at what price, and how it is held. */
interface HoldInput {
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
}

/**
 * The free technicians for the window, best first, each with the half-slot it would start in; null on a day blacked
 * out.
 */
async function candidatesFor({
  db,
  input,
  now,
}: {
  db: D1Database;
  input: HoldInput;
  now: Date;
}): Promise<{ technician: Technician; start: number }[] | null> {
  const { personId, service, date, window, moves, from = "app" } = input;
  const units = unitsFor(service.minutes);
  const moving = moves?.kind === "move" ? moves.visit : null;
  const ties = tieRange(date);
  const [blackouts, technicians, held, visits] = await Promise.all([
    loadBlackouts(db, date, date),
    techniciansFor(db, moving),
    occupancy({
      db,
      from: ties.from,
      to: ties.to,
      now,
      exceptVisitId: moving?.visitId ?? null,
      exceptHoldId: null,
      ownUnpaidOf: from === "app" ? personId : null,
    }),
    visitsOfClient(db, personId, moves?.visit.visitId ?? null),
  ]);
  if (blackouts.has(date)) return null;
  const beside = techniciansBarredOn(visits, date);
  const chosen = technicians.filter(
    (technician) =>
      !beside.has(technician.id) && (input.technicianId === undefined || technician.id === input.technicianId),
  );
  return chosen
    .map((technician) => ({ technician, start: placement(held(technician.id, date), window, units) }))
    .filter((candidate): candidate is { technician: Technician; start: number } => candidate.start !== null)
    .sort(compareTechniciansForHold(held, date));
}

/** The hold's row: the service, the day, the technician and its start, the price, and the terms it is sold under. */
function holdRow(
  input: HoldInput,
  hold: { id: string; technician: Technician; start: number; at: string; expiresAt: string; graceSeconds: number },
): Record<string, SqlValue> {
  const { personId, service, date, window, price, moves, useCredit = false, oneVisit = false, from = "app" } = input;
  const confirmedAt = from === "site" ? hold.at : null;
  return {
    id: hold.id,
    person_id: personId,
    type: service.type,
    date,
    window_label: window,
    technician_id: hold.technician.id,
    start_unit: hold.start,
    amount: price.amount,
    amount_ex_gst: price.amount_ex_gst,
    gst_percent: price.gst_percent,
    state: "held",
    expires_at: hold.expiresAt,
    created_at: hold.at,
    updated_at: hold.at,
    moves_appointment_id: moves?.visit.visitId ?? null,
    move_kind: moves?.kind ?? null,
    use_credit: useCredit ? 1 : 0,
    pincode: input.pincode ?? null,
    late_fee_ex_gst: input.lateFee?.amount_ex_gst ?? null,
    late_fee_gst_percent: input.lateFee?.gst_percent ?? null,
    confirmed_at: confirmedAt,
    queued_at: confirmedAt,
    tier: service.tier,
    minutes: service.minutes,
    grace_seconds: hold.graceSeconds,
    change_notice_hours: input.terms?.noticeHours ?? null,
    late_change_charge: input.terms?.lateCharge ?? null,
    no_show_charge: input.terms?.noShowCharge ?? null,
    one_visit: oneVisit ? 1 : 0,
    pay_by_link: input.payByLink === true ? 1 : 0,
  };
}

/**
 * Holds a window for the client with whoever has the least (compareTechniciansForHold), never the technician who took the client's
 * visit just before or just after it (src/domain/booking/technician-rotation.ts).
 * Holds nobody is paying for are let go first. Null when nobody is free, or the day is blacked out. The hold waits
 * `holdSeconds` for payment, and keeps its time for `graceSeconds` after, both as ops set them when it is made.
 */
export async function holdSlot({
  db,
  input,
  now,
  holdSeconds,
  graceSeconds = PAYMENT_GRACE_SECONDS,
}: {
  db: D1Database;
  input: HoldInput;
  now: Date;
  holdSeconds: number;
  graceSeconds?: number;
}): Promise<Hold | null> {
  const { personId, service, date, window, price, from = "app" } = input;
  const candidates = await candidatesFor({ db, input, now });
  if (candidates === null) return null;
  const units = unitsFor(service.minutes);

  const at = now.toISOString();
  const expiresAt = new Date(now.getTime() + holdSeconds * 1000).toISOString();
  for (const { technician, start } of candidates) {
    const id = crypto.randomUUID();
    try {
      await db.batch([
        ...(input.alongside ?? []),
        ...releaseDeadHolds(db, now, from === "app" ? personId : null),
        insertRow(db, "slot_holds", holdRow(input, { id, technician, start, at, expiresAt, graceSeconds })),
        ...claimsOf(start, units, window).map((claim) =>
          db
            .prepare("INSERT INTO slot_claims (technician_id, date, claim, hold_id) VALUES (?1, ?2, ?3, ?4)")
            .bind(technician.id, date, claim, id),
        ),
        ...(input.afterHold?.(id) ?? []),
      ]);
      return { id, service, date, window, technician, startUnit: start, price, expiresAt };
    } catch (error) {
      // Another hold took this technician's time between the look and the write: the next one, then. Any other
      // failure, a new number's person written twice at once say, is not a lost window.
      if (!failedUniqueOn(error, "slot_claims")) throw error;
    }
  }
  return null;
}

/** A hold's own time: its technician, day, window, and the half-slot its visit starts in. */
interface HeldTime {
  readonly id: string;
  readonly type: VisitType;
  readonly minutes: number | null;
  readonly technician_id: string;
  readonly date: string;
  readonly window_label: BookingWindow;
  readonly start_unit: number;
}

/**
 * Whether a hold's own time is still free on its technician's day: they are not on leave, and nothing but the hold itself
 * and the visit `exceptVisitId` takes its window or its half-slots.
 */
export async function heldTimeFree(
  db: D1Database,
  hold: HeldTime,
  now: Date,
  exceptVisitId: string | null = null,
): Promise<boolean> {
  const held = await occupancy({ db, from: hold.date, to: hold.date, now, exceptVisitId, exceptHoldId: hold.id });
  const day = held(hold.technician_id, hold.date);
  const units = unitsFor(heldMinutes(hold));
  return !day.onLeave && !clashes(day, hold.window_label) && fitsAt(day, hold.start_unit, units);
}

/**
 * Takes a hold that was let go back to held, on its own time, where nothing has taken that time since. False while it
 * stays let go; true once it is held again, here or by a try running alongside, or booked.
 */
export async function retakeSlot(db: D1Database, hold: HeldTime, now: Date): Promise<boolean> {
  if (!(await heldTimeFree(db, hold, now))) return false;
  const units = unitsFor(heldMinutes(hold));
  const isHeld = "EXISTS (SELECT 1 FROM slot_holds WHERE id = ?4 AND state = 'held')";
  try {
    await db.batch([
      ...releaseDeadHolds(db, now),
      db
        .prepare("UPDATE slot_holds SET state = 'held', updated_at = ?2 WHERE id = ?1 AND state = 'released'")
        .bind(hold.id, now.toISOString()),
      ...claimsOf(hold.start_unit, units, hold.window_label).map((claim) =>
        db
          .prepare(
            `INSERT INTO slot_claims (technician_id, date, claim, hold_id) SELECT ?1, ?2, ?3, ?4 WHERE ${isHeld}`,
          )
          .bind(hold.technician_id, hold.date, claim, hold.id),
      ),
    ]);
  } catch (error) {
    // The time went to another hold between the look and the write; or a try alongside took it back first.
    if (!failedUniqueOn(error, "slot_claims")) throw error;
  }
  const after = await db.prepare("SELECT state FROM slot_holds WHERE id = ?1").bind(hold.id).first<{ state: string }>();
  return after !== null && after.state !== "released";
}
