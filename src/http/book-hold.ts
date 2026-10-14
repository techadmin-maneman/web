// A hold the client has paid for, or booked free, booked at once, in this request.

import type { Context } from "hono";
import { paymentsTab } from "../domain/platform/alerts.ts";
import { confirmBooking } from "../domain/booking/bookings.ts";
import { RefundNotDone } from "../domain/booking/give-back.ts";
import { failureReason } from "../log.ts";
import type { AppEnv } from "./context.ts";
import { queueMessage } from "./queue-message.ts";
import { ALERT_WORDS } from "../config/alert-words.ts";

/**
 * Books the hold. Never throws: a booking that fails here keeps its time and its payment, and the cron books it within
 * the half hour (src/scheduled/cron.ts, unbooked_holds). A payment owed back that Razorpay would not refund is told to
 * ops at once, since a hold already let go is not tried again; the Tasks board lists it until it is refunded.
 */
export async function bookHold(c: Context<AppEnv>, holdId: string): Promise<void> {
  const { deps, log } = c.var;
  try {
    const outcome = await confirmBooking(
      {
        db: c.env.DB,
        payments: deps.payments,
        now: deps.now(),
        notify: (messageId) => queueMessage(c, messageId),
        alertOnce: deps.alertOnce,
        log,
      },
      holdId,
    );
    log.info("booking", { hold_id: holdId, outcome });
  } catch (error) {
    log.warn("booking_failed", { hold_id: holdId, reason: failureReason(error) });
    if (error instanceof RefundNotDone) await tellRefundOwed(c, holdId, error);
  }
}

async function tellRefundOwed(c: Context<AppEnv>, holdId: string, error: RefundNotDone): Promise<void> {
  await c.var.deps.alertOnce({
    key: `hold_refund_failed:${holdId}`,
    message: ALERT_WORDS.hold_refund_failed({
      outcome: error.outcome,
      booking: holdId,
      payment: error.paymentId,
      amount: error.amount,
    }),
    link: paymentsTab(error.personId),
  });
}
