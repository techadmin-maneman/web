// Runs every five minutes. D1 is the replay source: anything that should have
// reached the CRM and has not is put back on the queue from here.
//
// M2 covers leads and housekeeping; M3 adds try-on jobs, messages and the
// AILabTools credit check.

import type { Dependencies } from "../dependencies.ts";
import { addDays, indiaDate } from "../lib/india-time.ts";
import type { Logger } from "../log.ts";
import { MAX_SYNC_ATTEMPTS, type CrmSyncMessage } from "../queues/crm-sync.ts";

/** A pending lead older than this has lost its queue message. */
const PENDING_GRACE_MS = 2 * 60 * 1000;
/** Most leads re-enqueued per run; the next run takes the rest. */
const BATCH_LIMIT = 100;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** Rate-limit windows are at most a day; keep two more for inspection. */
const COUNTER_RETENTION_DAYS = 3;

export interface SweepSummary {
  readonly leadsRequeued: number;
}

export async function sweep(db: D1Database, crmQueue: Queue, deps: Dependencies, log: Logger): Promise<SweepSummary> {
  const now = deps.now();
  const pendingBefore = new Date(now.getTime() - PENDING_GRACE_MS).toISOString();

  const { results: leads } = await db
    .prepare(
      `SELECT id FROM leads
       WHERE (sync_state = 'pending' AND created_at < ?1)
          OR (sync_state = 'failed' AND sync_attempts < ?2)
       ORDER BY created_at
       LIMIT ?3`,
    )
    .bind(pendingBefore, MAX_SYNC_ATTEMPTS, BATCH_LIMIT)
    .all<{ id: string }>();

  if (leads.length > 0) {
    const messages = leads.map((lead) => ({
      body: { lead_id: lead.id, request_id: "sweeper" } satisfies CrmSyncMessage,
    }));
    await crmQueue.sendBatch(messages);
  }

  await db.batch([
    db
      .prepare("DELETE FROM idempotency WHERE created_at < ?1")
      .bind(new Date(now.getTime() - IDEMPOTENCY_TTL_MS).toISOString()),
    db.prepare("DELETE FROM counters WHERE window_start < ?1").bind(addDays(indiaDate(now), -COUNTER_RETENTION_DAYS)),
  ]);

  log.info("sweep", { leads_requeued: leads.length });
  return { leadsRequeued: leads.length };
}
