// Messages to a client about their visits (docs/decisions/0047-visit-messages.md): a booking, the day-before
// reminder, a move and a cancel. Each is a row in outbound_messages about the appointment, written with the change
// it tells of, then queued. The messaging consumer writes the text from the visit as it stands when it sends, and
// sends it only with the client's consent to WhatsApp about visits. The sweeper queues any whose queue message was
// lost.

import { shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { WINDOW_TIMES } from "../config/scheduling.ts";
import { FSM_SERVICE_NAMES, type VisitType } from "../config/visit-types.ts";
import { addDays, indiaDate, indiaInstant, indiaTime } from "../lib/india-time.ts";
import type { MessageKind } from "./messages.ts";
import { windowAt } from "./scheduling.ts";

export type VisitMessageKind = Extract<
  MessageKind,
  | "consultation_confirmation"
  | "payment_receipt"
  | "visit_reminder"
  | "reschedule_confirmation"
  | "cancel_confirmation"
  | "visit_moved"
>;

export const VISIT_MESSAGE_KINDS: readonly VisitMessageKind[] = [
  "consultation_confirmation",
  "payment_receipt",
  "visit_reminder",
  "reschedule_confirmation",
  "cancel_confirmation",
  // Ops moved the visit on the dispatch board; the client is told the new window and never charged.
  "visit_moved",
];

/** The day before a visit, reminders go from this time in India. */
export const REMINDERS_FROM = "18:00";
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
      status: string;
      name: string;
      technician: string | null;
    }>();
  if (visit === null) return { skip: "no such visit" };
  if (visit.type === null || visit.window_start === null) return { skip: "the visit has no type or time" };
  const booked = visit.status === "scheduled" || visit.status === "dispatched";
  if (kind !== "cancel_confirmation" && !booked) return { skip: "the visit is no longer booked" };

  const start = new Date(visit.window_start);
  const params = [
    visit.name.split(" ")[0] ?? visit.name,
    FSM_SERVICE_NAMES[visit.type].toLowerCase(),
    shortDate(indiaDate(start)),
    windowHours(start),
    visit.technician?.split(" ")[0] ?? "our technician",
    "",
    "",
    "",
  ];

  if (kind === "consultation_confirmation") return { template: "consultation_booked_v1", params };
  if (kind === "visit_reminder") return { template: "visit_reminder_v1", params };
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
      `SELECT c.refund_amount, p.method FROM visit_changes c LEFT JOIN payments p ON p.id = c.payment_id
       WHERE c.appointment_id = ?1 AND c.kind = 'cancelled'`,
    )
    .bind(appointmentId)
    .first<{ refund_amount: number; method: string | null }>();
  if (cancelled === null) return { skip: "the visit was not cancelled by the client" };
  const restored = await db
    .prepare("SELECT 1 FROM credit_ledger WHERE kind = 'restore' AND source_id = ?1")
    .bind(appointmentId)
    .first();
  if (restored !== null) return { template: "visit_cancelled_credit_v1", params };
  if (cancelled.refund_amount === 0) return { template: "visit_cancelled_v1", params };
  params[5] = rupees(cancelled.refund_amount);
  params[7] = DESTINATIONS[cancelled.method ?? ""] ?? "payment method";
  return { template: "visit_cancelled_refund_v1", params };
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
