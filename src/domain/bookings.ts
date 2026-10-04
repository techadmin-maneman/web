// A held window, booked (docs/decisions/0045-self-serve-booking.md, 0068-a-paid-hold-is-kept.md).
//
// A paid visit starts as a Razorpay order for the hold. Razorpay's webhook confirms the capture and books the visit in
// one batch; the request that confirms a free visit books it the same way. A hold the client has paid for, or booked
// free, keeps its time until it is booked or refunded: one whose request failed part-way is booked by the cron within
// the half hour. A payment is in time if Razorpay made it before the hold ran out, give or take the grace; one made
// later is refunded in full.
//
// A hold that moves a visit (docs/decisions/0046-moving-and-cancelling.md) either moves it in place, once its late fee
// is paid or at once when free, or books a new visit and cancels the old one, whose payment is kept. A visit the
// technician has begun is never moved or cancelled this way.
//
// A visit is booked for the length its hold was made with, and carries the hold's tier, since the hold is what was
// sold (docs/decisions/0085-services-ops-can-edit.md).

import type { BookingWindow } from "../config/scheduling.ts";
import type { VisitType } from "../config/visit-types.ts";
import type { CallBudget } from "../lib/call-budget.ts";
import { createLogger, failureReason, type Logger } from "../log.ts";
import type { PaymentsProvider } from "../providers/payments.ts";
import type { AlertOnce, ResolveAlert } from "./alerts.ts";
import { creditRedeemedFor, redeemCreditForBooking, SPENDABLE_CREDITS } from "./credits.ts";
import { askRefund, refundReceipt } from "./refunds.ts";
import { graceEndOf, heldVisitTimes, liveVisitOf, retakeSlot } from "./scheduling.ts";
import { hasBegun, visitBegun } from "./visit-begun.ts";
import { visitPayment } from "./visit-changes.ts";
import { visitMessage, type VisitMessageKind } from "./visit-messages.ts";
import { moveVisit } from "./visit-status.ts";
import { MINUTE_MS } from "../lib/durations.ts";

export interface ConfirmOptions {
  /** Queues a message about the visit once its row is written (src/domain/visit-messages.ts). */
  readonly notify?: (messageId: string) => Promise<unknown>;
  /** Tells ops, once, of something they must put right by hand (src/domain/alerts.ts). */
  readonly alertOnce?: AlertOnce;
  readonly log?: Logger;
}

interface HoldRow {
  id: string;
  person_id: string;
  type: VisitType;
  tier: string;
  /** The length it was held for; null for a hold made before services had lengths. */
  minutes: number | null;
  date: string;
  window_label: BookingWindow;
  start_unit: number;
  technician_id: string;
  amount: number;
  state: "held" | "booked" | "released";
  expires_at: string;
  /** The grace it was made with; null for a hold made before holds kept one. */
  grace_seconds: number | null;
  confirmed_at: string | null;
  razorpay_order_id: string | null;
  appointment_id: string | null;
  moves_appointment_id: string | null;
  move_kind: "move" | "replace" | null;
  use_credit: number;
  /** 1 for a consultation and fit in one visit, booked from the site with nothing paid (ADR 0105). */
  one_visit: number;
  /** 1 for a visit ops booked that the client pays for by the payment link ops sent, and by nothing else. */
  pay_by_link: number;
  /** Set as its refund is asked of Razorpay, and cleared only if Razorpay refuses it. */
  refunded_at: string | null;
  pincode: string | null;
  /** The pincode's city, where it is one we know. */
  city: string | null;
}

async function holdOf(db: D1Database, holdId: string): Promise<HoldRow | null> {
  return db
    .prepare(
      `SELECT h.id, h.person_id, h.type, h.tier, h.minutes, h.date, h.window_label, h.start_unit, h.technician_id,
              h.amount, h.state, h.expires_at, h.grace_seconds, h.confirmed_at, h.razorpay_order_id, h.appointment_id,
              h.moves_appointment_id, h.move_kind, h.use_credit, h.one_visit, h.pay_by_link, h.refunded_at, h.pincode,
              sp.city
       FROM slot_holds h LEFT JOIN serviceable_pincodes sp ON sp.pincode = h.pincode
       WHERE h.id = ?1`,
    )
    .bind(holdId)
    .first<HoldRow>();
}

