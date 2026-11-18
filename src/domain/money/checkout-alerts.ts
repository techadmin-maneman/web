// Razorpay Checkout failing to load in the client app (docs/decisions/0277-alerts-that-come-sooner.md): its script
// blocked, down or too slow, so no client can pay, and nothing else tells ops. Each failure the app reports counts;
// several with no payment captured between tell ops at once, and the next payment captured closes it.

import { ALERT_WORDS } from "../../config/alert-words.ts";
import { CHECKOUT_FAILING_AFTER, CHECKOUT_FAILING_KEY } from "../../policy/alerts.ts";
import type { AlertOnce } from "../platform/alerts.ts";

/** One more client whose Checkout did not load. */
export function checkoutUnavailable(alertOnce: AlertOnce): Promise<void> {
  return alertOnce({
    key: CHECKOUT_FAILING_KEY,
    message: ALERT_WORDS.checkout_failing({ times: CHECKOUT_FAILING_AFTER }),
    after: CHECKOUT_FAILING_AFTER,
  });
}
