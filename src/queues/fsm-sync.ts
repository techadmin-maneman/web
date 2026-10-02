// The fsm-sync consumer. Most messages name an FSM appointment to read afresh
// and write over its mirror copy (docs/decisions/0032-fsm-mirror.md). FSM's
// webhooks and the reconciliation put them here; neither is trusted for the
// appointment's contents, only for which one changed. Others name a hold paid
// for in the app to book as a visit (src/domain/bookings.ts), an erased
// person whose FSM contact is to be anonymised (docs/decisions/0049-dpdp.md),
// a client whose new number or address their contact is to take
// (docs/decisions/0070-vendor-correctness.md), or a client's note on their visit
// for its appointment (docs/decisions/0099-the-clients-note-in-fsm.md). One asks for FSM's catalogue to
// take the price book's prices, while the owner has that push switched on
// (docs/decisions/0073-prices-from-the-price-book.md).
//
// Once an appointment is closed, its photographs are copied from FSM into the
// client-photos bucket (src/domain/visit-photos.ts).
//
// A failure is retried after 30 s, 1, 2 and 4 minutes. The fifth alerts and
// gives up; the reconciliation picks an appointment up again, and ops can enter
// a lead in FSM by hand. A booking FSM would not take is not given up: it is
// held, with its slot and its payment, tried again every hour for a day, and
// waits for ops to book it or refund it (docs/decisions/0095-a-booking-fsm-refuses-is-held.md).

import { z } from "zod";
import type { FieldRecord } from "../config/field-record.ts";
import type { VisitType } from "../config/visit-types.ts";
import type { Dependencies } from "../dependencies.ts";
import { confirmBooking, unbookedAlertKey, type ConfirmOptions } from "../domain/bookings.ts";
import { CLIENT_NOTE_MAX_CHARS, clientNoteAlertKey } from "../domain/client-notes.ts";
import { pushCatalogue } from "../domain/fsm-catalogue.ts";
import { logDeactivated, syncAppointment } from "../domain/fsm-mirror.ts";
import { heldAlert, heldAlertKey, holdForFsm, isHeldForFsm, toLinkAlertKey } from "../domain/held-bookings.ts";
import { streetOf } from "../domain/profile.ts";
import { eventById, markFsmWrite, nextPending, rejectPendingAfter, unwrittenBefore } from "../domain/job-events.ts";
import { writeEventToFsm, type JobForFsm } from "../domain/job-sheet.ts";
import { readOpsInputs } from "../domain/ops-settings.ts";
import { exportVisitPhotos } from "../domain/visit-photos.ts";
import { fsmText } from "../lib/fsm-text.ts";
import { indiaDate } from "../lib/india-time.ts";
import { failureReason, type Logger } from "../log.ts";
import { REFUSALS_BEFORE_HELD } from "../policy/held-bookings.ts";
import type { FsmContactUpdate, FsmProvider } from "../providers/fsm.ts";
import { MAX_SYNC_ATTEMPTS } from "./crm-sync.ts";
import type { MessagingMessage } from "./messaging.ts";
import { retryWithBackoff } from "./backoff.ts";

export const MAX_FSM_SYNC_ATTEMPTS = 5;
const FIRST_RETRY_DELAY_SECONDS = 30;