/** Whether the client pays money for it: not a free visit, and not one a credit covers. */
const paidInMoney = (hold: { amount: number; use_credit: number }) => hold.amount > 0 && hold.use_credit !== 1;

export type Started = { readonly kind: "free" } | { readonly kind: "pay"; readonly orderId: string };

/**
 * A hold's price may change while its order is made, by a discount code entered or taken off, or as another booking
 * takes the credit that was to pay for it; then it is made again.
 */
const BOOKING_TRIES = 2;

/**
 * Starts paying for the client's live hold: its Razorpay order, made once, or, for a free visit, the hold
 * confirmed. Null when the hold is not live, when it is paid for by the link ops sent, or when a consultation or first
 * fit like it has been booked since.
 */
export async function startBooking(
  db: D1Database,
  payments: PaymentsProvider,
  holdId: string,
  personId: string,
  now: Date,
): Promise<Started | null> {
  for (let tries = 0; tries < BOOKING_TRIES; tries += 1) {
    const started = await tryStartBooking(db, payments, holdId, personId, now);
    if (started !== "price_changed") return started;
  }
  return null;
}

/**
 * One try. The hold's price is read, and the order made for it, or the hold confirmed free; each is written only while
 * the hold still costs what was read, so an order is never kept for a price a discount code changed meanwhile
 * (docs/decisions/0108-discount-codes.md), and the try answers "price_changed" for the next. A credit hold whose
 * credit another booking has taken is paid for in money from then on, so the next try makes its order.
 */
async function tryStartBooking(
  db: D1Database,
  payments: PaymentsProvider,
  holdId: string,
  personId: string,
  now: Date,
): Promise<Started | null | "price_changed"> {
  const hold = await holdOf(db, holdId);
  if (hold?.person_id !== personId || hold.state !== "held" || hold.expires_at <= now.toISOString()) return null;
  if (hold.pay_by_link === 1) return null;
  const isNewVisit = hold.moves_appointment_id === null;
  if (isNewVisit && (await liveVisitOf(db, personId, hold.type, hold.id)) !== null) return null;
  if (!paidInMoney(hold)) {
    if (await confirmFree(db, hold, now)) return { kind: "free" };
    if (hold.use_credit === 1) await stopUsingCredit(db, hold.id, now);
    return "price_changed";
  }
  if (hold.razorpay_order_id !== null) return { kind: "pay", orderId: hold.razorpay_order_id };
  const order = await payments.createOrder({
    amount: hold.amount,
    receipt: hold.id,
    notes: { hold_id: hold.id, person_id: hold.person_id },
  });
  // Two bookings of one hold at the same moment both found no order, and both made one. The write
  // settles which of them is the hold's, and the one that lost answers with the winner's, so a hold
  // is only ever paid for on the order it names (ADR 0057). It is the hold's only while the hold still
  // costs what the order was made for.
  const claimed = await db
    .prepare(
      `UPDATE slot_holds SET razorpay_order_id = ?1, updated_at = ?2
       WHERE id = ?3 AND razorpay_order_id IS NULL AND amount = ?4 RETURNING razorpay_order_id`,
    )
    .bind(order.id, now.toISOString(), hold.id, hold.amount)
    .first();
  if (claimed !== null) return { kind: "pay", orderId: order.id };
  const won = (await holdOf(db, holdId))?.razorpay_order_id ?? null;
  return won === null ? "price_changed" : { kind: "pay", orderId: won };
}

/**
 * Confirms a hold that costs nothing, or that a credit pays for while the client still has one to spend apart from it.
 * A credit hold confirmed already stays so, however often its booking is replayed. False when the hold no longer
 * qualifies: a discount code changed its price, or another booking took the client's last credit.
 */
async function confirmFree(db: D1Database, hold: HoldRow, now: Date): Promise<boolean> {
  const confirmed = await db
    .prepare(
      `UPDATE slot_holds SET confirmed_at = COALESCE(confirmed_at, ?2), queued_at = ?2, updated_at = ?2
       WHERE id = ?3 AND (amount = 0
         OR (use_credit = 1 AND (confirmed_at IS NOT NULL OR ${SPENDABLE_CREDITS} > 0)))
       RETURNING id`,
    )
    .bind(hold.person_id, now.toISOString(), hold.id)
    .first();
  return confirmed !== null;
}

