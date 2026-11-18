// A provider's webhook refused at our door (docs/decisions/0277-alerts-that-come-sooner.md): a signature or token that
// does not match, which is a secret changed on one side and not the other, or someone posting what the provider did
// not send. Refused a few times in a row, ops are told at once, by the urgent space; the next delivery taken closes it.

import { ALERT_WORDS } from "../../config/alert-words.ts";
import { WEBHOOK_REFUSED_AFTER, webhookRefusedKey, type Webhook } from "../../policy/alerts.ts";
import type { AlertOnce, ResolveAlert } from "./alerts.ts";

/** One more delivery refused: told once it has happened WEBHOOK_REFUSED_AFTER times with none taken between. */
export function webhookRefused(alertOnce: AlertOnce, hook: Webhook): Promise<void> {
  return alertOnce({
    key: webhookRefusedKey(hook),
    message: ALERT_WORDS.webhook_refused({ hook, times: WEBHOOK_REFUSED_AFTER }),
    after: WEBHOOK_REFUSED_AFTER,
  });
}

/** A delivery taken: whatever was refusing them is put right. */
export function webhookTaken(resolveAlert: ResolveAlert, hook: Webhook): Promise<void> {
  return resolveAlert(webhookRefusedKey(hook));
}
