// The fsm-sync consumer: each message names an FSM appointment to read afresh
// and write over its mirror copy (docs/decisions/0032-fsm-mirror.md). FSM's
// webhooks and the reconciliation put messages here; neither is trusted for
// the appointment's contents, only for which one changed.
//
// Once an appointment is closed, its photographs are copied from FSM into the
// client-photos bucket (src/domain/visit-photos.ts).
//
// A failed sync is retried after 30 s, 1, 2 and 4 minutes. The fifth failure
// alerts and gives up; the reconciliation picks the appointment up again.

import { z } from "zod";
import type { Dependencies } from "../dependencies.ts";
import { syncAppointment } from "../domain/fsm-mirror.ts";
import { exportVisitPhotos } from "../domain/visit-photos.ts";
import { scrubString, type Logger } from "../log.ts";

export const MAX_FSM_SYNC_ATTEMPTS = 5;
const FIRST_RETRY_DELAY_SECONDS = 30;

export const FsmSyncMessageSchema = z.object({
  fsm_id: z.string().min(1),
  /** The webhook delivery that asked for it, if one did. */
  inbox_id: z.uuid().optional(),
  request_id: z.string(),
});
export type FsmSyncMessage = z.infer<typeof FsmSyncMessageSchema>;

export type FsmSyncEnv = Pick<Env, "DB" | "CLIENT_PHOTOS">;

export async function handleFsmSyncBatch(
  batch: MessageBatch,
  env: FsmSyncEnv,
  deps: Dependencies,
  log: Logger,
): Promise<void> {
  const db = env.DB;
  for (const message of batch.messages) {
    const parsed = FsmSyncMessageSchema.safeParse(message.body);
    if (!parsed.success) {
      log.error("fsm_sync_bad_message", { message_id: message.id });
      message.ack();
      continue;
    }
    const { fsm_id: fsmId, inbox_id: inboxId, request_id: requestId } = parsed.data;
    const messageLog = log.child({ request_id: requestId, fsm_id: fsmId });

    try {
      const result = await syncAppointment(db, deps.fsm, fsmId, deps.now());
      const photos =
        result.appointmentId !== null && (result.status === "completed" || result.status === "terminated")
          ? await exportVisitPhotos(db, env.CLIENT_PHOTOS, deps.fsm, { id: result.appointmentId, fsmId }, deps.now())
          : null;
      if (inboxId !== undefined) await recordAttempt(db, inboxId, deps.now().toISOString(), null);
      messageLog.info("fsm_synced", {
        outcome: result.outcome,
        appointment_id: result.appointmentId,
        photos_exported: photos?.exported,
        photos_unreadable: photos?.unreadable,
      });
      message.ack();
    } catch (error) {
      const reason = scrubString(error instanceof Error ? error.message : "unknown error").slice(0, 300);
      if (inboxId !== undefined) await recordAttempt(db, inboxId, null, reason);
      messageLog.warn("fsm_sync_failed", { attempt: message.attempts, reason });
      if (message.attempts >= MAX_FSM_SYNC_ATTEMPTS) {
        await deps.alert(
          `FSM sync gave up on appointment ${fsmId} after ${String(message.attempts)} attempts: ${reason}. ` +
            "The reconciliation will try it again.",
        );
        message.ack();
      } else {
        message.retry({ delaySeconds: FIRST_RETRY_DELAY_SECONDS * 2 ** (message.attempts - 1) });
      }
    }
  }
}

/** Counts an attempt on a webhook delivery: processed when it succeeded, else the reason it failed. */
async function recordAttempt(db: D1Database, inboxId: string, processedAt: string | null, error: string | null) {
  await db
    .prepare(
      `UPDATE webhook_inbox SET attempts = attempts + 1, processed_at = COALESCE(?2, processed_at), last_error = ?3
       WHERE id = ?1`,
    )
    .bind(inboxId, processedAt, error)
    .run();
}
