// Razorpay's events, applied as the webhook queued them (src/domain/money/razorpay-events.ts). A refund that came
// before its payment is tried again a little later, as the payment's own event lands in between; work that throws is
// tried again, later each time, until the queue hands it to the dead letters (src/queues/dead-letters.ts).

import type { StaticConfig } from "../guard.ts";
import { RazorpayEventMessageSchema } from "../config/pipeline.ts";
import type { Dependencies } from "../dependencies.ts";
import { applyRazorpayEvent, RazorpayEventSchema } from "../domain/money/razorpay-events.ts";
import { notifyMessage } from "../domain/platform/enqueue.ts";
import type { Logger } from "../log.ts";
import { afterError, backoffSeconds, DONE, runConsumer } from "./consumer.ts";
import { ALERT_WORDS } from "../config/alert-words.ts";
import { CHECKOUT_FAILING_KEY, razorpayEventFailingKey } from "../policy/alerts.ts";

/** Tries an event has failed before ops are told: one can be a passing D1 hiccup, two are not. */
const FAILING_AFTER_ATTEMPTS = 2;

/** The first wait for a payment a refund's event came before: its own event is seconds behind, as a rule. */
const REFUND_EARLY_RETRY_SECONDS = 60;

export function handleRazorpayBatch({
  batch,
  env,
  config,
  deps,
  log,
}: {
  batch: MessageBatch;
  env: Pick<Env, "DB" | "MESSAGE_QUEUE">;
  config: StaticConfig;
  deps: Dependencies;
  log: Logger;
}): Promise<void> {
  return runConsumer(batch, {
    name: "razorpay",
    schema: RazorpayEventMessageSchema,
    log,
    logFor: (data) => log.child({ request_id: data.request_id, razorpay_event_id: data.event_id }),
    handle: async (data, attempts, eventLog) => {
      const event = RazorpayEventSchema.safeParse(JSON.parse(data.body));
      if (!event.success) {
        eventLog.warn("razorpay_hook_unreadable");
        return DONE;
      }
      const basis = {
        db: env.DB,
        payments: deps.payments,
        alertOnce: deps.alertOnce,
        log: eventLog,
        now: deps.now(),
        hashSalt: config.settings.ipHashSalt,
        requestId: data.request_id,
        notify: (messageId: string) =>
          notifyMessage(env.MESSAGE_QUEUE, { id: messageId, requestId: data.request_id }, eventLog),
      };
      if ((await applyRazorpayEvent(basis, event.data)) === "not_ready") {
        eventLog.info("razorpay_hook_refund_early", { event: event.data.event });
        return { retryAfterSeconds: backoffSeconds(attempts, REFUND_EARLY_RETRY_SECONDS) };
      }
      eventLog.info("razorpay_hook_taken", { event: event.data.event });
      // A payment made through Checkout: it loads again.
      if (event.data.event === "payment.captured") await deps.resolveAlert(CHECKOUT_FAILING_KEY);
      // An event told as failing is put right once it applies; one that never failed has nothing to close.
      if (attempts >= FAILING_AFTER_ATTEMPTS) await deps.resolveAlert(razorpayEventFailingKey(data.event_id));
      return DONE;
    },
    // Each try that throws is tried again, later each time; from the second, ops are told at once, so a payment or a
    // refund that cannot be applied is not left for the dead letters hours later.
    onError: async (data, attempts) => {
      if (attempts >= FAILING_AFTER_ATTEMPTS) {
        await deps.alertOnce({
          key: razorpayEventFailingKey(data.event_id),
          message: ALERT_WORDS.razorpay_event_failing({ event: data.event_id, name: eventName(data.body), attempts }),
        });
      }
      return afterError(attempts);
    },
  });
}

/** The event's name, as "payment.captured"; "unknown" for a body that is not one. */
function eventName(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    const name = typeof parsed === "object" && parsed !== null ? (parsed as { event?: unknown }).event : undefined;
    return typeof name === "string" ? name : "unknown";
  } catch {
    return "unknown";
  }
}
