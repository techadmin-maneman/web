// A held window, booked (docs/decisions/0045-self-serve-booking.md, 0068-a-paid-hold-is-kept.md).
//
// A paid visit starts as a Razorpay order for the hold. Razorpay's webhook
// confirms the capture, and the fsm-sync queue then writes the visit to FSM
// and, once FSM has it, to the mirror. A free visit, a consultation, goes
// straight to the queue.
//
// Where our own database holds the record of field work (src/config/field-record.ts),
// nothing goes to FSM: the webhook, or the request that confirms a free visit,
// books it in one batch, and so do a move and a replaced visit's cancel. A visit
// FSM never held, whose FSM ID is its own, is never written to FSM.
//
// A hold the client has paid for, or booked free, is confirmed: it keeps its
// time until it is booked or refunded, however long FSM takes. A payment is in
// time if Razorpay made it before the hold ran out, give or take the grace; one
// made later is refunded in full. A visit FSM will not take is held for ops,
// with its time and its payment, tried again every hour for a day, and booked
// or refunded by ops (src/domain/held-bookings.ts; docs/decisions/0095-a-booking-fsm-refuses-is-held.md).
//
// FSM is written once however often a booking is tried: one consumer at a
// time holds the hold's lease, each ID FSM gives is kept the moment it comes,
// and a try after an answer that never came looks for what FSM made before
// making it again. A held booking's try writes nothing while a visit ops may
// have booked for it in FSM by hand stands in the mirror.
//
// A hold that moves a visit (docs/decisions/0046-moving-and-cancelling.md)
// either moves it in place, once its late fee is paid or at once when free, or
// books a new visit and cancels the old one, whose payment is kept.
//
// A visit is booked on its service's own FSM item, for the length its hold
// was made with, and the mirror's copy carries the hold's tier, since the hold
// is what was sold (docs/decisions/0085-services-ops-can-edit.md).

import type { FieldRecord } from "../config/field-record.ts";
import { PAYMENT_GRACE_SECONDS } from "../config/scheduling.ts";
import { VISIT_TYPE_NAMES, type VisitType } from "../config/visit-types.ts";
import { indiaIso } from "../lib/india-time.ts";
import type { CallBudget } from "../lib/call-budget.ts";
import { createLogger, failureReason, type Logger } from "../log.ts";
import type { FsmProvider } from "../providers/fsm.ts";
import type { PaymentsProvider } from "../providers/payments.ts";
import { TRIES_STOPPED, triesStopped } from "../policy/held-bookings.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";
import type { AlertOnce, ResolveAlert } from "./alerts.ts";
import { auditStatement, auditStatementIfBooked, type AuditEntry } from "./audit.ts";
import { creditRedeemedFor, redeemCreditForBooking, SPENDABLE_CREDITS } from "./credits.ts";
import { itemForService } from "./fsm-catalogue.ts";
import { fsmContactOf, type Place } from "./fsm-contacts.ts";
import { toLinkAlert, toLinkAlertKey } from "./held-bookings.ts";
import { askRefund, refundReceipt } from "./refunds.ts";
import { heldVisitTimes, liveVisitOf } from "./scheduling.ts";
import { hasBegun, visitBegun } from "./visit-begun.ts";
import { visitPayment } from "./visit-changes.ts";
import { visitMessage, type VisitMessageKind } from "./visit-messages.ts";
import { moveVisit } from "./visit-status.ts";
import { MINUTE_MS } from "../lib/durations.ts";

export interface ConfirmOptions {
  readonly labelAsTest: boolean;
  /** Who holds the record of the visit: FSM, the default while its path stands, or our own database. */
  readonly record?: FieldRecord;
  /** Queues a message about the visit once its row is written (src/domain/visit-messages.ts). */
  readonly notify?: (messageId: string) => Promise<unknown>;
  /** Tells ops, once, of something in FSM they must put right by hand (src/domain/alerts.ts). */
  readonly alertOnce?: AlertOnce;
  readonly log?: Logger;
  /** Written in the same batch as the booking, or as the hold let go, as the audit entry for a try ops asked for is. */
  readonly alongside?: readonly D1PreparedStatement[];
  /** A try the queue makes by itself, not one ops asked for: it writes nothing once ops have stopped the tries. */
  readonly automatic?: boolean;
}

interface HoldRow {
  id: string;
  person_id: string;
  person_name: string;
  type: VisitType;
  tier: string;
  /** The length it was held for; null for a hold made before services had lengths. */
  minutes: number | null;
  /** Its service's name as it is now; null only where no service is its kind and tier. */
  service_name: string | null;
  date: string;
  start_unit: number;
  technician_id: string;
  technician_fsm_id: string;
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
  fsm_tried_at: string | null;
  fsm_work_order_id: string | null;
  fsm_appointment_id: string | null;
  /** When FSM's fifth refusal running held it for ops; null while it has not. */
  fsm_held_at: string | null;
  /** When it was last put on the queue: the end of time once ops stop its tries. */
  queued_at: string | null;
  /** Set as its refund is asked of Razorpay, and cleared only if Razorpay refuses it. */
  refunded_at: string | null;
  pincode: string | null;
  /** The pincode's city, where it is one we know. */
  city: string | null;
}

