// Holding a window while the client pays. The claims' key stops two holds taking the same time, and a booked visit
// then holds it itself; holds nobody is paying for are let go first.

import { failedUniqueOn } from "../../lib/d1-errors.ts";
import { graceEnds, ownUnpaid } from "./hold-stages.ts";
import { PAYMENT_GRACE_SECONDS, type BookingWindow } from "../../config/scheduling.ts";
import { isAFitting, type VisitType } from "../../config/visit-types.ts";
import { indiaTime } from "../../lib/india-time.ts";
import { claimsAt, minuteOf, placedAt } from "../../policy/day-plan.ts";
import type { SoldTerms } from "../../policy/moving-a-visit.ts";
import { unitAt, windowTimesOf } from "../../policy/slot-times.ts";
import { readOpsInputs, type OpsInputs } from "../platform/ops-settings.ts";
import { loadDayPlans } from "./day-plans.ts";
import { loadSlotSchedule } from "./slot-times.ts";
import { pinOfVisit, planRulesOf, startOffers } from "./start-offers.ts";
import { drivesFit, type DriveCheck } from "./drive-check.ts";
import type { Price } from "../money/price-book.ts";
import { fittingOf, type Moving, type Technician } from "./occupancy.ts";
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
  /** When the visit starts (docs/decisions/0210-booking-by-start-time.md). */
  readonly startsAt: Date;
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
  /** The start the client chose; left out, any start inside the window, the best first. */
  startsAt?: Date;
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
  /** Paid by UPI at the visit, nothing taken now: ops booked it while online payment is off. */
  payAtVisit?: boolean;
  /** Written in the same batch, so they stand or fall with the hold: the person and their consent, from the site. */
  alongside?: readonly D1PreparedStatement[];
  /** Written after the hold, in its batch, given its ID: the site's discount code (docs/decisions/0108-discount-codes.md). */
  afterHold?: (holdId: string) => readonly D1PreparedStatement[];
}

/** A technician who can take the hold, the start they would take it at, and the lock their day takes. */
interface Candidate {
  readonly technician: Technician;
  /** India's clock, "HH:MM". */
  readonly time: string;
  readonly startsAt: Date;
  readonly revision: number;
}

/**
 * Who can take the hold, best first (./start-offers.ts): at the start asked for, or at any start inside the window,
 * the least driving first and then the earliest start. A client's move stays with its own technician where they can
 * take it.
 */
async function candidatesFor({
  db,
  input,
  now,
}: {
  db: D1Database;
  input: HoldInput;
  now: Date;
}): Promise<Candidate[]> {
  const { personId, service, date, window, moves, from = "app" } = input;
  const moving = moves?.kind === "move" ? moves.visit : null;
  const [offers, schedule] = await Promise.all([
    startOffers({
      db,
      placing: {
        personId,
        moving,
        replacing: moves?.visit.visitId ?? null,
        pincode: input.pincode ?? null,
        leaving: { ownUnpaidOf: from === "app" ? personId : null },
      },
      visit: { type: service.type, minutes: service.minutes, fitting: fittingOf(service.type, service.tier) },
      from: date,
      days: 1,
      now,
    }),
    loadSlotSchedule(db),
  ]);
  const hours = windowTimesOf(schedule.on(date))[window];
  const inside = (offers[0]?.starts ?? []).filter((start) =>
    input.startsAt === undefined
      ? start.time >= hours.start && start.time < hours.end
      : start.startsAt.getTime() === input.startsAt.getTime(),
  );
  const ownFirst = (candidate: Candidate) => Number(candidate.technician.id === moving?.technicianId);
  return inside
    .flatMap((start) =>
      start.takers.map((taker) => ({
        technician: taker.technician,
        time: start.time,
        startsAt: start.startsAt,
        revision: taker.revision,
        addedDrive: taker.addedDrive,
      })),
    )
    .filter((candidate) => input.technicianId === undefined || candidate.technician.id === input.technicianId)
    .sort((a, b) => ownFirst(b) - ownFirst(a) || a.addedDrive - b.addedDrive || a.time.localeCompare(b.time));
}

