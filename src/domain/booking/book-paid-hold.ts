// A hold the client has paid for, or booked free, booked at once: by the request that took it, or by the queue that
// applies Razorpay's event of its payment (src/domain/money/razorpay-events.ts).

import { ALERT_WORDS } from "../../config/alert-words.ts";
import { failureReason } from "../../log.ts";
import { paymentsTab, type AlertOnce } from "../platform/alerts.ts";
import type { BookingContext } from "./booked-hold.ts";
import { confirmBooking } from "./bookings.ts";
import { RefundNotDone } from "./give-back.ts";

/**
 * Books the hold. Never throws: a booking that fails here keeps its time and its payment, and the cron books it within
 * the half hour (src/scheduled/cron.ts, unbooked_holds). A payment owed back that Razorpay would not refund is told to
 * ops at once, since a hold already let go is not tried again; the Tasks board lists it until it is refunded.
 */
export async function bookPaidHold(context: BookingContext & { readonly alertOnce: AlertOnce }, holdId: string) {
  try {
    const outcome = await confirmBooking(context, holdId);
    context.log.info("booking", { hold_id: holdId, outcome });
  } catch (error) {
    context.log.warn("booking_failed", { hold_id: holdId, reason: failureReason(error) });
    if (!(error instanceof RefundNotDone)) return;
    await context.alertOnce({
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
}
