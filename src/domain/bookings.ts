// A held window, booked (docs/decisions/0045-self-serve-booking.md, 0068-a-paid-hold-is-kept.md).
//
// A paid visit starts as a Razorpay order for the hold. Razorpay's webhook
// confirms the capture, and the fsm-sync queue then writes the visit to FSM
// and, once FSM has it, to the mirror. A free visit, a consultation, goes
// straight to the queue.
//
// A hold the client has paid for, or booked free, is confirmed: it keeps its
// time until it is booked or refunded, however long FSM takes. A payment is in
// time if Razorpay made it before the hold ran out, give or take the grace; one
// made later, or a visit FSM will not take, is refunded in full, and ops are
// told what happened to the money.
//
// FSM is written once however often a booking is tried: one consumer at a
// time holds the hold's lease, each ID FSM gives is kept the moment it comes,
// and a try after an answer that never came looks for what FSM made before
// making it again.
//
// A hold that moves a visit (docs/decisions/0046-moving-and-cancelling.md)
// either moves it in place, once its late fee is paid or at once when free, or
// books a new visit and cancels the old one, whose payment is kept.

import { PAYMENT_GRACE_SECONDS } from "../config/scheduling.ts";
import { FSM_SERVICE_NAMES, type VisitType } from "../config/visit-types.ts";
import { indiaIso } from "../lib/india-time.ts";
import type { CallBudget } from "../lib/call-budget.ts";
import { createLogger, type Logger } from "../log.ts";
import type { FsmProvider } from "../providers/fsm.ts";
import type { PaymentsProvider } from "../providers/payments.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";
import type { AlertOnce } from "./alerts.ts";
import { redeemCredit } from "./credits.ts";
import { fsmContactOf, type Place } from "./fsm-contacts.ts";
import { liveVisitOf, visitTimes } from "./scheduling.ts";
import { visitPayment } from "./visit-changes.ts";
import { visitMessage, type VisitMessageKind } from "./visit-messages.ts";
import { MINUTE_MS } from "../lib/durations.ts";

export interface ConfirmOptions {
  readonly labelAsTest: boolean;
  /** Queues a message about the visit once its row is written (src/domain/visit-messages.ts). */
  readonly notify?: (messageId: string) => Promise<unknown>;
  /** Tells ops, once, of something in FSM they must put right by hand (src/domain/alerts.ts). */
  readonly alertOnce?: AlertOnce;
  readonly log?: Logger;
}

interface HoldRow {
  id: string;
  person_id: string;
  person_name: string;
  type: VisitType;
  date: string;
  start_unit: number;
  technician_id: string;
  technician_fsm_id: string;
  amount: number;
  state: "held" | "booked" | "released";
  expires_at: string;
  confirmed_at: string | null;
  razorpay_order_id: string | null;
  appointment_id: string | null;
  moves_appointment_id: string | null;
  move_kind: "move" | "replace" | null;
  use_credit: number;
  fsm_tried_at: string | null;
  fsm_work_order_id: string | null;
  fsm_appointment_id: string | null;
  pincode: string | null;
  /** The pincode's city, where it is one we know. */
  city: string | null;
}

async function holdOf(db: D1Database, holdId: string): Promise<HoldRow | null> {
  return db
    .prepare(
      `SELECT h.id, h.person_id, p.name AS person_name, h.type, h.date, h.start_unit, h.technician_id,
              t.fsm_id AS technician_fsm_id, h.amount, h.state, h.expires_at, h.confirmed_at, h.razorpay_order_id,
              h.appointment_id, h.moves_appointment_id, h.move_kind, h.use_credit, h.fsm_tried_at,
              h.fsm_work_order_id, h.fsm_appointment_id, h.pincode, sp.city
       FROM slot_holds h JOIN technicians t ON t.id = h.technician_id JOIN people p ON p.id = h.person_id
       LEFT JOIN serviceable_pincodes sp ON sp.pincode = h.pincode
       WHERE h.id = ?1`,
    )
    .bind(holdId)
    .first<HoldRow>();
}

