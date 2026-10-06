// What follows a ruling on a no-show, or on the client's dispute of its charge, once the ruling has committed
// (src/domain/no-shows/no-shows.ts, src/domain/no-shows/no-show-disputes.ts; docs/decisions/0096-a-no-shows-charge-and-its-dispute.md):
// the refund, the client's message, and whether a credit given back came back. A committed ruling cannot be made
// again, so nothing here may fail without ops being told what is owed.

import type { PaymentsProvider } from "../../providers/payments/index.ts";
import { paymentsTab, type AlertOnce } from "../ops/alerts.ts";
import { askRefund, refundLeftToOps, refundReceipt, type RefundOutcome } from "../money/refunds.ts";
import { visitPayment, type VisitPayment } from "../visits/visit-changes.ts";
import { creditOfVisit } from "../messages/visit-message-text.ts";
import { rupees } from "@maneman/web-kit/money";

/** Money going back to the client once a ruling is written. */
export interface NoShowRefund {
  readonly appointmentId: string;
  /** Whose visit it was, for ops' alert should Razorpay refuse; null once they have been erased. */
  readonly personId: string | null;
  /** In paise. */
  readonly amount: number;
  /** What sends it back, in Razorpay's notes and in ops' alert. */
  readonly why: "waived" | "charged" | "refunded on dispute";
}

/** The credit a visit was paid with, where a ruling gives it back: whether it came back is read after the refund. */
export type CreditGivenBack = Omit<NoShowRefund, "amount">;

/** What follows a ruling on a no-show or on its dispute, once the ruling has committed (afterRuling). */
export interface Ruled {
  /** The client's WhatsApp about the ruling, to queue; null for a client not, or no longer, on our records. */
  readonly messageId: string | null;
  /** What goes back of the payment: what a charge does not keep, a waiver's, or a refunded dispute's. */
  readonly refund: NoShowRefund | null;
  /** The credit the visit was paid with, where the ruling gives it back. */
  readonly creditGivenBack: CreditGivenBack | null;
}

/**
 * What follows a committed ruling, in this order: the refund, the client's message, and last whether a credit given
 * back came back. The ruling cannot be made again, so nothing is read before the refund, which tells ops itself of
 * anything that stops it.
 */
export async function afterRuling(
  db: D1Database,
  deps: { payments: PaymentsProvider; alertOnce: AlertOnce; notify: (messageId: string) => Promise<unknown> },
  ruled: Ruled,
): Promise<void> {
  if (ruled.refund !== null) await refundNoShow(db, deps, ruled.refund);
  if (ruled.messageId !== null) await deps.notify(ruled.messageId);
  if (ruled.creditGivenBack !== null) await alertIfCreditNotBack(db, deps.alertOnce, ruled.creditGivenBack);
}

/**
 * Tells ops once where the credit a ruling gave back did not come back, its grant expired or clawed back since the
 * visit. The client's message says it could not; ops decide by hand whether the client is owed one.
 */
async function alertIfCreditNotBack(db: D1Database, alertOnce: AlertOnce, credit: CreditGivenBack): Promise<void> {
  if ((await creditOfVisit(db, credit.appointmentId)) !== "kept") return;
  await alertOnce({
    key: `no_show_credit_not_back:${credit.why}:${credit.appointmentId}`,
    message:
      `The visit credit for visit ${credit.appointmentId}, a no-show ${credit.why}, could not come back: its grant ` +
      "has expired or been withdrawn. The client is told so; settle it with them by hand if they are owed one.",
    link: credit.personId === null ? "/no-shows" : paymentsTab(credit.personId),
  });
}

/**
 * Refunds what a ruling gives back, at most what is left of the visit's payment, under a receipt of its own. The
 * ruling has committed by now, so whatever fails here, Razorpay's refusal, its silence or the read of the payment
 * before it, is left to ops, told once with the visit and what is owed, as a cancel's is (src/domain/visits/visit-changes.ts).
 */
export async function refundNoShow(
  db: D1Database,
  deps: { payments: PaymentsProvider; alertOnce: AlertOnce },
  refund: NoShowRefund,
): Promise<void> {
  let payment: VisitPayment | null = null;
  let amount = refund.amount;
  let outcome: RefundOutcome["kind"] | "unread" = "unread";
  try {
    payment = await visitPayment(db, refund.appointmentId);
    if (payment === null) return;
    amount = Math.min(refund.amount, payment.paid);
    if (amount <= 0) return;
    const receipt = refundReceipt({ kind: "no_show", why: refund.why, appointmentId: refund.appointmentId });
    const notes = { appointment_id: refund.appointmentId, reason: `no-show ${refund.why}` };
    outcome = (await askRefund(deps.payments, payment.razorpayPaymentId, { amount, notes, receipt })).kind;
  } catch {
    // The payment could not be read, so nothing was asked of Razorpay.
  }
  if (outcome === "refunded") return;
  const what = `${rupees(amount)} for visit ${refund.appointmentId}, a no-show ${refund.why}`;
  await deps.alertOnce({
    key: `no_show_refund_failed:${refund.why}:${refund.appointmentId}`,
    message:
      payment === null || outcome === "unread"
        ? `The refund of ${what}, failed (its payment could not be read). Refund it by hand in Razorpay, once.`
        : refundLeftToOps(outcome, what, payment.razorpayPaymentId, amount),
    link: refund.personId === null ? "/no-shows" : paymentsTab(refund.personId),
  });
}