async function holdOf(db: D1Database, holdId: string): Promise<HoldRow | null> {
  return db
    .prepare(
      `SELECT h.id, h.person_id, p.name AS person_name, h.type, h.tier, h.minutes, s.name AS service_name, h.date,
              h.start_unit, h.technician_id, t.fsm_id AS technician_fsm_id, h.amount, h.state, h.expires_at,
              h.grace_seconds, h.confirmed_at, h.razorpay_order_id, h.appointment_id, h.moves_appointment_id, h.move_kind,
              h.use_credit, h.one_visit, h.fsm_tried_at, h.fsm_work_order_id, h.fsm_appointment_id, h.fsm_held_at, h.queued_at,
              h.refunded_at, h.pincode, sp.city
       FROM slot_holds h JOIN technicians t ON t.id = h.technician_id JOIN people p ON p.id = h.person_id
       LEFT JOIN serviceable_pincodes sp ON sp.pincode = h.pincode
       LEFT JOIN services s ON s.kind = h.type AND s.tier = h.tier
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
 * confirmed. Null when the hold is not live, or when a consultation or first fit like it has been booked since.
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
 * A capture of the order a hold names: the hold is confirmed from Razorpay's own time for the payment, and is
 * due on the queue. Run with the payment's record, by the webhook.
 */
export function confirmPaidHold(db: D1Database, orderId: string, paidAt: string, now: Date): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE slot_holds SET confirmed_at = COALESCE(confirmed_at, ?2), queued_at = COALESCE(queued_at, ?3)
       WHERE razorpay_order_id = ?1`,
    )
    .bind(orderId, paidAt, now.toISOString());
}

/**
 * How a try ended. Nothing is written for "to_link", when a visit ops may have booked for it in FSM by hand stands, nor
 * for "stopped", when ops stopped the tries of a booking the queue was trying by itself.
 */
export type Confirmed =
  "booked" | "already_booked" | "being_booked" | "not_paid" | "refunded" | "lapsed" | "to_link" | "stopped";

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
  const grace = hold.grace_seconds ?? PAYMENT_GRACE_SECONDS;
  const lastMoment = new Date(Date.parse(hold.expires_at) + grace * 1000);
  return Date.parse(payment.paid_at) > lastMoment.getTime();
}

/**
 * Books a hold in FSM once it is paid for (or free), then in the mirror. A payment made too late is refunded
 * instead. Throws when FSM fails, so the queue tries again; answers "being_booked" while another consumer is
 * writing it, which the queue tries again later. A booking held for ops writes nothing to FSM while a visit of the
 * client's that may be the one ops booked for it by hand stands in the mirror, and ops are told once to link it.
 * `alongside` is written with whatever the try changes: the booking, or the hold let go.
 *
 * What stops a try is read again once it holds the lease, since ops act under the same lease: tries stopped by ops,
 * and a refund asked of Razorpay, whose `refunded_at` is set before the call and kept once it goes through, even if the
 * write that lets the hold go then fails.
 */
export async function confirmBooking(
  db: D1Database,
  fsm: FsmProvider,
  payments: PaymentsProvider,
  holdId: string,
  now: Date,
  options: ConfirmOptions,
): Promise<Confirmed> {
  const hold = await holdOf(db, holdId);
  if (hold === null) throw new Error("no such hold to book");
  if (hold.state === "booked") {
    await afterBooked(db, fsm, hold, now, options);
    return "already_booked";
  }
  const payment = await capturedFor(db, hold.razorpay_order_id);
  if (paidInMoney(hold) && payment === null) {
    if (hold.confirmed_at === null) return "not_paid";
    // Only a capture confirms a paid hold, so this one's payment has since been refunded, by ops.
    await giveBack(db, payments, hold.id, now, "its payment was refunded", options.alongside);
    return "refunded";
  }
  if (hold.state === "released" || (payment !== null && paidTooLate(hold, payment))) {
    await giveBack(db, payments, hold.id, now, "the hold had lapsed", options.alongside);
    return payment === null ? "lapsed" : "refunded";
  }

  if (!(await takeLease(db, hold.id, now))) return "being_booked";
  try {
    const leased = (await holdOf(db, holdId)) ?? hold;
    if (options.automatic === true && triesStoppedOn(leased)) {
      await releaseLease(db, hold.id);
      return "stopped";
    }
    if (leased.refunded_at !== null) {
      await giveBack(db, payments, hold.id, now, "its payment was refunded", options.alongside);
      return "refunded";
    }
    if (leased.move_kind === "move") return await moveInPlace(db, fsm, payments, leased, now, options);
    if (await replacesBegunVisit(db, leased)) return await moveRefused(db, payments, leased, now, options);
    if (recordOf(options) === "ours") return await bookOurVisit(db, fsm, leased, now, options);
    const bookedByHand = await visitBookedSinceHeld(db, leased);
    if (bookedByHand !== null) {
      await releaseLease(db, hold.id);
      await options.alertOnce?.({
        key: toLinkAlertKey(hold.id),
        message: toLinkAlert(hold.id, bookedByHand),
        link: `/clients/${hold.person_id}/visits`,
      });
      return "to_link";
    }
    return await bookNewVisit(db, fsm, leased, now, options);
  } catch (error) {
    await releaseLease(db, hold.id);
    throw error;
  }
}

/** Longer than every FSM call a booking makes, each of which gives up at 20 seconds. */
const BOOKING_LEASE_MS = 5 * MINUTE_MS;

/** Takes the hold for this consumer while it writes it to FSM; false while another consumer has it. */
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

/** Whether ops have stopped the booking's hourly tries, to book it in FSM by hand. */
const triesStoppedOn = (hold: HoldRow): boolean => hold.queued_at !== null && triesStopped(new Date(hold.queued_at));

async function releaseLease(db: D1Database, holdId: string): Promise<void> {
  await db.prepare("UPDATE slot_holds SET booking_until = NULL WHERE id = ?1").bind(holdId).run();
}

/**
 * A visit of the client's, of the booking's kind, still to come and no booking's, that reached the mirror after FSM's
 * refusals held the booking for ops: most likely the one ops booked in FSM by hand for it, so a try must not book
 * another. Not one on the work order or appointment a try kept for the booking, which is the booking's own. Null for
 * a booking not held, and while there is none.
 */