/**
 * Confirms a hold ops book that nothing is paid for at booking: free, or paid by a credit the client still has to
 * spend. False when it no longer qualifies, as when another booking took the client's last credit meanwhile.
 */
export async function confirmUnpaid(db: D1Database, holdId: string, now: Date): Promise<boolean> {
  const hold = await holdOf(db, holdId);
  if (hold?.state !== "held") return false;
  return confirmFree(db, hold, now);
}

/** The client's credit went on another booking, so this hold is paid for in money instead. */
async function stopUsingCredit(db: D1Database, holdId: string, now: Date): Promise<void> {
  await db
    .prepare(
      `UPDATE slot_holds SET use_credit = 0, updated_at = ?2
       WHERE id = ?1 AND use_credit = 1 AND confirmed_at IS NULL`,
    )
    .bind(holdId, now.toISOString())
    .run();
}

/**
 * A capture of the order a hold names: the hold is confirmed from Razorpay's own time for the payment, and is due to
 * be booked. Run with the payment's record, by the webhook.
 */
export function confirmPaidHold(db: D1Database, orderId: string, paidAt: string, now: Date): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE slot_holds SET confirmed_at = COALESCE(confirmed_at, ?2), queued_at = COALESCE(queued_at, ?3)
       WHERE razorpay_order_id = ?1`,
    )
    .bind(orderId, paidAt, now.toISOString());
}

/** How a try ended. */
export type Confirmed = "booked" | "already_booked" | "being_booked" | "not_paid" | "refunded" | "lapsed";

interface CapturedPayment {
  razorpay_payment_id: string;
  amount: number;
  /** Razorpay's own time for the payment, not when its webhook reached us. */
  paid_at: string;
}

async function capturedFor(db: D1Database, orderId: string | null): Promise<CapturedPayment | null> {
  if (orderId === null) return null;
  return db
    .prepare(
      `SELECT razorpay_payment_id, amount, created_at AS paid_at FROM payments
       WHERE razorpay_order_id = ?1 AND status = 'captured' ORDER BY created_at LIMIT 1`,
    )
    .bind(orderId)
    .first<CapturedPayment>();
}

/** Whether Razorpay made the payment after the hold ran out and the grace it was made with. */
function paidTooLate(hold: HoldRow, payment: CapturedPayment): boolean {
  return Date.parse(payment.paid_at) > graceEndOf(hold).getTime();
}

/**
 * A new visit's hold let go once its grace ended, whose payment was made in time but heard of only since: it takes its
 * time back where that is still free, so it is booked rather than refunded. Never a move, a hold refunded already, or a
 * visit whose start has passed.
 */
async function retakenInTime(
  db: D1Database,
  hold: HoldRow,
  payment: CapturedPayment | null,
  now: Date,
): Promise<boolean> {
  if (payment === null || paidTooLate(hold, payment)) return false;
  if (hold.confirmed_at === null || hold.refunded_at !== null || hold.moves_appointment_id !== null) return false;
  if ((await heldVisitTimes(db, hold)).start <= now) return false;
  if ((await liveVisitOf(db, hold.person_id, hold.type, hold.id)) !== null) return false;
  return retakeSlot(db, hold, now);
}

/**
 * Books a hold once it is paid for (or free). A payment made too late is refunded instead. Answers "being_booked"
 * while another try holds the hold's lease.
 *
 * A refund asked of Razorpay is read again once the try holds the lease, since its `refunded_at` is set before the
 * call and kept once it goes through, even if the write that lets the hold go then fails.
 */
export async function confirmBooking(
  db: D1Database,
  payments: PaymentsProvider,
  holdId: string,
  now: Date,
  options: ConfirmOptions,
): Promise<Confirmed> {
  const hold = await holdOf(db, holdId);
  if (hold === null) throw new Error("no such hold to book");
  if (hold.state === "booked") {
    await afterBooked(db, hold, now, options);
    return "already_booked";
  }
  const payment = await capturedFor(db, hold.razorpay_order_id);
  if (paidInMoney(hold) && payment === null) {
    if (hold.confirmed_at === null) return "not_paid";
    // Only a capture confirms a paid hold, so this one's payment has since been refunded, by ops.
    await giveBack(db, payments, hold.id, now, "its payment was refunded");
    return "refunded";
  }
  const stillLetGo = hold.state === "released" && !(await retakenInTime(db, hold, payment, now));
  if (stillLetGo || (payment !== null && paidTooLate(hold, payment))) {
    await giveBack(db, payments, hold.id, now, "the hold had lapsed");
    return payment === null ? "lapsed" : "refunded";
  }

  if (!(await takeLease(db, hold.id, now))) return "being_booked";
  try {
    const leased = (await holdOf(db, holdId)) ?? hold;
    if (leased.refunded_at !== null) {
      await giveBack(db, payments, hold.id, now, "its payment was refunded");
      return "refunded";
    }
    if (leased.move_kind === "move") return await moveInPlace(db, payments, leased, now, options);
    if (await replacesBegunVisit(db, leased)) return await moveRefused(db, payments, leased, now);
    return await bookNewVisit(db, leased, now, options);
  } catch (error) {
    await releaseLease(db, hold.id);
    throw error;
  }
}

/** Longer than any try takes, a refund asked of Razorpay included. */
const BOOKING_LEASE_MS = 5 * MINUTE_MS;

/** Takes the hold for this try while it books it; false while another try has it. */
async function takeLease(db: D1Database, holdId: string, now: Date): Promise<boolean> {
  const taken = await db
    .prepare(
      `UPDATE slot_holds SET booking_until = ?2
       WHERE id = ?1 AND state = 'held' AND (booking_until IS NULL OR booking_until <= ?3) RETURNING id`,
    )
    .bind(holdId, new Date(now.getTime() + BOOKING_LEASE_MS).toISOString(), now.toISOString())
    .first();
  return taken !== null;
}

async function releaseLease(db: D1Database, holdId: string): Promise<void> {
  await db.prepare("UPDATE slot_holds SET booking_until = NULL WHERE id = ?1").bind(holdId).run();
}

/** Books a new visit: its row is written in the booking's own batch. */
async function bookNewVisit(db: D1Database, hold: HoldRow, now: Date, options: ConfirmOptions): Promise<Confirmed> {
  const visitId = crypto.randomUUID();
  const row = await newVisit(db, hold, visitId, now);
  await writeNewBooking(db, hold, { id: visitId, row }, now, options);
  return "booked";
}

/**
 * The row of a new visit, written only while its hold still waits to be booked, so a booking written twice makes one
 * visit. It is booked into the window the client picked, and a consultation keeps the window of the client's latest
 * request as the one they asked for.
 */
async function newVisit(db: D1Database, hold: HoldRow, visitId: string, now: Date): Promise<D1PreparedStatement> {
  const { start, end } = await heldVisitTimes(db, hold);
  const at = now.toISOString();
  return db
    .prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, tier, window_start, window_end, technician_id, status,
         service_city, service_pincode, synced_at, first_seen_at, one_visit, asked_checked_at, asked_window)
       SELECT ?1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'scheduled', ?8, ?9, ?10, ?10, ?11, ?10,
         (SELECT r.requested_window FROM consultation_requests r
           WHERE r.person_id = ?2 AND ?3 = 'consultation' ORDER BY r.created_at DESC LIMIT 1)
       WHERE EXISTS (SELECT 1 FROM slot_holds WHERE id = ?12 AND state = 'held')`,
    )
    .bind(
      visitId,
      hold.person_id,
      hold.type,
      hold.tier,
      start.toISOString(),
      end.toISOString(),
      hold.technician_id,
      hold.city,
      hold.pincode,
      at,
      hold.one_visit === 1 ? "booked" : null,
      hold.id,
    );
}

