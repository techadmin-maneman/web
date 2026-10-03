// A client moving or cancelling a visit (docs/decisions/0046-moving-and-cancelling.md).
//
// The terms come from src/policy/moving-a-visit.ts and are shown before the
// client confirms. A cancel is done here: FSM first where FSM holds the visit,
// then the mirror, then the refund. A refund the request could not settle is
// asked for by the cron's cancel_refunds job. A move is a hold like any booking: its price
// is what the move costs now, and confirmBooking moves the visit once that is
// paid (or at once, when free).
//
// A late fee is the one the visit was booked under, kept on its hold, so a
// price changed since does not change what moving it costs
// (docs/decisions/0068-a-paid-hold-is-kept.md). So are the notice and what the
// visit's kind costs inside it, which ops set in the console
// (docs/decisions/0088-every-policy-in-the-console.md). A credit comes back only
// to a grant that can still take it: not one clawed back or expired. After ops
// move a visit, the notice counts from its time before they moved it
// (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).

import type { FieldRecord } from "../config/field-record.ts";
import { STANDARD_TIER, type VisitType } from "../config/visit-types.ts";
import type { CallBudget } from "../lib/call-budget.ts";
import { MINUTE_MS } from "../lib/durations.ts";
import { addDays, indiaDate, indiaInstant } from "../lib/india-time.ts";
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
import { loadSlotSchedule, type SlotSchedule } from "./slot-times.ts";
import type { AlertOnce } from "./alerts.ts";
import type { OpsInputs } from "./ops-settings.ts";
import { lateFeeOn, priceOf, type Price } from "./price-book.ts";
import { ASKS, askRefund, refundReceipt } from "./refunds.ts";
import { bookedMinutes } from "./scheduling.ts";
import { windowTimesOf } from "../policy/slot-times.ts";
import { visitBegun } from "./visit-begun.ts";
import { visitMessage, visitMessageOnChange } from "./visit-messages.ts";
import { STEPS } from "./visit-status.ts";

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
  /** Null for a visit booked without FSM. */
  readonly fsmWorkOrderId: string | null;
}

