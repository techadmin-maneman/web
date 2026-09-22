// A held window, booked (docs/decisions/0045-self-serve-booking.md).
//
// A paid visit starts as a Razorpay order for the hold. Razorpay's webhook
// confirms the capture, and the fsm-sync queue then writes the visit to FSM
// and, once FSM has it, to the mirror. A free visit, a consultation, goes
// straight to the queue. If the payment came after the hold had lapsed, or FSM
// will not take the visit, the payment is refunded in full.
//
// A hold that moves a visit (docs/decisions/0046-moving-and-cancelling.md)
// either moves it in place, once its late fee is paid or at once when free, or
// books a new visit and cancels the old one, whose payment is kept.

import { FSM_SERVICE_NAMES, type VisitType } from "../config/visit-types.ts";
import { indiaIso } from "../lib/india-time.ts";
import type { FsmProvider } from "../providers/fsm.ts";
import type { PaymentsProvider } from "../providers/razorpay.ts";
import { fsmContactOf } from "./fsm-contacts.ts";
import { visitTimes } from "./scheduling.ts";
import { visitPayment } from "./visit-changes.ts";

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
  razorpay_order_id: string | null;
  moves_appointment_id: string | null;
  move_kind: "move" | "replace" | null;
}

async function holdOf(db: D1Database, holdId: string): Promise<HoldRow | null> {
  return db
    .prepare(
      `SELECT h.id, h.person_id, p.name AS person_name, h.type, h.date, h.start_unit, h.technician_id,
              t.fsm_id AS technician_fsm_id, h.amount, h.state, h.expires_at, h.razorpay_order_id,
              h.moves_appointment_id, h.move_kind
       FROM slot_holds h JOIN technicians t ON t.id = h.technician_id JOIN people p ON p.id = h.person_id
       WHERE h.id = ?1`,
    )
    .bind(holdId)
    .first<HoldRow>();
}

export type Started = { readonly kind: "free" } | { readonly kind: "pay"; readonly orderId: string };

/** Starts paying for the client's live hold: its Razorpay order, made once. Null when the hold is not live. */
export async function startBooking(
  db: D1Database,
  payments: PaymentsProvider,
  holdId: string,
  personId: string,
  now: Date,
): Promise<Started | null> {
  const hold = await holdOf(db, holdId);
  if (hold?.person_id !== personId || hold.state !== "held" || hold.expires_at <= now.toISOString()) return null;
  if (hold.amount === 0) return { kind: "free" };
  if (hold.razorpay_order_id !== null) return { kind: "pay", orderId: hold.razorpay_order_id };
  const order = await payments.createOrder({
    amount: hold.amount,
    receipt: hold.id,
    notes: { hold_id: hold.id, person_id: hold.person_id },
  });
  await db
    .prepare("UPDATE slot_holds SET razorpay_order_id = ?1, updated_at = ?2 WHERE id = ?3")
    .bind(order.id, now.toISOString(), hold.id)
    .run();
  return { kind: "pay", orderId: order.id };
}

export type Confirmed = "booked" | "already_booked" | "not_paid" | "refunded" | "lapsed";

interface CapturedPayment {
  razorpay_payment_id: string;
  amount: number;
  captured_at: string;
}

async function capturedFor(db: D1Database, orderId: string | null): Promise<CapturedPayment | null> {
  if (orderId === null) return null;
  return db
    .prepare(
      `SELECT razorpay_payment_id, amount, captured_at FROM payments
       WHERE razorpay_order_id = ?1 AND status = 'captured' ORDER BY captured_at LIMIT 1`,
    )
    .bind(orderId)
    .first<CapturedPayment>();
}

/**
 * Books a hold in FSM once it is paid for (or free), then in the mirror. A payment that came after the hold
 * lapsed is refunded instead. Throws when FSM fails, so the queue tries again.
 */
