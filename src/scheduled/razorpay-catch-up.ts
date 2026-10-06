// The cron's razorpay_catch_up job: what Razorpay's webhook never told us, read from Razorpay
// (src/domain/money/razorpay-catch-up.ts), and each hold found paid for booked as the webhook would book it.

import type { Dependencies } from "../dependencies.ts";
import { confirmBooking } from "../domain/booking/bookings.ts";
import { catchUpWithRazorpay } from "../domain/money/razorpay-catch-up.ts";
import type { StaticConfig } from "../guard.ts";
import type { CallBudget } from "../lib/call-budget.ts";
import type { Logger } from "../log.ts";
import { enqueue } from "../domain/platform/enqueue.ts";
import { type MessagingMessage } from "../config/pipeline.ts";

const REQUEST_ID = "razorpay-catch-up";

interface CatchUpRun {
  readonly env: Pick<Env, "DB" | "MESSAGE_QUEUE">;
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

/** Books a hold found paid for, in this run. */
function holdBooker({ env, deps, log }: CatchUpRun): (holdId: string) => Promise<unknown> {
  const notify = (messageId: string) => {
    const body = { message_id: messageId, request_id: REQUEST_ID } satisfies MessagingMessage;
    return enqueue(env.MESSAGE_QUEUE, body, { log, ifLost: "sweeper" });
  };
  return async (holdId) => {
    const context = { db: env.DB, payments: deps.payments, now: deps.now(), notify, alertOnce: deps.alertOnce, log };
    const outcome = await confirmBooking(context, holdId);
    log.info("booking", { hold_id: holdId, outcome });
  };
}
