// Messages to a client about their visits (docs/decisions/0047-visit-messages.md): a booking, the day-before
// reminder, a move and a cancel, and since docs/decisions/0074-hand-offs-and-messages.md the technician's arrival and
// ops' ruling on a visit the client was not home for. Each is a row in outbound_messages about the appointment, written with the change
// it tells of, then queued. The messaging consumer writes the text from the visit as it stands when it sends, and
// sends it only with the client's consent to WhatsApp about visits. The sweeper queues any whose queue message was
// lost.

import { shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { WINDOW_TIMES } from "../config/scheduling.ts";
import { FSM_SERVICE_NAMES, type VisitType } from "../config/visit-types.ts";
import { addDays, indiaDate, indiaInstant, indiaTime } from "../lib/india-time.ts";
import { DAY_BEFORE_REMINDER_HOUR } from "../policy/job-visibility.ts";
import { WAIVER_GIVES_BACK, type NoShowDecision } from "../policy/no-show.ts";
import type { AppointmentStatus } from "./fsm-mirror.ts";
import type { MessageKind } from "./messages.ts";
import { windowAt } from "../policy/windows.ts";
import { MINUTE_MS, minutesBetween } from "../lib/durations.ts";
import { firstNameOf } from "../lib/names.ts";

export type VisitMessageKind = Extract<
  MessageKind,
  | "consultation_confirmation"
  | "payment_receipt"
  | "visit_reminder"
  | "reschedule_confirmation"
  | "cancel_confirmation"
  | "visit_moved"
  | "arrival_notice"
  | "no_show_decided"
>;

export const VISIT_MESSAGE_KINDS: readonly VisitMessageKind[] = [
  "consultation_confirmation",
  "payment_receipt",
  "visit_reminder",
  "reschedule_confirmation",
  "cancel_confirmation",
  // Ops moved the visit on the dispatch board; the client is told the new window and never charged.
  "visit_moved",
  // The technician checked in at the door: the no-show evidence reads its receipt (ADR 0047).
  "arrival_notice",
  // Ops ruled on a visit the client was not home for (docs/decisions/0074-hand-offs-and-messages.md).
  "no_show_decided",
];

/**
 * The statuses in which each kind is still true of the visit. Most are about a visit still booked; a cancel and a
 * no-show are about one that no longer is, and the technician's arrival may already have started the visit in FSM.
 */
const STILL_TRUE_WHILE: Readonly<Record<VisitMessageKind, readonly AppointmentStatus[] | "any">> = {
  consultation_confirmation: ["scheduled", "dispatched"],
  payment_receipt: ["scheduled", "dispatched"],
  visit_reminder: ["scheduled", "dispatched"],
  reschedule_confirmation: ["scheduled", "dispatched"],
  visit_moved: ["scheduled", "dispatched"],
  cancel_confirmation: "any",
  arrival_notice: ["scheduled", "dispatched", "in_progress"],
  no_show_decided: "any",
};

/**
 * What the ruling on a no-show says, by the ruling and by what the client paid ahead. A charge keeps it, as a
 * cancel inside 24 hours does; what a waiver gives back is the owner's to rule (WAIVER_GIVES_BACK), so until then
 * the client is asked to message us about it rather than promised anything.
 */
const NO_SHOW_TEMPLATES = {
  charged: { payment: "no_show_charged_paid_v1", credit: "no_show_charged_credit_v1", nothing: "no_show_missed_v1" },
  waived: WAIVER_GIVES_BACK
    ? { payment: "no_show_waived_refund_v1", credit: "no_show_waived_credit_back_v1", nothing: "no_show_waived_v1" }
    : { payment: "no_show_waived_paid_v1", credit: "no_show_waived_credit_v1", nothing: "no_show_waived_v1" },
} as const;

const stillTrue = (kind: VisitMessageKind, status: AppointmentStatus): boolean => {
  const statuses = STILL_TRUE_WHILE[kind];
  return statuses === "any" || statuses.includes(status);
};

/**
 * How long after the technician arrived the client may still be told of it. A check-in that reaches us later, from
 * a phone that had no signal, is past the point: he has been at the door, or gone.
 */
export const ARRIVAL_NOTICE_WITHIN_MINUTES = 10;

/** Why an arrival notice was not sent: the no-show evidence reads it back. */
export const ARRIVAL_TOO_LATE = "the check-in reached us too late to tell the client";

/** The day before a visit, reminders go from this time in India. */
export const REMINDERS_FROM = `${String(DAY_BEFORE_REMINDER_HOUR)}:00`;
/** How many reminders a cron pass queues, well inside its 50 outside calls. */
const REMINDERS_PER_PASS = 20;

/** A message about a visit, to go in the same batch as the change it tells of; send its ID to the queue after. */
export function visitMessage(
  db: D1Database,
  input: { personId: string; appointmentId: string; kind: VisitMessageKind; now: Date },
): { id: string; statement: D1PreparedStatement } {
  const id = crypto.randomUUID();
  const at = input.now.toISOString();
  const statement = db
    .prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at)
       VALUES (?1, ?2, ?3, ?4, 'appointment', ?5, 'queued', ?2)`,
    )
    .bind(id, at, input.personId, input.kind, input.appointmentId);
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
         last_error)
       VALUES (?1, ?2, ?3, 'arrival_notice', 'appointment', ?4, ?5, ?6, ?7)
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

/** "12 to 4 pm", as the app writes a window. */
function windowHours(start: Date): string {
  const { start: from, end: to } = WINDOW_TIMES[windowAt(indiaTime(start))];
  const hour = (time: string) => {
    const hours = Number(time.slice(0, 2));
    return { number: String(hours % 12 === 0 ? 12 : hours % 12), half: hours < 12 ? "am" : "pm" };
  };
  const [first, last] = [hour(from), hour(to)];
  return first.half === last.half
    ? `${first.number} to ${last.number} ${last.half}`
    : `${first.number} ${first.half} to ${last.number} ${last.half}`;
}

const DESTINATIONS: Readonly<Record<string, string>> = { upi: "UPI", card: "card", netbanking: "bank account" };

export type Composed = { readonly template: string; readonly params: string[] } | { readonly skip: string };

/** Why a message about a visit was skipped when the client never agreed to them; the no-show queue reads it back. */
export const NO_VISITS_CONSENT = "no consent to WhatsApp about visits";

/** What a queued message about a visit says, as the visit stands now; or why it is not sent. */
export async function composeVisitMessage(
  db: D1Database,
  kind: VisitMessageKind,
  appointmentId: string,
  personId: string,
): Promise<Composed> {
  const consent = await db
    .prepare(
      `SELECT granted FROM consents WHERE person_id = ?1 AND purpose = 'whatsapp_visits'
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .bind(personId)
    .first<{ granted: number }>();
  if (consent?.granted !== 1) return { skip: NO_VISITS_CONSENT };

  const visit = await db
    .prepare(
      `SELECT a.type, a.window_start, a.status, p.name, t.name AS technician
       FROM appointments a JOIN people p ON p.id = a.person_id LEFT JOIN technicians t ON t.id = a.technician_id
       WHERE a.id = ?1 AND a.person_id = ?2 AND a.deleted_at IS NULL`,
    )
    .bind(appointmentId, personId)
    .first<{
      type: VisitType | null;
      window_start: string | null;
      status: AppointmentStatus;
      name: string;
      technician: string | null;
    }>();
  if (visit === null) return { skip: "no such visit" };
  if (visit.type === null || visit.window_start === null) return { skip: "the visit has no type or time" };
  if (!stillTrue(kind, visit.status)) return { skip: "the visit is no longer booked" };

  const start = new Date(visit.window_start);
  const params = [
    firstNameOf(visit.name),
    FSM_SERVICE_NAMES[visit.type].toLowerCase(),
    shortDate(indiaDate(start)),
    windowHours(start),
    visit.technician === null ? "our technician" : firstNameOf(visit.technician),
    "",
    "",
    "",
  ];

  if (kind === "consultation_confirmation") return { template: "consultation_booked_v1", params };
  if (kind === "visit_reminder") return { template: "visit_reminder_v1", params };
  if (kind === "arrival_notice") return { template: "technician_arrived_v1", params };
  if (kind === "no_show_decided") return noShowRuling(db, appointmentId, params);
  // A move, whether the client made it or ops did: the same words, the visit's new window.
  if (kind === "reschedule_confirmation" || kind === "visit_moved") return { template: "visit_moved_v1", params };
  if (kind === "payment_receipt") {
    const payment = await db
      .prepare(
        `SELECT amount, reference FROM payments WHERE appointment_id = ?1 AND kind = 'visit' AND status = 'captured'
         ORDER BY captured_at LIMIT 1`,
      )
      .bind(appointmentId)
      .first<{ amount: number; reference: string | null }>();
    if (payment === null) {
      const credit = await db
        .prepare("SELECT 1 FROM credit_ledger WHERE kind = 'redeem' AND source_id = ?1")
        .bind(appointmentId)
        .first();
      return credit === null
        ? { skip: "no captured payment for the visit" }
        : { template: "visit_booked_credit_v1", params };
    }
    if (payment.reference === null) return { skip: "the payment has no reference yet" };
    params[5] = rupees(payment.amount);
    params[6] = payment.reference;
    return { template: "visit_booked_v1", params };
  }
  const cancelled = await db
    .prepare(
      `SELECT c.refund_amount, c.notice, p.method FROM visit_changes c LEFT JOIN payments p ON p.id = c.payment_id
       WHERE c.appointment_id = ?1 AND c.kind = 'cancelled'`,
    )
    .bind(appointmentId)
    .first<{ refund_amount: number; notice: "free" | "late"; method: string | null }>();
  if (cancelled === null) return { skip: "the visit was not cancelled by the client" };
  const credit = await creditOnCancel(db, appointmentId);
  if (credit === "restored") return { template: "visit_cancelled_credit_v1", params };
  // Kept under the 24-hour rule, or drawn on a grant that has since expired or been clawed back.
  if (credit === "kept") {
    return {
      template: cancelled.notice === "late" ? "visit_cancelled_credit_lost_v1" : "visit_cancelled_credit_gone_v1",
      params,
    };
  }
  if (cancelled.refund_amount === 0) return { template: "visit_cancelled_v1", params };
  params[5] = rupees(cancelled.refund_amount);
  params[7] = DESTINATIONS[cancelled.method ?? ""] ?? "payment method";
  return { template: "visit_cancelled_refund_v1", params };
}

