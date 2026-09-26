// The client is not home (src/policy/no-show.ts).
//
// "The wait timer starts at check-in and runs config NO_SHOW_WAIT_MIN (15)
// minutes. Close as no-show is disabled until the timer ends." The server
// enforces the wait, not the screen, and on its own clock as well as the
// phone's (docs/decisions/0065-a-technicians-writes-reach-fsm.md).
//
// "Ops then receive three facts: check-in time, distance, and the delivery
// receipt of the day-before or arrival WhatsApp to the client." Nothing here
// charges anybody: "the charge is applied by ops from the evidence, never
// automatically", so a case opens undecided and waits for a person.
//
// The ruling reaches the client: a WhatsApp about it, and their visit's page
// and Payments say it (docs/decisions/0073-hand-offs-and-messages.md).

import type { VisitType } from "../config/visit-types.ts";
import { indiaDate } from "../lib/india-time.ts";
import { canCloseAsNoShow, noShowWaitEnds, type NoShowDecision, type Waits } from "../policy/no-show.ts";
import type { PaymentsProvider } from "../providers/razorpay.ts";
import type { AlertOnce } from "./alerts.ts";
import { auditStatement, type AuditEntry } from "./audit.ts";
import type { LatestArrival } from "./check-ins.ts";
import { visitPayment } from "./visit-changes.ts";
import { NO_VISITS_CONSENT, visitMessage } from "./visit-messages.ts";

/**
 * What became of the WhatsApp ops read the receipt of. A reminder that was never
 * sent is not one that was sent and never arrived, and a client who never agreed
 * to WhatsApp about visits was never going to get one.
 */
export const MESSAGE_STATES = ["delivered", "sent", "not_sent", "no_consent", "none"] as const;
export type MessageState = (typeof MESSAGE_STATES)[number];

/** The three facts, with what ops need to read the first one by. */
export interface NoShowCase {
  readonly id: string;
  readonly appointment_id: string;
  /** Whose visit it was; null once they have been erased. */
  readonly person: { readonly id: string; readonly name: string } | null;
  readonly visit_date: string | null;
  readonly technician: string | null;
  /** The phone's time for the arrival, held within bounds (src/policy/phone-clock.ts): what the wait ran from. */
  readonly checked_in_at: string;
  /** What the phone itself said, before the bounds; null when it said nothing. */
  readonly phone_checked_in_at: string | null;
  /** When the check-in reached us. Far after the phone's time means a phone with no signal, or a clock set back. */
  readonly received_at: string;
  /** The visit's booked window. */
  readonly window_start: string | null;
  readonly window_end: string | null;
  /** How long after the booked start he checked in, in minutes; negative when he was early. */
  readonly minutes_late: number | null;
  /** Null when there was nothing to measure against. */
  readonly distance_m: number | null;
  readonly message_state: MessageState;
  readonly message_delivered_at: string | null;
  readonly wait_ends_at: string;
  readonly closed_at: string | null;
  /** When the case opened, which is when it started waiting for ops. */
  readonly opened_at: string;
  readonly decision: NoShowDecision;
  readonly decided_at: string | null;
}

interface CaseRow {
  id: string;
  appointment_id: string;
  person_id: string | null;
  person_name: string | null;
  checked_in_at: string;
  claimed_at: string | null;
  received_at: string;
  distance_m: number | null;
  message_id: string | null;
  message_status: string | null;
  message_error: string | null;
  message_delivered_at: string | null;
  wait_ends_at: string;
  closed_at: string | null;
  created_at: string;
  decision: NoShowDecision;
  decided_at: string | null;
  window_start: string | null;
  window_end: string | null;
  technician: string | null;
}

function messageStateOf(row: CaseRow): MessageState {
  if (row.message_id === null) return "none";
  if (row.message_delivered_at !== null) return "delivered";
  if (row.message_status === "sent") return "sent";
  if (row.message_status === "skipped" && row.message_error === NO_VISITS_CONSENT) return "no_consent";
  return "not_sent";
}

