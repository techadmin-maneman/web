// The refund a cancel gives back, the client's own or ops' (docs/decisions/0046-moving-and-cancelling.md). The
// request that cancels the visit asks for it; one that request could not settle is asked for again by the cron's
// cancel_refunds job. Both ask under the cancel's own receipt, so Razorpay makes it once
// (docs/decisions/0100-a-refund-is-made-once.md).

import type { CallBudget } from "../lib/call-budget.ts";
import { MINUTE_MS } from "../lib/durations.ts";
import type { Logger } from "../log.ts";
import type { PaymentsProvider } from "../providers/payments/index.ts";
import { paymentsTab, type AlertOnce } from "./alerts.ts";
import { ASKS, askRefund, refundLeftToOps, refundReceipt } from "./refunds.ts";

export interface RefundDeps {
  readonly payments: PaymentsProvider;
  readonly alertOnce: AlertOnce;
}

/** Who cancelled, as a refund's note and ops' alert name them. */
export type Canceller = "the client" | "ops";

/** A cancel's refund still to be asked of Razorpay. */
export interface OwedRefund {
  readonly changeId: string;
  readonly cancelledBy: Canceller;
  readonly appointmentId: string;
  readonly personId: string;
  readonly razorpayPaymentId: string;
  /** In paise. */
  readonly amount: number;
}

/**
 * The refund asked for in the request that cancelled the visit: true once settled. On a failure it is left owed, for
 * the cron's cancel_refunds job.
 */
export async function refundAtOnce(
  db: D1Database,
  deps: RefundDeps,
  owed: OwedRefund,
  now: Date,
  log: Logger,
): Promise<boolean> {
  try {
    await settleRefund(db, deps, owed, now, { log, askedBefore: false });
    return true;
  } catch (error) {
    log.error("cancel_refund_owed", { appointment_id: owed.appointmentId, error });
    return false;
  }
}

/**
 * Asks Razorpay for the refund, then marks it settled. One Razorpay refuses, or will not say it made, is left to ops,
 * who are told first. A refund `askedBefore` may have been made by that ask, so a refusal now is told to ops as one
 * that may have been made.
 */
async function settleRefund(
  db: D1Database,
  deps: RefundDeps,
  owed: OwedRefund,
  now: Date,
  asking: { readonly log: Logger; readonly askedBefore: boolean },
): Promise<void> {
  const refund = {
    amount: owed.amount,
    notes: { appointment_id: owed.appointmentId, reason: `cancelled by ${owed.cancelledBy}` },
    receipt: refundReceipt({ kind: "cancel", appointmentId: owed.appointmentId }),
  };
  const asked = await askRefund(deps.payments, owed.razorpayPaymentId, refund, { askedBefore: asking.askedBefore });
  if (asked.kind !== "refunded") {
    asking.log.error("cancel_refund_failed", {
      appointment_id: owed.appointmentId,
      outcome: asked.kind,
      error: asked.error,
    });
    const what = `Rs. ${String(owed.amount / 100)} for visit ${owed.appointmentId}, cancelled by ${owed.cancelledBy}`;
    // Keyed on the visit, so ops are told once and a second refund by hand is not asked for.
    await deps.alertOnce({
      key: `cancel_refund_failed:${owed.appointmentId}`,
      message: refundLeftToOps(asked.kind, what, owed.razorpayPaymentId, owed.amount),
      link: paymentsTab(owed.personId),
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

/** Well after the request that cancelled has stopped asking, which it does within 20 seconds. */
const OWED_AFTER_MS = 10 * MINUTE_MS;
const OWED_PER_PASS = 10;

/**
 * Cancels whose refund the request that cancelled them did not settle, ten minutes on, oldest first. Each is asked for
 * again and settled as the request would have, while the run's budget has the calls a refund can make. Returns how
 * many were settled.
 */
export async function settleOwedRefunds(
  db: D1Database,
  deps: RefundDeps & { readonly budget: CallBudget; readonly log: Logger },
  now: Date,
): Promise<number> {
  let settled = 0;
  for (const owed of await owedRefunds(db, now)) {
    if (!deps.budget.spend(ASKS)) break;
    await settleRefund(db, deps, owed, now, { log: deps.log, askedBefore: true });
    settled += 1;
  }
  return settled;
}

/**
 * Refunds owed by cancels the request did not settle, of visits that are cancelled. One with a refund ID was refunded
 * by a Worker that did not yet mark refunds settled.
 */
async function owedRefunds(db: D1Database, now: Date): Promise<OwedRefund[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.appointment_id, c.person_id, c.refund_amount, c.cancelled_by, p.razorpay_payment_id
       FROM visit_changes c
         JOIN payments p ON p.id = c.payment_id
         JOIN appointments a ON a.id = c.appointment_id
       WHERE c.kind = 'cancelled' AND c.refund_settled_at IS NULL AND c.created_at <= ?1
         AND c.refund_amount > 0 AND c.razorpay_refund_id IS NULL AND a.status = 'cancelled'
       ORDER BY c.created_at LIMIT ?2`,
    )
    .bind(new Date(now.getTime() - OWED_AFTER_MS).toISOString(), OWED_PER_PASS)
    .all<{
      id: string;
      appointment_id: string;
      person_id: string;
      refund_amount: number;
      cancelled_by: string | null;
      razorpay_payment_id: string;
    }>();
  return results.map((row) => ({
    changeId: row.id,
    cancelledBy: row.cancelled_by === null ? "the client" : "ops",
    appointmentId: row.appointment_id,
    personId: row.person_id,
    razorpayPaymentId: row.razorpay_payment_id,
    amount: row.refund_amount,
  }));
}
