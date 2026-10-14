// A hold the client has paid for, or booked free, booked at once, in this request (src/domain/booking/book-paid-hold.ts).

import type { Context } from "hono";
import { bookPaidHold } from "../domain/booking/book-paid-hold.ts";
import type { AppEnv } from "./context.ts";
import { queueMessage } from "./queue-message.ts";

export async function bookHold(c: Context<AppEnv>, holdId: string): Promise<void> {
  const { deps, log } = c.var;
  await bookPaidHold(
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
}