async function visitBookedSinceHeld(db: D1Database, hold: HoldRow): Promise<string | null> {
  if (hold.fsm_held_at === null) return null;
  const { results } = await db
    .prepare(
      `SELECT a.id, a.fsm_id, a.fsm_work_order_id FROM appointments a
       WHERE a.person_id = ?1 AND a.type = ?2 AND a.deleted_at IS NULL AND a.status IN ('scheduled', 'dispatched')
         AND a.first_seen_at > ?3 AND a.id IS NOT ?4
         AND NOT EXISTS (SELECT 1 FROM slot_holds h WHERE h.appointment_id = a.id AND h.state = 'booked')
       ORDER BY a.first_seen_at`,
    )
    .bind(hold.person_id, hold.type, hold.fsm_held_at, hold.moves_appointment_id)
    .all<{ id: string; fsm_id: string; fsm_work_order_id: string | null }>();
  const theBookingsOwn = (visit: { fsm_id: string; fsm_work_order_id: string | null }) =>
    visit.fsm_id === hold.fsm_appointment_id ||
    (visit.fsm_work_order_id !== null && visit.fsm_work_order_id === hold.fsm_work_order_id);
  return results.find((visit) => !theBookingsOwn(visit))?.id ?? null;
}

/** Books a new visit: FSM first, then the booking written with the visit as FSM has it. */
async function bookNewVisit(
  db: D1Database,
  fsm: FsmProvider,
  hold: HoldRow,
  now: Date,
  options: ConfirmOptions,
): Promise<Confirmed> {
  const workOrder = await workOrderFor(db, fsm, hold, now, options);
  const appointmentId = hold.fsm_appointment_id ?? (await appointmentFor(db, fsm, hold, workOrder, options));
  const visit = await mirroredVisit(db, hold, { appointmentId, workOrderId: workOrder.id }, now);
  await writeNewBooking(db, fsm, hold, { fsmId: appointmentId, row: visit }, now, options);
  return "booked";
}

/**
 * The mirror's row for the visit FSM booked. FSM's webhook may have mirrored it already; either way the visit is the
 * one with its FSM ID. Its tier is the hold's whatever the mirror read from its item, which may be its kind's where FSM
 * had none of its own, and it is a one visit exactly when its hold was, whatever the mirror took it for, since FSM's
 * item does not say.
 */
async function mirroredVisit(
  db: D1Database,
  hold: HoldRow,
  inFsm: { readonly appointmentId: string; readonly workOrderId: string },
  now: Date,
): Promise<D1PreparedStatement> {
  const { start, end } = await heldVisitTimes(db, hold);
  const at = now.toISOString();
  return db
    .prepare(
      `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, tier, window_start, window_end,
         technician_id, status, fsm_status, service_city, service_pincode, fsm_modified_at, synced_at, first_seen_at,
         one_visit)
       VALUES (?2, ?1, ?3, ?4, ?5, ?12, ?6, ?7, ?8, 'scheduled', 'Scheduled', ?9, ?10, ?11, ?11, ?11, ?13)
       ON CONFLICT (fsm_id) DO UPDATE SET
         tier = excluded.tier,
         one_visit = excluded.one_visit,
         service_city = COALESCE(appointments.service_city, excluded.service_city),
         service_pincode = COALESCE(appointments.service_pincode, excluded.service_pincode)`,
    )
    .bind(
      inFsm.appointmentId,
      crypto.randomUUID(),
      inFsm.workOrderId,
      hold.person_id,
      hold.type,
      start.toISOString(),
      end.toISOString(),
      hold.technician_id,
      hold.city,
      hold.pincode,
      at,
      hold.tier,
      hold.one_visit === 1 ? "booked" : null,
    );
}

/** Books a new visit without FSM: its row is written in the booking's own batch, with its own ID as its FSM ID. */
async function bookOurVisit(
  db: D1Database,
  fsm: FsmProvider,
  hold: HoldRow,
  now: Date,
  options: ConfirmOptions,
): Promise<Confirmed> {
  const visitId = crypto.randomUUID();
  const row = await ourVisit(db, hold, visitId, now);
  await writeNewBooking(db, fsm, hold, { fsmId: visitId, row }, now, options);
  return "booked";
}

/**
 * The row of a visit booked without FSM, written only while its hold still waits to be booked, so a booking written
 * twice makes one visit. It has no work order and no FSM status. It is booked into the window the client picked, so
 * the asked-window pass has nothing to look up for it.
 */
async function ourVisit(db: D1Database, hold: HoldRow, visitId: string, now: Date): Promise<D1PreparedStatement> {
  const { start, end } = await heldVisitTimes(db, hold);
  const at = now.toISOString();
  return db
    .prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, tier, window_start, window_end, technician_id, status,
         service_city, service_pincode, synced_at, first_seen_at, one_visit, asked_checked_at)
       SELECT ?1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'scheduled', ?8, ?9, ?10, ?10, ?11, ?10
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

/** Who holds the record of field work for this try: FSM, unless the caller says our own database does. */
const recordOf = (options: Pick<ConfirmOptions, "record">): FieldRecord => options.record ?? "fsm";

/** Whether FSM is written for a change to the visit: only on FSM's path, and only for a visit FSM holds. */
function writesFsmFor(
  options: Pick<ConfirmOptions, "record">,
  visit: { readonly id: string; readonly fsm_id: string },
) {
  return recordOf(options) === "fsm" && visit.fsm_id !== visit.id;
}

/**
 * Writes a new booking in one batch with its visit's row: the hold booked as the visit, its claims let go, its payment
 * and referral linked to the visit, and the credit that pays for it redeemed. Then what follows a booking. The visit is
 * found by `visit.fsmId`.
 */