/** What the client paid for a visit ahead of it: a payment, with what is left of it, a credit, or nothing. */
type PaidAhead =
  | { readonly kind: "payment"; readonly amount: number; readonly method: string | null }
  | { readonly kind: "credit" }
  | { readonly kind: "nothing" };

async function paidAhead(db: D1Database, appointmentId: string): Promise<PaidAhead> {
  const payment = await db
    .prepare(
      `SELECT amount - refunded_amount AS amount, method FROM payments
       WHERE appointment_id = ?1 AND kind = 'visit' AND status IN ('captured', 'partially_refunded')
       ORDER BY captured_at LIMIT 1`,
    )
    .bind(appointmentId)
    .first<{ amount: number; method: string | null }>();
  if (payment !== null) return { kind: "payment", amount: payment.amount, method: payment.method };
  const credit = await db
    .prepare("SELECT 1 FROM credit_ledger WHERE kind = 'redeem' AND source_id = ?1")
    .bind(appointmentId)
    .first();
  return credit === null ? { kind: "nothing" } : { kind: "credit" };
}

/** The ruling on a visit the client was not home for: how long we waited, and what became of what they paid. */
async function noShowRuling(db: D1Database, appointmentId: string, params: string[]): Promise<Composed> {
  const ruling = await db
    .prepare(
      `SELECT decision, wait_started_at, COALESCE(closed_at, wait_ends_at) AS ended_at FROM no_show_cases
       WHERE appointment_id = ?1 ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(appointmentId)
    .first<{ decision: NoShowDecision; wait_started_at: string; ended_at: string }>();
  if (ruling === null || ruling.decision === "undecided") return { skip: "ops have not ruled on it" };
  // The ninth param, which only these templates take.
  params.push(String(minutesBetween(ruling.wait_started_at, ruling.ended_at)));
  const paid = await paidAhead(db, appointmentId);
  if (paid.kind === "payment") {
    params[5] = rupees(paid.amount);
    params[7] = DESTINATIONS[paid.method ?? ""] ?? "payment method";
  }
  return { template: NO_SHOW_TEMPLATES[ruling.decision][paid.kind], params };
}

/** What became of the credit a cancelled visit was paid with: back in the balance, kept, or none was used. */
async function creditOnCancel(db: D1Database, appointmentId: string): Promise<"restored" | "kept" | "none"> {
  const used = await db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM credit_ledger WHERE kind = 'restore' AND source_id = ?1) AS restored
       FROM credit_ledger WHERE kind = 'redeem' AND source_id = ?1`,
    )
    .bind(appointmentId)
    .first<{ restored: number }>();
  if (used === null) return "none";
  return used.restored === 1 ? "restored" : "kept";
}

