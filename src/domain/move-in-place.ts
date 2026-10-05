// A hold that moves a visit: the visit moved in place, or a replacement booked and the visit it replaces cancelled.

import { createLogger } from "../log.ts";
import type { PaymentsProvider } from "../providers/payments/index.ts";
import { refundedMessage } from "./auto-refunds.ts";
import { heldTimeFree } from "./hold-slot.ts";
import { heldVisitTimes } from "./visit-times.ts";
import { hasBegun, visitBegun } from "./visit-begun.ts";
import { visitPayment } from "./visit-changes.ts";
import { visitMessage } from "./visit-messages.ts";
import { moveVisit } from "./visit-status.ts";
import { type ConfirmOptions, type HoldRow, type Confirmed } from "./booked-hold.ts";
import { giveBack, AUTO_REFUND_NOTES, autoRefundMarked, giveBackUnkept } from "./give-back.ts";

interface VisitToMove {
  id: string;
  window_start: string;
  technician_id: string | null;
}

/** Moves the visit to the hold's time, with its technician; its payment carries over, and a late fee is kept. */
export async function moveInPlace(
  db: D1Database,
  payments: PaymentsProvider,
  hold: HoldRow,
  now: Date,
  options: ConfirmOptions,
): Promise<Confirmed> {
  const visit = await db
    .prepare(
      `SELECT a.id, a.window_start, a.technician_id FROM appointments a
       WHERE a.id = ?1 AND a.status IN ('scheduled', 'dispatched') AND a.deleted_at IS NULL AND NOT ${visitBegun("a")}`,
    )
    .bind(hold.moves_appointment_id)
    .first<VisitToMove>();
  if (visit === null) return moveRefused(db, payments, hold, now, options);
  if (!(await takesHeldTime(db, hold, visit, now))) return moveOvertaken(db, payments, hold, now, options);
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

/**
 * Whether the visit can still take the hold's time: it is still with the technician the time was held on, since ops
 * may have given it to another after the client chose it, and nothing else has taken that time on his day.
 */
async function takesHeldTime(db: D1Database, hold: HoldRow, visit: VisitToMove, now: Date): Promise<boolean> {
  if (visit.technician_id !== hold.technician_id) return false;
  return heldTimeFree(db, hold, now, visit.id);
}

/**
 * Lets a move in place go where the visit can no longer take the held time, and gives back what the client paid for
 * it. The visit stays as it is, and the client is told so.
 */
async function moveOvertaken(
  db: D1Database,
  payments: PaymentsProvider,
  hold: HoldRow,
  now: Date,
  options: ConfirmOptions,
): Promise<Confirmed> {
  (options.log ?? createLogger()).warn("move_overtaken", { hold_id: hold.id });
  const told = refundedMessage(db, { personId: hold.person_id, holdId: hold.id, now });
  await giveBack(
    db,
    payments,
    hold.id,
    now,
    AUTO_REFUND_NOTES.not_movable,
    [told.statement],
    [autoRefundMarked(db, hold.id, "not_movable")],
  );
  await options.notify?.(told.id);
  return hold.amount > 0 ? "refunded" : "lapsed";
}

/** A late move whose visit the technician began before it was booked: it is refunded, not booked. */
export async function replacesBegunVisit(db: D1Database, hold: HoldRow): Promise<boolean> {
  if (hold.move_kind !== "replace" || hold.moves_appointment_id === null) return false;
  return hasBegun(db, hold.moves_appointment_id);
}

/** Lets a move's hold go, and gives its payment back, since the visit it moves can no longer be changed. */
export async function moveRefused(
  db: D1Database,
  payments: PaymentsProvider,
  hold: HoldRow,
  now: Date,
  options: ConfirmOptions,
): Promise<Confirmed> {
  await giveBackUnkept(db, payments, hold, now, "not_movable", options);
  return hold.amount > 0 ? "refunded" : "lapsed";
}

/**
 * Cancels the visit a new one replaced, once. Its payment is kept as the charge. A visit the technician has begun since
 * is never cancelled: both visits stand, and ops are told.
 */
export async function retireReplaced(db: D1Database, hold: HoldRow, now: Date, options: ConfirmOptions): Promise<void> {
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
