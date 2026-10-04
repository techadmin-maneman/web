// The cron's razorpay_catch_up job: what Razorpay's webhook never told us, read from Razorpay
// (src/domain/razorpay-catch-up.ts), and each hold found paid for sent to be booked as the webhook would send it.

import { fieldRecord } from "../config/field-record.ts";
import type { Dependencies } from "../dependencies.ts";
import { confirmBooking, type ConfirmOptions } from "../domain/bookings.ts";
import { catchUpWithRazorpay } from "../domain/razorpay-catch-up.ts";
import type { StaticConfig } from "../guard.ts";
import type { CallBudget } from "../lib/call-budget.ts";
import type { Logger } from "../log.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";
import type { MessagingMessage } from "../queues/messaging.ts";

const REQUEST_ID = "razorpay-catch-up";

export interface CatchUpRun {
  readonly env: Pick<Env, "DB" | "FSM_QUEUE" | "MESSAGE_QUEUE">;
  readonly deps: Dependencies;
  readonly config: StaticConfig;
  readonly log: Logger;
  readonly budget: CallBudget;
}

export async function razorpayCatchUpJob(run: CatchUpRun): Promise<void> {
  const { env, deps, config, log, budget } = run;
  const catchUp = {
    payments: deps.payments,
    alertOnce: deps.alertOnce,
    log,
    hashSalt: config.settings.ipHashSalt,
    book: holdBooker(run),
  };
  const found = await catchUpWithRazorpay(env.DB, catchUp, budget, deps.now());
  if (found > 0) log.warn("razorpay_payments_caught_up", { count: found });
}

/** Sends a hold found paid for to be booked: on FSM's queue on its path, else booked in this run. */
function holdBooker({ env, deps, config, log }: CatchUpRun): (holdId: string) => Promise<unknown> {
  if (fieldRecord(config.providers) === "fsm") {
    return (holdId) => env.FSM_QUEUE.send({ hold_id: holdId, request_id: REQUEST_ID } satisfies FsmSyncMessage);
  }
  const notify = (messageId: string) =>
    env.MESSAGE_QUEUE.send({ message_id: messageId, request_id: REQUEST_ID } satisfies MessagingMessage);
  const options: ConfirmOptions = {
    record: "ours",
    labelAsTest: config.environment !== "production",
    notify,
    alertOnce: deps.alertOnce,
    log,
  };
  return async (holdId) => {
    const outcome = await confirmBooking(env.DB, deps.fsm, deps.payments, holdId, deps.now(), options);
    log.info("booking", { hold_id: holdId, outcome });
  };
}