export async function confirmBooking(
  db: D1Database,
  fsm: FsmProvider,
  payments: PaymentsProvider,
  holdId: string,
  now: Date,
  { labelAsTest }: { labelAsTest: boolean },
): Promise<Confirmed> {
  const hold = await holdOf(db, holdId);
  if (hold === null) throw new Error("no such hold to book");
  if (hold.state === "booked") {
    // A new visit replacing an old one: the old one is cancelled once the new one is booked, if not yet.
    if (hold.move_kind === "replace") await retireReplaced(db, fsm, hold, now, labelAsTest);
    return "already_booked";
  }
  const payment = await capturedFor(db, hold.razorpay_order_id);
  if (hold.amount > 0 && payment === null) return "not_paid";

  const lapsed = hold.state === "released" || (payment?.captured_at ?? now.toISOString()) > hold.expires_at;
  if (lapsed) {
    await giveBack(db, payments, hold.id, now, "the hold had lapsed");
    return payment === null ? "lapsed" : "refunded";
  }
  if (hold.move_kind === "move") return moveInPlace(db, fsm, payments, hold, now);

  const contactId = await fsmContactOf(db, fsm, hold.person_id);
  const service = (await fsm.items()).find((item) => item.name === FSM_SERVICE_NAMES[hold.type]);
  if (service === undefined) throw new Error(`FSM has no ${FSM_SERVICE_NAMES[hold.type]} item: run setup-fsm.ts`);
  const { start, end } = visitTimes(hold.date, hold.start_unit, hold.type);
  const booked = await fsm.createVisit({
    contactId,
    summary: `${labelAsTest ? "Staging test: " : ""}${FSM_SERVICE_NAMES[hold.type]} for ${hold.person_name}`,
    serviceId: service.id,
    technicianId: hold.technician_fsm_id,
    start: indiaIso(start),
    end: indiaIso(end),
  });

  // FSM's webhook may have mirrored the appointment already; either way the visit is the one with its FSM ID.
  const at = now.toISOString();
  const visitId = "(SELECT id FROM appointments WHERE fsm_id = ?1)";
  await db.batch([
    db
      .prepare(
        `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, window_start, window_end,
           technician_id, status, fsm_status, fsm_modified_at, synced_at)
         VALUES (?2, ?1, ?3, ?4, ?5, ?6, ?7, ?8, 'scheduled', 'Scheduled', ?9, ?9)
         ON CONFLICT (fsm_id) DO NOTHING`,
      )
      .bind(
        booked.appointmentId,
        crypto.randomUUID(),
        booked.workOrderId,
        hold.person_id,
        hold.type,
        start.toISOString(),
        end.toISOString(),
        hold.technician_id,
        at,
      ),
    db
      .prepare(`UPDATE slot_holds SET state = 'booked', appointment_id = ${visitId}, updated_at = ?2 WHERE id = ?3`)
      .bind(booked.appointmentId, at, hold.id),
    db.prepare("DELETE FROM slot_claims WHERE hold_id = ?1").bind(hold.id),
    db
      .prepare(
        `UPDATE payments SET appointment_id = ${visitId}, updated_at = ?2
         WHERE razorpay_order_id = ?3 AND appointment_id IS NULL`,
      )
      .bind(booked.appointmentId, at, hold.razorpay_order_id),
  ]);
  if (hold.move_kind === "replace") await retireReplaced(db, fsm, hold, now, labelAsTest);
  return "booked";
}

/** Moves the visit to the hold's time, with its technician; its payment carries over, and a late fee is kept. */
async function moveInPlace(
  db: D1Database,
  fsm: FsmProvider,
  payments: PaymentsProvider,
  hold: HoldRow,
  now: Date,
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
  ]);
  return "booked";
}

/** Cancels the visit a new one replaced, once: in FSM, then in the mirror. Its payment is kept as the charge. */
async function retireReplaced(
  db: D1Database,
  fsm: FsmProvider,
  hold: HoldRow,
  now: Date,
  labelAsTest: boolean,
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
    const note = `${labelAsTest ? "Staging test: " : ""}Moved by the client inside 24 hours, to a new visit; charged.`;
    await fsm.cancelVisit(old.fsm_work_order_id, note);
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

/** Lets a hold go, and refunds in full, once, any payment taken for it. */
export async function giveBack(
  db: D1Database,
  payments: PaymentsProvider,
  holdId: string,
  now: Date,
  reason: string,
): Promise<void> {
  const hold = await holdOf(db, holdId);
  if (hold === null || hold.state === "booked") return;
  const payment = await capturedFor(db, hold.razorpay_order_id);
  // The refund is claimed on the hold before it is asked for, so a repeated message cannot ask twice.
  const claimed =
    payment === null
      ? null
      : await db
          .prepare("UPDATE slot_holds SET refunded_at = ?1 WHERE id = ?2 AND refunded_at IS NULL RETURNING id")
          .bind(now.toISOString(), hold.id)
          .first();
  if (payment !== null && claimed !== null) {
    try {
      await payments.refund(payment.razorpay_payment_id, {
        amount: payment.amount,
        notes: { hold_id: hold.id, reason },
      });
    } catch (error) {
      await db.prepare("UPDATE slot_holds SET refunded_at = NULL WHERE id = ?1").bind(hold.id).run();
      throw error;
    }
  }
  await db.batch([
    db.prepare("DELETE FROM slot_claims WHERE hold_id = ?1").bind(hold.id),
    db
      .prepare("UPDATE slot_holds SET state = 'released', updated_at = ?1 WHERE id = ?2")
      .bind(now.toISOString(), hold.id),
  ]);
}