export const FsmSyncMessageSchema = z.union([
  z.object({
    fsm_id: z.string().min(1),
    /** The webhook delivery that asked for it, if one did. */
    inbox_id: z.uuid().optional(),
    request_id: z.string(),
  }),
  /** A hold paid for, or free, to book in FSM (src/domain/bookings.ts). */
  z.object({ hold_id: z.uuid(), request_id: z.string() }),
  /** An erased person, whose FSM contact is anonymised; the sweeper sends it. */
  z.object({ erase_person_id: z.string().min(1), request_id: z.string() }),
  /** One write from a technician's outbox, to pass to FSM (docs/decisions/0038-offline-writes.md). */
  z.object({ job_event_id: z.uuid(), request_id: z.string() }),
  /** A client whose number or address changed, written over their FSM contact (src/http/contact-sync.ts). */
  z.object({ update_contact_person_id: z.string().min(1), request_id: z.string() }),
  /** FSM's catalogue to take the price book's prices (src/domain/fsm-catalogue.ts). */
  z.object({ catalogue_sync: z.literal(true), request_id: z.string() }),
  /** A client's note on their visit, written to its appointment (src/routes/client-notes.ts). */
  z.object({ note_appointment_id: z.uuid(), request_id: z.string() }),
]);
export type FsmSyncMessage = z.infer<typeof FsmSyncMessageSchema>;

export type FsmSyncEnv = Pick<Env, "DB" | "CLIENT_PHOTOS" | "MESSAGE_QUEUE" | "FSM_QUEUE">;

export interface FsmSyncOptions {
  readonly labelAsTest: boolean;
  /** FSM_CATALOGUE_PUSH, read as each message is taken: a push queued before it was switched off writes nothing. */
  readonly cataloguePush: boolean;
  /** Who holds the record of field work, FSM unless said: a hold queued for FSM is booked in our own database once FSM is off. */
  readonly record?: FieldRecord;
}

export async function handleFsmSyncBatch(
  batch: MessageBatch,
  env: FsmSyncEnv,
  deps: Dependencies,
  log: Logger,
  { labelAsTest, cataloguePush, record = "fsm" }: FsmSyncOptions = { labelAsTest: false, cataloguePush: false },
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
      const bookingLog = log.child({ request_id: requestId });
      await bookHold(message, parsed.data.hold_id, db, deps, bookingLog, {
        labelAsTest,
        record,
        notify: (messageId) =>
          env.MESSAGE_QUEUE.send({ message_id: messageId, request_id: requestId } satisfies MessagingMessage),
        alertOnce: deps.alertOnce,
        log: bookingLog,
        automatic: true,
      });
      continue;
    }
    if ("catalogue_sync" in parsed.data) {
      await syncCatalogue(message, db, deps, log.child({ request_id: parsed.data.request_id }), cataloguePush);
      continue;
    }
    if ("update_contact_person_id" in parsed.data) {
      await updateContact(
        message,
        parsed.data.update_contact_person_id,
        db,
        deps,
        log.child({ request_id: parsed.data.request_id }),
      );
      continue;
    }
    if ("note_appointment_id" in parsed.data) {
      await writeClientNote(
        message,
        parsed.data.note_appointment_id,
        db,
        deps,
        log.child({ request_id: parsed.data.request_id }),
      );
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
    const { fsm_id: fsmId, inbox_id: inboxId, request_id: requestId } = parsed.data;
    const messageLog = log.child({ request_id: requestId, fsm_id: fsmId });

    try {
      const result = await syncAppointment(db, deps.fsm, fsmId, deps.now());
      logDeactivated(messageLog, result.techniciansDeactivated);
      const photos =
        result.appointmentId !== null && (result.status === "completed" || result.status === "terminated")
          ? await exportVisitPhotos(db, env.CLIENT_PHOTOS, deps.fsm, { id: result.appointmentId, fsmId }, deps.now())
          : null;
      if (inboxId !== undefined) await recordAttempt(db, inboxId, deps.now().toISOString(), null);
      await deps.resolveAlert(`fsm_sync:${fsmId}`);
      messageLog.info("fsm_synced", {
        outcome: result.outcome,
        appointment_id: result.appointmentId,
        photos_exported: photos?.exported,
        photos_unreadable: photos?.unreadable,
      });
      message.ack();
    } catch (error) {
      const reason = failureReason(error);
      if (inboxId !== undefined) await recordAttempt(db, inboxId, null, reason);
      messageLog.warn("fsm_sync_failed", { attempt: message.attempts, reason });
      if (message.attempts >= MAX_FSM_SYNC_ATTEMPTS) {
        // The reconciliation queues it again each night, so a failure that lasts is counted, not told nightly.
        await deps.alertOnce({
          key: `fsm_sync:${fsmId}`,
          message:
            `FSM sync gave up on appointment ${fsmId} after ${String(message.attempts)} attempts: ${reason}. ` +
            "The reconciliation will try it again.",
        });
        message.ack();
      } else {
        retryWithBackoff(message, FIRST_RETRY_DELAY_SECONDS);
      }
    }
  }
}