/**
 * The client's visit, if they may still change it: ahead, not begun by FSM's status or by our own records, of one of
 * our types, and, where FSM holds it, with its work order.
 */
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
         AND a.type IS NOT NULL AND a.window_start > ?3 AND (a.fsm_work_order_id IS NOT NULL OR a.fsm_id = a.id)
         AND NOT ${visitBegun("a")}`,
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
      fsm_work_order_id: string | null;
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

/** When the visit's window starts, by the times in force on its day, which the 24 hours count back from. */
export function windowStartOf(start: Date, schedule: SlotSchedule): Date {
  const { date, window } = schedule.at(start);
  return indiaInstant(date, windowTimesOf(schedule.on(date))[window].start);
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
    lateFeeItem === undefined ? null : (sold?.lateFee ?? (await lateFeeOn(db, lateFeeItem, indiaDate(visit.start))));
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
  const windowStarts = windowStartOf(noticeFrom, await loadSlotSchedule(db));
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
  | {
      readonly kind: "cancelled";
      readonly refund: number;
      readonly kept: number;
      /** The refund could not be settled in the request, so the cron's cancel_refunds job asks for it. */
      readonly refundPending: boolean;
    }
  | { readonly kind: "not_changeable" };

/** The cancel's notice as the note FSM keeps says it: "more than 24 hours ahead", or "inside 24 hours". */
function noticeWords(terms: ChangeTerms): string {
  const hours = `${String(terms.noticeHours)} hours`;
  if (terms.notice === "late") return `inside ${hours}`;
  return terms.noticeFromBeforeMove
    ? `more than ${hours} before the time ops moved it from`
    : `more than ${hours} ahead`;
}

interface RefundDeps {
  readonly payments: PaymentsProvider;
  readonly alertOnce: AlertOnce;
}

interface CancelDeps extends RefundDeps {
  readonly fsm: FsmProvider;
  /** Queues the cancel's confirmation to the client. */
  readonly notify?: (messageId: string) => Promise<unknown>;
}

/** A cancel's refund still to be asked of Razorpay. */
interface OwedRefund {
  readonly changeId: string;
  readonly appointmentId: string;
  readonly personId: string;
  readonly razorpayPaymentId: string;
  /** In paise. */
  readonly amount: number;
}

/** The refund the cancel owes the client; null when it gives nothing back. */
function refundOwed(terms: ChangeTerms, changeId: string): OwedRefund | null {
  const { visit, payment, cancel } = terms;
  if (payment === null || cancel.refund === 0) return null;
  return {
    changeId,
    appointmentId: visit.id,
    personId: visit.personId,
    razorpayPaymentId: payment.razorpayPaymentId,
    amount: cancel.refund,
  };
}

/**
 * Cancels the visit on the terms given, then refunds what the terms give back. Where FSM holds the record, FSM cancels
 * its work order, and so its appointment, before the mirror is changed; otherwise the visit is cancelled in our own
 * database alone. The change is claimed first, so it happens once, and never once the visit has begun. Once the visit
 * is cancelled it stays cancelled, whatever fails after: a refund Razorpay refuses is left to ops, who are alerted,
 * and one the request could not settle is left to the cron's cancel_refunds job.
 */
export async function cancelVisit(
  db: D1Database,
  deps: CancelDeps,
  terms: ChangeTerms,
  now: Date,
  options: { labelAsTest: boolean; log: Logger; record: FieldRecord },
): Promise<Cancelled> {
  const changeId = crypto.randomUUID();
  const workOrderId = options.record === "fsm" ? terms.visit.fsmWorkOrderId : null;
  const messageId =
    workOrderId === null
      ? await cancelInOurDatabase(db, terms, changeId, now)
      : await cancelInFsm(db, deps.fsm, terms, { changeId, workOrderId }, now, options.labelAsTest);
  if (messageId === null) return { kind: "not_changeable" };
  const settled = await refundAtOnce(db, deps, refundOwed(terms, changeId), now, options.log);
  await tellClient(deps, messageId, options.log);
  return { kind: "cancelled", refund: terms.cancel.refund, kept: terms.cancel.kept, refundPending: !settled };
}

/**
 * The refund asked for in the request that cancelled the visit. A failure is logged and the refund left owed, for the
 * cron's cancel_refunds job: false then.
 */
async function refundAtOnce(
  db: D1Database,
  deps: RefundDeps,
  owed: OwedRefund | null,
  now: Date,
  log: Logger,
): Promise<boolean> {
  if (owed === null) return true;
  try {
    await settleRefund(db, deps, owed, now, log);
    return true;
  } catch (error) {
    log.error("cancel_refund_owed", { appointment_id: owed.appointmentId, error });
    return false;
  }
}

/** Queues the client's message. One the queue refuses is in the outbox, and the sweeper sends it minutes later. */
async function tellClient(deps: CancelDeps, messageId: string, log: Logger): Promise<void> {
  try {
    await deps.notify?.(messageId);
  } catch (error) {
    log.warn("cancel_message_not_queued", { message_id: messageId, error });
  }
}

/**
 * The cancel claimed as the visit's one change that ends it, only while it is still to come and has not begun. Its
 * refund is settled at once when it gives nothing back.
 */
function claimCancel(db: D1Database, terms: ChangeTerms, changeId: string, now: Date): D1PreparedStatement {
  const { visit, notice, payment, cancel } = terms;
  const settledAt = refundOwed(terms, changeId) === null ? now.toISOString() : null;
  return db
    .prepare(
      `INSERT INTO visit_changes (id, appointment_id, person_id, kind, notice, was_start, refund_amount, kept_amount,
         payment_id, created_at, refund_settled_at)
       SELECT ?1, ?2, ?3, 'cancelled', ?4, ?5, ?6, ?7, ?8, ?9, ?11 FROM appointments a
       WHERE a.id = ?2 AND a.deleted_at IS NULL AND a.status IN (SELECT value FROM json_each(?10))
         AND NOT ${visitBegun("a")}
       ON CONFLICT DO NOTHING`,
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
      now.toISOString(),
      JSON.stringify(STEPS.cancel.from),
      settledAt,
    );
}

/** A visit credit given back by the cancel. A clawback between the terms and the cancel still stops it coming back. */
function restoredCredit(db: D1Database, terms: ChangeTerms, changeId: string, now: Date): D1PreparedStatement[] {
  if (terms.credit?.outcome !== "restored") return [];
  return [
    db
      .prepare(
        `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
         SELECT ?1, ?2, 'restore', 1, ?3, 'appointment', ?4, ?5
         WHERE NOT EXISTS (SELECT 1 FROM credit_ledger WHERE grant_id = ?3 AND kind = 'clawback')
           AND EXISTS (SELECT 1 FROM visit_changes WHERE id = ?6)`,
      )
      .bind(
        crypto.randomUUID(),
        terms.visit.personId,
        terms.credit.grantId,
        terms.visit.id,
        now.toISOString(),
        changeId,
      ),
  ];
}

/**
 * The cancel in our own database, in one batch: the change claimed, the visit cancelled, the client's message and any
 * credit given back, each written only if the claim was. The message's ID, or null when the visit could not be
 * cancelled.
 */
async function cancelInOurDatabase(
  db: D1Database,
  terms: ChangeTerms,
  changeId: string,
  now: Date,
): Promise<string | null> {
  const { visit } = terms;
  const message = visitMessageOnChange(db, {
    personId: visit.personId,
    appointmentId: visit.id,
    kind: "cancel_confirmation",
    now,
    changeId,
  });
  const [claimed] = await db.batch([
    claimCancel(db, terms, changeId, now),
    db
      .prepare(
        `UPDATE appointments SET status = 'cancelled', synced_at = ?2
         WHERE id = ?1 AND EXISTS (SELECT 1 FROM visit_changes WHERE id = ?3)`,
      )
      .bind(visit.id, now.toISOString(), changeId),
    message.statement,
    ...restoredCredit(db, terms, changeId, now),
  ]);
  return claimed?.meta.changes === 1 ? message.id : null;
}

/**
 * The cancel in FSM, then in the mirror. The claim is let go again if FSM fails or will not cancel the work order. The
 * message's ID, or null when the visit could not be cancelled.
 */
async function cancelInFsm(
  db: D1Database,
  fsm: FsmProvider,
  terms: ChangeTerms,
  change: { readonly changeId: string; readonly workOrderId: string },
  now: Date,
  labelAsTest: boolean,
): Promise<string | null> {
  const { visit } = terms;
  const claimed = await claimCancel(db, terms, change.changeId, now).run();
  if (claimed.meta.changes !== 1) return null;

  const note = `${labelAsTest ? "Staging test: " : ""}Cancelled by the client in the app, ${noticeWords(terms)}.`;
  let done: boolean;
  try {
    done = await fsm.cancelVisit(change.workOrderId, note);
  } catch (error) {
    await db.prepare("DELETE FROM visit_changes WHERE id = ?1").bind(change.changeId).run();
    throw error;
  }
  if (!done) {
    await db.prepare("DELETE FROM visit_changes WHERE id = ?1").bind(change.changeId).run();
    return null;
  }
  const message = visitMessage(db, {
    personId: visit.personId,
    appointmentId: visit.id,
    kind: "cancel_confirmation",
    now,
  });
  await db.batch([
    db
      .prepare("UPDATE appointments SET status = 'cancelled', fsm_status = 'Cancelled', synced_at = ?1 WHERE id = ?2")
      .bind(now.toISOString(), visit.id),
    message.statement,
    ...restoredCredit(db, terms, change.changeId, now),
  ]);
  return message.id;
}

/**
 * Asks Razorpay for the cancel's refund under the cancel's receipt, so it is made once however often it is asked, then
 * marks it settled. One Razorpay refuses, or will not say it made, is left to ops, who are told first.
 */
async function settleRefund(
  db: D1Database,
  deps: RefundDeps,
  owed: OwedRefund,
  now: Date,
  log: Logger,
): Promise<void> {
  const asked = await askRefund(deps.payments, owed.razorpayPaymentId, {
    amount: owed.amount,
    notes: { appointment_id: owed.appointmentId, reason: "cancelled by the client" },
    receipt: refundReceipt({ kind: "cancel", appointmentId: owed.appointmentId }),
  });
  if (asked.kind !== "refunded") {
    log.error("cancel_refund_failed", { appointment_id: owed.appointmentId, outcome: asked.kind, error: asked.error });
    const what = `Rs. ${String(owed.amount / 100)} for visit ${owed.appointmentId}, cancelled by the client`;
    // Keyed on the visit, so ops are told once and a second refund by hand is not asked for.
    await deps.alertOnce({
      key: `cancel_refund_failed:${owed.appointmentId}`,
      message: refundLeftToOps(asked.kind, what, owed.razorpayPaymentId, owed.amount),
      link: `/clients/${owed.personId}`,
    });
  }
  const refundId = asked.kind === "refunded" ? asked.refundId : null;
  await db
    .prepare(
      `UPDATE visit_changes SET razorpay_refund_id = COALESCE(?1, razorpay_refund_id), refund_settled_at = ?2
       WHERE id = ?3`,
    )
    .bind(refundId, now.toISOString(), owed.changeId)
    .run();
}

/** Long after the request that cancelled has finished asking: each ask of Razorpay gives up after 10 seconds. */
const OWED_AFTER_MS = 10 * MINUTE_MS;
const OWED_PER_PASS = 10;

/**
 * Cancels whose refund the request that cancelled them did not settle, ten minutes on, oldest first: each is asked
 * for again, as many calls from the run's budget as a refund can make, and settled as the request would have. Only a
 * visit cancelled in our own record is refunded. Returns how many were settled.
 */
export async function settleOwedRefunds(
  db: D1Database,
  deps: RefundDeps & { readonly budget: CallBudget; readonly log: Logger },
  now: Date,
): Promise<number> {
  let settled = 0;
  for (const owed of await owedRefunds(db, now)) {
    if (!deps.budget.spend(ASKS)) break;
    await settleRefund(db, deps, owed, now, deps.log);
    settled += 1;
  }
  return settled;
}

async function owedRefunds(db: D1Database, now: Date): Promise<OwedRefund[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.appointment_id, c.person_id, c.refund_amount, p.razorpay_payment_id
       FROM visit_changes c
         JOIN payments p ON p.id = c.payment_id
         JOIN appointments a ON a.id = c.appointment_id
       WHERE c.kind = 'cancelled' AND c.refund_settled_at IS NULL AND c.created_at <= ?1
         AND c.refund_amount > 0 AND a.status = 'cancelled'
       ORDER BY c.created_at LIMIT ?2`,
    )
    .bind(new Date(now.getTime() - OWED_AFTER_MS).toISOString(), OWED_PER_PASS)
    .all<{
      id: string;
      appointment_id: string;
      person_id: string;
      refund_amount: number;
      razorpay_payment_id: string;
    }>();
  return results.map((row) => ({
    changeId: row.id,
    appointmentId: row.appointment_id,
    personId: row.person_id,
    razorpayPaymentId: row.razorpay_payment_id,
    amount: row.refund_amount,
  }));
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