/**
 * The WhatsApp ops read the receipt of, as `?1` names the visit: of the day-before reminder and the arrival notice,
 * one WhatsApp reported delivered, else the latest. The technician's card reads the same (src/domain/tech-jobs.ts).
 */
export const EVIDENCE_MESSAGE = `SELECT id, delivered_at FROM outbound_messages
  WHERE subject_kind = 'appointment' AND subject_id = ?1 AND kind IN ('visit_reminder', 'arrival_notice')
  ORDER BY delivered_at IS NULL, created_at DESC, rowid DESC LIMIT 1`;

function evidenceMessage(
  db: D1Database,
  appointmentId: string,
): Promise<{ id: string; delivered_at: string | null } | null> {
  return db.prepare(EVIDENCE_MESSAGE).bind(appointmentId).first<{ id: string; delivered_at: string | null }>();
}

export type Readiness =
  | { readonly kind: "ready"; readonly checkIn: LatestArrival; readonly waitEndsAt: Date }
  | { readonly kind: "too_early"; readonly waitEndsAt: Date }
  | { readonly kind: "no_check_in" };

/** Whether the job may close as a no-show now: a check-in, and its wait run out on both clocks. */
export function noShowReadiness(
  checkIn: LatestArrival | null,
  type: VisitType,
  now: Date,
  /** The waits in force, which ops set (ADR 0061). */
  wait: Waits,
): Readiness {
  if (checkIn === null) return { kind: "no_check_in" };
  const waitEndsAt = noShowWaitEnds(checkIn, type, wait);
  if (!canCloseAsNoShow(checkIn, type, now, wait)) return { kind: "too_early", waitEndsAt };
  return { kind: "ready", checkIn, waitEndsAt };
}

/**
 * Opens the case ops rule on, once the close has landed. The case is keyed on
 * the check-in, so a replay of the same close lands once. Returns its ID.
 */
export async function openNoShowCase(
  db: D1Database,
  input: { appointmentId: string; checkIn: LatestArrival; waitEndsAt: Date; now: Date },
): Promise<string> {
  const message = await evidenceMessage(db, input.appointmentId);
  const at = input.now.toISOString();
  await db
    .prepare(
      `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, closed_at,
         message_id, message_delivered_at, decision, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'undecided', ?6)
       ON CONFLICT (checkin_id) DO UPDATE SET
         closed_at = COALESCE(no_show_cases.closed_at, excluded.closed_at),
         message_id = COALESCE(no_show_cases.message_id, excluded.message_id),
         message_delivered_at = COALESCE(no_show_cases.message_delivered_at, excluded.message_delivered_at)`,
    )
    .bind(
      crypto.randomUUID(),
      input.checkIn.id,
      input.appointmentId,
      input.checkIn.at.toISOString(),
      input.waitEndsAt.toISOString(),
      at,
      message?.id ?? null,
      message?.delivered_at ?? null,
    )
    .run();
  const stored = await db
    .prepare("SELECT id FROM no_show_cases WHERE checkin_id = ?1")
    .bind(input.checkIn.id)
    .first<{ id: string }>();
  if (stored === null) throw new Error("the no-show case was not written");
  return stored.id;
}

/**
 * What the client is told of a visit they were not home for (LIFE-07): that we waited, how long, and what ops
 * ruled. The reason ops gave is theirs, and stays with the ruling.
 */
export interface NoShowNote {
  readonly decision: NoShowDecision;
  /** From the check-in to the close: how long the technician waited at the door. */
  readonly waited_minutes: number;
}

