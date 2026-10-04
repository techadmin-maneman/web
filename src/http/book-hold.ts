// A hold the client has paid for, or booked free, sent to be booked. Where our own database holds the record of field
// work it is booked at once, in this request; otherwise it goes on FSM's queue (src/queues/fsm-sync.ts).

import type { Context } from "hono";
import { fieldRecord } from "../config/field-record.ts";
import { confirmBooking } from "../domain/bookings.ts";
import { failureReason } from "../log.ts";
import { enqueue } from "../queues/enqueue.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";
import type { AppEnv } from "./context.ts";
import { queueMessage } from "./queue-message.ts";

/**
 * Books the hold, or queues it for FSM. Never throws: a booking that fails here, or a hold FSM's queue refuses, keeps
 * its time and its payment, and the cron books it within the half hour (src/scheduled/cron.ts, unbooked_holds).
 */
export async function bookHold(c: Context<AppEnv>, holdId: string): Promise<void> {
  const { config, deps, log, requestId } = c.var;
  if (fieldRecord(config.providers) === "fsm") {
    const body = { hold_id: holdId, request_id: requestId } satisfies FsmSyncMessage;
    await enqueue(c.env.FSM_QUEUE, body, { log, ifLost: "sweeper" });
    return;
  }
  try {
    const outcome = await confirmBooking(c.env.DB, deps.fsm, deps.payments, holdId, deps.now(), {
      record: "ours",
      labelAsTest: config.environment !== "production",
      notify: (messageId) => queueMessage(c, messageId),
      alertOnce: deps.alertOnce,
      log,
    });
    log.info("booking", { hold_id: holdId, outcome });
  } catch (error) {
    log.warn("booking_failed", { hold_id: holdId, reason: failureReason(error) });
  }
}