/** Whether the client pays money for it: not a free visit, and not one a credit covers. */
const paidInMoney = (hold: { amount: number; use_credit: number }) => hold.amount > 0 && hold.use_credit !== 1;

export type Started = { readonly kind: "free" } | { readonly kind: "pay"; readonly orderId: string };

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
  const hold = await holdOf(db, holdId);
  if (hold?.person_id !== personId || hold.state !== "held" || hold.expires_at <= now.toISOString()) return null;
  const isNewVisit = hold.moves_appointment_id === null;
  if (isNewVisit && (await liveVisitOf(db, personId, hold.type, hold.id)) !== null) return null;
  if (!paidInMoney(hold)) {
    await db
      .prepare(
        `UPDATE slot_holds SET confirmed_at = COALESCE(confirmed_at, ?2), queued_at = ?2, updated_at = ?2
         WHERE id = ?1`,
      )
      .bind(hold.id, now.toISOString())
      .run();
    return { kind: "free" };
  }
  if (hold.razorpay_order_id !== null) return { kind: "pay", orderId: hold.razorpay_order_id };
  const order = await payments.createOrder({
    amount: hold.amount,
    receipt: hold.id,
    notes: { hold_id: hold.id, person_id: hold.person_id },
  });
  // Two bookings of one hold at the same moment both found no order, and both made one. The write
  // settles which of them is the hold's, and the one that lost answers with the winner's, so a hold
  // is only ever paid for on the order it names (ADR 0057).
  const claimed = await db
    .prepare(
      `UPDATE slot_holds SET razorpay_order_id = ?1, updated_at = ?2
       WHERE id = ?3 AND razorpay_order_id IS NULL RETURNING razorpay_order_id`,
    )
    .bind(order.id, now.toISOString(), hold.id)
    .first();
  if (claimed !== null) return { kind: "pay", orderId: order.id };
  const won = (await holdOf(db, holdId))?.razorpay_order_id ?? null;
  return won === null ? null : { kind: "pay", orderId: won };
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

/** Whether Razorpay made the payment after the hold ran out and the grace after it. */
function paidTooLate(hold: HoldRow, payment: CapturedPayment): boolean {
  const lastMoment = new Date(Date.parse(hold.expires_at) + PAYMENT_GRACE_SECONDS * 1000);
  return Date.parse(payment.paid_at) > lastMoment.getTime();
}

