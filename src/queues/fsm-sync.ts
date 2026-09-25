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
import type { VisitType } from "../config/visit-types.ts";
import type { Dependencies } from "../dependencies.ts";
import { confirmBooking, giveBack, type ConfirmOptions } from "../domain/bookings.ts";
import { sendLeadToFsm } from "../domain/fsm-leads.ts";
import { syncAppointment } from "../domain/fsm-mirror.ts";
import { eventById, markFsmWrite, nextPending, rejectPendingAfter, unwrittenBefore } from "../domain/job-events.ts";
import { writeEventToFsm, type JobForFsm } from "../domain/job-sheet.ts";
import { readOpsInputs } from "../domain/ops-settings.ts";
import { exportVisitPhotos } from "../domain/visit-photos.ts";
import { scrubString, type Logger } from "../log.ts";
import { MAX_SYNC_ATTEMPTS } from "./crm-sync.ts";
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
  /** One write from a technician's outbox, to pass to FSM (docs/decisions/0038-offline-writes.md). */
  z.object({ job_event_id: z.uuid(), request_id: z.string() }),
]);
export type FsmSyncMessage = z.infer<typeof FsmSyncMessageSchema>;

export type FsmSyncEnv = Pick<Env, "DB" | "CLIENT_PHOTOS" | "MESSAGE_QUEUE" | "FSM_QUEUE">;

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
    if ("job_event_id" in parsed.data) {
      await writeJobEvent(
        message,
        parsed.data.job_event_id,
        env,
        deps,
        log.child({ request_id: parsed.data.request_id }),
        { labelAsTest, requestId: parsed.data.request_id },
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

/**
 * Passes one write from a technician's outbox to FSM. A failure is retried on
 * the same schedule as everything else here, so the technician's work is never
 * lost to a refusal FSM will take a minute later; the fifth attempt alerts, and
 * the event is marked rejected for ops to enter by hand.
 *
 * A job's writes reach FSM in the order they landed, as ADR 0053 has it. Each
 * is its own message and a failed one is retried minutes later, so a write
 * whose job has an earlier one still pending waits for it, and every write that
 * lands sends the job's next one on. One given up on takes the writes behind it
 * with it: FSM never records a job closed without the steps before the close.
 */
async function writeJobEvent(
  message: Message,
  jobEventId: string,
  env: FsmSyncEnv,
  deps: Dependencies,
  log: Logger,
  options: { labelAsTest: boolean; requestId: string },
): Promise<void> {
  const db = env.DB;
  const event = await eventById(db, jobEventId);
  if (event === null || event.superseded || event.fsmWriteState !== "pending") {
    message.ack();
    return;
  }
  const job = await jobForFsm(db, event.appointmentId);
  if (job === null) {
    const reason = "the job is no longer in the mirror";
    await markFsmWrite(db, event.id, "rejected", deps.now(), reason);
    await rejectPendingAfter(db, event, deps.now(), reason);
    message.ack();
    return;
  }

  const before = await unwrittenBefore(db, event);
  if (before?.fsmWriteState === "pending") {
    // Sent on again when the one before it lands.
    log.info("job_event_waiting", { appointment_id: job.id, kind: event.kind, waits_for: before.kind });
    message.ack();
    return;
  }
  if (before?.fsmWriteState === "rejected") {
    await markFsmWrite(db, event.id, "rejected", deps.now(), `the ${before.kind} before it did not reach FSM`);
    await deps.alert(
      `A technician's ${event.kind} was not sent to FSM, because the ${before.kind} before it did not reach FSM. ` +
        "Enter both in FSM by hand.",
    );
    message.ack();
    return;
  }

  try {
    const outcome = await writeEventToFsm(
      {
        db,
        bucket: env.CLIENT_PHOTOS,
        fsm: deps.fsm,
        labelAsTest: options.labelAsTest,
        cycles: (await readOpsInputs(db, deps.now())).pieceCycleDays,
      },
      job,
      event,
      deps.now(),
    );
    await markFsmWrite(db, event.id, "written", deps.now());
    log.info("job_event_written", { appointment_id: job.id, kind: event.kind, outcome });
    message.ack();
  } catch (error) {
    const reason = scrubString(error instanceof Error ? error.message : "unknown error").slice(0, 300);
    log.warn("job_event_write_failed", { appointment_id: job.id, kind: event.kind, attempt: message.attempts, reason });
    if (message.attempts < MAX_FSM_SYNC_ATTEMPTS) {
      message.retry({ delaySeconds: FIRST_RETRY_DELAY_SECONDS * 2 ** (message.attempts - 1) });
      return;
    }
    await markFsmWrite(db, event.id, "rejected", deps.now(), reason);
    const behind = await rejectPendingAfter(db, event, deps.now(), `the ${event.kind} before it did not reach FSM`);
    await deps.alert(
      `A technician's ${event.kind} did not reach FSM after ${String(message.attempts)} attempts: ${reason}. ` +
        (behind.length === 0
          ? "Enter it in FSM by hand."
          : `Enter it in FSM by hand, with what came after it and was held back: ${behind.join(", ")}.`),
    );
    message.ack();
    return;
  }

  const next = await nextPending(db, event);
  if (next !== null) {
    await env.FSM_QUEUE.send({ job_event_id: next.id, request_id: options.requestId } satisfies FsmSyncMessage);
  }
}

/** The appointment a job event belongs to, with what FSM needs to write against it. */
async function jobForFsm(db: D1Database, appointmentId: string): Promise<JobForFsm | null> {
  const row = await db
    .prepare(
      `SELECT a.id, a.fsm_id, a.type, a.person_id, p.fsm_contact_id FROM appointments a
       LEFT JOIN people p ON p.id = a.person_id
       WHERE a.id = ?1 AND a.deleted_at IS NULL AND a.type IS NOT NULL`,
    )
    .bind(appointmentId)
    .first<{
      id: string;
      fsm_id: string;
      type: VisitType;
      person_id: string | null;
      fsm_contact_id: string | null;
    }>();
  return row === null
    ? null
    : {
        id: row.id,
        fsmId: row.fsm_id,
        type: row.type,
        personId: row.person_id,
        fsmContactId: row.fsm_contact_id,
      };
}

/**
 * Anonymises an erased person's FSM contact, once. A failure is counted, and the
 * sweeper sends it again until MAX_SYNC_ATTEMPTS; the last failure tells ops,
 * and the Tasks board lists the contact until it is anonymised by hand.
 */
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
    const counted = await db
      .prepare(
        "UPDATE people SET fsm_erasure_attempts = fsm_erasure_attempts + 1 WHERE id = ?1 RETURNING fsm_erasure_attempts",
      )
      .bind(personId)
      .first<{ fsm_erasure_attempts: number }>();
    const attempts = counted?.fsm_erasure_attempts ?? 1;
    log.warn("fsm_erasure_failed", { person_id: personId, attempts, reason });
    if (attempts >= MAX_SYNC_ATTEMPTS) {
      await deps.alertOnce({
        key: `fsm_erasure:${personId}`,
        message:
          `FSM would not anonymise contact ${contactId} of erased person ${personId} after ${String(attempts)} ` +
          `attempts (${reason}), and nothing will ask again. Anonymise it in FSM by hand, then record it ` +
          '(runbook, "Erasure within the day").',
        link: "/tasks",
      });
    }
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