async function writeNewBooking(
  db: D1Database,
  fsm: FsmProvider,
  hold: HoldRow,
  visit: { readonly fsmId: string; readonly row: D1PreparedStatement },
  now: Date,
  options: ConfirmOptions,
): Promise<void> {
  const at = now.toISOString();
  const visitId = "(SELECT id FROM appointments WHERE fsm_id = ?1)";
  await db.batch([
    visit.row,
    db
      .prepare(
        `UPDATE slot_holds SET state = 'booked', appointment_id = ${visitId}, updated_at = ?2
         WHERE id = ?3 AND state = 'held'`,
      )
      .bind(visit.fsmId, at, hold.id),
    db.prepare("DELETE FROM slot_claims WHERE hold_id = ?1").bind(hold.id),
    db
      .prepare(
        `UPDATE payments SET appointment_id = ${visitId}, updated_at = ?2
         WHERE razorpay_order_id = ?3 AND appointment_id IS NULL`,
      )
      .bind(visit.fsmId, at, hold.razorpay_order_id),
    // The consultation an invited friend booked, so ops' referral record names it: a one visit is theirs too.
    db
      .prepare(
        `UPDATE referral_attributions SET consultation_appointment_id = ${visitId}, updated_at = ?2
         WHERE referred_person_id = ?3 AND consultation_appointment_id IS NULL AND (?4 = 'consultation' OR ?5 = 1)`,
      )
      .bind(visit.fsmId, at, hold.person_id, hold.type, hold.one_visit),
    ...creditRedeem(db, hold, now),
    ...(options.alongside ?? []),
  ]);
  const booked = await holdOf(db, hold.id);
  if (booked === null) return;
  await alertIfNoCreditPaid(db, booked, options);
  await afterBooked(db, fsm, booked, now, options);
}

/** For the batch that books a hold: the redeem of the credit that pays for it, if one does. */
function creditRedeem(db: D1Database, hold: HoldRow, now: Date): D1PreparedStatement[] {
  if (hold.use_credit !== 1) return [];
  return [redeemCreditForBooking(db, { holdId: hold.id, personId: hold.person_id }, now)];
}

/**
 * A credit visit booked with no credit redeemed for it, because the client had none left by then: the visit stands,
 * and ops decide what to charge.
 */
async function alertIfNoCreditPaid(
  db: D1Database,
  booked: HoldRow,
  options: Omit<ConfirmOptions, "alongside">,
): Promise<void> {
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

/** Where the hold says the visit is, for the contact FSM files the client under. */
const placeOf = (hold: HoldRow): Place | undefined =>
  hold.city === null ? undefined : { city: hold.city, pincode: hold.pincode };

interface WorkOrder {
  readonly id: string;
  /** Made by this try, so it cannot have an appointment yet. */
  readonly madeNow: boolean;
}

/**
 * The booking's work order in FSM: the one kept on the hold, else one an earlier try made whose answer never
 * came, else a new one. Its ID is kept the moment FSM gives it.
 */
async function workOrderFor(
  db: D1Database,
  fsm: FsmProvider,
  hold: HoldRow,
  now: Date,
  options: ConfirmOptions,
): Promise<WorkOrder> {
  if (hold.fsm_work_order_id !== null) return { id: hold.fsm_work_order_id, madeNow: false };
  const madeBefore = hold.fsm_tried_at === null ? null : await workOrderMadeBefore(fsm, hold, options);
  if (madeBefore !== null) {
    await keepWorkOrder(db, hold.id, madeBefore);
    return { id: madeBefore, madeNow: false };
  }

  const log = options.log ?? createLogger();
  const contactId = await fsmContactOf(db, fsm, hold.person_id, placeOf(hold), log);
  const service = await itemForService(
    db,
    fsm,
    { kind: hold.type, tier: hold.tier },
    { alertOnce: options.alertOnce, log },
  );
  await db.prepare("UPDATE slot_holds SET fsm_tried_at = ?2 WHERE id = ?1").bind(hold.id, now.toISOString()).run();
  const id = await fsm.createWorkOrder({
    contactId,
    summary: summaryOf(hold, options.labelAsTest),
    serviceId: service.id,
    reference: hold.id,
  });
  await keepWorkOrder(db, hold.id, id);
  return { id, madeNow: true };
}

/**
 * The work order an earlier try made, if FSM took it and its answer never came. When FSM cannot be asked, a new
 * one is made, and ops are told to look for the one it may already hold.
 */
async function workOrderMadeBefore(fsm: FsmProvider, hold: HoldRow, options: ConfirmOptions): Promise<string | null> {
  try {
    return await fsm.findWorkOrder(hold.id);
  } catch (error) {
    (options.log ?? createLogger()).warn("fsm_work_order_lookup_failed", { hold_id: hold.id, error });
    await options.alertOnce?.({
      key: `work_order_lookup_failed:${hold.id}`,
      message:
        `Booking ${hold.id}: an earlier try may have made its work order in FSM, and FSM could not be asked, ` +
        `so another is being made. Look in FSM for work orders ending "(booking ${hold.id})" and cancel all but one.`,
      link: `/clients/${hold.person_id}`,
    });
    return null;
  }
}

/** The work order's appointment: one an earlier try made, else a new one. Its ID is kept the moment FSM gives it. */
async function appointmentFor(
  db: D1Database,
  fsm: FsmProvider,
  hold: HoldRow,
  workOrder: WorkOrder,
  options: ConfirmOptions,
): Promise<string> {
  const { start, end } = await heldVisitTimes(db, hold);
  const madeBefore = workOrder.madeNow ? null : await fsm.workOrderAppointment(workOrder.id);
  const id =
    madeBefore ??
    (await fsm.createAppointment(workOrder.id, {
      summary: summaryOf(hold, options.labelAsTest),
      technicianId: hold.technician_fsm_id,
      start: indiaIso(start),
      end: indiaIso(end),
    }));
  await keepAppointment(db, hold.id, id);
  return id;
}

const summaryOf = (hold: HoldRow, labelAsTest: boolean) =>
  `${labelAsTest ? "Staging test: " : ""}${hold.service_name ?? VISIT_TYPE_NAMES[hold.type]} for ${hold.person_name}`;

async function keepWorkOrder(db: D1Database, holdId: string, workOrderId: string): Promise<void> {
  await db.prepare("UPDATE slot_holds SET fsm_work_order_id = ?2 WHERE id = ?1").bind(holdId, workOrderId).run();
}

async function keepAppointment(db: D1Database, holdId: string, appointmentId: string): Promise<void> {
  await db.prepare("UPDATE slot_holds SET fsm_appointment_id = ?2 WHERE id = ?1").bind(holdId, appointmentId).run();
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
async function afterBooked(
  db: D1Database,
  fsm: FsmProvider,
  hold: HoldRow,
  now: Date,
  options: ConfirmOptions,
): Promise<void> {
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
  if (hold.move_kind === "replace") await retireReplaced(db, fsm, hold, now, options);
}

/** Moves the visit to the hold's time, with its technician; its payment carries over, and a late fee is kept. */
async function moveInPlace(
  db: D1Database,
  fsm: FsmProvider,
  payments: PaymentsProvider,
  hold: HoldRow,
  now: Date,
  options: ConfirmOptions,
): Promise<Confirmed> {
  const visit = await db
    .prepare(
      `SELECT a.id, a.fsm_id, a.window_start FROM appointments a
       WHERE a.id = ?1 AND a.status IN ('scheduled', 'dispatched') AND a.deleted_at IS NULL AND NOT ${visitBegun("a")}`,
    )
    .bind(hold.moves_appointment_id)
    .first<{ id: string; fsm_id: string; window_start: string }>();
  if (visit === null) return moveRefused(db, payments, hold, now, options);
  const { start, end } = await heldVisitTimes(db, hold);
  if (writesFsmFor(options, visit)) {
    await fsm.rescheduleVisit(visit.fsm_id, { start: indiaIso(start), end: indiaIso(end) });
  }

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
    ...(options.alongside ?? []),
  ]);
  await options.notify?.(message.id);
  return "booked";
}

