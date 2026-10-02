// The sweeper's pass over messages queued and not sent: their queue message was lost, or they are waiting for the
// WhatsApp bridge (src/queues/messaging.ts). They go back on the queue only while the bridge is open, so an outage
// does not have each one tried and refused every five minutes. One still unsent a day after it was queued has missed
// its moment: it is failed, and ops are told under one alert a day however many there are.

import type { Dependencies } from "../dependencies.ts";
import type { CallBudget } from "../lib/call-budget.ts";
import { DAY_MS, MINUTE_MS } from "../lib/durations.ts";
import { indiaDate } from "../lib/india-time.ts";
import type { Logger } from "../log.ts";
import { SENDING_LEASE_MS, type MessagingMessage } from "../queues/messaging.ts";

/** Unsent this long after it was queued, a message has lost its queue message or is waiting for the bridge. */
const GRACE_MS = 5 * MINUTE_MS;
const GIVE_UP_MS = DAY_MS;
/** Most messages handled a run; the next run takes the rest. */
const BATCH_LIMIT = 100;

export interface UnsentMessagesRun {
  readonly db: D1Database;
  readonly queue: Queue;
  readonly deps: Pick<Dependencies, "messaging" | "alertOnce">;
  readonly log: Logger;
  readonly now: Date;
  /** The cron run's outside calls; asking the bridge takes one. */
  readonly budget: CallBudget;
}

/** Fails the day-old messages, and sends the rest to messaging again if the bridge is open. Answers the IDs sent. */
export async function requeueUnsentMessages(run: UnsentMessagesRun): Promise<string[]> {
  await failDayOldMessages(run);
  const { results } = await run.db
    .prepare(
      `SELECT id FROM outbound_messages
       WHERE state = 'queued' AND queued_at < ?1 AND (sending_at IS NULL OR sending_at < ?2)
       ORDER BY queued_at LIMIT ?3`,
    )
    .bind(before(run, GRACE_MS), before(run, SENDING_LEASE_MS), BATCH_LIMIT)
    .all<{ id: string }>();
  if (results.length === 0) return [];
  if (!(await bridgeOpen(run))) return [];

  const bodies = results.map((row) => ({ message_id: row.id, request_id: "sweeper" }) satisfies MessagingMessage);
  await run.queue.sendBatch(bodies.map((body) => ({ body })));
  return results.map((row) => row.id);
}

/** Whether the bridge can send now. Not asked once the run has no outside call left; the next run asks. */
async function bridgeOpen(run: UnsentMessagesRun): Promise<boolean> {
  if (!run.budget.spend(1)) return false;
  const connection = await run.deps.messaging.connection();
  if (connection.open) return true;
  run.log.info("messages_wait_for_bridge", { fault: connection.fault, detail: connection.detail });
  return false;
}

async function failDayOldMessages(run: UnsentMessagesRun): Promise<void> {
  const { results } = await run.db
    .prepare(
      `UPDATE outbound_messages
       SET state = 'failed', last_error = 'not sent within a day' || COALESCE(': ' || last_error, ''), sending_at = NULL
       WHERE id IN (
         SELECT id FROM outbound_messages
         WHERE state = 'queued' AND queued_at < ?1 AND (sending_at IS NULL OR sending_at < ?2)
         ORDER BY queued_at LIMIT ?3)
       RETURNING id, kind`,
    )
    .bind(before(run, GIVE_UP_MS), before(run, SENDING_LEASE_MS), BATCH_LIMIT)
    .all<{ id: string; kind: string }>();
  const example = results[0];
  if (example === undefined) return;

  run.log.warn("messages_unsent_failed", { count: results.length });
  await run.deps.alertOnce({
    key: `messages_unsent:${indiaDate(run.now)}`,
    message:
      `Messages queued over a day ago were never sent, and are now failed: ${String(results.length)} on this run, ` +
      `${example.id} (${example.kind}) among them. Replay those still worth sending once the bridge is back ` +
      '(runbook, "Replaying a failed message").',
  });
}

/** The instant `ms` before the run, as ISO. */
const before = (run: UnsentMessagesRun, ms: number): string => new Date(run.now.getTime() - ms).toISOString();
