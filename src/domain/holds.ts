// A client's hold, as the app shows it (docs/decisions/0045-self-serve-booking.md): the window held for ten
// minutes while they pay, the service it is for, what it costs, with the discount code entered on it
// (docs/decisions/0108-discount-codes.md), and what became of it. Letting one go, and what Checkout is opened with. A hold is made by holdSlot (src/domain/scheduling.ts) and booked by startBooking
// (src/domain/bookings.ts).

import { withGst } from "../config/gst.ts";
import type { BookingWindow } from "../config/scheduling.ts";
import { windowTimesOf } from "../policy/slot-times.ts";
import { VISIT_TYPE_NAMES, type VisitType } from "../config/visit-types.ts";
import { indiaInstant } from "../lib/india-time.ts";
import {
  FREE_CHANGE_NOTICE_HOURS,
  freeUntil,
  LATE_CHANGE_CHARGES,
  LATE_FEES,
  type Charge,
} from "../policy/moving-a-visit.ts";
import { spendableCredits } from "./credits.ts";
import { holdDiscount } from "./discount-code-holds.ts";
import { lateFeeOn, type Price } from "./price-book.ts";
import { graceEndOf, graceEnds, heldMinutes, visitTimes } from "./scheduling.ts";
import { loadSlotSchedule } from "./slot-times.ts";

interface HoldRow {
  id: string;
  type: VisitType;
  tier: string;
  minutes: number | null;
  /** The service's name as it is now; null only where no service is the hold's kind and tier. */
  service_name: string | null;
  date: string;
  window_label: BookingWindow;
  start_unit: number;
  amount: number;
  amount_ex_gst: number;
  gst_percent: number;
  state: "held" | "booked" | "released";
  expires_at: string;
  /** The grace it was made with; null for a hold made before holds kept one. */
  grace_seconds: number | null;
  confirmed_at: string | null;
  late_fee_ex_gst: number | null;
  late_fee_gst_percent: number | null;
  /** The notice it was sold under, and what its kind costs inside it; null for a hold made before holds kept them. */
  change_notice_hours: number | null;
  late_change_charge: Charge | null;
  technician_name: string;
  technician_initials: string;
  appointment_id: string | null;
  moves_appointment_id: string | null;
  use_credit: number;
  person_id: string;
  paid: number;
}

const HOLD_QUERY = `SELECT h.id, h.type, h.tier, h.minutes, s.name AS service_name, h.date, h.window_label, h.start_unit,
    h.amount, h.amount_ex_gst, h.gst_percent, h.state, h.expires_at, h.grace_seconds, h.confirmed_at, h.late_fee_ex_gst,
    h.late_fee_gst_percent, h.change_notice_hours, h.late_change_charge, t.name AS technician_name, t.initials AS technician_initials, h.appointment_id,
    h.moves_appointment_id, h.use_credit, h.person_id,
    EXISTS (SELECT 1 FROM payments p WHERE p.razorpay_order_id = h.razorpay_order_id AND p.status = 'captured') AS paid
  FROM slot_holds h JOIN technicians t ON t.id = h.technician_id
  LEFT JOIN services s ON s.kind = h.type AND s.tier = h.tier
  WHERE h.id = ?1 AND h.person_id = ?2`;

/**
 * The late fee the hold was made under, where it was sold to charge one late; for a hold made before it kept one, the
 * price book's for its day.
 */
async function lateFeeOf(db: D1Database, row: HoldRow, charge: Charge): Promise<Price | null> {
  const item = LATE_FEES[row.type];
  if (item === undefined || charge !== "late_fee") return null;
  if (row.late_fee_ex_gst === null || row.late_fee_gst_percent === null) return lateFeeOn(db, item, row.date);
  return {
    amount_ex_gst: row.late_fee_ex_gst,
    amount: withGst(row.late_fee_ex_gst, row.late_fee_gst_percent),
    gst_percent: row.late_fee_gst_percent,
  };
}

/** A hold not paid for and past its ten minutes: the client may no longer pay for it. */
const hasLapsed = (row: HoldRow, now: Date) =>
  row.state === "held" && row.confirmed_at === null && row.expires_at <= now.toISOString();

async function holdOf(db: D1Database, row: HoldRow, now: Date) {
  const minutes = heldMinutes(row);
  const lateCharge = row.late_change_charge ?? LATE_CHANGE_CHARGES[row.type];
  const price = { amount_ex_gst: row.amount_ex_gst, amount: row.amount, gst_percent: row.gst_percent };
  const [schedule, lateFee, credit, discount] = await Promise.all([
    loadSlotSchedule(db),
    lateFeeOf(db, row, lateCharge),
    creditOn(db, row, now),
    holdDiscount(db, { id: row.id, price }),
  ]);
  const { start, end } = visitTimes(row.date, row.start_unit, minutes, schedule);
  const windowStarts = indiaInstant(row.date, windowTimesOf(schedule.on(row.date))[row.window_label].start);
  const noticeHours = row.change_notice_hours ?? FREE_CHANGE_NOTICE_HOURS;
  return {
    id: row.id,
    type: row.type,
    service: { tier: row.tier, name: row.service_name ?? VISIT_TYPE_NAMES[row.type], minutes },
    date: row.date,
    window: row.window_label,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    technician: { name: row.technician_name, initials: row.technician_initials },
    price,
    late_fee: lateFee,
    free_until: freeUntil(windowStarts, noticeHours).toISOString(),
    change_notice_hours: noticeHours,
    late_change_charge: lateCharge,
    expires_at: row.expires_at,
    pay_by: graceEndOf(row).toISOString(),
    state: hasLapsed(row, now) ? ("expired" as const) : row.state,
    paid: row.paid === 1,
    visit_id: row.appointment_id,
    moves_visit_id: row.moves_appointment_id,
    credit,
    discount,
  };
}