/**
 * Books a hold in FSM once it is paid for (or free), then in the mirror. A payment made too late is refunded
 * instead. Throws when FSM fails, so the queue tries again; answers "being_booked" while another consumer is
 * writing it, which the queue tries again later.
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
    await giveBack(db, payments, hold.id, now, "its payment was refunded");
    return "refunded";
  }
  if (hold.state === "released" || (payment !== null && paidTooLate(hold, payment))) {
    await giveBack(db, payments, hold.id, now, "the hold had lapsed");
    return payment === null ? "lapsed" : "refunded";
  }

  if (!(await takeLease(db, hold.id, now))) return "being_booked";
  try {
    const leased = (await holdOf(db, holdId)) ?? hold;
    if (leased.move_kind === "move") return await moveInPlace(db, fsm, payments, leased, now, options.notify);
    return await bookNewVisit(db, fsm, leased, now, options);
  } catch (error) {
    await db.prepare("UPDATE slot_holds SET booking_until = NULL WHERE id = ?1").bind(hold.id).run();
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

/** Books a new visit: FSM first, then, in one batch, the mirror, the hold, its claims and its payment. */
async function bookNewVisit(
  db: D1Database,
  fsm: FsmProvider,
  hold: HoldRow,
  now: Date,
  options: ConfirmOptions,
): Promise<Confirmed> {
  const workOrder = await workOrderFor(db, fsm, hold, now, options);
  const appointmentId = hold.fsm_appointment_id ?? (await appointmentFor(db, fsm, hold, workOrder, options));

  // FSM's webhook may have mirrored the appointment already; either way the visit is the one with its FSM ID.
  const { start, end } = visitTimes(hold.date, hold.start_unit, hold.type);
  const at = now.toISOString();
  const visitId = "(SELECT id FROM appointments WHERE fsm_id = ?1)";
  await db.batch([
    db
      .prepare(
        `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, window_start, window_end,
           technician_id, status, fsm_status, service_city, service_pincode, fsm_modified_at, synced_at, first_seen_at)
         VALUES (?2, ?1, ?3, ?4, ?5, ?6, ?7, ?8, 'scheduled', 'Scheduled', ?9, ?10, ?11, ?11, ?11)
         ON CONFLICT (fsm_id) DO UPDATE SET
           service_city = COALESCE(appointments.service_city, excluded.service_city),
           service_pincode = COALESCE(appointments.service_pincode, excluded.service_pincode)`,
      )
      .bind(
        appointmentId,
        crypto.randomUUID(),
        workOrder.id,
        hold.person_id,
        hold.type,
        start.toISOString(),
        end.toISOString(),
        hold.technician_id,
        hold.city,
        hold.pincode,
        at,
      ),
    db
      .prepare(
        `UPDATE slot_holds SET state = 'booked', appointment_id = ${visitId}, updated_at = ?2
         WHERE id = ?3 AND state = 'held'`,
      )
      .bind(appointmentId, at, hold.id),
    db.prepare("DELETE FROM slot_claims WHERE hold_id = ?1").bind(hold.id),
    db
      .prepare(
        `UPDATE payments SET appointment_id = ${visitId}, updated_at = ?2
         WHERE razorpay_order_id = ?3 AND appointment_id IS NULL`,
      )
      .bind(appointmentId, at, hold.razorpay_order_id),
    // The consultation an invited friend booked, so ops' referral record names it.
    db
      .prepare(
        `UPDATE referral_attributions SET consultation_appointment_id = ${visitId}, updated_at = ?2
         WHERE referred_person_id = ?3 AND consultation_appointment_id IS NULL AND ?4 = 'consultation'`,
      )
      .bind(appointmentId, at, hold.person_id, hold.type),
  ]);
  const booked = await holdOf(db, hold.id);
  if (booked !== null) await afterBooked(db, fsm, booked, now, options);
  return "booked";
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
  const service = (await fsm.items()).find((item) => item.name === FSM_SERVICE_NAMES[hold.type]);
  if (service === undefined) throw new Error(`FSM has no ${FSM_SERVICE_NAMES[hold.type]} item: run setup-fsm.ts`);
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
  const { start, end } = visitTimes(hold.date, hold.start_unit, hold.type);
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
  `${labelAsTest ? "Staging test: " : ""}${FSM_SERVICE_NAMES[hold.type]} for ${hold.person_name}`;

async function keepWorkOrder(db: D1Database, holdId: string, workOrderId: string): Promise<void> {
  await db.prepare("UPDATE slot_holds SET fsm_work_order_id = ?2 WHERE id = ?1").bind(holdId, workOrderId).run();
}

async function keepAppointment(db: D1Database, holdId: string, appointmentId: string): Promise<void> {
  await db.prepare("UPDATE slot_holds SET fsm_appointment_id = ?2 WHERE id = ?1").bind(holdId, appointmentId).run();
}

/** The message a new booking sends: a move's, a consultation's, or the payment's receipt. */
function confirmationOf(hold: HoldRow): VisitMessageKind {
  if (hold.move_kind === "replace") return "reschedule_confirmation";
  return hold.type === "consultation" ? "consultation_confirmation" : "payment_receipt";
}

/**
 * What follows a new booking, each step once however often this runs: the credit spent, the client told, and
 * the visit it replaces cancelled. A retry after any of them failed runs them all again, and each that has
 * already happened changes nothing. A move in place does all of this in its own batch.
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
  if (hold.use_credit === 1) {
    // Checked when the hold was made; a credit spent meanwhile leaves the visit booked, as ops would.
    const redeem = await redeemCredit(db, hold.person_id, visitId, now);
    await redeem?.run();
  }
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
  notify: ConfirmOptions["notify"],
): Promise<Confirmed> {
  const visit = await db
    .prepare(
      `SELECT id, fsm_id, window_start FROM appointments
       WHERE id = ?1 AND status IN ('scheduled', 'dispatched') AND deleted_at IS NULL`,
    )
    .bind(hold.moves_appointment_id)
    .first<{ id: string; fsm_id: string; window_start: string }>();
  if (visit === null) {
    await giveBack(db, payments, hold.id, now, "the visit could no longer be moved");
    return hold.amount > 0 ? "refunded" : "lapsed";
  }
  const { start, end } = visitTimes(hold.date, hold.start_unit, hold.type);
  await fsm.rescheduleVisit(visit.fsm_id, { start: indiaIso(start), end: indiaIso(end) });

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
      .prepare("UPDATE appointments SET window_start = ?1, window_end = ?2, synced_at = ?3 WHERE id = ?4")
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
  await notify?.(message.id);
  return "booked";
}

/**
 * Cancels the visit a new one replaced, once: in FSM, then in the mirror. Its payment is kept as the charge.
 * When FSM will not cancel it, the mirror is left as FSM has it and ops are told to cancel it by hand.
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
      `SELECT a.id, a.fsm_work_order_id, a.window_start FROM appointments a
       WHERE a.id = ?1 AND a.status IN ('scheduled', 'dispatched') AND a.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM visit_changes c WHERE c.appointment_id = a.id AND c.kind IN ('replaced', 'cancelled'))`,
    )
    .bind(hold.moves_appointment_id)
    .first<{ id: string; fsm_work_order_id: string | null; window_start: string }>();
  if (old === null) return;
  if (old.fsm_work_order_id !== null) {
    const note = `${options.labelAsTest ? "Staging test: " : ""}Moved by the client inside 24 hours, to a new visit; charged.`;
    if (!(await fsm.cancelVisit(old.fsm_work_order_id, note))) {
      await options.alertOnce?.({
        key: `replaced_not_cancelled:${old.id}`,
        message:
          `The client moved visit ${old.id} to a new one (booking ${hold.id}), and FSM would not cancel its work ` +
          `order ${old.fsm_work_order_id}. Cancel it in FSM by hand; its payment is kept as the charge.`,
        link: `/clients/${hold.person_id}`,
      });
      return;
    }
  }
  const payment = await visitPayment(db, old.id);
  const at = now.toISOString();
  await db.batch([
    db
      .prepare("UPDATE appointments SET status = 'cancelled', fsm_status = 'Cancelled', synced_at = ?1 WHERE id = ?2")
      .bind(at, old.id),
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
        visitTimes(hold.date, hold.start_unit, hold.type).start.toISOString(),
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
 * Lets a hold go, and refunds in full, once, any payment taken for it. Says what it did with the money; throws
 * RefundRefused, and keeps the hold, when Razorpay will not refund it.
 */
export async function giveBack(
  db: D1Database,
  payments: PaymentsProvider,
  holdId: string,
  now: Date,
  reason: string,
): Promise<GivenBack> {
  const hold = await holdOf(db, holdId);
  if (hold === null) throw new Error("no such hold to give back");
  if (hold.state === "booked") return { kind: "booked" };
  const payment = await capturedFor(db, hold.razorpay_order_id);
  const given: GivenBack =
    payment === null ? { kind: "nothing_paid" } : await refundOnce(db, payments, hold.id, payment, now, reason);
  await db.batch([
    db.prepare("DELETE FROM slot_claims WHERE hold_id = ?1").bind(hold.id),
    db
      .prepare("UPDATE slot_holds SET state = 'released', updated_at = ?1 WHERE id = ?2 AND state = 'held'")
      .bind(now.toISOString(), hold.id),
  ]);
  return given;
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
  try {
    await payments.refund(payment.razorpay_payment_id, { amount: payment.amount, notes: { hold_id: holdId, reason } });
  } catch (error) {
    await db.prepare("UPDATE slot_holds SET refunded_at = NULL WHERE id = ?1").bind(holdId).run();
    throw new RefundRefused(payment.razorpay_payment_id, payment.amount, error);
  }
  return { kind: "refunded", paymentId: payment.razorpay_payment_id, amount: payment.amount };
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
  readonly money: GivenBack | { readonly kind: "refund_refused"; readonly paymentId: string; readonly amount: number };
  readonly fsm: LeftInFsm;
}

/**
 * The last try failed. The work order FSM holds for it is cancelled first, so no technician goes to a visit
 * whose money went back, then the payment is refunded. Says what happened to each, for ops.
 */
export async function giveUpOnBooking(
  db: D1Database,
  fsm: FsmProvider,
  payments: PaymentsProvider,
  holdId: string,
  now: Date,
  labelAsTest: boolean,
): Promise<GaveUp> {
  const hold = await holdOf(db, holdId);
  if (hold === null) throw new Error("no such hold to give up on");
  const left = hold.state === "booked" ? { kind: "nothing" as const } : await cancelOrphan(fsm, hold, labelAsTest);
  const personId = hold.person_id;
  try {
    return { personId, money: await giveBack(db, payments, holdId, now, "FSM would not take the booking"), fsm: left };
  } catch (error) {
    if (!(error instanceof RefundRefused)) throw error;
    return { personId, money: { kind: "refund_refused", paymentId: error.paymentId, amount: error.amount }, fsm: left };
  }
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

async function cancelOrphan(fsm: FsmProvider, hold: HoldRow, labelAsTest: boolean): Promise<LeftInFsm> {
  const left = await workOrderLeftBy(fsm, hold);
  if (left.kind !== "found") return left;
  const { workOrderId } = left;
  const note = `${labelAsTest ? "Staging test: " : ""}The booking could not be finished; the client is refunded.`;
  try {
    return (await fsm.cancelVisit(workOrderId, note))
      ? { kind: "cancelled", workOrderId }
      : { kind: "not_cancelled", workOrderId };
  } catch {
    return { kind: "not_cancelled", workOrderId };
  }
}

/** How long a confirmed hold may wait for FSM before the cron puts it back on the queue. */
const UNBOOKED_AFTER_MS = 30 * MINUTE_MS;
const REQUEUE_PER_PASS = 20;

/** The alert a hold raises while it waits unbooked; closed once it is booked or given back. */
export const unbookedAlertKey = (holdId: string) => `unbooked_hold:${holdId}`;

/**
 * Holds paid for, or booked free, that are neither booked nor refunded half an hour after they were queued: the
 * queue lost the message, or a refund failed. Each goes back on the queue, one call from the run's budget, and
 * ops are told once. A hold the queue refuses is left for the next run. Returns how many went back.
 */
export async function requeueUnbookedHolds(
  db: D1Database,
  input: { queue: Queue; alertOnce: AlertOnce; budget: CallBudget; log: Logger },
  now: Date,
): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT id, person_id FROM slot_holds WHERE state = 'held' AND confirmed_at IS NOT NULL AND queued_at <= ?1
       ORDER BY queued_at LIMIT ?2`,
    )
    .bind(new Date(now.getTime() - UNBOOKED_AFTER_MS).toISOString(), REQUEUE_PER_PASS)
    .all<{ id: string; person_id: string }>();
  let requeued = 0;
  for (const hold of results) {
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
        "on. It is back on the queue; if FSM still refuses it, it is refunded and you are told.",
      link: `/clients/${hold.person_id}`,
    });
    requeued += 1;
  }
  return requeued;
}
