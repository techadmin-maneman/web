// A provider's webhook refused at our door (docs/decisions/0277-alerts-that-come-sooner.md): a signature or token that
// does not match, which is a secret changed on one side and not the other, or someone posting what the provider did
// not send. Refused a few times in a row, ops are told at once, by the urgent space; the next delivery taken closes it.
// Told and closed once, it is not told again for a day, so posts anyone can forge page once a day at most, and stray
// ones never stop a real mismatch from being told.

import { ALERT_WORDS } from "../../config/alert-words.ts";
import { DAY_MS } from "../../lib/durations.ts";
import { WEBHOOK_REFUSED_AFTER, webhookRefusedKey, type Webhook } from "../../policy/alerts.ts";
import type { AlertOnce, ResolveAlert } from "./alerts.ts";

/** One more delivery refused: told once it has happened WEBHOOK_REFUSED_AFTER times with none taken between. */
export async function webhookRefused(
  deps: { readonly db: D1Database; readonly alertOnce: AlertOnce; readonly now: Date },
  hook: Webhook,
): Promise<void> {
  const key = webhookRefusedKey(hook);
  const toldToday = await deps.db
    .prepare(
      `SELECT 1 FROM alerts INDEXED BY alerts_resolved
        WHERE key = ?1 AND resolved_at >= ?2 AND told_at IS NOT NULL LIMIT 1`,
    )
    .bind(key, new Date(deps.now.getTime() - DAY_MS).toISOString())
    .first();
  if (toldToday !== null) return;
  await deps.alertOnce({
    key,
    message: ALERT_WORDS.webhook_refused({ hook, times: WEBHOOK_REFUSED_AFTER }),
    after: WEBHOOK_REFUSED_AFTER,
  });
}

/** A delivery taken: whatever was refusing them is put right. */
export function webhookTaken(resolveAlert: ResolveAlert, hook: Webhook): Promise<void> {
  return resolveAlert(webhookRefusedKey(hook));
}