/** A late move whose visit the technician began before FSM was given the new one: it is refunded, not booked. */
async function replacesBegunVisit(db: D1Database, hold: HoldRow): Promise<boolean> {
  if (hold.move_kind !== "replace" || hold.fsm_work_order_id !== null || hold.moves_appointment_id === null) {
    return false;
  }
  return hasBegun(db, hold.moves_appointment_id);
}

/** Lets a move's hold go, and gives its payment back, since the visit it moves can no longer be changed. */
async function moveRefused(
  db: D1Database,
  payments: PaymentsProvider,
  hold: HoldRow,
  now: Date,
  options: ConfirmOptions,
): Promise<Confirmed> {
  await giveBack(db, payments, hold.id, now, "the visit could no longer be moved", options.alongside);
  return hold.amount > 0 ? "refunded" : "lapsed";
}

/**
 * Cancels the visit a new one replaced, once: in FSM where FSM holds it, then in the mirror. Its payment is kept as the
 * charge. When FSM will not cancel it, the mirror is left as FSM has it and ops are told to cancel it by hand. A visit
 * the technician has begun since is never cancelled: both visits stand, and ops are told.
 */
async function retireReplaced(
  db: D1Database,
  fsm: FsmProvider,
  hold: HoldRow,
  now: Date,
  options: ConfirmOptions,
): Promise<void> {
  const old = await db
    .prepare(
      `SELECT a.id, a.fsm_id, a.fsm_work_order_id, a.window_start, ${visitBegun("a")} AS begun FROM appointments a
       WHERE a.id = ?1 AND a.status IN ('scheduled', 'dispatched') AND a.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM visit_changes c WHERE c.appointment_id = a.id AND c.kind IN ('replaced', 'cancelled'))`,
    )
    .bind(hold.moves_appointment_id)
    .first<{ id: string; fsm_id: string; fsm_work_order_id: string | null; window_start: string; begun: number }>();
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
  const workOrderId = writesFsmFor(options, old) ? old.fsm_work_order_id : null;
  if (workOrderId !== null && !(await cancelledInFsm(fsm, workOrderId, old.id, hold, options))) return;
  const payment = await visitPayment(db, old.id);
  const at = now.toISOString();
  const nowStart = (await heldVisitTimes(db, hold)).start.toISOString();
  const cancelled =
    workOrderId === null
      ? moveVisit(db, old.id, "cancel", at)
      : db
          .prepare(
            "UPDATE appointments SET status = 'cancelled', fsm_status = 'Cancelled', synced_at = ?1 WHERE id = ?2",
          )
          .bind(at, old.id);
  await db.batch([
    cancelled,
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

/** Cancels a replaced visit's work order in FSM; false, with ops told to cancel it by hand, when FSM will not. */
async function cancelledInFsm(
  fsm: FsmProvider,
  workOrderId: string,
  visitId: string,
  hold: HoldRow,
  options: ConfirmOptions,
): Promise<boolean> {
  const note = `${options.labelAsTest ? "Staging test: " : ""}Moved by the client too late to move it free, to a new visit; charged.`;
  if (await fsm.cancelVisit(workOrderId, note)) return true;
  await options.alertOnce?.({
    key: `replaced_not_cancelled:${visitId}`,
    message:
      `The client moved visit ${visitId} to a new one (booking ${hold.id}), and FSM would not cancel its work ` +
      `order ${workOrderId}. Cancel it in FSM by hand; its payment is kept as the charge.`,
    link: `/clients/${hold.person_id}`,
  });
  return false;
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
 * did. `alongside` is written in the same batch as
 * the hold is let go: ops' audit entry, and the client's message.
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

/** What FSM held for a booking given up on. */
export type LeftInFsm =
  | { readonly kind: "nothing" }
  | { readonly kind: "cancelled"; readonly workOrderId: string }
  | { readonly kind: "not_cancelled"; readonly workOrderId: string }
  /** An earlier try asked FSM for a work order and never heard back, and FSM could not now be asked. */
  | { readonly kind: "unknown" };

export interface GaveUp {
  /** Whose booking it was, for the console's link. */
  readonly personId: string;
  readonly money:
    | GivenBack
    | { readonly kind: "refund_refused" | "refund_unanswered"; readonly paymentId: string; readonly amount: number };
  readonly fsm: LeftInFsm;
}

/**
 * Ops refund a booking FSM would not take (docs/decisions/0095-a-booking-fsm-refuses-is-held.md). The work order
 * FSM holds for it is cancelled first, so no technician goes to a visit whose money went back, then the payment is
 * refunded and the hold let go, with `alongside` in the same batch. Says what happened to each, for ops. It takes the
 * hold's lease first, as a try does, and answers "being_booked" while a try or a link has it; once it has the lease it
 * reads the hold again, for the work order a try may have kept meanwhile.
 */
export async function giveUpOnBooking(
  db: D1Database,
  fsm: FsmProvider,
  payments: PaymentsProvider,
  holdId: string,
  now: Date,
  options: { readonly labelAsTest: boolean; readonly alongside?: readonly D1PreparedStatement[] },
): Promise<GaveUp | "being_booked"> {
  const hold = await holdOf(db, holdId);
  if (hold === null) throw new Error("no such hold to give up on");
  if (hold.state === "held" && !(await takeLease(db, hold.id, now))) return "being_booked";
  const leased = (await holdOf(db, holdId)) ?? hold;
  const note = `${options.labelAsTest ? "Staging test: " : ""}The booking could not be finished; the client is refunded.`;
  const personId = hold.person_id;
  let left: LeftInFsm = { kind: "nothing" };
  try {
    if (leased.state !== "booked") left = await cancelOrphan(fsm, leased, note);
    // Whatever fails next, no later try may book the visit on the work order just cancelled.
    if (left.kind === "cancelled") await forgetWorkOrder(db, holdId);
    const money = await giveBack(db, payments, holdId, now, "FSM would not take the booking", options.alongside);
    return { personId, money, fsm: left };
  } catch (error) {
    await releaseLease(db, holdId);
    if (error instanceof RefundRefused) {
      return {
        personId,
        money: { kind: "refund_refused", paymentId: error.paymentId, amount: error.amount },
        fsm: left,
      };
    }
    if (error instanceof RefundUnanswered) {
      const money = { kind: "refund_unanswered", paymentId: error.paymentId, amount: error.amount } as const;
      return { personId, money, fsm: left };
    }
    throw error;
  }
}

/** A hold whose work order is cancelled in FSM, made to start afresh: its next try makes a new one, and looks for none. */
async function forgetWorkOrder(db: D1Database, holdId: string): Promise<void> {
  await db
    .prepare(
      "UPDATE slot_holds SET fsm_work_order_id = NULL, fsm_appointment_id = NULL, fsm_tried_at = NULL WHERE id = ?1",
    )
    .bind(holdId)
    .run();
}

/** The work order a booking left in FSM: the one kept on the hold, else one FSM holds under its reference. */
async function workOrderLeftBy(
  fsm: FsmProvider,
  hold: HoldRow,
): Promise<{ readonly kind: "found"; readonly workOrderId: string } | { readonly kind: "nothing" | "unknown" }> {
  if (hold.fsm_work_order_id !== null) return { kind: "found", workOrderId: hold.fsm_work_order_id };
  if (hold.fsm_tried_at === null) return { kind: "nothing" };
  try {
    const found = await fsm.findWorkOrder(hold.id);
    return found === null ? { kind: "nothing" } : { kind: "found", workOrderId: found };
  } catch {
    return { kind: "unknown" };
  }
}

/** Cancels the work order a booking left in FSM, if any, but the one it is now booked as; says what became of it. */
async function cancelOrphan(
  fsm: FsmProvider,
  hold: HoldRow,
  note: string,
  keep: string | null = null,
): Promise<LeftInFsm> {
  const left = await workOrderLeftBy(fsm, hold);
  if (left.kind !== "found") return left;
  const { workOrderId } = left;
  if (workOrderId === keep) return { kind: "nothing" };
  try {
    return (await fsm.cancelVisit(workOrderId, note))
      ? { kind: "cancelled", workOrderId }
      : { kind: "not_cancelled", workOrderId };
  } catch {
    return { kind: "not_cancelled", workOrderId };
  }
}

export type Linked =
  | { readonly kind: "linked"; readonly personId: string; readonly fsm: LeftInFsm }
  /** Its payment had gone back, in Razorpay's dashboard or by a refund of ours, so it was let go, not linked. */
  | { readonly kind: "given_back" }
  /** Not a booking still waiting: booked meanwhile, or given back. */
  | { readonly kind: "not_waiting" }
  /** A try is writing it to FSM at this moment. */
  | { readonly kind: "being_booked" }
  /**
   * Not a visit this booking can be: another client's, another kind, gone or done, another booking's, one the mirror
   * had before the client paid, or the visit the booking replaces.
   */
  | { readonly kind: "not_the_visit" };

export interface LinkOptions extends Omit<ConfirmOptions, "alongside"> {
  /** Ops' entry for the link, written only if the booking is linked; one for its release instead if it is let go. */
  readonly audit: AuditEntry;
}

/**
 * Ops booked a waiting booking's visit in FSM by hand, and the mirror has it: the hold is booked as that visit, as a
 * try that reached FSM would have booked it, with its payment, its tier and its credit, and the client told. Nothing
 * is made in FSM twice: a work order an earlier try made for it, other than the visit's own, is cancelled, and what
 * became of it said, and it takes the hold's lease first, so no try is writing it to FSM meanwhile. A booking that
 * moves a visit is not linked: its visit is already booked, and trying FSM again moves it. A booking whose payment has
 * gone back, refunded in Razorpay's dashboard or by a refund of ours whose own write then failed, is never booked
 * free: it is let go, as a try would let it go, and audited as the release it is.
 */
export async function bookAsVisit(
  db: D1Database,
  fsm: FsmProvider,
  payments: PaymentsProvider,
  input: { readonly holdId: string; readonly visitId: string },
  now: Date,
  options: LinkOptions,
): Promise<Linked> {
  const hold = await holdOf(db, input.holdId);
  if (hold?.state !== "held" || hold.confirmed_at === null) return { kind: "not_waiting" };
  if (hold.move_kind === "move") return { kind: "not_the_visit" };
  const visit = await linkableVisit(db, hold, input.visitId);
  if (visit === null) return { kind: "not_the_visit" };
  if (!(await takeLease(db, hold.id, now))) return { kind: "being_booked" };

  const leased = (await holdOf(db, hold.id)) ?? hold;
  try {
    if (await paymentGone(db, leased)) {
      const released = auditStatement(db, releaseEntry(options.audit), now);
      await giveBack(db, payments, leased.id, now, "its payment was refunded", [released]);
      return { kind: "given_back" };
    }
    await db.batch([...linkStatements(db, leased, visit.id, now, options.audit), ...creditRedeem(db, leased, now)]);
  } catch (error) {
    await releaseLease(db, hold.id);
    throw error;
  }

  const booked = await holdOf(db, hold.id);
  if (booked?.state !== "booked" || booked.appointment_id !== visit.id) {
    // Another of the client's bookings was linked to the visit a moment before.
    await releaseLease(db, hold.id);
    return { kind: "not_the_visit" };
  }
  await alertIfNoCreditPaid(db, booked, options);
  await afterBooked(db, fsm, booked, now, options);
  const note = `${options.labelAsTest ? "Staging test: " : ""}Booked by hand as another work order; not needed.`;
  return {
    kind: "linked",
    personId: hold.person_id,
    fsm: await cancelOrphan(fsm, booked, note, visit.fsm_work_order_id),
  };
}

/** Whether a booking's payment has gone back: refunded, or its refund asked of Razorpay, which only a refusal undoes. */
async function paymentGone(db: D1Database, hold: HoldRow): Promise<boolean> {
  if (hold.refunded_at !== null) return true;
  return paidInMoney(hold) && (await capturedFor(db, hold.razorpay_order_id)) === null;
}

/** Ops' entry for a link that let the booking go instead, its payment having gone back. */
const releaseEntry = (link: AuditEntry): AuditEntry => ({
  ...link,
  action: "booking.give_back",
  detail: { ...link.detail, reason: "payment_refunded" },
});

/**
 * The visit, if the booking can be it: the client's, of the booking's kind, still to come and no booking's, not the
 * visit the booking replaces, and first seen since the client paid, since a visit the mirror had before cannot be this
 * booking. Since they paid, not since the booking was held: a try whose answer never came may have made the booking's
 * own visit in FSM before its refusals held it.
 */
async function linkableVisit(
  db: D1Database,
  hold: HoldRow,
  visitId: string,
): Promise<{ id: string; fsm_work_order_id: string | null } | null> {
  return db
    .prepare(
      `SELECT a.id, a.fsm_work_order_id FROM appointments a
       WHERE a.id = ?1 AND a.person_id = ?2 AND a.type = ?3 AND a.deleted_at IS NULL
         AND a.status IN ('scheduled', 'dispatched') AND a.first_seen_at >= ?4 AND a.id IS NOT ?5
         AND NOT EXISTS (SELECT 1 FROM slot_holds h WHERE h.appointment_id = a.id AND h.state = 'booked')`,
    )
    .bind(visitId, hold.person_id, hold.type, hold.confirmed_at, hold.moves_appointment_id)
    .first<{ id: string; fsm_work_order_id: string | null }>();
}

/** True inside a link's batch once its first statement has booked the hold, ?1, as the visit, ?2. */
const LINKED = "EXISTS (SELECT 1 FROM slot_holds WHERE id = ?1 AND state = 'booked' AND appointment_id = ?2)";

/**
 * The hold booked as a visit already in the mirror: its tier, its claims, its payment and its referral move to it,
 * with ops' entry. Two of the client's bookings, each under its own lease, may be linked to one visit at once, so the
 * first statement books the hold only while no other booking is the visit, and each after it acts only if it did.
 */
function linkStatements(
  db: D1Database,
  hold: HoldRow,
  visitId: string,
  now: Date,
  audit: AuditEntry,
): D1PreparedStatement[] {
  const at = now.toISOString();
  return [
    db
      .prepare(
        `UPDATE slot_holds SET state = 'booked', appointment_id = ?2, updated_at = ?3
         WHERE id = ?1 AND state = 'held'
           AND NOT EXISTS (SELECT 1 FROM slot_holds other WHERE other.appointment_id = ?2 AND other.state = 'booked')`,
      )
      .bind(hold.id, visitId, at),
    db.prepare(`UPDATE appointments SET tier = ?3 WHERE id = ?2 AND ${LINKED}`).bind(hold.id, visitId, hold.tier),
    db.prepare(`DELETE FROM slot_claims WHERE hold_id = ?1 AND ${LINKED}`).bind(hold.id, visitId),
    db
      .prepare(
        `UPDATE payments SET appointment_id = ?2, updated_at = ?3
         WHERE razorpay_order_id = ?4 AND appointment_id IS NULL AND ${LINKED}`,
      )
      .bind(hold.id, visitId, at, hold.razorpay_order_id),
    db
      .prepare(
        `UPDATE referral_attributions SET consultation_appointment_id = ?2, updated_at = ?3
         WHERE referred_person_id = ?4 AND consultation_appointment_id IS NULL AND ?5 = 'consultation' AND ${LINKED}`,
      )
      .bind(hold.id, visitId, at, hold.person_id, hold.type),
    auditStatementIfBooked(db, audit, now, { holdId: hold.id, visitId }),
  ];
}

/**
 * Ops stop a waiting booking's hourly tries, to book it in FSM by hand and then link it: its last try is set at the
 * end of time (src/policy/held-bookings.ts), so the cron never puts it on the queue again, and it waits for a link or
 * a refund. It takes the hold's lease, as a try does, so no try is writing it to FSM meanwhile, and `audit` goes in
 * the same batch. "being_booked" while a try, or another of ops' actions, has it.
 */
export async function stopTries(
  db: D1Database,
  holdId: string,
  now: Date,
  audit: D1PreparedStatement,
): Promise<"stopped" | "being_booked"> {
  if (!(await takeLease(db, holdId, now))) return "being_booked";
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE slot_holds SET queued_at = ?2, booking_until = NULL, updated_at = ?3
           WHERE id = ?1 AND state = 'held'`,
        )
        .bind(holdId, TRIES_STOPPED.toISOString(), now.toISOString()),
      audit,
    ]);
  } catch (error) {
    await releaseLease(db, holdId);
    throw error;
  }
  return "stopped";
}

/** How long a confirmed hold may wait for FSM before the cron puts it back on the queue. */
const UNBOOKED_AFTER_MS = 30 * MINUTE_MS;
const REQUEUE_PER_PASS = 20;

/** The alert a hold raises while it waits unbooked; closed once it is booked or given back. */
export const unbookedAlertKey = (holdId: string) => `unbooked_hold:${holdId}`;

/**
 * Holds paid for, or booked free, that are neither booked nor refunded half an hour after they were queued: the
 * queue lost the message. Each goes back on the queue, one call from the run's budget, and ops are told once. A
 * hold the queue refuses is left for the next run. One FSM has refused five times running is not among them: it is
 * held for ops, and tried hourly (src/domain/held-bookings.ts). Returns how many went back.
 */
export async function requeueUnbookedHolds(
  db: D1Database,
  input: { queue: Queue; alertOnce: AlertOnce; budget: CallBudget; log: Logger },
  now: Date,
): Promise<number> {
  let requeued = 0;
  for (const hold of await unbookedHolds(db, now)) {
    if (!input.budget.spend(1)) break;
    try {
      await input.queue.send({ hold_id: hold.id, request_id: "unbooked-holds" } satisfies FsmSyncMessage);
    } catch (error) {
      input.log.warn("unbooked_hold_requeue_failed", { hold_id: hold.id, error });
      continue;
    }
    await db.prepare("UPDATE slot_holds SET queued_at = ?2 WHERE id = ?1").bind(hold.id, now.toISOString()).run();
    await input.alertOnce({
      key: unbookedAlertKey(hold.id),
      message:
        `Booking ${hold.id} was paid for, or booked free, and is neither booked in FSM nor refunded half an hour ` +
        "on. It is back on the queue; if FSM still refuses it, it is kept, tried every hour, and you are told.",
      link: `/clients/${hold.person_id}`,
    });
    requeued += 1;
  }
  return requeued;
}

interface UnbookedHold {
  readonly id: string;
  readonly person_id: string;
}

/** Confirmed holds neither booked nor refunded half an hour after they last went to be booked, oldest first. */
async function unbookedHolds(db: D1Database, now: Date): Promise<UnbookedHold[]> {
  const { results } = await db
    .prepare(
      `SELECT id, person_id FROM slot_holds
       WHERE state = 'held' AND confirmed_at IS NOT NULL AND queued_at <= ?1 AND fsm_held_at IS NULL
       ORDER BY queued_at LIMIT ?2`,
    )
    .bind(new Date(now.getTime() - UNBOOKED_AFTER_MS).toISOString(), REQUEUE_PER_PASS)
    .all<UnbookedHold>();
  return results;
}

export interface UnbookedPass {
  readonly fsm: FsmProvider;
  readonly payments: PaymentsProvider;
  readonly alertOnce: AlertOnce;
  readonly resolveAlert: ResolveAlert;
  /** Queues a message about the visit once its row is written. */
  readonly notify: (messageId: string) => Promise<unknown>;
  readonly labelAsTest: boolean;
  readonly budget: CallBudget;
  readonly log: Logger;
}

/**
 * Where our own database holds the record of field work: holds paid for, or booked free, that are neither booked nor
 * refunded half an hour after they were confirmed, because the request that confirmed them failed part-way. Each is
 * booked here, one call from the run's budget, since giving one back asks Razorpay for its refund. One that still
 * cannot be is tried again half an hour on, and ops are told once. Returns how many were booked.
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
  const options: ConfirmOptions = {
    record: "ours",
    labelAsTest: pass.labelAsTest,
    notify: pass.notify,
    alertOnce: pass.alertOnce,
    log: pass.log,
  };
  try {
    const outcome = await confirmBooking(db, pass.fsm, pass.payments, hold.id, now, options);
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
