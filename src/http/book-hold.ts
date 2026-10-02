// A hold the client has paid for, or booked free, sent to be booked. Where our own database holds the record of field
// work it is booked at once, in this request; otherwise it goes on FSM's queue (src/queues/fsm-sync.ts).

import type { Context } from "hono";
import { fieldRecord } from "../config/field-record.ts";
import { confirmBooking } from "../domain/bookings.ts";
import { failureReason } from "../log.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";
import type { MessagingMessage } from "../queues/messaging.ts";
import type { AppEnv } from "./context.ts";

/**
 * Books the hold, or queues it for FSM. A booking that fails here is only logged: the hold keeps its time and its
 * payment, and the cron books it within the half hour (bookUnbookedHolds in src/domain/bookings.ts).
 */
export async function bookHold(c: Context<AppEnv>, holdId: string): Promise<void> {
  const { config, deps, log, requestId } = c.var;
  if (fieldRecord(config.providers) === "fsm") {
    await c.env.FSM_QUEUE.send({ hold_id: holdId, request_id: requestId } satisfies FsmSyncMessage);
    return;
  }
  const notify = (messageId: string) =>
    c.env.MESSAGE_QUEUE.send({ message_id: messageId, request_id: requestId } satisfies MessagingMessage);
  try {
    const outcome = await confirmBooking(c.env.DB, deps.fsm, deps.payments, holdId, deps.now(), {
      record: "ours",
      labelAsTest: config.environment !== "production",
      notify,
      alertOnce: deps.alertOnce,
      log,
    });
    log.info("booking", { hold_id: holdId, outcome });
  } catch (error) {
    log.warn("booking_failed", { hold_id: holdId, reason: failureReason(error) });
  }
}