/** The no-show note of each of these visits that has one: its latest case. */
export async function noShowNotes(db: D1Database, appointmentIds: readonly string[]): Promise<Map<string, NoShowNote>> {
  if (appointmentIds.length === 0) return new Map();
  const placeholders = appointmentIds.map((_, index) => `?${String(index + 1)}`).join(", ");
  const { results } = await db
    .prepare(
      `SELECT appointment_id, decision, wait_started_at, COALESCE(closed_at, wait_ends_at) AS ended_at
       FROM no_show_cases WHERE appointment_id IN (${placeholders}) ORDER BY created_at`,
    )
    .bind(...appointmentIds)
    .all<{ appointment_id: string; decision: NoShowDecision; wait_started_at: string; ended_at: string }>();
  // Oldest first, so a later case of the same visit is the one kept.
  return new Map(
    results.map((row) => [
      row.appointment_id,
      {
        decision: row.decision,
        waited_minutes: Math.round((Date.parse(row.ended_at) - Date.parse(row.wait_started_at)) / 60_000),
      },
    ]),
  );
}

/** The cases ops have still to rule on, oldest first, then the decided ones. */
export async function listNoShowCases(
  db: D1Database,
  decision: NoShowDecision | "all",
  limit: number,
): Promise<NoShowCase[]> {
  // The receipt is read from the message itself as well as from the case, since
  // it can arrive after the case opened.
  const { results } = await db
    .prepare(
      `SELECT n.id, n.appointment_id, pe.id AS person_id, pe.name AS person_name,
         n.wait_started_at AS checked_in_at, c.claimed_at, c.created_at AS received_at, c.distance_m,
         n.message_id, o.state AS message_status, o.last_error AS message_error,
         COALESCE(n.message_delivered_at, o.delivered_at) AS message_delivered_at,
         n.wait_ends_at, n.closed_at, n.created_at, n.decision, n.decided_at,
         a.window_start, a.window_end, t.name AS technician
       FROM no_show_cases n
       JOIN checkins c ON c.id = n.checkin_id
       JOIN appointments a ON a.id = n.appointment_id
       LEFT JOIN people pe ON pe.id = a.person_id AND pe.erased_at IS NULL
       LEFT JOIN outbound_messages o ON o.id = n.message_id
       LEFT JOIN technicians t ON t.id = c.technician_id
       WHERE (?1 = 'all' OR n.decision = ?1)
       ORDER BY n.decision = 'undecided' DESC, n.created_at
       LIMIT ?2`,
    )
    .bind(decision, limit)
    .all<CaseRow>();
  return results.map((row) => ({
    id: row.id,
    appointment_id: row.appointment_id,
    person: row.person_id === null || row.person_name === null ? null : { id: row.person_id, name: row.person_name },
    visit_date: row.window_start === null ? null : indiaDate(new Date(row.window_start)),
    technician: row.technician,
    checked_in_at: row.checked_in_at,
    phone_checked_in_at: row.claimed_at,
    received_at: row.received_at,
    window_start: row.window_start,
    window_end: row.window_end,
    minutes_late:
      row.window_start === null
        ? null
        : Math.round((Date.parse(row.checked_in_at) - Date.parse(row.window_start)) / 60_000),
    distance_m: row.distance_m,
    message_state: messageStateOf(row),
    message_delivered_at: row.message_delivered_at,
    wait_ends_at: row.wait_ends_at,
    closed_at: row.closed_at,
    opened_at: row.created_at,
    decision: row.decision,
    decided_at: row.decided_at,
  }));
}

/** A waived visit whose payment is to go back, once the ruling is written. */
export interface WaivedVisit {
  readonly appointmentId: string;
  readonly personId: string;
}

export interface Ruled {
  /** The client's WhatsApp about the ruling, to queue; null for a visit with no client on our records. */
  readonly messageId: string | null;
  /** A waiver that gives back what the visit took (WAIVER_GIVES_BACK): the visit whose payment to refund now. */
  readonly refund: WaivedVisit | null;
}

/**
 * Ops charge or waive the visit, with their reason. Ruled once: a second ruling on the same case changes nothing.
 * In the one batch: the ruling, its audit entry (src/domain/audit.ts), the client's message about it, and, for a
 * waiver that gives back, the credit the visit used. The reason stays with the ruling and reaches no message. A
 * charge moves nothing: the visit keeps what it took, as a cancel inside 24 hours does.
 */
