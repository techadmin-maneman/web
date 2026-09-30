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
// A charge costs what the booking was sold to cost a no-show, and the ruling
// records what it kept and gave back; the client may dispute it
// (src/domain/no-show-disputes.ts, docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
//
// The ruling reaches the client: a WhatsApp about it, and their visit's page
// and Payments say it (docs/decisions/0074-hand-offs-and-messages.md).

import type { VisitType } from "../config/visit-types.ts";
import { indiaDate } from "../lib/india-time.ts";
import type { Charge } from "../policy/moving-a-visit.ts";
import {
  canCloseAsNoShow,
  chargedCredit,
  chargedRefund,
  isDisputable,
  noShowWaitEnds,
  type DisputeRuling,
  type DisputeState,
  type NoShowDecision,
  type Waiver,
  type Waits,
} from "../policy/no-show.ts";
import type { PaymentsProvider } from "../providers/payments.ts";
import type { AlertOnce } from "./alerts.ts";
import { auditStatementIfRuled, type AuditEntry } from "./audit.ts";
import type { LatestArrival } from "./check-ins.ts";
import type { OpsInputs } from "./ops-settings.ts";
import { creditBack, rulingMessage, type RulingClaim } from "./ruling-claims.ts";
import { refundOf, termsInForce, termsOfVisit, visitPayment } from "./visit-changes.ts";
import { creditOfVisit, NO_VISITS_CONSENT } from "./visit-messages.ts";
import { minutesBetween } from "../lib/durations.ts";

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
  /** The check-in radius in force when he checked in, which the check-in keeps. */
  readonly radius_m: number;
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
  radius_m: number;
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
  /**
   * What a charge took: in paise, what it kept of the payment, and whether it spent the credit. Null unless ops
   * charged, and on a charge ruled before charges were recorded.
   */
  readonly charge: { readonly kept: number; readonly credit_spent: boolean } | null;
  /** The client's dispute of the charge: open while ops look, then refunded or upheld; null when none was raised. */
  readonly dispute: DisputeState | null;
  /** Whether the client may dispute the charge now: one that took something, not disputed yet. */
  readonly disputable: boolean;
}

/**
 * What a charge took, read with case `n`: what it kept of the payment, and whether it spent the credit the visit
 * was paid with, which a charge of nothing gives back (src/policy/no-show.ts).
 */
export const CHARGE_TAKEN = `n.kept_amount AS kept_amount,
  (n.charge <> 'nothing' AND EXISTS (
    SELECT 1 FROM credit_ledger r WHERE r.kind = 'redeem' AND r.source_id = n.appointment_id)) AS credit_spent`;

interface NoteRow {
  appointment_id: string;
  decision: NoShowDecision;
  wait_started_at: string;
  ended_at: string;
  charge: Charge | null;
  kept_amount: number | null;
  credit_spent: number | null;
  dispute_ruling: DisputeRuling | null;
  dispute_id: string | null;
}

function chargeTaken(row: NoteRow): NoShowNote["charge"] {
  if (row.decision !== "charged" || row.charge === null || row.kept_amount === null) return null;
  return { kept: row.kept_amount, credit_spent: row.credit_spent === 1 };
}

function disputeOf(row: NoteRow): DisputeState | null {
  if (row.dispute_id === null) return null;
  return row.dispute_ruling ?? "open";
}

function noteOf(row: NoteRow): NoShowNote {
  const charge = chargeTaken(row);
  const dispute = disputeOf(row);
  return {
    decision: row.decision,
    waited_minutes: minutesBetween(row.wait_started_at, row.ended_at),
    charge,
    dispute,
    disputable:
      charge !== null && dispute === null && isDisputable({ kept: charge.kept, creditSpent: charge.credit_spent }),
  };
}

/** The no-show note of each of these visits that has one: its latest case. */
export async function noShowNotes(db: D1Database, appointmentIds: readonly string[]): Promise<Map<string, NoShowNote>> {
  if (appointmentIds.length === 0) return new Map();
  const placeholders = appointmentIds.map((_, index) => `?${String(index + 1)}`).join(", ");
  const { results } = await db
    .prepare(
      `SELECT n.appointment_id, n.decision, n.wait_started_at, COALESCE(n.closed_at, n.wait_ends_at) AS ended_at,
         n.charge, ${CHARGE_TAKEN}, d.id AS dispute_id, d.ruling AS dispute_ruling
       FROM no_show_cases n LEFT JOIN no_show_disputes d ON d.case_id = n.id
       WHERE n.appointment_id IN (${placeholders}) ORDER BY n.created_at`,
    )
    .bind(...appointmentIds)
    .all<NoteRow>();
  // Oldest first, so a later case of the same visit is the one kept.
  return new Map(results.map((row) => [row.appointment_id, noteOf(row)]));
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
         n.wait_started_at AS checked_in_at, c.claimed_at, c.created_at AS received_at, c.distance_m, c.radius_m,
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
    minutes_late: row.window_start === null ? null : minutesBetween(row.window_start, row.checked_in_at),
    distance_m: row.distance_m,
    radius_m: row.radius_m,
    message_state: messageStateOf(row),
    message_delivered_at: row.message_delivered_at,
    wait_ends_at: row.wait_ends_at,
    closed_at: row.closed_at,
    opened_at: row.created_at,
    decision: row.decision,
    decided_at: row.decided_at,
  }));
}

