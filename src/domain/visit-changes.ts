// A client moving or cancelling a visit (docs/decisions/0046-moving-and-cancelling.md).
//
// The terms come from src/policy/moving-a-visit.ts and are shown before the
// client confirms. A cancel is done here: FSM first, then the mirror, then the
// refund. A move is a hold like any booking: its price is what the move costs
// now, and confirmBooking moves the visit once that is paid (or at once, when
// free).
//
// A late fee is the one the visit was booked under, kept on its hold, so a
// price changed since does not change what moving it costs
// (docs/decisions/0068-a-paid-hold-is-kept.md). So are the notice and what the
// visit's kind costs inside it, which ops set in the console
// (docs/decisions/0088-every-policy-in-the-console.md). A credit comes back only
// to a grant that can still take it: not one clawed back or expired. After ops
// move a visit, the notice counts from its time before they moved it
// (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).

import { WINDOW_TIMES } from "../config/scheduling.ts";
import { STANDARD_TIER, type VisitType } from "../config/visit-types.ts";
import { addDays, indiaDate, indiaInstant, indiaTime } from "../lib/india-time.ts";
import type { Logger } from "../log.ts";
import { withGst } from "../config/gst.ts";
import {
  cancelRefund,
  creditOnChange,
  FREE_CHANGE_NOTICE_HOURS,
  freeUntil,
  LATE_CHANGE_CHARGES,
  LATE_FEES,
  moveCost,
  noticeAt,
  noticeCountsFrom,
  type CancelRefund,
  type Charge,
  type CreditOnChange,
  type MoveCost,
  type Notice,
  type SoldTerms,
} from "../policy/moving-a-visit.ts";
import { NO_SHOW_CHARGES } from "../policy/no-show.ts";
import { ONE_VISIT_TERMS } from "../policy/one-visit.ts";
import type { FsmProvider } from "../providers/fsm.ts";
import type { PaymentsProvider } from "../providers/payments.ts";
import type { AlertOnce } from "./alerts.ts";
import type { OpsInputs } from "./ops-settings.ts";
import { priceOf, type Price } from "./price-book.ts";
import { askRefund, refundReceipt } from "./refunds.ts";
import { bookedMinutes } from "./scheduling.ts";
import { windowAt } from "../policy/windows.ts";
import { visitMessage } from "./visit-messages.ts";