/**
 * Writes a new booking in one batch with its visit's row: the hold booked as the visit, its claims let go, its payment
 * and referral linked to the visit, and the credit that pays for it redeemed. Then what follows a booking. Each
 * statement after the row names the visit only once the row is written.
 */
async function writeNewBooking(
  db: D1Database,
  hold: HoldRow,
  visit: { readonly id: string; readonly row: D1PreparedStatement },
  now: Date,
  options: ConfirmOptions,
): Promise<void> {
  const at = now.toISOString();
  const visitId = "(SELECT id FROM appointments WHERE id = ?1)";
  await db.batch([
    visit.row,
    db
      .prepare(
        `UPDATE slot_holds SET state = 'booked', appointment_id = ${visitId}, updated_at = ?2
         WHERE id = ?3 AND state = 'held'`,
      )
      .bind(visit.id, at, hold.id),
    db.prepare("DELETE FROM slot_claims WHERE hold_id = ?1").bind(hold.id),
    db
      .prepare(
        `UPDATE payments SET appointment_id = ${visitId}, updated_at = ?2
         WHERE razorpay_order_id = ?3 AND appointment_id IS NULL`,
      )
      .bind(visit.id, at, hold.razorpay_order_id),
    // The consultation an invited friend booked, so ops' referral record names it: a one visit is theirs too.
    db
      .prepare(
        `UPDATE referral_attributions SET consultation_appointment_id = ${visitId}, updated_at = ?2
         WHERE referred_person_id = ?3 AND consultation_appointment_id IS NULL AND (?4 = 'consultation' OR ?5 = 1)`,
      )
      .bind(visit.id, at, hold.person_id, hold.type, hold.one_visit),
    ...creditRedeem(db, hold, now),
  ]);
  const booked = await holdOf(db, hold.id);
  if (booked === null) return;
  await alertIfNoCreditPaid(db, booked, options);
  await afterBooked(db, booked, now, options);
}