/**
 * Whether Google's drives leave room for a candidate's start (./drive-check.ts): read once for every candidate's day,
 * and always true where there is no Google to ask.
 */
async function roadCheck(
  db: D1Database,
  asked: {
    input: HoldInput;
    now: Date;
    inputs: OpsInputs;
    drives: DriveCheck | null;
    candidates: readonly Candidate[];
  },
): Promise<(technicianId: string, time: string) => Promise<boolean>> {
  const { input, now, inputs, drives, candidates } = asked;
  if (drives === null || candidates.length === 0) return () => Promise.resolve(true);
  const [plans, pin] = await Promise.all([
    loadDayPlans({
      db,
      technicianIds: [...new Set(candidates.map((candidate) => candidate.technician.id))],
      from: input.date,
      to: input.date,
      now,
      hours: inputs.workingHours,
      leaving: {
        visitId: input.moves?.kind === "move" ? input.moves.visit.visitId : null,
        ownUnpaidOf: (input.from ?? "app") === "app" ? input.personId : null,
      },
    }),
    pinOfVisit(db, { personId: input.personId, pincode: input.pincode ?? null }),
  ]);
  const rules = planRulesOf(inputs);
  return async (technicianId, time) => {
    const day = plans.day(technicianId, input.date);
    if (day === null) return true;
    return drivesFit(db, drives, { day, rules, now }, { time, minutes: input.service.minutes, pin });
  };
}

/** The hold's row: the service, the day, the technician and its start, the price, and the terms it is sold under. */
function holdRow(
  input: HoldInput,
  hold: {
    id: string;
    technician: Technician;
    start: number;
    startsAt: Date;
    at: string;
    expiresAt: string;
    graceSeconds: number;
  },
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
    starts_at: hold.startsAt.toISOString(),
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
    pay_at_visit: input.payAtVisit === true ? 1 : 0,
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
  drives,
}: {
  db: D1Database;
  input: HoldInput;
  now: Date;
  holdSeconds: number;
  graceSeconds?: number;
  /** Google, to check the drives either side of the start before it is held, where the routes provider is on. */
  drives?: DriveCheck | null;
}): Promise<Hold | null> {
  const { personId, service, date, window, price, from = "app" } = input;
  const [candidates, schedule, inputs] = await Promise.all([
    candidatesFor({ db, input, now }),
    loadSlotSchedule(db),
    readOpsInputs(db, now),
  ]);

  const at = now.toISOString();
  const expiresAt = new Date(now.getTime() + holdSeconds * 1000).toISOString();
  const roadFits = await roadCheck(db, { input, now, inputs, drives: drives ?? null, candidates });
  for (const { technician, time, startsAt, revision } of candidates) {
    if (!(await roadFits(technician.id, time))) continue;
    const id = crypto.randomUUID();
    const start = unitAt(time, schedule.on(date));
    const claims = claimsAt(time, service.minutes + inputs.bookingRules.wrap_up, revision);
    try {
      await db.batch([
        ...(input.alongside ?? []),
        ...releaseDeadHolds(db, now, from === "app" ? personId : null),
        insertRow(db, "slot_holds", holdRow(input, { id, technician, start, startsAt, at, expiresAt, graceSeconds })),
        ...claims.map((claim) =>
          db
            .prepare("INSERT INTO slot_claims (technician_id, date, claim, hold_id) VALUES (?1, ?2, ?3, ?4)")
            .bind(technician.id, date, claim, id),
        ),
        ...(input.afterHold?.(id) ?? []),
      ]);
      return { id, service, date, window, technician, startUnit: start, startsAt, price, expiresAt };
    } catch (error) {
      // Another hold took this technician's time, or changed their day, between the look and the write: the next one,
      // then. Any other
      // failure, a new number's person written twice at once say, is not a lost window.
      if (!failedUniqueOn(error, "slot_claims")) throw error;
    }
  }
  return null;
}

