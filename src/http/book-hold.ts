// A hold the client has paid for, or booked free, booked at once, in this request.

import { rupees } from "@maneman/web-kit/money";
import type { Context } from "hono";
import { paymentsTab } from "../domain/alerts.ts";
import { confirmBooking, RefundRefused, RefundUnanswered } from "../domain/bookings.ts";
import { failureReason } from "../log.ts";
import type { AppEnv } from "./context.ts";
import { queueMessage } from "./queue-message.ts";

/**
 * Books the hold. Never throws: a booking that fails here keeps its time and its payment, and the cron books it within
 * the half hour (src/scheduled/cron.ts, unbooked_holds). A payment owed back that Razorpay would not refund is told to
 * ops at once, since a hold already let go is not tried again; the Tasks board lists it until it is refunded.
 */
export async function bookHold(c: Context<AppEnv>, holdId: string): Promise<void> {
  const { deps, log } = c.var;
  try {
    const outcome = await confirmBooking(c.env.DB, deps.payments, holdId, deps.now(), {
      notify: (messageId) => queueMessage(c, messageId),
      alertOnce: deps.alertOnce,
      log,
    });
    log.info("booking", { hold_id: holdId, outcome });
  } catch (error) {
    log.warn("booking_failed", { hold_id: holdId, reason: failureReason(error) });
    if (error instanceof RefundRefused || error instanceof RefundUnanswered) await tellRefundOwed(c, holdId, error);
  }
}

async function tellRefundOwed(
  c: Context<AppEnv>,
  holdId: string,
  error: RefundRefused | RefundUnanswered,
): Promise<void> {
  const personId = await c.env.DB.prepare("SELECT person_id FROM slot_holds WHERE id = ?1")
    .bind(holdId)
    .first<string>("person_id");
  const owed = `Booking ${holdId} owes back payment ${error.paymentId} of ${rupees(error.amount)}`;
  // A refund Razorpay never answered may have been made: ops look before they refund, so it is not made twice.
  const message =
    error instanceof RefundRefused
      ? `${owed}, and Razorpay refused the refund. Refund it from Razorpay's dashboard.`
      : `${owed}, and Razorpay did not say whether it refunded it. Check Razorpay's dashboard, and refund it there ` +
        "only if no refund of it shows.";
  await c.var.deps.alertOnce({
    key: `hold_refund_failed:${holdId}`,
    message,
    ...(personId === null ? {} : { link: paymentsTab(personId) }),
  });
}