/**
 * For the batch that books a hold: the redeem of the credit that pays for it, if one does, from the credits the client
 * held when the booking was confirmed.
 */
function creditRedeem(db: D1Database, hold: HoldRow, now: Date): D1PreparedStatement[] {
  if (hold.use_credit !== 1) return [];
  const madeAt = hold.confirmed_at ?? now.toISOString();
  return [redeemCreditForBooking(db, { holdId: hold.id, personId: hold.person_id, madeAt }, now)];
}

/**
 * A credit visit booked with no credit redeemed for it, because the client had none left by then: the visit stands,
 * and ops decide what to charge.
 */
async function alertIfNoCreditPaid(db: D1Database, booked: HoldRow, options: ConfirmOptions): Promise<void> {
  if (booked.use_credit !== 1 || booked.appointment_id === null) return;
  if (await creditRedeemedFor(db, booked.appointment_id)) return;
  (options.log ?? createLogger()).warn("credit_visit_without_credit", { hold_id: booked.id });
  await options.alertOnce?.({
    key: `credit_visit_without_credit:${booked.id}`,
    message:
      `Booking ${booked.id} was booked on a visit credit, but the client had none left by then, ` +
      "so nothing has paid for it. Decide whether to charge for the visit.",
    link: `/clients/${booked.person_id}`,
  });
}

/**
 * The message a new booking sends: a move's, the site's booking of a consultation or of one visit, which nothing paid
 * for, or the payment's receipt.
 */
function confirmationOf(hold: HoldRow): VisitMessageKind {
  if (hold.move_kind === "replace") return "reschedule_confirmation";
  if (hold.type === "consultation" || hold.one_visit === 1) return "consultation_confirmation";
  return "payment_receipt";
}

/**
 * What follows a new booking, each step once however often this runs: the client told, and the visit it replaces
 * cancelled. A retry after either failed runs both again, and one that has already happened changes nothing. A move
 * in place does all of this in its own batch.
 */
async function afterBooked(db: D1Database, hold: HoldRow, now: Date, options: ConfirmOptions): Promise<void> {
  const visitId = hold.appointment_id;
  if (visitId === null || hold.move_kind === "move") return;
  const kind = confirmationOf(hold);
  const told = await db
    .prepare("SELECT 1 FROM outbound_messages WHERE subject_id = ?1 AND kind = ?2")
    .bind(visitId, kind)
    .first();
  if (told === null) {
    const message = visitMessage(db, { personId: hold.person_id, appointmentId: visitId, kind, now });
    await message.statement.run();
    await options.notify?.(message.id);
  }
  if (hold.move_kind === "replace") await retireReplaced(db, hold, now, options);
}

