// Messages to a client about their visits (docs/decisions/0047-visit-messages.md): a booking, the day-before
// reminder, a move and a cancel, and since docs/decisions/0074-hand-offs-and-messages.md the technician's arrival and
// ops' ruling on a visit the client was not home for, and since docs/decisions/0096-a-no-shows-charge-and-its-dispute.md
// their ruling on the client's dispute of its charge. Each is a row in outbound_messages about the appointment, written
// with the change it tells of, then queued. The messaging consumer writes the text from the visit as it stands when it sends, and
// sends it only with the client's consent to WhatsApp about visits, but for a receipt or a refund, which goes without
// it (src/policy/consents.ts). The sweeper queues any whose queue message was lost. Writing a message, whether it
// is still worth sending, and the day-before reminders are here; its text is ./visit-message-text.ts.

import { addDays, indiaDate, indiaInstant, indiaTime } from "../../lib/india-time.ts";
import { DAY_BEFORE_REMINDER_HOUR } from "../../policy/job-visibility.ts";
import type { MessageKind } from "../../config/message-kinds.ts";
import { MINUTE_MS } from "../../lib/durations.ts";
import { statusIn, VISIT_NOT_BEGUN } from "../../config/statuses.ts";
import { queueMessage } from "./queued-messages.ts";

export const VISIT_MESSAGE_KINDS = [
  "consultation_confirmation",
  "payment_receipt",
  // A one visit a discount code made free, told once the client is fitted (docs/decisions/0108-discount-codes.md).
  "nothing_to_pay",
  "visit_reminder",
  "reschedule_confirmation",
  "cancel_confirmation",
  // Ops cancelled the visit from the console: the same words as the client's own cancel.
  "visit_cancelled",
  // Ops moved the visit on the dispatch board; the client is told the new window and never charged.
  "visit_moved",
  // The technician checked in at the door: the no-show evidence reads its receipt (ADR 0047).
  "arrival_notice",
  // Ops ruled on a visit the client was not home for (docs/decisions/0074-hand-offs-and-messages.md).
  "no_show_decided",
  // Ops ruled on the client's dispute of its charge (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
  "no_show_dispute_ruled",
] as const satisfies readonly MessageKind[];

export type VisitMessageKind = (typeof VISIT_MESSAGE_KINDS)[number];

/**
 * How long after the technician arrived the client may still be told of it. A check-in that reaches us later, from
 * a phone that had no signal, is past the point: he has been at the door, or gone.
 */
const ARRIVAL_NOTICE_WITHIN_MINUTES = 10;

/** Why an arrival notice was not sent: the no-show evidence reads it back. */
const ARRIVAL_TOO_LATE = "the check-in reached us too late to tell the client";

/** The time in India reminders go from, on the day before a visit: "18:00" for the hour 18, "08:00" for 8. */
export const remindersFrom = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;
/** How many reminders a cron pass queues, well inside its 50 outside calls. */
const REMINDERS_PER_PASS = 20;

/** A message about a visit, to go in the same batch as the change it tells of; send its ID to the queue after. */
export function visitMessage(
  db: D1Database,
  input: { personId: string; appointmentId: string; kind: VisitMessageKind; now: Date },
): { id: string; statement: D1PreparedStatement } {
  const id = crypto.randomUUID();
  const at = input.now.toISOString();
  const statement = queueMessage(db, {
    id,
    personId: input.personId,
    kind: input.kind,
    subject: { kind: "appointment", id: input.appointmentId },
    at,
  });
  return { id, statement };
}

/** visitMessage, written only if the visit change `changeId` is: for the batch whose first statement claims it. */
export function visitMessageOnChange(
  db: D1Database,
  input: { personId: string; appointmentId: string; kind: VisitMessageKind; now: Date; changeId: string },
): { id: string; statement: D1PreparedStatement } {
  const id = crypto.randomUUID();
  const statement = db
    .prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at)
       SELECT ?1, ?2, ?3, ?4, 'appointment', ?5, 'queued', ?2
       WHERE EXISTS (SELECT 1 FROM visit_changes WHERE id = ?6)`,
    )
    .bind(id, input.now.toISOString(), input.personId, input.kind, input.appointmentId, input.changeId);
  return { id, statement };
}

/**
 * Writes the arrival notice for a check-in that passed, once per visit (the index outbound_messages_one_arrival).
 * A check-in heard of too late to tell the client anything is recorded as not sent, with why, so a no-show's
 * evidence says so rather than "none". Answers the ID to queue; null when there is nothing to send.
 */
export async function arrivalNotice(
  db: D1Database,
  input: { personId: string; appointmentId: string; arrivedAt: Date; now: Date },
): Promise<string | null> {
  const late = input.now.getTime() - input.arrivedAt.getTime() > ARRIVAL_NOTICE_WITHIN_MINUTES * MINUTE_MS;
  const id = crypto.randomUUID();
  const at = input.now.toISOString();
  const written = await db
    .prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at,
         last_error) VALUES (?1, ?2, ?3, 'arrival_notice', 'appointment', ?4, ?5, ?6, ?7)
       ON CONFLICT DO NOTHING`,
    )
    .bind(
      id,
      at,
      input.personId,
      input.appointmentId,
      late ? "skipped" : "queued",
      late ? null : at,
      late ? ARRIVAL_TOO_LATE : null,
    )
    .run();
  return written.meta.changes === 1 && !late ? id : null;
}