/** Money going back to the client once a ruling is written. */
export interface NoShowRefund {
  readonly appointmentId: string;
  /** Whose visit it was, for ops' alert should Razorpay refuse; null once they have been erased. */
  readonly personId: string | null;
  /** In paise. */
  readonly amount: number;
  /** What sends it back, in Razorpay's notes and in ops' alert. */
  readonly why: "waived" | "charged" | "refunded on dispute";
}

/** A credit a ruling gave back that its grant could no longer take, expired or clawed back since the visit. */
export type CreditNotBack = Omit<NoShowRefund, "amount">;

export interface Ruled {
  /** The client's WhatsApp about the ruling, to queue; null for a visit with no client on our records. */
  readonly messageId: string | null;
  /** What goes back now: what a charge does not keep, or a waiver's payment where ops set a waiver to refund it. */
  readonly refund: NoShowRefund | null;
  /** The credit the ruling gave back, where it could not come back: ops settle it by hand. */
  readonly creditNotBack: CreditNotBack | null;
}

/** The terms in force, which a visit ops booked in FSM, and no hold sold, is charged under. */
export type TermsInputs = Pick<OpsInputs, "changeNoticeHours" | "lateChangeCharges" | "noShowCharges">;

interface OpenCase {
  appointment_id: string;
  person_id: string | null;
  type: VisitType | null;
  window_start: string | null;
}

/** What charging a no-show costs the client (src/policy/no-show.ts). */
interface NoShowCharge {
  readonly charge: Charge;
  /** In paise, of the visit's payment: what the charge keeps, and what it gives back. */
  readonly kept: number;
  readonly refund: number;
  /** Whether the credit the visit was paid with comes back, as it does where the charge is nothing. */
  readonly creditBack: boolean;
}

/**
 * What charging this visit costs: the no-show charge its booking was sold under, kept on its hold, or for a visit ops
 * booked in FSM the one in force (docs/decisions/0088-every-policy-in-the-console.md). A visit of no kind we sell
 * keeps what it took, as every charge did before a charge was priced.
 */
async function chargeOf(db: D1Database, visit: OpenCase, inForce: TermsInputs): Promise<NoShowCharge> {
  const paid = (await visitPayment(db, visit.appointment_id))?.paid ?? 0;
  if (visit.type === null || visit.window_start === null) {
    return { charge: "visit", kept: paid, refund: 0, creditBack: false };
  }
  const { terms, lateFee } = await termsOfVisit(
    db,
    { id: visit.appointment_id, type: visit.type, start: new Date(visit.window_start) },
    termsInForce(inForce, visit.type),
  );
  const refund = refundOf(chargedRefund(visit.type, terms.noShowCharge), paid, lateFee);
  return {
    charge: terms.noShowCharge,
    kept: paid - refund,
    refund,
    creditBack: chargedCredit(terms.noShowCharge) === "restored",
  };
}

/** What a waiver gives back, as ops set it: the payment, all of it, and the credit. */
async function waiverOf(db: D1Database, appointmentId: string, waiver: Waiver) {
  const refund = waiver.payment === "refunded" ? ((await visitPayment(db, appointmentId))?.paid ?? 0) : 0;
  return { refund, creditBack: waiver.credit === "returned" };
}