/**
 * Books a paid (or free) hold. A failure is retried on the usual schedule, and the fifth holds the booking for ops:
 * nothing is cancelled or refunded, and ops are told once (src/domain/held-bookings.ts). A held booking is tried
 * again by the cron, once an hour, so a failure of one of those tries waits for the next rather than being retried
 * here, and one that finds a visit ops may have booked for it in FSM by hand writes nothing and waits for ops to link
 * it. A try the cron put on the queue before ops stopped the tries, to book it by hand, writes nothing. Nothing here
 * throws out of the batch.
 */
async function bookHold(
  message: Message,
  holdId: string,
  db: D1Database,
  deps: Dependencies,
  log: Logger,
  options: ConfirmOptions,
): Promise<void> {
  const retryLater = () => {
    retryWithBackoff(message, FIRST_RETRY_DELAY_SECONDS);
  };
  try {
    const outcome = await confirmBooking(db, deps.fsm, deps.payments, holdId, deps.now(), options);
    log.info("booking", { hold_id: holdId, outcome });
    // Another consumer is writing it: this one looks again later, which never counts toward holding it.
    if (outcome === "being_booked" && message.attempts < MAX_FSM_SYNC_ATTEMPTS) {
      retryLater();
      return;
    }
    // It waits for ops, who stopped its tries or are to link the visit they booked in FSM by hand: what they were
    // told of it stands.
    if (outcome === "to_link" || outcome === "stopped") {
      message.ack();
      return;
    }
    // Booked, or given back: whatever ops were told of this hold before is over.
    await deps.resolveAlert(unbookedAlertKey(holdId));
    await deps.resolveAlert(heldAlertKey(holdId));
    await deps.resolveAlert(toLinkAlertKey(holdId));
    message.ack();
  } catch (error) {
    const reason = failureReason(error);
    log.warn("booking_failed", { hold_id: holdId, attempt: message.attempts, reason });
    if (message.attempts < REFUSALS_BEFORE_HELD && !(await isHeldForFsm(db, holdId))) {
      retryLater();
      return;
    }
    const refused = await holdForFsm(db, holdId, deps.now(), reason);
    if (refused?.newlyHeld === true) {
      log.warn("booking_held", { hold_id: holdId });
      const retry = (await readOpsInputs(db, deps.now())).fsmRetry;
      await deps.alertOnce({
        key: heldAlertKey(holdId),
        message: heldAlert(holdId, message.attempts, reason, retry),
        link: `/clients/${refused.personId}/visits`,
      });
    }
    message.ack();
  }
}

/**
 * Writes the price book's prices over the FSM catalogue items that differ, while the push is on. It is tried once:
 * the hourly catalogue check is its retry, and tells ops if FSM still differs an hour on, to look here. A service whose
 * item lies past the pages the push reads is logged with it, since the push will never reach it.
 */