/** Moves the visit to the hold's time, with its technician; its payment carries over, and a late fee is kept. */
async function moveInPlace(
  db: D1Database,
  payments: PaymentsProvider,
  hold: HoldRow,
  now: Date,
  options: ConfirmOptions,
): Promise<Confirmed> {
  const visit = await db
    .prepare(
      `SELECT a.id, a.window_start FROM appointments a
       WHERE a.id = ?1 AND a.status IN ('scheduled', 'dispatched') AND a.deleted_at IS NULL AND NOT ${visitBegun("a")}`,
    )
    .bind(hold.moves_appointment_id)
    .first<{ id: string; window_start: string }>();
  if (visit === null) return moveRefused(db, payments, hold, now);
  const { start, end } = await heldVisitTimes(db, hold);

  const at = now.toISOString();
  const lateFee = "(SELECT id FROM payments WHERE razorpay_order_id = ?1)";
  const message = visitMessage(db, {
    personId: hold.person_id,
    appointmentId: visit.id,
    kind: "reschedule_confirmation",
    now,
  });
  await db.batch([
    db
      // The client chose this time, so their notice counts from it, however ops had moved the visit before.
      .prepare(
        `UPDATE appointments SET window_start = ?1, window_end = ?2, synced_at = ?3, start_before_move = NULL
         WHERE id = ?4`,
      )
      .bind(start.toISOString(), end.toISOString(), at, visit.id),
    db
      .prepare("UPDATE slot_holds SET state = 'booked', appointment_id = ?1, updated_at = ?2 WHERE id = ?3")
      .bind(visit.id, at, hold.id),
    db.prepare("DELETE FROM slot_claims WHERE hold_id = ?1").bind(hold.id),
    db
      .prepare(
        `UPDATE payments SET appointment_id = ?2, kind = 'late_fee', updated_at = ?3
         WHERE razorpay_order_id = ?1 AND appointment_id IS NULL`,
      )
      .bind(hold.razorpay_order_id, visit.id, at),
    db
      .prepare(
        `INSERT INTO visit_changes (id, appointment_id, person_id, kind, notice, was_start, now_start, kept_amount,
           payment_id, hold_id, created_at)
         VALUES (?2, ?3, ?4, 'moved', ?5, ?6, ?7, ?8, ${lateFee}, ?9, ?10)`,
      )
      .bind(
        hold.razorpay_order_id,
        crypto.randomUUID(),
        visit.id,
        hold.person_id,
        hold.amount > 0 ? "late" : "free",
        visit.window_start,
        start.toISOString(),
        hold.amount,
        hold.id,
        at,
      ),
    message.statement,
  ]);
  await options.notify?.(message.id);
  return "booked";
}

/** A late move whose visit the technician began before it was booked: it is refunded, not booked. */
async function replacesBegunVisit(db: D1Database, hold: HoldRow): Promise<boolean> {
  if (hold.move_kind !== "replace" || hold.moves_appointment_id === null) return false;
  return hasBegun(db, hold.moves_appointment_id);
}

/** Lets a move's hold go, and gives its payment back, since the visit it moves can no longer be changed. */
async function moveRefused(db: D1Database, payments: PaymentsProvider, hold: HoldRow, now: Date): Promise<Confirmed> {
  await giveBack(db, payments, hold.id, now, "the visit could no longer be moved");
  return hold.amount > 0 ? "refunded" : "lapsed";
}

/**
 * Cancels the visit a new one replaced, once. Its payment is kept as the charge. A visit the technician has begun since
 * is never cancelled: both visits stand, and ops are told.
 */
async function retireReplaced(db: D1Database, hold: HoldRow, now: Date, options: ConfirmOptions): Promise<void> {
  const old = await db
    .prepare(
      `SELECT a.id, a.window_start, ${visitBegun("a")} AS begun FROM appointments a
       WHERE a.id = ?1 AND a.status IN ('scheduled', 'dispatched') AND a.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM visit_changes c WHERE c.appointment_id = a.id AND c.kind IN ('replaced', 'cancelled'))`,
    )
    .bind(hold.moves_appointment_id)
    .first<{ id: string; window_start: string; begun: number }>();
  if (old === null) return;
  if (old.begun === 1) {
    await options.alertOnce?.({
      key: `replaced_after_begun:${old.id}`,
      message:
        `The client moved visit ${old.id} to a new one (booking ${hold.id}), but the technician had already begun ` +
        `it, so it was not cancelled. Both visits stand: ask the client which to keep.`,
      link: `/clients/${hold.person_id}`,
    });
    return;
  }
  const payment = await visitPayment(db, old.id);
  const at = now.toISOString();
  const nowStart = (await heldVisitTimes(db, hold)).start.toISOString();
  await db.batch([
    moveVisit(db, old.id, "cancel", at),
    db
      .prepare(
        `INSERT INTO visit_changes (id, appointment_id, person_id, kind, notice, was_start, now_start, kept_amount,
           payment_id, hold_id, created_at)
         VALUES (?1, ?2, ?3, 'replaced', 'late', ?4, ?5, ?6, ?7, ?8, ?9) ON CONFLICT DO NOTHING`,
      )
      .bind(
        crypto.randomUUID(),
        old.id,
        hold.person_id,
        old.window_start,
        nowStart,
        payment?.paid ?? 0,
        payment?.id ?? null,
        hold.id,
        at,
      ),
  ]);
}