export async function decideNoShow(
  db: D1Database,
  input: {
    caseId: string;
    decision: Exclude<NoShowDecision, "undecided">;
    reason: string | null;
    actor: string;
    audit: AuditEntry;
    now: Date;
    /** Whether a waiver gives back the payment and the credit: the owner's ruling (src/policy/no-show.ts). */
    waiverGivesBack: boolean;
  },
): Promise<Ruled | null> {
  const open = await db
    .prepare(
      `SELECT n.appointment_id, p.id AS person_id FROM no_show_cases n JOIN appointments a ON a.id = n.appointment_id
       LEFT JOIN people p ON p.id = a.person_id AND p.erased_at IS NULL
       WHERE n.id = ?1 AND n.decision = 'undecided'`,
    )
    .bind(input.caseId)
    .first<{ appointment_id: string; person_id: string | null }>();
  if (open === null) return null;
  const at = input.now.toISOString();
  const message =
    open.person_id === null
      ? null
      : visitMessage(db, {
          personId: open.person_id,
          appointmentId: open.appointment_id,
          kind: "no_show_decided",
          now: input.now,
        });
  const givesBack = input.decision === "waived" && input.waiverGivesBack;
  await db.batch([
    db
      .prepare(
        `UPDATE no_show_cases SET decision = ?2, decided_by = ?3, decided_at = ?4, decision_reason = ?5
         WHERE id = ?1 AND decision = 'undecided'`,
      )
      .bind(input.caseId, input.decision, input.actor, at, input.reason),
    auditStatement(db, input.audit, input.now),
    ...(message === null ? [] : [message.statement]),
    ...(givesBack ? [creditBack(db, open.appointment_id, input.now)] : []),
  ]);
  return {
    messageId: message?.id ?? null,
    refund:
      givesBack && open.person_id !== null ? { appointmentId: open.appointment_id, personId: open.person_id } : null,
  };
}

/**
 * The credit a waived visit used, back in its grant: once (the ledger's one-use index), and only to a grant that
 * can still take it, neither clawed back nor expired, as a free cancel's is (src/policy/moving-a-visit.ts).
 */
function creditBack(db: D1Database, appointmentId: string, now: Date): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
       SELECT ?1, r.person_id, 'restore', 1, r.grant_id, 'appointment', r.source_id, ?3
       FROM credit_ledger r JOIN credit_ledger g ON g.id = r.grant_id
       WHERE r.kind = 'redeem' AND r.source_id = ?2
         AND NOT EXISTS (SELECT 1 FROM credit_ledger c WHERE c.grant_id = r.grant_id AND c.kind = 'clawback')
         AND (g.expires_at IS NULL OR g.expires_at > ?3)
       ON CONFLICT DO NOTHING`,
    )
    .bind(crypto.randomUUID(), appointmentId, now.toISOString());
}

/**
 * Refunds what is left of a waived visit's payment, when a waiver gives back. A refund Razorpay refuses is left
 * to ops, told once with the visit and the payment, as a cancel's is (src/domain/visit-changes.ts).
 */
export async function refundWaivedVisit(
  db: D1Database,
  deps: { payments: PaymentsProvider; alertOnce: AlertOnce },
  visit: WaivedVisit,
): Promise<void> {
  const payment = await visitPayment(db, visit.appointmentId);
  if (payment === null || payment.paid <= 0) return;
  try {
    await deps.payments.refund(payment.razorpayPaymentId, {
      amount: payment.paid,
      notes: { appointment_id: visit.appointmentId, reason: "no-show waived" },
    });
  } catch {
    await deps.alertOnce({
      key: `no_show_refund_failed:${visit.appointmentId}`,
      message:
        `The refund of Rs. ${String(payment.paid / 100)} for visit ${visit.appointmentId}, whose no-show was ` +
        `waived, failed (Razorpay payment ${payment.razorpayPaymentId}). Refund it by hand in Razorpay, once.`,
      link: `/clients/${visit.personId}`,
    });
  }
}