/**
 * Queues the reminders for tomorrow's visits, from 6 pm in India the day before: each booked visit once. Returns
 * the messages' IDs, for the queue.
 */
export async function queueReminders(db: D1Database, now: Date): Promise<string[]> {
  if (indiaTime(now) < REMINDERS_FROM) return [];
  const tomorrow = addDays(indiaDate(now), 1);
  const { results } = await db
    .prepare(
      `SELECT a.id, a.person_id FROM appointments a
       WHERE a.window_start >= ?1 AND a.window_start < ?2 AND a.status IN ('scheduled', 'dispatched')
         AND a.deleted_at IS NULL AND a.person_id IS NOT NULL AND a.type IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM outbound_messages m WHERE m.subject_id = a.id AND m.kind = 'visit_reminder')
       ORDER BY a.window_start LIMIT ?3`,
    )
    .bind(
      indiaInstant(tomorrow, "00:00").toISOString(),
      indiaInstant(addDays(tomorrow, 1), "00:00").toISOString(),
      REMINDERS_PER_PASS,
    )
    .all<{ id: string; person_id: string }>();
  const messages = results.map((visit) =>
    visitMessage(db, { personId: visit.person_id, appointmentId: visit.id, kind: "visit_reminder", now }),
  );
  if (messages.length > 0) await db.batch(messages.map((message) => message.statement));
  return messages.map((message) => message.id);
}