/**
 * The credit that pays for the hold, with the credits left once it is spent. Null when none does, including a hold not
 * yet confirmed whose credit another booking has taken since: booking it asks for payment.
 */
async function creditOn(db: D1Database, row: HoldRow, now: Date): Promise<{ remaining: number } | null> {
  if (row.use_credit !== 1) return null;
  const spendable = (await spendableCredits(db, row.person_id, now, row.id)).visits;
  if (row.state !== "held") return { remaining: spendable };
  if (row.confirmed_at === null && spendable === 0) return null;
  // Until the visit is booked, the credit it spends is still in the balance.
  return { remaining: Math.max(0, spendable - 1) };
}

/** One of the client's holds as the app shows it; null when there is no such hold of theirs. */
export async function clientHold(db: D1Database, holdId: string, personId: string, now: Date) {
  const row = await db.prepare(HOLD_QUERY).bind(holdId, personId).first<HoldRow>();
  return row === null ? null : holdOf(db, row, now);
}

/**
 * Lets a client's hold go, with the time it held. Once paid for, or booked free, it is on its way to FSM, and only
 * a booking or a refund ends it. Once it has a Razorpay order, it keeps its time until its grace ends, since a payment
 * on that order may still land; the next hold anyone makes after that lets it go.
 */
export async function releaseHold(db: D1Database, hold: { holdId: string; personId: string; now: Date }) {
  const mine = `SELECT id FROM slot_holds WHERE id = ?1 AND person_id = ?2 AND state = 'held' AND confirmed_at IS NULL
    AND (razorpay_order_id IS NULL OR ${graceEnds("slot_holds")} <= ?3)`;
  const at = hold.now.toISOString();
  await db.batch([
    db.prepare(`DELETE FROM slot_claims WHERE hold_id IN (${mine})`).bind(hold.holdId, hold.personId, at),
    db
      .prepare(`UPDATE slot_holds SET state = 'released', updated_at = ?3 WHERE id IN (${mine})`)
      .bind(hold.holdId, hold.personId, at),
  ]);
}

/** A visit on its way to FSM, as Home shows it until FSM has it. */
export interface BookingUnderWay {
  readonly type: VisitType;
  readonly date: string;
  readonly window: BookingWindow;
  /** Paid for in money, rather than free or covered by a credit. */
  readonly paid: boolean;
  /** A consultation and fit in one visit. */
  readonly one_visit: boolean;
}

/**
 * The client's soonest visit paid for, or booked free, that FSM does not have yet: on its way, or held after FSM
 * refused it (docs/decisions/0095-a-booking-fsm-refuses-is-held.md). It is neither booked nor refunded, and Home says
 * so. A move is not one: the visit it moves is booked, and Home shows that. Null with none.
 */
export async function bookingUnderWay(db: D1Database, personId: string): Promise<BookingUnderWay | null> {
  const row = await db
    .prepare(
      `SELECT type, date, window_label, amount, use_credit, one_visit FROM slot_holds
       WHERE person_id = ?1 AND state = 'held' AND confirmed_at IS NOT NULL AND moves_appointment_id IS NULL
       ORDER BY date, start_unit LIMIT 1`,
    )
    .bind(personId)
    .first<{
      type: VisitType;
      date: string;
      window_label: BookingWindow;
      amount: number;
      use_credit: number;
      one_visit: number;
    }>();
  if (row === null) return null;
  return {
    type: row.type,
    date: row.date,
    window: row.window_label,
    paid: row.amount > 0 && row.use_credit !== 1,
    one_visit: row.one_visit === 1,
  };
}

/** What Checkout names a hold's payment with, and prefills. */
export interface CheckoutHold {
  readonly type: VisitType;
  /** The hold's service, by its name as it is now; null only where no service is the hold's kind and tier. */
  readonly service_name: string | null;
  readonly amount: number;
  readonly date: string;
  readonly move_kind: "move" | "replace" | null;
  readonly name: string;
  readonly mobile_e164: string;
}

export function checkoutHold(db: D1Database, holdId: string): Promise<CheckoutHold | null> {
  return db
    .prepare(
      `SELECT h.type, s.name AS service_name, h.amount, h.date, h.move_kind, p.name, p.mobile_e164
       FROM slot_holds h JOIN people p ON p.id = h.person_id
       LEFT JOIN services s ON s.kind = h.type AND s.tier = h.tier
       WHERE h.id = ?1`,
    )
    .bind(holdId)
    .first<CheckoutHold>();
}
