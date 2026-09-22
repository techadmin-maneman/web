// A client moving or cancelling a visit (docs/decisions/0046-moving-and-cancelling.md).
//
// The terms come from src/policy/moving-a-visit.ts and are shown before the
// client confirms. A cancel is done here: FSM first, then the mirror, then the
// refund. A move is a hold like any booking: its price is what the move costs
// now, and confirmBooking moves the visit once that is paid (or at once, when
// free).

import { WINDOW_TIMES } from "../config/scheduling.ts";
import type { VisitType } from "../config/visit-types.ts";
import { addDays, indiaDate, indiaInstant, indiaTime } from "../lib/india-time.ts";
import type { Logger } from "../log.ts";
import {
  cancelRefund,
  freeUntil,
  LATE_FEES,
  moveCost,
  noticeAt,
  type MoveCost,
  type Notice,
} from "../policy/moving-a-visit.ts";
import type { FsmProvider } from "../providers/fsm.ts";
import type { PaymentsProvider } from "../providers/razorpay.ts";
import { priceOf, type Price } from "./price-book.ts";
import { windowAt } from "./scheduling.ts";

export interface ChangeableVisit {
  readonly id: string;
  readonly personId: string;
  readonly type: VisitType;
  readonly start: Date;
  readonly technicianId: string | null;
  readonly fsmId: string;
  readonly fsmWorkOrderId: string;
}

/** The client's visit, if they may still change it: ahead, not started, of one of our types, with its work order. */
export async function changeableVisit(
  db: D1Database,
  personId: string,
  visitId: string,
  now: Date,
): Promise<ChangeableVisit | null> {
  const row = await db
    .prepare(
      `SELECT id, person_id, type, window_start, technician_id, fsm_id, fsm_work_order_id FROM appointments
       WHERE id = ?1 AND person_id = ?2 AND deleted_at IS NULL AND status IN ('scheduled', 'dispatched')
         AND type IS NOT NULL AND window_start > ?3 AND fsm_work_order_id IS NOT NULL`,
    )
    .bind(visitId, personId, now.toISOString())
    .first<{
      id: string;
      person_id: string;
      type: VisitType;
      window_start: string;
      technician_id: string | null;
      fsm_id: string;
      fsm_work_order_id: string;
    }>();
  if (row === null) return null;
  return {
    id: row.id,
    personId: row.person_id,
    type: row.type,
    start: new Date(row.window_start),
    technicianId: row.technician_id,
    fsmId: row.fsm_id,
    fsmWorkOrderId: row.fsm_work_order_id,
  };
}

/** When the visit's window starts, which the 24 hours count back from. */
export function windowStartOf(start: Date): Date {
  return indiaInstant(indiaDate(start), WINDOW_TIMES[windowAt(indiaTime(start))].start);
}

export interface VisitPayment {
  readonly id: string;
  readonly razorpayPaymentId: string;
  /** In paise: what was paid for the visit and not yet refunded. */
  readonly paid: number;
  readonly method: string | null;
}

/** The payment for the visit itself (not a late fee), if it was paid for. */
export async function visitPayment(db: D1Database, visitId: string): Promise<VisitPayment | null> {
  const row = await db
    .prepare(
      `SELECT id, razorpay_payment_id, amount - refunded_amount AS paid, method FROM payments
       WHERE appointment_id = ?1 AND kind = 'visit' AND status IN ('captured', 'partially_refunded')
       ORDER BY captured_at LIMIT 1`,
    )
    .bind(visitId)
    .first<{ id: string; razorpay_payment_id: string; paid: number; method: string | null }>();
  return row === null
    ? null
    : { id: row.id, razorpayPaymentId: row.razorpay_payment_id, paid: row.paid, method: row.method };
}

const ZERO = (gstPercent: number): Price => ({ amount_ex_gst: 0, amount: 0, gst_percent: gstPercent });

export interface ChangeTerms {
  readonly visit: ChangeableVisit;
  readonly notice: Notice;
  readonly freeUntil: Date;
  readonly payment: VisitPayment | null;
  /** What moving costs, and what is paid now to move: nothing, the late fee, or the new visit's price. */
  readonly move: { readonly cost: MoveCost; readonly price: Price };
  /** In paise: what cancelling gives back, and what it keeps. */
  readonly cancel: { readonly refund: number; readonly kept: number };
}

/**
 * The terms of changing the visit now. `on` is the day a new visit would be priced on, for a charged move: the
 * first day one can be booked, unless the client has picked one.
 */