/** A hold's own time: its technician, day and start, and whose visit it is, where. */
interface HeldTime {
  readonly id: string;
  readonly person_id: string;
  readonly pincode: string | null;
  readonly type: VisitType;
  readonly minutes: number | null;
  readonly technician_id: string;
  readonly date: string;
  readonly window_label: BookingWindow;
  readonly start_unit: number;
  readonly starts_at: string | null;
}

/** The hold's start on India's clock: the one it keeps, or its half-slot's for a hold made before. */
async function heldTimeOf(db: D1Database, hold: HeldTime): Promise<string> {
  if (hold.starts_at !== null) return indiaTime(new Date(hold.starts_at));
  return (await loadSlotSchedule(db)).on(hold.date).unitStarts[hold.start_unit] ?? "09:00";
}

/**
 * Whether a hold's own time is still free on its technician's day: inside their hours and clear of leave, with room
 * for the drives either side, as booking plans a day (./day-plans.ts), with nothing but the hold itself and the visit
 * `exceptVisitId` left out. Gives the lock the hold's claims take where it is free; null where it is not.
 */
async function heldTimeRoom(
  db: D1Database,
  hold: HeldTime,
  now: Date,
  exceptVisitId: string | null,
): Promise<{ readonly time: string; readonly revision: number; readonly inputs: OpsInputs } | null> {
  const [inputs, time, pin] = await Promise.all([
    readOpsInputs(db, now),
    heldTimeOf(db, hold),
    pinOfVisit(db, { personId: hold.person_id, pincode: hold.pincode }),
  ]);
  const plans = await loadDayPlans({
    db,
    technicianIds: [hold.technician_id],
    from: hold.date,
    to: hold.date,
    now,
    hours: inputs.workingHours,
    leaving: { visitId: exceptVisitId, holdId: hold.id },
  });
  const day = plans.day(hold.technician_id, hold.date);
  if (day === null) return null;
  const visit = { minutes: heldMinutes(hold), pin, fit: isAFitting(hold.type) };
  if (placedAt(day, visit, minuteOf(time), planRulesOf(inputs)) === null) return null;
  return { time, revision: plans.revision(hold.technician_id, hold.date), inputs };
}

/** Whether a hold's own time is still free on its technician's day (heldTimeRoom). */
export async function heldTimeFree(
  db: D1Database,
  hold: HeldTime,
  now: Date,
  exceptVisitId: string | null = null,
): Promise<boolean> {
  return (await heldTimeRoom(db, hold, now, exceptVisitId)) !== null;
}

/**
 * Takes a hold that was let go back to held, on its own time, where nothing has taken that time since. False while it
 * stays let go; true once it is held again, here or by a try running alongside, or booked.
 */
export async function retakeSlot(db: D1Database, hold: HeldTime, now: Date): Promise<boolean> {
  const room = await heldTimeRoom(db, hold, now, null);
  if (room === null) return false;
  const claims = claimsAt(room.time, heldMinutes(hold) + room.inputs.bookingRules.wrap_up, room.revision);
  const isHeld = "EXISTS (SELECT 1 FROM slot_holds WHERE id = ?4 AND state = 'held')";
  try {
    await db.batch([
      ...releaseDeadHolds(db, now),
      db
        .prepare("UPDATE slot_holds SET state = 'held', updated_at = ?2 WHERE id = ?1 AND state = 'released'")
        .bind(hold.id, now.toISOString()),
      ...claims.map((claim) =>
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

/**
 * A fitted one visit's booking, owing the hair system's price by UPI at the visit while online payment is off
 * (docs/decisions/0209-paid-at-the-visit-by-upi.md): the amount, with its GST, as the price book had it on the day.
 */
export function oneVisitOwedAtVisit(
  db: D1Database,
  appointmentId: string,
  price: { readonly amount: number; readonly amount_ex_gst: number; readonly gst_percent: number },
  now: Date,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE slot_holds SET pay_at_visit = 1, amount = ?2, amount_ex_gst = ?3, gst_percent = ?4, updated_at = ?5
       WHERE appointment_id = ?1 AND one_visit = 1 AND state = 'booked'`,
    )
    .bind(appointmentId, price.amount, price.amount_ex_gst, price.gst_percent, now.toISOString());
}