/** What giving a hold back did with the money. */
export type GivenBack =
  | { readonly kind: "refunded"; readonly paymentId: string; readonly amount: number }
  | { readonly kind: "refunded_before"; readonly paymentId: string }
  | { readonly kind: "nothing_paid" }
  | { readonly kind: "booked" };

/** Razorpay would not refund the payment: nothing has gone back, and the hold still holds its time. */
export class RefundRefused extends Error {
  readonly paymentId: string;
  readonly amount: number;

  constructor(paymentId: string, amount: number, cause: unknown) {
    super(`Razorpay refused the refund of ${paymentId}`, { cause });
    this.paymentId = paymentId;
    this.amount = amount;
  }
}

/**
 * Razorpay did not say whether it refunded the payment, twice: the refund may have been made, and the hold still
 * holds its time. Asking again is safe, under the hold's receipt (src/domain/refunds.ts).
 */
export class RefundUnanswered extends Error {
  readonly paymentId: string;
  readonly amount: number;

  constructor(paymentId: string, amount: number, cause: unknown) {
    super(`Razorpay did not answer the refund of ${paymentId}`, { cause });
    this.paymentId = paymentId;
    this.amount = amount;
  }
}

/**
 * Lets a hold go, and refunds in full, once, any payment taken for it. Says what it did with the money; throws
 * RefundRefused, or RefundUnanswered, and keeps the hold, when Razorpay will not refund it or will not say whether it
 * did. `alongside` is written in the same batch as the hold is let go, such as ops' audit entry.
 */
export async function giveBack(
  db: D1Database,
  payments: PaymentsProvider,
  holdId: string,
  now: Date,
  reason: string,
  alongside: readonly D1PreparedStatement[] = [],
): Promise<GivenBack> {
  const hold = await holdOf(db, holdId);
  if (hold === null) throw new Error("no such hold to give back");
  if (hold.state === "booked") return { kind: "booked" };
  const payment = await capturedFor(db, hold.razorpay_order_id);
  const given: GivenBack =
    payment === null
      ? await nothingToRefund(db, hold.razorpay_order_id)
      : await refundOnce(db, payments, hold.id, payment, now, reason);
  await db.batch([
    db.prepare("DELETE FROM slot_claims WHERE hold_id = ?1").bind(hold.id),
    db
      .prepare("UPDATE slot_holds SET state = 'released', updated_at = ?1 WHERE id = ?2 AND state = 'held'")
      .bind(now.toISOString(), hold.id),
    ...alongside,
  ]);
  return given;
}

/** What letting go a hold with no captured payment did with the money: nothing, or it was refunded before, by ops. */
async function nothingToRefund(db: D1Database, orderId: string | null): Promise<GivenBack> {
  if (orderId === null) return { kind: "nothing_paid" };
  const refunded = await db
    .prepare(
      `SELECT razorpay_payment_id FROM payments
       WHERE razorpay_order_id = ?1 AND status IN ('refunded', 'partially_refunded') ORDER BY created_at LIMIT 1`,
    )
    .bind(orderId)
    .first<{ razorpay_payment_id: string }>();
  if (refunded === null) return { kind: "nothing_paid" };
  return { kind: "refunded_before", paymentId: refunded.razorpay_payment_id };
}