async function syncCatalogue(
  message: Message,
  db: D1Database,
  deps: Dependencies,
  log: Logger,
  pushOn: boolean,
): Promise<void> {
  if (!pushOn) {
    log.info("fsm_catalogue_push_off");
    message.ack();
    return;
  }
  try {
    const pushed = await pushCatalogue(db, deps.fsm, indiaDate(deps.now()));
    log.info("fsm_catalogue_pushed", { written: pushed.written });
    if (pushed.unreached.length > 0) {
      log.warn("fsm_catalogue_push_failed", { reason: "catalogue_unread", services: pushed.unreached });
    }
  } catch (error) {
    const reason = failureReason(error);
    log.warn("fsm_catalogue_push_failed", { reason });
  }
  message.ack();
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
    await deps.resolveAlert(`job_event_pending:${event.id}`);
    log.info("job_event_written", { appointment_id: job.id, kind: event.kind, outcome });
    message.ack();
  } catch (error) {
    const reason = failureReason(error);
    log.warn("job_event_write_failed", { appointment_id: job.id, kind: event.kind, attempt: message.attempts, reason });
    if (message.attempts < MAX_FSM_SYNC_ATTEMPTS) {
      retryWithBackoff(message, FIRST_RETRY_DELAY_SECONDS);
      return;
    }
    await markFsmWrite(db, event.id, "rejected", deps.now(), reason);
    const behind = await rejectPendingAfter(db, event, deps.now(), `the ${event.kind} before it did not reach FSM`);
    await deps.resolveAlert(`job_event_pending:${event.id}`);
    await deps.alert(
      `A technician's ${event.kind} did not reach FSM after ${String(message.attempts)} attempts ` +
        `on visit ${job.id}: ${reason}. ` +
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
      `SELECT a.id, a.fsm_id, a.type, a.one_visit, a.person_id, p.fsm_contact_id FROM appointments a
       LEFT JOIN people p ON p.id = a.person_id
       WHERE a.id = ?1 AND a.deleted_at IS NULL AND a.type IS NOT NULL`,
    )
    .bind(appointmentId)
    .first<{
      id: string;
      fsm_id: string;
      type: VisitType;
      one_visit: string | null;
      person_id: string | null;
      fsm_contact_id: string | null;
    }>();
  return row === null
    ? null
    : {
        id: row.id,
        fsmId: row.fsm_id,
        type: row.type,
        oneVisit: row.one_visit !== null,
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
    await blankClientNotes(db, deps.fsm, personId);
    await deps.fsm.eraseContact(contactId);
    await db
      .prepare("UPDATE people SET fsm_erased_at = ?2 WHERE id = ?1")
      .bind(personId, deps.now().toISOString())
      .run();
    log.info("fsm_contact_erased", { person_id: personId });
  } catch (error) {
    const reason = failureReason(error);
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

/** Blanks an erased client's notes on their appointments in FSM, which FSM's API cannot delete. */
async function blankClientNotes(db: D1Database, fsm: FsmProvider, personId: string): Promise<void> {
  const noted = await db
    .prepare("SELECT id, fsm_id FROM appointments WHERE person_id = ?1 AND fsm_note_written_at IS NOT NULL")
    .bind(personId)
    .all<{ id: string; fsm_id: string }>();
  for (const visit of noted.results) {
    await fsm.writeClientNote(visit.fsm_id, "");
    await db.prepare("UPDATE appointments SET fsm_note_written_at = NULL WHERE id = ?1").bind(visit.id).run();
  }
}

/**
 * Writes a client's note on their visit over the one on its FSM appointment, read afresh from D1, so a note sent
 * late never stands over a later one. Nothing is written for an erased client. The fifth failure tells ops; the
 * technician reads the note in their app whether or not FSM has it.
 */
async function writeClientNote(
  message: Message,
  visitId: string,
  db: D1Database,
  deps: Dependencies,
  log: Logger,
): Promise<void> {
  const visit = await db
    .prepare(
      `SELECT a.fsm_id, a.person_id, a.client_note FROM appointments a JOIN people p ON p.id = a.person_id
       WHERE a.id = ?1 AND a.deleted_at IS NULL AND a.client_note IS NOT NULL AND p.erased_at IS NULL`,
    )
    .bind(visitId)
    .first<{ fsm_id: string; person_id: string; client_note: string }>();
  if (visit === null) {
    message.ack();
    return;
  }
  try {
    await deps.fsm.writeClientNote(visit.fsm_id, fsmText(visit.client_note, CLIENT_NOTE_MAX_CHARS));
    await db
      .prepare("UPDATE appointments SET fsm_note_written_at = ?2 WHERE id = ?1")
      .bind(visitId, deps.now().toISOString())
      .run();
    await deps.resolveAlert(clientNoteAlertKey(visitId));
    log.info("fsm_client_note_written", { appointment_id: visitId });
    message.ack();
  } catch (error) {
    const reason = failureReason(error);
    log.warn("fsm_client_note_failed", { appointment_id: visitId, attempt: message.attempts, reason });
    if (message.attempts < MAX_FSM_SYNC_ATTEMPTS) {
      retryWithBackoff(message, FIRST_RETRY_DELAY_SECONDS);
      return;
    }
    await deps.alertOnce({
      key: clientNoteAlertKey(visitId),
      message:
        `The client's note on visit ${visitId} did not reach FSM appointment ${visit.fsm_id} after ` +
        `${String(message.attempts)} attempts: ${reason}. The technician reads it in their app; add it to the ` +
        "appointment in FSM by hand.",
      link: `/clients/${visit.person_id}`,
    });
    message.ack();
  }
}

/**
 * Writes a client's number and current address over their FSM contact, read
 * afresh from D1, so FSM's screens and Books show them rather than the old
 * number and "To be confirmed with the client". Nothing is written for an
 * erased client or one FSM has no contact for yet: the booking that adds the
 * contact reads the same row. The fifth failure tells ops.
 */
async function updateContact(
  message: Message,
  personId: string,
  db: D1Database,
  deps: Dependencies,
  log: Logger,
): Promise<void> {
  const person = await db
    .prepare(
      `SELECT p.fsm_contact_id, p.mobile_e164, a.flat, a.floor, a.tower, a.line1, a.line2, a.landmark, a.locality,
              a.city, a.pincode
       FROM people p
       LEFT JOIN addresses a ON a.id = (SELECT id FROM addresses WHERE person_id = p.id AND replaced_at IS NULL
                                        ORDER BY created_at DESC LIMIT 1)
       WHERE p.id = ?1 AND p.erased_at IS NULL AND p.fsm_contact_id IS NOT NULL`,
    )
    .bind(personId)
    .first<ContactRow>();
  if (person === null) {
    message.ack();
    return;
  }
  try {
    await deps.fsm.updateContact(person.fsm_contact_id, { mobile: person.mobile_e164, address: addressOf(person) });
    await deps.resolveAlert(`fsm_contact_update:${personId}`);
    log.info("fsm_contact_updated", { person_id: personId });
    message.ack();
  } catch (error) {
    const reason = failureReason(error);
    log.warn("fsm_contact_update_failed", { person_id: personId, attempt: message.attempts, reason });
    if (message.attempts < MAX_FSM_SYNC_ATTEMPTS) {
      retryWithBackoff(message, FIRST_RETRY_DELAY_SECONDS);
      return;
    }
    await deps.alertOnce({
      key: `fsm_contact_update:${personId}`,
      message:
        `Client ${personId}'s new number or address did not reach FSM contact ${person.fsm_contact_id} after ` +
        `${String(message.attempts)} attempts: ${reason}. Update the contact in FSM by hand.`,
      link: `/clients/${personId}`,
    });
    message.ack();
  }
}

interface ContactRow {
  fsm_contact_id: string;
  mobile_e164: string;
  flat: string | null;
  floor: string | null;
  tower: string | null;
  line1: string | null;
  line2: string | null;
  landmark: string | null;
  locality: string | null;
  city: string | null;
  pincode: string | null;
}

/** The client's address as FSM's service address takes it; null while they have given none. */
function addressOf(row: ContactRow): FsmContactUpdate["address"] {
  const { line1, city, pincode } = row;
  if (line1 === null || city === null || pincode === null) return null;
  return {
    ...streetOf({ ...row, line1 }),
    city,
    pincode,
  };
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