export interface ChangeableVisit {
  readonly id: string;
  readonly personId: string;
  readonly type: VisitType;
  /** Its service's tier: the standard tier's where the mirror knows no other. */
  readonly tier: string;
  /** How long it is, which a move keeps (src/policy/visit-length.ts). */
  readonly minutes: number;
  readonly start: Date;
  /** When it started before ops moved it, while it stands where they put it; null otherwise. */
  readonly startBeforeMove: Date | null;
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
      `SELECT a.id, a.person_id, a.type, a.tier, a.window_start, a.window_end, a.start_before_move, a.technician_id,
         a.fsm_id, a.fsm_work_order_id, s.minutes AS service_minutes
       FROM appointments a LEFT JOIN services s ON s.kind = a.type AND s.tier = COALESCE(a.tier, 'standard')
       WHERE a.id = ?1 AND a.person_id = ?2 AND a.deleted_at IS NULL AND a.status IN ('scheduled', 'dispatched')
         AND a.type IS NOT NULL AND a.window_start > ?3 AND a.fsm_work_order_id IS NOT NULL`,
    )
    .bind(visitId, personId, now.toISOString())
    .first<{
      id: string;
      person_id: string;
      type: VisitType;
      tier: string | null;
      window_start: string;
      window_end: string | null;
      start_before_move: string | null;
      technician_id: string | null;
      fsm_id: string;
      fsm_work_order_id: string;
      service_minutes: number | null;
    }>();
  if (row === null) return null;
  return {
    id: row.id,
    personId: row.person_id,
    type: row.type,
    tier: row.tier ?? STANDARD_TIER,
    minutes: bookedMinutes(row),
    start: new Date(row.window_start),
    startBeforeMove: row.start_before_move === null ? null : new Date(row.start_before_move),
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

/** What a move is paid with: the late fee, or the visit again, or nothing. */
function movePriceOf(cost: MoveCost, prices: { lateFee: Price | null; visit: Price | null; gst: number }): Price {
  if (cost === "late_fee") return prices.lateFee ?? ZERO(prices.gst);
  if (cost === "charged") return prices.visit ?? ZERO(prices.gst);
  return ZERO(prices.gst);
}

/** What cancelling gives back of what was paid, in paise; a charged no-show gives back the same (src/domain/no-shows.ts). */
export function refundOf(refunding: CancelRefund, paid: number, lateFee: Price | null): number {
  if (refunding === "all") return paid;
  if (refunding === "all_but_fee") return Math.max(0, paid - (lateFee?.amount ?? 0));
  return 0;
}

export interface ChangeTerms {
  readonly visit: ChangeableVisit;
  readonly notice: Notice;
  /** The notice the visit was booked under, in hours. */
  readonly noticeHours: number;
  /** Whether the notice counts from the visit's time before ops moved it, which is later than its own. */
  readonly noticeFromBeforeMove: boolean;
  /**
   * The terms the visit is changed under: those it was sold under, or, for a visit ops booked in FSM, those in force.
   * A move in place carries them, and the late fee below, to the visit's new time.
   */
  readonly sold: SoldTerms;
  /** The late fee the visit was sold under, or its kind's on its day; null for a kind with none. */
  readonly lateFee: Price | null;
  readonly freeUntil: Date;
  readonly payment: VisitPayment | null;
  /** What moving costs, and what is paid now to move: nothing, the late fee, or the new visit's price. */
  readonly move: { readonly cost: MoveCost; readonly price: Price };
  /** In paise: what cancelling gives back, and what it keeps. */
  readonly cancel: { readonly refund: number; readonly kept: number };
  /** For a visit paid with a credit: the grant it came from, and whether changing the visit now gives it back. */
  readonly credit: { readonly grantId: string; readonly outcome: CreditOnChange } | null;
}

/** The terms a booking of this kind is sold under now, as ops set them. */
export const termsInForce = (
  inputs: Pick<OpsInputs, "changeNoticeHours" | "lateChangeCharges" | "noShowCharges">,
  type: VisitType,
): SoldTerms => ({
  noticeHours: inputs.changeNoticeHours,
  lateCharge: inputs.lateChangeCharges[type],
  noShowCharge: inputs.noShowCharges[type],
});

/** The committed terms, which a visit booked before holds kept theirs was sold under. */
const committedTerms = (type: VisitType): SoldTerms => ({
  noticeHours: FREE_CHANGE_NOTICE_HOURS,
  lateCharge: LATE_CHANGE_CHARGES[type],
  noShowCharge: NO_SHOW_CHARGES[type],
});

interface Sold {
  /** The late fee kept on the hold; null where it kept none. */
  readonly lateFee: Price | null;
  readonly terms: SoldTerms;
}

/** A visit as its terms are read: which it is, its kind, and when it starts, whose day prices a late fee. */
type SoldVisit = Pick<ChangeableVisit, "id" | "type" | "start">;

/**
 * What the visit was sold under, kept on the hold that booked it: its late fee and its terms. Null for a visit ops
 * booked in FSM, which no hold sold. A term the hold kept no figure for is the committed one.
 */
async function soldWith(db: D1Database, visit: SoldVisit): Promise<Sold | null> {
  const held = await db
    .prepare(
      `SELECT late_fee_ex_gst, late_fee_gst_percent, change_notice_hours, late_change_charge, no_show_charge
       FROM slot_holds WHERE appointment_id = ?1 AND state = 'booked'
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .bind(visit.id)
    .first<{
      late_fee_ex_gst: number | null;
      late_fee_gst_percent: number | null;
      change_notice_hours: number | null;
      late_change_charge: Charge | null;
      no_show_charge: Charge | null;
    }>();
  if (held === null) return null;
  const committed = committedTerms(visit.type);
  const lateFee =
    held.late_fee_ex_gst === null || held.late_fee_gst_percent === null
      ? null
      : {
          amount_ex_gst: held.late_fee_ex_gst,
          amount: withGst(held.late_fee_ex_gst, held.late_fee_gst_percent),
          gst_percent: held.late_fee_gst_percent,
        };
  return {
    lateFee,
    terms: {
      noticeHours: held.change_notice_hours ?? committed.noticeHours,
      lateCharge: held.late_change_charge ?? committed.lateCharge,
      noShowCharge: held.no_show_charge ?? committed.noShowCharge,
    },
  };
}

/** Whether the visit is a consultation and fit in one visit, as ops book one in FSM while booking is off. */
async function isOneVisit(db: D1Database, visitId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 FROM appointments WHERE id = ?1 AND one_visit IS NOT NULL")
    .bind(visitId)
    .first();
  return row !== null;
}

/**
 * The terms the visit was sold under and its late fee, from the hold that booked it; for a visit ops booked in FSM,
 * which no hold sold, the terms in force (`inForce`) and its kind's late fee on its day, or, for a one visit, what
 * every one visit is sold under (src/policy/one-visit.ts). A client's change is judged by them, and so is a
 * no-show's charge (src/domain/no-shows.ts).
 */
export async function termsOfVisit(
  db: D1Database,
  visit: SoldVisit,
  inForce: SoldTerms,
): Promise<{ readonly terms: SoldTerms; readonly lateFee: Price | null }> {
  const sold = await soldWith(db, visit);
  if (sold === null && (await isOneVisit(db, visit.id))) return { terms: ONE_VISIT_TERMS, lateFee: null };
  const lateFeeItem = LATE_FEES[visit.type];
  const lateFee =
    lateFeeItem === undefined ? null : (sold?.lateFee ?? (await priceOf(db, lateFeeItem, indiaDate(visit.start))));
  return { terms: sold?.terms ?? inForce, lateFee };
}

/** The credit a visit was paid with, if it was, and whether its grant could take it back now. */
async function creditOf(
  db: D1Database,
  visitId: string,
  change: { readonly notice: Notice; readonly charge: Charge },
  now: Date,
): Promise<ChangeTerms["credit"]> {
  const redeemed = await db
    .prepare(
      `SELECT r.grant_id, g.expires_at,
         EXISTS (SELECT 1 FROM credit_ledger c WHERE c.grant_id = r.grant_id AND c.kind = 'clawback') AS clawed_back
       FROM credit_ledger r JOIN credit_ledger g ON g.id = r.grant_id
       WHERE r.kind = 'redeem' AND r.source_id = ?1
         AND NOT EXISTS (SELECT 1 FROM credit_ledger x WHERE x.kind = 'restore' AND x.source_id = ?1)`,
    )
    .bind(visitId)
    .first<{ grant_id: string; expires_at: string | null; clawed_back: number }>();
  if (redeemed === null) return null;
  const grantLive =
    redeemed.clawed_back === 0 && (redeemed.expires_at === null || redeemed.expires_at > now.toISOString());
  return { grantId: redeemed.grant_id, outcome: grantLive ? creditOnChange(change.notice, change.charge) : "lost" };
}

/**
 * The terms of changing the visit now, under the terms it was booked under, or, for a visit ops booked in FSM, those
 * in force (`inForce`). The notice counts from the visit's time before ops moved it, where that is later. `on` is the
 * day a new visit would be priced on, for a charged move: the first day one can be booked, unless the client has
 * picked one.
 */
export async function changeTerms(
  db: D1Database,
  visit: ChangeableVisit,
  now: Date,
  inForce: SoldTerms,
  on: string = addDays(indiaDate(now), 1),
): Promise<ChangeTerms> {
  const { terms, lateFee } = await termsOfVisit(db, visit, inForce);
  const noticeFrom = noticeCountsFrom(visit.start, visit.startBeforeMove);
  const windowStarts = windowStartOf(noticeFrom);
  const notice = noticeAt(windowStarts, now, terms.noticeHours);
  const payment = await visitPayment(db, visit.id);
  const paid = payment?.paid ?? 0;
  // A charged move books a new visit of the same service, at its price on the day.
  const visitPrice = await priceOf(db, visit.type, on, visit.tier);
  const gst = visitPrice?.gst_percent ?? 0;

  const cost = moveCost(visit.type, notice, "client", terms.lateCharge);
  const movePrice = movePriceOf(cost, { lateFee, visit: visitPrice, gst });

  const refund = refundOf(cancelRefund(visit.type, notice, terms.lateCharge), paid, lateFee);
  return {
    visit,
    notice,
    noticeHours: terms.noticeHours,
    noticeFromBeforeMove: noticeFrom !== visit.start,
    sold: terms,
    lateFee,
    freeUntil: freeUntil(windowStarts, terms.noticeHours),
    payment,
    move: { cost, price: movePrice },
    cancel: { refund, kept: paid - refund },
    credit: await creditOf(db, visit.id, { notice, charge: terms.lateCharge }, now),
  };
}

export type Cancelled =
  { readonly kind: "cancelled"; readonly refund: number; readonly kept: number } | { readonly kind: "not_changeable" };

/** The cancel's notice as the note FSM keeps says it: "more than 24 hours ahead", or "inside 24 hours". */
function noticeWords(terms: ChangeTerms): string {
  const hours = `${String(terms.noticeHours)} hours`;
  if (terms.notice === "late") return `inside ${hours}`;
  return terms.noticeFromBeforeMove
    ? `more than ${hours} before the time ops moved it from`
    : `more than ${hours} ahead`;
}

/**
 * Cancels the visit on the terms given: in FSM (its work order, and so its appointment), then in the mirror,
 * then refunds what the terms give back. The change is claimed first, so it happens once. A refund Razorpay
 * refuses is left to ops, who are alerted; the visit stays cancelled.
 */
export async function cancelVisit(
  db: D1Database,
  deps: {
    fsm: FsmProvider;
    payments: PaymentsProvider;
    alertOnce: AlertOnce;
    /** Queues the cancel's confirmation to the client. */
    notify?: (messageId: string) => Promise<unknown>;
  },
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

  const note = `${labelAsTest ? "Staging test: " : ""}Cancelled by the client in the app, ${noticeWords(terms)}.`;
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
  const message = visitMessage(db, {
    personId: visit.personId,
    appointmentId: visit.id,
    kind: "cancel_confirmation",
    now,
  });
  // A clawback between the terms and the cancel still stops the credit coming back.
  const restore =
    terms.credit?.outcome === "restored"
      ? [
          db
            .prepare(
              `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
               SELECT ?1, ?2, 'restore', 1, ?3, 'appointment', ?4, ?5
               WHERE NOT EXISTS (SELECT 1 FROM credit_ledger WHERE grant_id = ?3 AND kind = 'clawback')`,
            )
            .bind(crypto.randomUUID(), visit.personId, terms.credit.grantId, visit.id, at),
        ]
      : [];
  await db.batch([
    db
      .prepare("UPDATE appointments SET status = 'cancelled', fsm_status = 'Cancelled', synced_at = ?1 WHERE id = ?2")
      .bind(at, visit.id),
    message.statement,
    ...restore,
  ]);

  if (payment !== null && cancel.refund > 0) {
    const asked = await askRefund(deps.payments, payment.razorpayPaymentId, {
      amount: cancel.refund,
      notes: { appointment_id: visit.id, reason: "cancelled by the client" },
      receipt: refundReceipt({ kind: "cancel", appointmentId: visit.id }),
    });
    if (asked.kind === "refunded" && asked.refundId !== null) {
      await db
        .prepare("UPDATE visit_changes SET razorpay_refund_id = ?1 WHERE id = ?2")
        .bind(asked.refundId, changeId)
        .run();
    }
    if (asked.kind !== "refunded") {
      log.error("cancel_refund_failed", { appointment_id: visit.id, outcome: asked.kind, error: asked.error });
      const what = `Rs. ${String(cancel.refund / 100)} for visit ${visit.id}, cancelled by the client`;
      // Keyed on the visit, so ops are told once and a second refund by hand is not asked for.
      await deps.alertOnce({
        key: `cancel_refund_failed:${visit.id}`,
        message: refundLeftToOps(asked.kind, what, payment.razorpayPaymentId, cancel.refund),
        link: `/clients/${visit.personId}`,
      });
    }
  }
  await deps.notify?.(message.id);
  return { kind: "cancelled", refund: cancel.refund, kept: cancel.kept };
}

/**
 * What ops are told to do with a refund Razorpay did not make, or would not say it made
 * (docs/decisions/0100-a-refund-is-made-once.md). `what` is the amount and the visit, as "Rs. 500 for visit …".
 */
export function refundLeftToOps(
  outcome: "refused" | "unanswered",
  what: string,
  paymentId: string,
  amount: number,
): string {
  if (outcome === "refused") {
    return `The refund of ${what}, failed (Razorpay payment ${paymentId}). Refund it by hand in Razorpay, once.`;
  }
  return (
    `Razorpay did not answer the refund of ${what} (payment ${paymentId}), so it may have been made. Look at the ` +
    `payment in Razorpay, and refund it by hand only if no refund of Rs. ${String(amount / 100)} is there.`
  );
}
