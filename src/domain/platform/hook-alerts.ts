// A provider's webhook refused at our door (docs/decisions/0277-alerts-that-come-sooner.md): a signature or token that
// does not match, which is a secret changed on one side and not the other, or someone posting what the provider did
// not send. Refused a few times in a row, ops are told at once, by the urgent space; the next delivery taken closes it.
// Only the first few refusals of a day count, so posts anyone can forge raise it once a day at most.

import { ALERT_WORDS } from "../../config/alert-words.ts";
import { WEBHOOK_REFUSED_AFTER, webhookRefusedKey, type Webhook } from "../../policy/alerts.ts";
import { takeOne, type CountedAt } from "../sign-in/rate-limit.ts";
import type { AlertOnce, ResolveAlert } from "./alerts.ts";

/** One more delivery refused: told once it has happened WEBHOOK_REFUSED_AFTER times with none taken between. */
export async function webhookRefused(
  deps: { readonly db: D1Database; readonly alertOnce: AlertOnce; readonly at: CountedAt },
  hook: Webhook,
): Promise<void> {
  if (!(await takeOne(deps.db, "webhook_refused:hook", hook, deps.at))) return;
  await deps.alertOnce({
    key: webhookRefusedKey(hook),
    message: ALERT_WORDS.webhook_refused({ hook, times: WEBHOOK_REFUSED_AFTER }),
    after: WEBHOOK_REFUSED_AFTER,
  });
}

/** A delivery taken: whatever was refusing them is put right. */
export function webhookTaken(resolveAlert: ResolveAlert, hook: Webhook): Promise<void> {
  return resolveAlert(webhookRefusedKey(hook));
}
