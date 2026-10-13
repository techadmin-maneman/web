// What follows a ruling on a no-show, or on the client's dispute of its charge, once the ruling has committed
// (src/domain/no-shows/no-shows.ts, src/domain/no-shows/no-show-disputes.ts; docs/decisions/0096-a-no-shows-charge-and-its-dispute.md):
// the refund, the client's message, and whether a credit given back came back. A committed ruling cannot be made
// again, so what it gives back is kept as owed in its batch (no_show_refunds, migration 0161): the request asks
// Razorpay at once, and the cron's refund job asks again for any it did not settle.

import type { PaymentsProvider } from "../../providers/payments/index.ts";
import { paymentsTab, type AlertOnce } from "../ops/alerts.ts";
import type { CallBudget } from "../../lib/call-budget.ts";
import { MINUTE_MS } from "../../lib/durations.ts";
import type { Logger } from "../../log.ts";
import { ASKS, askRefund, refundLeftToOps, refundReceipt } from "../money/refunds.ts";
import { visitPayment } from "../visits/visit-changes.ts";
import { creditOfVisit } from "../messages/visit-message-text.ts";
import { rupees } from "@maneman/web-kit/money";

/** Money going back to the client once a ruling is written. */
export interface NoShowRefund {
  /** The refund owed, as the ruling's batch kept it. */
  readonly id: string;
  readonly appointmentId: string;
  /** Whose visit it was, for ops' alert should Razorpay refuse; null once they have been erased. */
  readonly personId: string | null;
  /** In paise. */
  readonly amount: number;
  /** What sends it back, in Razorpay's notes and in ops' alert. */
  readonly why: "waived" | "charged" | "refunded on dispute";
}

/** The credit a visit was paid with, where a ruling gives it back: whether it came back is read after the refund. */
type CreditGivenBack = Omit<NoShowRefund, "id" | "amount">;

/** What follows a ruling on a no-show or on its dispute, once the ruling has committed (afterRuling). */
export interface Ruled {
  /** The client's WhatsApp about the ruling, to queue; null for a client not, or no longer, on our records. */
  readonly messageId: string | null;
  /** What goes back of the payment: what a charge does not keep, a waiver's, or a refunded dispute's. */
  readonly refund: NoShowRefund | null;
  /** The credit the visit was paid with, where the ruling gives it back. */
  readonly creditGivenBack: CreditGivenBack | null;
}

type RefundDeps = { readonly payments: PaymentsProvider; readonly alertOnce: AlertOnce };

/**
 * What follows a committed ruling, in this order: the refund, the client's message, and last whether a credit given
 * back came back. A refund that fails to settle here stays owed, for the cron's refund job to ask again.
 */
export async function afterRuling(
  db: D1Database,
  deps: RefundDeps & { now: () => Date; log: Logger; notify: (messageId: string) => Promise<unknown> },
  ruled: Ruled,
): Promise<void> {
  if (ruled.refund !== null) {
    try {
      await settleNoShowRefund(db, deps, { ...ruled.refund, askedAt: null }, deps.now());
    } catch (error) {
      deps.log.error("no_show_refund_left_owed", { appointment_id: ruled.refund.appointmentId, error });
    }
  }
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
    link: credit.personId === null ? "/payments" : paymentsTab(credit.personId),
  });
}

/** A refund a ruling owes, as kept, with when Razorpay was first asked for it. */
type OwedNoShowRefund = NoShowRefund & { readonly askedAt: string | null };

/**
 * Refunds what a ruling gives back, at most what is left of the visit's payment, under a receipt of its own, marked as
 * asked first, so a second ask is made as for one that may have been made. Whatever Razorpay answers, short of a
 * refund, is left to ops, told once with the visit and what is owed, as a cancel's is; a read or write that throws
 * leaves it owed, for the cron to ask again.
 */
export async function settleNoShowRefund(
  db: D1Database,
  deps: RefundDeps,
  owed: OwedNoShowRefund,
  now: Date,
): Promise<void> {
  await db.prepare("UPDATE no_show_refunds SET asked_at = ?2 WHERE id = ?1").bind(owed.id, now.toISOString()).run();
  const payment = await visitPayment(db, owed.appointmentId);
  const amount = payment === null ? 0 : Math.min(owed.amount, payment.paid);
  let refundId: string | null = null;
  if (payment !== null && amount > 0) {
    const receipt = refundReceipt({ kind: "no_show", why: owed.why, appointmentId: owed.appointmentId });
    const notes = { appointment_id: owed.appointmentId, reason: `no-show ${owed.why}` };
    const asked = await askRefund(
      deps.payments,
      payment.razorpayPaymentId,
      { amount, notes, receipt },
      { askedBefore: owed.askedAt !== null },
    );
    if (asked.kind === "refunded") refundId = asked.refundId;
    else await refundLeft(deps.alertOnce, owed, { outcome: asked.kind, paymentId: payment.razorpayPaymentId, amount });
  }
  await db
    .prepare("UPDATE no_show_refunds SET settled_at = ?2, razorpay_refund_id = ?3 WHERE id = ?1")
    .bind(owed.id, now.toISOString(), refundId)
    .run();
}

/** Ops told once of a refund Razorpay did not make, or would not say it made, with the visit and what is owed. */
async function refundLeft(
  alertOnce: AlertOnce,
  owed: OwedNoShowRefund,
  asked: { outcome: "refused" | "unanswered"; paymentId: string; amount: number },
): Promise<void> {
  const what = `${rupees(asked.amount)} for visit ${owed.appointmentId}, a no-show ${owed.why}`;
  await alertOnce({
    key: `no_show_refund_failed:${owed.why}:${owed.appointmentId}`,
    message: refundLeftToOps(asked.outcome, what, asked.paymentId, asked.amount),
    link: owed.personId === null ? "/payments" : paymentsTab(owed.personId),
  });
}

/** Well after the request that ruled has stopped asking. */
const OWED_AFTER_MS = 10 * MINUTE_MS;
const OWED_PER_PASS = 10;

/**
 * No-show refunds the request that ruled did not settle, ten minutes on, oldest first, each asked for again while the
 * run's budget has the calls a refund can make. Returns how many were settled.
 */
export async function settleOwedNoShowRefunds(
  db: D1Database,
  deps: RefundDeps & { readonly budget: CallBudget },
  now: Date,
): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.appointment_id, r.why, r.amount, r.asked_at, pe.id AS person_id
       FROM no_show_refunds r INDEXED BY no_show_refunds_owed
         JOIN appointments a ON a.id = r.appointment_id
         LEFT JOIN people pe ON pe.id = a.person_id AND pe.erased_at IS NULL
       WHERE r.settled_at IS NULL AND r.created_at <= ?1
       ORDER BY r.created_at LIMIT ?2`,
    )
    .bind(new Date(now.getTime() - OWED_AFTER_MS).toISOString(), OWED_PER_PASS)
    .all<{
      id: string;
      appointment_id: string;
      why: NoShowRefund["why"];
      amount: number;
      asked_at: string | null;
      person_id: string | null;
    }>();
  let settled = 0;
  for (const row of results) {
    if (!deps.budget.spend(ASKS)) break;
    const owed = {
      id: row.id,
      appointmentId: row.appointment_id,
      personId: row.person_id,
      why: row.why,
      amount: row.amount,
      askedAt: row.asked_at,
    };
    await settleNoShowRefund(db, deps, owed, now);
    settled += 1;
  }
  return settled;
}
