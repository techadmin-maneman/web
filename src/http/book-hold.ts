// A hold the client has paid for, or booked free, booked at once, in this request.

import type { Context } from "hono";
import { confirmBooking } from "../domain/bookings.ts";
import { failureReason } from "../log.ts";
import type { AppEnv } from "./context.ts";
import { queueMessage } from "./queue-message.ts";

/**
 * Books the hold. Never throws: a booking that fails here keeps its time and its payment, and the cron books it within
 * the half hour (src/scheduled/cron.ts, unbooked_holds).
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
  }
}