async function refundOnce(
  db: D1Database,
  payments: PaymentsProvider,
  holdId: string,
  payment: CapturedPayment,
  now: Date,
  reason: string,
): Promise<GivenBack> {
  // The refund is claimed on the hold before it is asked for, so a repeated message cannot ask twice.
  const claimed = await db
    .prepare("UPDATE slot_holds SET refunded_at = ?1 WHERE id = ?2 AND refunded_at IS NULL RETURNING id")
    .bind(now.toISOString(), holdId)
    .first();
  if (claimed === null) return { kind: "refunded_before", paymentId: payment.razorpay_payment_id };
  const asked = await askRefund(payments, payment.razorpay_payment_id, {
    amount: payment.amount,
    notes: { hold_id: holdId, reason },
    receipt: refundReceipt({ kind: "hold", holdId }),
  });
  if (asked.kind === "refunded") {
    return { kind: "refunded", paymentId: payment.razorpay_payment_id, amount: payment.amount };
  }
  // Let go, so the refund can be asked for again: its receipt keeps Razorpay from making it twice.
  await db.prepare("UPDATE slot_holds SET refunded_at = NULL WHERE id = ?1").bind(holdId).run();
  if (asked.kind === "refused") throw new RefundRefused(payment.razorpay_payment_id, payment.amount, asked.error);
  throw new RefundUnanswered(payment.razorpay_payment_id, payment.amount, asked.error);
}

/** How long a confirmed hold may wait to be booked before the cron books it. */
const UNBOOKED_AFTER_MS = 30 * MINUTE_MS;
const BOOKED_PER_PASS = 20;

/** The alert a hold raises while it waits unbooked; closed once it is booked or given back. */
export const unbookedAlertKey = (holdId: string) => `unbooked_hold:${holdId}`;

interface UnbookedHold {
  readonly id: string;
  readonly person_id: string;
}

/** Confirmed holds neither booked nor refunded half an hour after they last went to be booked, oldest first. */
async function unbookedHolds(db: D1Database, now: Date): Promise<UnbookedHold[]> {
  const { results } = await db
    .prepare(
      `SELECT id, person_id FROM slot_holds
       WHERE state = 'held' AND confirmed_at IS NOT NULL AND queued_at <= ?1
       ORDER BY queued_at LIMIT ?2`,
    )
    .bind(new Date(now.getTime() - UNBOOKED_AFTER_MS).toISOString(), BOOKED_PER_PASS)
    .all<UnbookedHold>();
  return results;
}

export interface UnbookedPass {
  readonly payments: PaymentsProvider;
  readonly alertOnce: AlertOnce;
  readonly resolveAlert: ResolveAlert;
  /** Queues a message about the visit once its row is written. */
  readonly notify: (messageId: string) => Promise<unknown>;
  readonly budget: CallBudget;
  readonly log: Logger;
}

/**
 * Holds paid for, or booked free, that are neither booked nor refunded half an hour after they were confirmed, because
 * the request that confirmed them failed part-way. Each is booked here, one call from the run's budget, since giving
 * one back asks Razorpay for its refund. One that still cannot be is tried again half an hour on, and ops are told
 * once. Returns how many were booked.
 */
export async function bookUnbookedHolds(db: D1Database, pass: UnbookedPass, now: Date): Promise<number> {
  let booked = 0;
  for (const hold of await unbookedHolds(db, now)) {
    if (!pass.budget.spend(1)) break;
    await db.prepare("UPDATE slot_holds SET queued_at = ?2 WHERE id = ?1").bind(hold.id, now.toISOString()).run();
    if ((await bookUnbookedHold(db, pass, hold, now)) === "booked") booked += 1;
  }
  return booked;
}

async function bookUnbookedHold(
  db: D1Database,
  pass: UnbookedPass,
  hold: UnbookedHold,
  now: Date,
): Promise<Confirmed | null> {
  const options: ConfirmOptions = { notify: pass.notify, alertOnce: pass.alertOnce, log: pass.log };
  try {
    const outcome = await confirmBooking(db, pass.payments, hold.id, now, options);
    pass.log.info("unbooked_hold_booked", { hold_id: hold.id, outcome });
    if (outcome !== "being_booked") await pass.resolveAlert(unbookedAlertKey(hold.id));
    return outcome;
  } catch (error) {
    const reason = failureReason(error);
    pass.log.warn("unbooked_hold_failed", { hold_id: hold.id, reason });
    await pass.alertOnce({
      key: unbookedAlertKey(hold.id),
      message:
        `Booking ${hold.id} was paid for, or booked free, and is neither booked nor refunded half an hour on: ` +
        `${reason}. It is tried again every half hour.`,
      link: `/clients/${hold.person_id}`,
    });
    return null;
  }
}