/**
 * Ops charge or waive the visit, with their reason. Ruled once: a second ruling on the same case changes nothing,
 * and writes nothing beside it (src/domain/ruling-claims.ts). In the one batch: the ruling, with what a charge
 * cost or a waiver gave back; its audit entry; the client's message about it; and the credit the visit used, where
 * the ruling returns it. The reason stays with the ruling and reaches no message. What goes back of the payment is
 * refunded after the batch.
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
    /** What a waiver gives back of the payment and the credit, as ops set it (src/policy/no-show.ts). */
    waiver: Waiver;
    terms: TermsInputs;
  },
): Promise<Ruled | null> {
  const open = await db
    .prepare(
      `SELECT n.appointment_id, p.id AS person_id, a.type, a.window_start
       FROM no_show_cases n JOIN appointments a ON a.id = n.appointment_id
       LEFT JOIN people p ON p.id = a.person_id AND p.erased_at IS NULL
       WHERE n.id = ?1 AND n.decision = 'undecided'`,
    )
    .bind(input.caseId)
    .first<OpenCase>();
  if (open === null) return null;
  const at = input.now.toISOString();
  const ruled: RulingClaim = { table: "no_show_cases", id: input.caseId, rulingId: crypto.randomUUID() };
  const message =
    open.person_id === null
      ? null
      : rulingMessage(
          db,
          { personId: open.person_id, appointmentId: open.appointment_id, kind: "no_show_decided", now: input.now },
          ruled,
        );
  const charged = input.decision === "charged" ? await chargeOf(db, open, input.terms) : null;
  const waiver = input.decision === "waived" ? input.waiver : null;
  const givenBack = charged ?? (await waiverOf(db, open.appointment_id, input.waiver));
  const [ruling] = await db.batch([
    db
      .prepare(
        `UPDATE no_show_cases SET decision = ?2, decided_by = ?3, decided_at = ?4, decision_reason = ?5,
           waiver_payment = ?6, waiver_credit = ?7, charge = ?8, kept_amount = ?9, refund_amount = ?10, ruling_id = ?11
         WHERE id = ?1 AND decision = 'undecided'`,
      )
      .bind(
        input.caseId,
        input.decision,
        input.actor,
        at,
        input.reason,
        waiver?.payment ?? null,
        waiver?.credit ?? null,
        charged?.charge ?? null,
        charged?.kept ?? null,
        charged?.refund ?? null,
        ruled.rulingId,
      ),
    auditStatementIfRuled(db, input.audit, input.now, ruled),
    ...(message === null ? [] : [message.statement]),
    ...(givenBack.creditBack ? [creditBack(db, open.appointment_id, input.now, ruled)] : []),
  ]);
  // Another member of staff ruled first: their ruling stands, and nothing of this one was written.
  if (ruling?.meta.changes !== 1) return null;
  const visit = { appointmentId: open.appointment_id, personId: open.person_id, why: input.decision };
  return {
    messageId: message?.id ?? null,
    refund: givenBack.refund > 0 ? { ...visit, amount: givenBack.refund } : null,
    creditNotBack: givenBack.creditBack && (await creditOfVisit(db, open.appointment_id)) === "kept" ? visit : null,
  };
}

/**
 * Tells ops once of a credit a ruling gave back that could not come back, its grant expired or clawed back since the
 * visit. The client's message says it could not; ops decide by hand whether the client is owed one.
 */
export async function alertCreditNotBack(alertOnce: AlertOnce, credit: CreditNotBack): Promise<void> {
  await alertOnce({
    key: `no_show_credit_not_back:${credit.why}:${credit.appointmentId}`,
    message:
      `The visit credit for visit ${credit.appointmentId}, a no-show ${credit.why}, could not come back: its grant ` +
      "has expired or been withdrawn. The client is told so; settle it with them by hand if they are owed one.",
    link: credit.personId === null ? "/no-shows" : `/clients/${credit.personId}`,
  });
}

/**
 * Refunds what a ruling gives back, at most what is left of the visit's payment. A refund Razorpay refuses is left
 * to ops, told once with the visit and the payment, as a cancel's is (src/domain/visit-changes.ts).
 */
export async function refundNoShow(
  db: D1Database,
  deps: { payments: PaymentsProvider; alertOnce: AlertOnce },
  refund: NoShowRefund,
): Promise<void> {
  const payment = await visitPayment(db, refund.appointmentId);
  const amount = Math.min(refund.amount, payment?.paid ?? 0);
  if (payment === null || amount <= 0) return;
  try {
    await deps.payments.refund(payment.razorpayPaymentId, {
      amount,
      notes: { appointment_id: refund.appointmentId, reason: `no-show ${refund.why}` },
    });
  } catch {
    await deps.alertOnce({
      key: `no_show_refund_failed:${refund.why}:${refund.appointmentId}`,
      message:
        `The refund of Rs. ${String(amount / 100)} for visit ${refund.appointmentId}, a no-show ${refund.why}, ` +
        `failed (Razorpay payment ${payment.razorpayPaymentId}). Refund it by hand in Razorpay, once.`,
      link: refund.personId === null ? "/no-shows" : `/clients/${refund.personId}`,
    });
  }
}
