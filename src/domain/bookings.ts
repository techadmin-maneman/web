// A held window, booked (docs/decisions/0068-a-paid-hold-is-kept.md). Razorpay's webhook, or the request for a free
// visit, books it in one batch; a paid hold keeps its time until it is booked, by the half-hour pass if its request
// failed (src/domain/unbooked-holds.ts), or is given back (src/domain/give-back.ts).

import type { PaymentsProvider } from "../providers/payments/index.ts";
import { paymentsTab } from "./alerts.ts";
import { creditRedeemedFor, redeemCreditForBooking, SPENDABLE_CREDITS } from "./credits.ts";
import { graceEndOf } from "./hold-stages.ts";
import { retakeSlot } from "./hold-slot.ts";
import { heldVisitTimes } from "./visit-times.ts";
import { liveVisitOf } from "./availability.ts";
import { visitMessage, type VisitMessageKind } from "./visit-messages.ts";
import { MINUTE_MS } from "../lib/durations.ts";
import {
  type ConfirmOptions,
  type HoldRow,
  bookingHoldRow,
  paidInMoney,
  type CapturedPayment,
  capturedFor,
  type Confirmed,
} from "./booked-hold.ts";
import { moveInPlace, replacesBegunVisit, moveRefused, retireReplaced } from "./move-in-place.ts";
import { giveBack, giveBackUnkept } from "./give-back.ts";

type Started = { readonly kind: "free" } | { readonly kind: "pay"; readonly orderId: string };

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
  const hold = await bookingHoldRow(db, holdId);
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
  const won = (await bookingHoldRow(db, holdId))?.razorpay_order_id ?? null;
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
  const hold = await bookingHoldRow(db, holdId);
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
 * while another try holds the hold's lease. A hold whose client has been erased is never booked: it is let go, and any
 * payment for it refunded.
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
  const hold = await bookingHoldRow(db, holdId);
  if (hold === null) throw new Error("no such hold to book");
  if (hold.state === "booked") {
    await afterBooked(db, hold, now, options);
    return "already_booked";
  }
  const payment = await capturedFor(db, hold.razorpay_order_id);
  if (hold.person_erased_at !== null) {
    await giveBack(db, payments, hold.id, now, "the client was erased");
    return payment === null ? "lapsed" : "refunded";
  }
  if (paidInMoney(hold) && payment === null) {
    if (hold.confirmed_at === null) return "not_paid";
    // Only a capture confirms a paid hold, so this one's payment has since been refunded, by ops.
    await giveBack(db, payments, hold.id, now, "its payment was refunded");
    return "refunded";
  }
  const stillLetGo = hold.state === "released" && !(await retakenInTime(db, hold, payment, now));
  if (stillLetGo || (payment !== null && paidTooLate(hold, payment))) {
    await giveBackUnkept(db, payments, hold, now, "lapsed", options);
    return payment === null ? "lapsed" : "refunded";
  }

  if (!(await takeLease(db, hold.id, now))) return "being_booked";
  try {
    const leased = (await bookingHoldRow(db, holdId)) ?? hold;
    if (leased.refunded_at !== null) {
      await giveBack(db, payments, hold.id, now, "its payment was refunded");
      return "refunded";
    }
    if (leased.move_kind === "move") return await moveInPlace(db, payments, leased, now, options);
    if (await replacesBegunVisit(db, leased)) return await moveRefused(db, payments, leased, now, options);
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
  const booked = await bookingHoldRow(db, hold.id);
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
  options.log.warn("credit_visit_without_credit", { hold_id: booked.id });
  await options.alertOnce?.({
    key: `credit_visit_without_credit:${booked.id}`,
    message:
      `Booking ${booked.id} was booked on a visit credit, but the client had none left by then, ` +
      "so nothing has paid for it. Decide whether to charge for the visit.",
    link: paymentsTab(booked.person_id),
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
