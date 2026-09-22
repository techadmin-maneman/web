// The fsm-sync consumer. Most messages name an FSM appointment to read afresh
// and write over its mirror copy (docs/decisions/0032-fsm-mirror.md). FSM's
// webhooks and the reconciliation put them here; neither is trusted for the
// appointment's contents, only for which one changed. Others name a booked
// lead to send to FSM as a Request (src/domain/fsm-leads.ts), a hold paid
// for in the app to book as a visit (src/domain/bookings.ts), or an erased
// person whose FSM contact is to be anonymised (docs/decisions/0049-dpdp.md).
//
// Once an appointment is closed, its photographs are copied from FSM into the
// client-photos bucket (src/domain/visit-photos.ts).
//
// A failure is retried after 30 s, 1, 2 and 4 minutes. The fifth alerts and
// gives up; the reconciliation picks an appointment up again, ops can enter a
// lead in FSM by hand, and a booking FSM would not take is refunded.

import { z } from "zod";
import type { Dependencies } from "../dependencies.ts";
import { confirmBooking, giveBack, type ConfirmOptions } from "../domain/bookings.ts";
import { sendLeadToFsm } from "../domain/fsm-leads.ts";
import { syncAppointment } from "../domain/fsm-mirror.ts";
import { exportVisitPhotos } from "../domain/visit-photos.ts";
import { scrubString, type Logger } from "../log.ts";
import type { MessagingMessage } from "./messaging.ts";

export const MAX_FSM_SYNC_ATTEMPTS = 5;
const FIRST_RETRY_DELAY_SECONDS = 30;

export const FsmSyncMessageSchema = z.union([
  z.object({
    fsm_id: z.string().min(1),
    /** The webhook delivery that asked for it, if one did. */
    inbox_id: z.uuid().optional(),
    request_id: z.string(),
  }),
  z.object({ lead_id: z.uuid(), request_id: z.string() }),
  /** A hold paid for, or free, to book in FSM (src/domain/bookings.ts). */
  z.object({ hold_id: z.uuid(), request_id: z.string() }),
  /** An erased person, whose FSM contact is anonymised; the sweeper sends it. */
  z.object({ erase_person_id: z.string().min(1), request_id: z.string() }),
]);
export type FsmSyncMessage = z.infer<typeof FsmSyncMessageSchema>;

export type FsmSyncEnv = Pick<Env, "DB" | "CLIENT_PHOTOS" | "MESSAGE_QUEUE">;

export async function handleFsmSyncBatch(
  batch: MessageBatch,
  env: FsmSyncEnv,
  deps: Dependencies,
  log: Logger,
  { labelAsTest }: { labelAsTest: boolean } = { labelAsTest: false },
): Promise<void> {
  const db = env.DB;
  for (const message of batch.messages) {
    const parsed = FsmSyncMessageSchema.safeParse(message.body);
    if (!parsed.success) {
      log.error("fsm_sync_bad_message", { message_id: message.id });
      message.ack();
      continue;
    }
    if ("hold_id" in parsed.data) {
      const requestId = parsed.data.request_id;
      await bookHold(message, parsed.data.hold_id, db, deps, log.child({ request_id: requestId }), {
        labelAsTest,
        notify: (messageId) =>
          env.MESSAGE_QUEUE.send({ message_id: messageId, request_id: requestId } satisfies MessagingMessage),
      });
      continue;
    }
    if ("erase_person_id" in parsed.data) {
      await eraseContact(
        message,
        parsed.data.erase_person_id,
        db,
        deps,
        log.child({ request_id: parsed.data.request_id }),
      );
      continue;
    }
    if ("lead_id" in parsed.data) {
      await sendLead(message, parsed.data.lead_id, db, deps, log.child({ request_id: parsed.data.request_id }), {
        labelAsTest,
      });
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

async function bookHold(
  message: Message,
  holdId: string,
  db: D1Database,
  deps: Dependencies,
  log: Logger,
  options: ConfirmOptions,
): Promise<void> {
  try {
    const outcome = await confirmBooking(db, deps.fsm, deps.payments, holdId, deps.now(), options);
    log.info("booking", { hold_id: holdId, outcome });
    message.ack();
  } catch (error) {
    const reason = scrubString(error instanceof Error ? error.message : "unknown error").slice(0, 300);
    log.warn("booking_failed", { hold_id: holdId, attempt: message.attempts, reason });
    if (message.attempts < MAX_FSM_SYNC_ATTEMPTS) {
      message.retry({ delaySeconds: FIRST_RETRY_DELAY_SECONDS * 2 ** (message.attempts - 1) });
      return;
    }
    await giveBack(db, deps.payments, holdId, deps.now(), "FSM would not take the booking");
    await deps.alert(
      `Booking ${holdId} could not be written to FSM after ${String(message.attempts)} attempts: ${reason}. ` +
        "The client's payment has been refunded.",
    );
    message.ack();
  }
}

/** Anonymises an erased person's FSM contact, once; a failure is counted, and the sweeper sends it again. */
async function eraseContact(
  message: Message,
  personId: string,
  db: D1Database,
  deps: Dependencies,
  log: Logger,
): Promise<void> {
  const person = await db
    .prepare("SELECT fsm_contact_id FROM people WHERE id = ?1 AND erased_at IS NOT NULL AND fsm_erased_at IS NULL")
    .bind(personId)
    .first<{ fsm_contact_id: string | null }>();
  const contactId = person?.fsm_contact_id ?? null;
  if (contactId === null) {
    message.ack();
    return;
  }
  try {
    await deps.fsm.eraseContact(contactId);
    await db
      .prepare("UPDATE people SET fsm_erased_at = ?2 WHERE id = ?1")
      .bind(personId, deps.now().toISOString())
      .run();
    log.info("fsm_contact_erased", { person_id: personId });
  } catch (error) {
    const reason = scrubString(error instanceof Error ? error.message : "unknown error").slice(0, 300);
    await db
      .prepare("UPDATE people SET fsm_erasure_attempts = fsm_erasure_attempts + 1 WHERE id = ?1")
      .bind(personId)
      .run();
    log.warn("fsm_erasure_failed", { person_id: personId, reason });
  }
  message.ack();
}

async function sendLead(
  message: Message,
  leadId: string,
  db: D1Database,
  deps: Dependencies,
  log: Logger,
  options: { labelAsTest: boolean },
): Promise<void> {
  try {
    const outcome = await sendLeadToFsm(db, deps.fsm, leadId, options);
    log.info("fsm_lead", { lead_id: leadId, outcome });
    message.ack();
  } catch (error) {
    const reason = scrubString(error instanceof Error ? error.message : "unknown error").slice(0, 300);
    log.warn("fsm_lead_failed", { lead_id: leadId, attempt: message.attempts, reason });
    if (message.attempts >= MAX_FSM_SYNC_ATTEMPTS) {
      await deps.alert(
        `Lead ${leadId} did not reach FSM after ${String(message.attempts)} attempts: ${reason}. Enter it in FSM by hand.`,
      );
      message.ack();
    } else {
      message.retry({ delaySeconds: FIRST_RETRY_DELAY_SECONDS * 2 ** (message.attempts - 1) });
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