/** The kinds that tell a visit's new window: the client's own move, and one ops made on the dispatch board. */
const MOVE_KINDS: readonly VisitMessageKind[] = ["reschedule_confirmation", "visit_moved"];

/**
 * Why a message about a booked visit is no longer worth sending, as after waiting out a bridge that was down; null
 * while it still is. An arrival notice says the technician is at the door, a reminder that the visit is tomorrow, and
 * a move the visit's new window, which a later move's message tells as well.
 */
export async function isMessageStale({
  db,
  kind,
  appointmentId,
  writtenAt,
  now,
}: {
  db: D1Database;
  kind: VisitMessageKind;
  appointmentId: string;
  writtenAt: Date;
  now: Date;
}): Promise<string | null> {
  if (kind === "arrival_notice") return arrivalTooLate(writtenAt, now);
  if (kind === "visit_reminder") return reminderOutdated(db, appointmentId, writtenAt, now);
  if (MOVE_KINDS.includes(kind)) return laterMoveTold(db, appointmentId, writtenAt);
  return null;
}

function arrivalTooLate(writtenAt: Date, now: Date): string | null {
  const minutesWaited = (now.getTime() - writtenAt.getTime()) / MINUTE_MS;
  if (minutesWaited > ARRIVAL_NOTICE_WITHIN_MINUTES) return "too late to tell the client the technician had arrived";
  return null;
}

/** Why a reminder is not sent once its visit has moved to another day: the new day has a reminder of its own. */
export const REMINDER_DAY_MOVED = "the visit moved off the day this reminder was for";

/**
 * The day a reminder written at `writtenAt` is about. queueReminders writes one only for the next day's visits, so it
 * is the day after the one it was written on.
 */
function reminderDay(writtenAt: Date): string {
  return addDays(indiaDate(writtenAt), 1);
}

async function reminderOutdated(
  db: D1Database,
  appointmentId: string,
  writtenAt: Date,
  now: Date,
): Promise<string | null> {
  const visit = await db
    .prepare("SELECT window_start FROM appointments WHERE id = ?1")
    .bind(appointmentId)
    .first<{ window_start: string | null }>();
  const windowStart = visit?.window_start ?? null;
  if (windowStart === null) return null;
  const dayItIsFor = reminderDay(writtenAt);
  if (indiaDate(new Date(windowStart)) !== dayItIsFor) return REMINDER_DAY_MOVED;
  const tomorrow = addDays(indiaDate(now), 1);
  if (dayItIsFor !== tomorrow) return "too late for a day-before reminder";
  return null;
}

/**
 * Why a move's message is not sent: a later move's message, queued or sent, tells the same window, since each says
 * the visit as it stands when it goes.
 */
async function laterMoveTold(db: D1Database, appointmentId: string, writtenAt: Date): Promise<string | null> {
  const later = await db
    .prepare(
      `SELECT 1 FROM outbound_messages
       WHERE subject_kind = 'appointment' AND subject_id = ?1 AND kind IN ('reschedule_confirmation', 'visit_moved')
         AND state IN ('queued', 'sent') AND created_at > ?2`,
    )
    .bind(appointmentId, writtenAt.toISOString())
    .first();
  return later === null ? null : "a later move's message tells the new window";
}

/**
 * Queues the reminders for tomorrow's visits, from the reminder hour in India the day before, 6 pm unless ops set
 * another: each booked visit once for the day it is on, so a visit reminded and then moved to another day is reminded
 * again the evening before its new day. Returns the messages' IDs, for the queue.
 */
export async function queueReminders(
  db: D1Database,
  now: Date,
  hour: number = DAY_BEFORE_REMINDER_HOUR,
): Promise<string[]> {
  if (indiaTime(now) < remindersFrom(hour)) return [];
  const today = indiaDate(now);
  const tomorrow = addDays(today, 1);
  // A reminder written today is about tomorrow (reminderDay); one from an earlier day was about an earlier day.
  const writtenToday = indiaInstant(today, "00:00");
  const { results } = await db
    .prepare(
      `SELECT a.id, a.person_id FROM appointments a
       WHERE a.window_start >= ?1 AND a.window_start < ?2 AND ${statusIn("a.status", VISIT_NOT_BEGUN)}
         AND a.deleted_at IS NULL AND a.person_id IS NOT NULL AND a.type IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM outbound_messages m
           WHERE m.subject_id = a.id AND m.kind = 'visit_reminder' AND m.created_at >= ?3)
       ORDER BY a.window_start LIMIT ?4`,
    )
    .bind(
      indiaInstant(tomorrow, "00:00").toISOString(),
      indiaInstant(addDays(tomorrow, 1), "00:00").toISOString(),
      writtenToday.toISOString(),
      REMINDERS_PER_PASS,
    )
    .all<{ id: string; person_id: string }>();
  const messages = results.map((visit) =>
    visitMessage(db, { personId: visit.person_id, appointmentId: visit.id, kind: "visit_reminder", now }),
  );
  if (messages.length > 0) await db.batch(messages.map((message) => message.statement));
  return messages.map((message) => message.id);
}
