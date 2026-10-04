// A hold the client has paid for, or booked free, booked at once, in this request.

import type { Context } from "hono";
import { confirmBooking } from "../domain/bookings.ts";
import { failureReason } from "../log.ts";
import type { MessagingMessage } from "../queues/messaging.ts";
import type { AppEnv } from "./context.ts";

/**
 * Books the hold. A booking that fails here is only logged: the hold keeps its time and its payment, and the cron
 * books it within the half hour (bookUnbookedHolds in src/domain/bookings.ts).
 */
export async function bookHold(c: Context<AppEnv>, holdId: string): Promise<void> {
  const { deps, log, requestId } = c.var;
  const notify = (messageId: string) =>
    c.env.MESSAGE_QUEUE.send({ message_id: messageId, request_id: requestId } satisfies MessagingMessage);
  try {
    const outcome = await confirmBooking(c.env.DB, deps.payments, holdId, deps.now(), {
      notify,
      alertOnce: deps.alertOnce,
      log,
    });
    log.info("booking", { hold_id: holdId, outcome });
  } catch (error) {
    log.warn("booking_failed", { hold_id: holdId, reason: failureReason(error) });
  }
}