export async function changeTerms(
  db: D1Database,
  visit: ChangeableVisit,
  now: Date,
  on: string = addDays(indiaDate(now), 1),
): Promise<ChangeTerms> {
  const windowStarts = windowStartOf(visit.start);
  const notice = noticeAt(windowStarts, now);
  const payment = await visitPayment(db, visit.id);
  const paid = payment?.paid ?? 0;
  const lateFeeItem = LATE_FEES[visit.type];
  const lateFee = lateFeeItem === undefined ? null : await priceOf(db, lateFeeItem, indiaDate(visit.start));
  const visitPrice = await priceOf(db, visit.type, on);
  const gst = visitPrice?.gst_percent ?? 0;

  const cost = moveCost(visit.type, notice, "client");
  const movePrice =
    cost === "late_fee" ? (lateFee ?? ZERO(gst)) : cost === "charged" ? (visitPrice ?? ZERO(gst)) : ZERO(gst);

  const refunding = cancelRefund(visit.type, notice);
  const refund =
    refunding === "all" ? paid : refunding === "all_but_fee" ? Math.max(0, paid - (lateFee?.amount ?? 0)) : 0;
  return {
    visit,
    notice,
    freeUntil: freeUntil(windowStarts),
    payment,
    move: { cost, price: movePrice },
    cancel: { refund, kept: paid - refund },
  };
}

export type Cancelled =
  { readonly kind: "cancelled"; readonly refund: number; readonly kept: number } | { readonly kind: "not_changeable" };

/**
 * Cancels the visit on the terms given: in FSM (its work order, and so its appointment), then in the mirror,
 * then refunds what the terms give back. The change is claimed first, so it happens once. A refund Razorpay
 * refuses is left to ops, who are alerted; the visit stays cancelled.
 */
export async function cancelVisit(
  db: D1Database,
  deps: { fsm: FsmProvider; payments: PaymentsProvider; alert: (message: string) => Promise<void> },
  terms: ChangeTerms,
  now: Date,
  { labelAsTest, log }: { labelAsTest: boolean; log: Logger },
): Promise<Cancelled> {
  const { visit, notice, payment, cancel } = terms;
  const at = now.toISOString();
  const changeId = crypto.randomUUID();
  const claimed = await db
    .prepare(
      `INSERT INTO visit_changes (id, appointment_id, person_id, kind, notice, was_start, refund_amount, kept_amount,
         payment_id, created_at)
       VALUES (?1, ?2, ?3, 'cancelled', ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT DO NOTHING RETURNING id`,
    )
    .bind(
      changeId,
      visit.id,
      visit.personId,
      notice,
      visit.start.toISOString(),
      cancel.refund,
      cancel.kept,
      payment?.id ?? null,
      at,
    )
    .first();
  if (claimed === null) return { kind: "not_changeable" };

  const note = `${labelAsTest ? "Staging test: " : ""}Cancelled by the client in the app, ${
    notice === "free" ? "more than 24 hours ahead" : "inside 24 hours"
  }.`;
  let done: boolean;
  try {
    done = await deps.fsm.cancelVisit(visit.fsmWorkOrderId, note);
  } catch (error) {
    await db.prepare("DELETE FROM visit_changes WHERE id = ?1").bind(changeId).run();
    throw error;
  }
  if (!done) {
    await db.prepare("DELETE FROM visit_changes WHERE id = ?1").bind(changeId).run();
    return { kind: "not_changeable" };
  }
  await db
    .prepare("UPDATE appointments SET status = 'cancelled', fsm_status = 'Cancelled', synced_at = ?1 WHERE id = ?2")
    .bind(at, visit.id)
    .run();

  if (payment !== null && cancel.refund > 0) {
    try {
      const refund = await deps.payments.refund(payment.razorpayPaymentId, {
        amount: cancel.refund,
        notes: { appointment_id: visit.id, reason: "cancelled by the client" },
      });
      await db
        .prepare("UPDATE visit_changes SET razorpay_refund_id = ?1 WHERE id = ?2")
        .bind(refund.id, changeId)
        .run();
    } catch (error) {
      log.error("cancel_refund_failed", { appointment_id: visit.id, error });
      await deps.alert(`A cancelled visit's refund failed; refund ${String(cancel.refund / 100)} rupees by hand.`);
    }
  }
  return { kind: "cancelled", refund: cancel.refund, kept: cancel.kept };
}
