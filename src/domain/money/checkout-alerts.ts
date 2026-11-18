// Razorpay Checkout failing to load in the client app (docs/decisions/0277-alerts-that-come-sooner.md): its script
// blocked, down or too slow, so no client can pay, and nothing else tells ops. Each signed-in client's failure counts,
// once an hour each; three within a quarter of an hour tell ops at once, and the next payment made through Checkout
// closes it. A count that has not reached three in its quarter hour starts again.

import { ALERT_WORDS } from "../../config/alert-words.ts";
import { MINUTE_MS } from "../../lib/durations.ts";
import { CHECKOUT_FAILING_AFTER, CHECKOUT_FAILING_KEY } from "../../policy/alerts.ts";
import type { AlertOnce } from "../platform/alerts.ts";

/** How long the failures that raise the alert may be spread over. */
const WITHIN_MS = 15 * MINUTE_MS;

/** One more client whose Checkout did not load. */
export async function checkoutUnavailable(db: D1Database, alertOnce: AlertOnce, now: Date): Promise<void> {
  // An untold count older than the window is let go, so only failures close together raise it.
  await db
    .prepare(
      `UPDATE alerts SET resolved_at = ?2
        WHERE key = ?1 AND resolved_at IS NULL AND told_at IS NULL AND first_seen_at < ?3`,
    )
    .bind(CHECKOUT_FAILING_KEY, now.toISOString(), new Date(now.getTime() - WITHIN_MS).toISOString())
    .run();
  await alertOnce({
    key: CHECKOUT_FAILING_KEY,
    message: ALERT_WORDS.checkout_failing({ times: CHECKOUT_FAILING_AFTER }),
    after: CHECKOUT_FAILING_AFTER,
  });
}
