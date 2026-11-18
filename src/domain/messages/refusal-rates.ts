// A kind of WhatsApp WhatsApp refuses too often (docs/decisions/0277-alerts-that-come-sooner.md): of the messages of
// a kind sent in the last day, the share it refused (docs/decisions/0276-a-message-whatsapp-refuses.md). Past ops'
// setting, Care are told once, as a template filed as marketing or a sender rated low does to every client at once;
// the kind back under it closes the alert. What Care do not chase, the marketing texts above all, is not counted.

import { ALERT_WORDS } from "../../config/alert-words.ts";
import { DAY_MS } from "../../lib/durations.ts";
import { REFUSALS_NOT_CHASED, type RefusedMessages } from "../../policy/message-refusals.ts";
import type { AlertOnce } from "../platform/alerts.ts";

/** An alert's key for a kind refused too often; its kind is "messages_refused". */
const messagesRefusedKey = (kind: string): string => `messages_refused:${kind}`;

/**
 * Tells Care of each kind of message refused past ops' share in the last day, of at least the fewest sent, and closes
 * the alert of each kind back under it. Run hourly by the cron. Answers how many kinds are past it.
 */
export async function alertRefusalRates(
  db: D1Database,
  alertOnce: AlertOnce,
  { now, limit }: { readonly now: Date; readonly limit: RefusedMessages },
): Promise<number> {
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const { results } = await db
    .prepare(
      `SELECT kind, COUNT(*) AS sent, SUM(state = 'failed') AS refused
         FROM outbound_messages INDEXED BY outbound_messages_by_created
        WHERE created_at >= ?1 AND provider_message_id IS NOT NULL AND state IN ('sent', 'failed')
          AND kind NOT IN (SELECT value FROM json_each(?2))
        GROUP BY kind`,
    )
    .bind(since, JSON.stringify(REFUSALS_NOT_CHASED))
    .all<{ kind: string; sent: number; refused: number }>();
  const past = results.filter((row) => row.sent >= limit.least && row.refused * 100 >= limit.share * row.sent);
  for (const row of past) {
    await alertOnce({
      key: messagesRefusedKey(row.kind),
      message: ALERT_WORDS.messages_refused({ kind: row.kind, refused: row.refused, sent: row.sent }),
      link: "/tasks",
    });
  }
  await db
    .prepare(
      `UPDATE alerts SET resolved_at = ?1
        WHERE key >= 'messages_refused:' AND key < 'messages_refused;' AND resolved_at IS NULL
          AND key NOT IN (SELECT value FROM json_each(?2))`,
    )
    .bind(now.toISOString(), JSON.stringify(past.map((row) => messagesRefusedKey(row.kind))))
    .run();
  return past.length;
}
