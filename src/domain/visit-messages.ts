// Messages to a client about their visits (docs/decisions/0047-visit-messages.md): a booking, the day-before
// reminder, a move and a cancel, and since docs/decisions/0074-hand-offs-and-messages.md the technician's arrival and
// ops' ruling on a visit the client was not home for, and since docs/decisions/0096-a-no-shows-charge-and-its-dispute.md
// their ruling on the client's dispute of its charge. Each is a row in outbound_messages about the appointment, written
// with the change it tells of, then queued. The messaging consumer writes the text from the visit as it stands when it sends, and
// sends it only with the client's consent to WhatsApp about visits, but for a receipt or a refund, which goes without
// it (src/policy/consents.ts). The sweeper queues any whose queue message was lost.

import { shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import type { BookingWindow } from "../config/scheduling.ts";
import { VISIT_TYPE_NAMES, type VisitType } from "../config/visit-types.ts";
import { addDays, indiaDate, indiaInstant, indiaTime } from "../lib/india-time.ts";
import { isTransactional } from "../policy/consents.ts";
import { DAY_BEFORE_REMINDER_HOUR } from "../policy/job-visibility.ts";
import type { Charge } from "../policy/moving-a-visit.ts";
import type { OneVisitState } from "../policy/one-visit.ts";
import { WAIVER_GIVES_BACK, type DisputeRuling, type NoShowDecision, type Waiver } from "../policy/no-show.ts";
import { tooEarlyToArrive } from "../policy/phone-clock.ts";
import { latestArrival } from "./check-ins.ts";
import { codeOnVisit } from "./discount-code-uses.ts";
import { readOpsInputs } from "./ops-settings.ts";
import { loadSlotSchedule, type SlotSchedule } from "./slot-times.ts";
import type { AppointmentStatus } from "./visit-status.ts";
import { consentGiven, type MessageKind } from "./messages.ts";
import { windowTimesOf } from "../policy/slot-times.ts";
import { MINUTE_MS, minutesBetween } from "../lib/durations.ts";
import { firstNameOf } from "../lib/names.ts";

export type VisitMessageKind = Extract<
  MessageKind,
  | "consultation_confirmation"
  | "payment_receipt"
  | "nothing_to_pay"
  | "visit_reminder"
  | "reschedule_confirmation"
  | "cancel_confirmation"
  | "visit_cancelled"
  | "visit_moved"
  | "arrival_notice"
  | "no_show_decided"
  | "no_show_dispute_ruled"
>;

export const VISIT_MESSAGE_KINDS: readonly VisitMessageKind[] = [
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
];

/**
 * The statuses in which each kind is still true of the visit. Most are about a visit still booked; a cancel and a
 * no-show are about one that no longer is, and the technician's arrival may already have started the visit.
 */
const STILL_TRUE_WHILE: Readonly<Record<VisitMessageKind, readonly AppointmentStatus[] | "any">> = {
  consultation_confirmation: ["scheduled", "dispatched"],
  payment_receipt: ["scheduled", "dispatched"],
  nothing_to_pay: ["scheduled", "dispatched", "in_progress", "completed"],
  visit_reminder: ["scheduled", "dispatched"],
  reschedule_confirmation: ["scheduled", "dispatched"],
  visit_moved: ["scheduled", "dispatched"],
  cancel_confirmation: "any",
  visit_cancelled: "any",
  arrival_notice: ["scheduled", "dispatched", "in_progress"],
  no_show_decided: "any",
  no_show_dispute_ruled: "any",
};

/**
 * What the ruling on a no-show says, by the ruling and by what the client paid ahead. A charge says what it kept and
 * what goes back, as the ruling recorded them (no_show_cases.kept_amount and refund_amount); one charged before a
 * charge recorded them kept what was paid, as a cancel inside 24 hours does. A waiver says what it gave back, as the
 * ruling kept it (no_show_cases.waiver_payment and waiver_credit): the owner ruled on 27 September 2026 that it
 * refunds the payment and returns the credit, and ops may set it otherwise (src/policy/no-show.ts). A waiver ruled
 * before the ruling kept it gave both back. A credit given back says so only where the ledger holds it back: a grant
 * expired or clawed back since the visit could not take it.
 */
const CHARGED_TEMPLATES = {
  payment: "no_show_charged_paid_v1",
  credit: "no_show_charged_credit_v1",
  nothing: "no_show_missed_v1",
} as const;

function waivedTemplate(paid: PaidAhead["kind"], waiver: Waiver, credit: VisitCredit): string {
  if (paid === "payment") return waiver.payment === "refunded" ? "no_show_waived_refund_v1" : "no_show_waived_paid_v1";
  if (paid === "nothing") return "no_show_waived_v1";
  if (waiver.credit === "spent") return "no_show_waived_credit_v1";
  return credit === "restored" ? "no_show_waived_credit_back_v1" : "no_show_waived_credit_gone_v1";
}

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
  const statement = db
    .prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at)
       VALUES (?1, ?2, ?3, ?4, 'appointment', ?5, 'queued', ?2)`,
    )
    .bind(id, at, input.personId, input.kind, input.appointmentId);
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

/** The kinds that tell a visit's new window: the client's own move, and one ops made on the dispatch board. */
const MOVE_KINDS: readonly VisitMessageKind[] = ["reschedule_confirmation", "visit_moved"];

/**
 * Why a message about a booked visit is no longer worth sending, as after waiting out a bridge that was down; null
 * while it still is. An arrival notice says the technician is at the door, a reminder that the visit is tomorrow, and
 * a move the visit's new window, which a later move's message tells as well.
 */
export async function noLongerWorthSending(
  db: D1Database,
  kind: VisitMessageKind,
  appointmentId: string,
  writtenAt: Date,
  now: Date,
): Promise<string | null> {
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

/** "12 to 4 pm", as the app writes a window, by the times in force on the visit's day. */
function windowHours(start: Date, schedule: SlotSchedule): string {
  const { date, window } = schedule.at(start);
  return hoursOfWindow(date, window, schedule);
}

/** "12 to 4 pm" for a day's window, by the times in force that day. */
export function hoursOfWindow(date: string, window: BookingWindow, schedule: SlotSchedule): string {
  const { start: from, end: to } = windowTimesOf(schedule.on(date))[window];
  const hour = (time: string) => {
    const hours = Number(time.slice(0, 2));
    return { number: String(hours % 12 === 0 ? 12 : hours % 12), half: hours < 12 ? "am" : "pm" };
  };
  const [first, last] = [hour(from), hour(to)];
  return first.half === last.half
    ? `${first.number} to ${last.number} ${last.half}`
    : `${first.number} ${first.half} to ${last.number} ${last.half}`;
}

/** What a message calls a consultation and fit in one visit while it is still to happen (ADR 0105). PLACEHOLDER COPY. */
const ONE_VISIT_NAME = "consultation and fit";

/** Where a refund goes back to, by the payment's method, as a message names it. */
export const DESTINATIONS: Readonly<Record<string, string>> = { upi: "UPI", card: "card", netbanking: "bank account" };

export type Composed = { readonly template: string; readonly params: string[] } | { readonly skip: string };

/** Why a message about a visit was skipped when the client never agreed to them; the no-show queue reads it back. */
export const NO_VISITS_CONSENT = "no consent to WhatsApp about visits";

/**
 * A composed message as it may go: as it is with the client's consent to WhatsApp about visits, or without it when it
 * is a receipt or a refund. Anything else without that consent is skipped for the want of it.
 */
export async function underVisitsConsent(db: D1Database, personId: string, composed: Composed): Promise<Composed> {
  if (await consentGiven(db, personId, "whatsapp_visits")) return composed;
  if ("template" in composed && isTransactional(composed.template)) return composed;
  return { skip: NO_VISITS_CONSENT };
}

/** Why an arrival or a no-show's ruling is not told: the check-in came before a technician may check in. */
export const ARRIVED_TOO_EARLY = "the check-in came before the earliest check-in";

/** The visit a check-in is held against: its booked start, and the technician it is on. */
interface VisitArrivedAt {
  readonly id: string;
  readonly technicianId: string | null;
  readonly start: Date;
}

/** Whether the visit's technician's check-in reached us before the earliest check-in ops allow. */
async function arrivedTooEarly(db: D1Database, visit: VisitArrivedAt): Promise<boolean> {
  if (visit.technicianId === null) return false;
  const arrival = await latestArrival(db, { id: visit.id, technicianId: visit.technicianId });
  if (arrival === null) return false;
  const { phoneClock } = await readOpsInputs(db, arrival.receivedAt);
  return tooEarlyToArrive(arrival.receivedAt, visit.start, phoneClock);
}

/** That the technician is at the door, told only of a check-in made in time. */
async function arrivalMessage(db: D1Database, visit: VisitArrivedAt, params: string[]): Promise<Composed> {
  if (await arrivedTooEarly(db, visit)) return { skip: ARRIVED_TOO_EARLY };
  return { template: "technician_arrived_v1", params };
}

/** What a queued message about a visit says, as the visit stands now; or why it is not sent. */
export async function composeVisitMessage(
  db: D1Database,
  kind: VisitMessageKind,
  appointmentId: string,
  personId: string,
): Promise<Composed> {
  return underVisitsConsent(db, personId, await composeVisitText(db, kind, appointmentId, personId));
}

async function composeVisitText(
  db: D1Database,
  kind: VisitMessageKind,
  appointmentId: string,
  personId: string,
): Promise<Composed> {
  const visit = await db
    .prepare(
      `SELECT a.type, a.one_visit, a.window_start, a.status, a.technician_id, p.name, t.name AS technician
       FROM appointments a JOIN people p ON p.id = a.person_id LEFT JOIN technicians t ON t.id = a.technician_id
       WHERE a.id = ?1 AND a.person_id = ?2 AND a.deleted_at IS NULL`,
    )
    .bind(appointmentId, personId)
    .first<{
      type: VisitType | null;
      one_visit: OneVisitState | null;
      window_start: string | null;
      status: AppointmentStatus;
      technician_id: string | null;
      name: string;
      technician: string | null;
    }>();
  if (visit === null) return { skip: "no such visit" };
  if (visit.type === null || visit.window_start === null) return { skip: "the visit has no type or time" };
  if (!stillTrue(kind, visit.status)) return { skip: "the visit is no longer booked" };

  const start = new Date(visit.window_start);
  const params = [
    firstNameOf(visit.name),
    visit.one_visit === "booked" ? ONE_VISIT_NAME : VISIT_TYPE_NAMES[visit.type].toLowerCase(),
    shortDate(indiaDate(start)),
    windowHours(start, await loadSlotSchedule(db)),
    visit.technician === null ? "our technician" : firstNameOf(visit.technician),
    "",
    "",
    "",
  ];

  if (kind === "consultation_confirmation") {
    return { template: visit.one_visit === null ? "consultation_booked_v1" : "one_visit_booked_v1", params };
  }
  if (kind === "nothing_to_pay") return { template: "visit_fitted_code_v1", params };
  if (kind === "visit_reminder") return { template: "visit_reminder_v1", params };
  const arrivedAt = { id: appointmentId, technicianId: visit.technician_id, start };
  if (kind === "arrival_notice") return arrivalMessage(db, arrivedAt, params);
  if (kind === "no_show_decided") return noShowRuling(db, arrivedAt, params);
  if (kind === "no_show_dispute_ruled") return disputeRuling(db, appointmentId, params);
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
    if (payment === null) return bookedWithNothingPaid(db, appointmentId, params);
    if (payment.reference === null) return { skip: "the payment has no reference yet" };
    params[5] = rupees(payment.amount);
    params[6] = payment.reference;
    return { template: "visit_booked_v1", params };
  }
  return cancelMessage(db, appointmentId, params);
}

/** A cancel, the client's own or one ops made: what goes back, and whether the credit it used comes back. */
async function cancelMessage(db: D1Database, appointmentId: string, params: string[]): Promise<Composed> {
  const cancelled = await db
    .prepare(
      `SELECT c.refund_amount, c.notice, c.ops_terms, p.method FROM visit_changes c
       LEFT JOIN payments p ON p.id = c.payment_id
       WHERE c.appointment_id = ?1 AND c.kind = 'cancelled'`,
    )
    .bind(appointmentId)
    .first<{
      refund_amount: number;
      notice: "free" | "late";
      ops_terms: "free" | "client" | null;
      method: string | null;
    }>();
  if (cancelled === null) return { skip: "the visit was not cancelled" };
  const credit = await creditOfVisit(db, appointmentId);
  if (credit === "restored") return { template: "visit_cancelled_credit_v1", params };
  // Kept under the client's late terms, or drawn on a grant that has since expired or been clawed back.
  if (credit === "kept") {
    const keptAsLate = cancelled.notice === "late" && cancelled.ops_terms !== "free";
    return { template: keptAsLate ? "visit_cancelled_credit_lost_v1" : "visit_cancelled_credit_gone_v1", params };
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
  return (await paidWithCredit(db, appointmentId)) ? { kind: "credit" } : { kind: "nothing" };
}

/** Where a refund of the visit's payment goes, as a message names it: "UPI". */
async function refundDestination(db: D1Database, appointmentId: string): Promise<string> {
  const payment = await db
    .prepare("SELECT method FROM payments WHERE appointment_id = ?1 AND kind = 'visit' ORDER BY captured_at LIMIT 1")
    .bind(appointmentId)
    .first<{ method: string | null }>();
  return DESTINATIONS[payment?.method ?? ""] ?? "payment method";
}

/** Whether a service-visit credit paid for the visit. */
/**
 * A booking's receipt with no payment behind it: a visit a credit paid for, or one a discount code made free, which
 * the owner ruled on 1 October 2026 is told it is booked as a paid one is (docs/decisions/0108-discount-codes.md). A
 * prepaid visit with a code is booked only once paid, so a code on a visit with no payment is one that left nothing
 * to pay.
 */
async function bookedWithNothingPaid(db: D1Database, appointmentId: string, params: string[]): Promise<Composed> {
  if (await paidWithCredit(db, appointmentId)) return { template: "visit_booked_credit_v1", params };
  if ((await codeOnVisit(db, appointmentId)) !== null) return { template: "visit_booked_code_v1", params };
  return { skip: "no captured payment for the visit" };
}

async function paidWithCredit(db: D1Database, appointmentId: string): Promise<boolean> {
  const credit = await db
    .prepare("SELECT 1 FROM credit_ledger WHERE kind = 'redeem' AND source_id = ?1")
    .bind(appointmentId)
    .first();
  return credit !== null;
}

/** A charge as its ruling recorded it, in paise: what it kept of the payment, and what goes back. */
interface RecordedCharge {
  readonly charge: Charge;
  readonly kept: number;
  readonly refund: number;
}

/**
 * What a charge says: what it kept and what goes back, or that it spent the credit. A charge of nothing gave both
 * back, and says so as a waiver that gives them does, the credit only where the ledger holds it back.
 */
async function chargedMessage(
  db: D1Database,
  appointmentId: string,
  charge: RecordedCharge,
  params: string[],
): Promise<Composed> {
  if (charge.kept + charge.refund === 0) {
    const credit = await creditOfVisit(db, appointmentId);
    if (credit === "none") return { template: "no_show_missed_v1", params };
    if (charge.charge !== "nothing") return { template: "no_show_charged_credit_v1", params };
    return {
      template: credit === "restored" ? "no_show_waived_credit_back_v1" : "no_show_waived_credit_gone_v1",
      params,
    };
  }
  params[7] = await refundDestination(db, appointmentId);
  if (charge.kept === 0) {
    params[5] = rupees(charge.refund);
    return { template: "no_show_waived_refund_v1", params };
  }
  params[5] = rupees(charge.kept);
  if (charge.refund === 0) return { template: "no_show_charged_paid_v1", params };
  // The tenth param, which only this template takes.
  params.push(rupees(charge.refund));
  return { template: "no_show_charged_fee_v1", params };
}

/**
 * The ruling on a visit the client was not home for: how long we waited, and what became of what they paid. Never
 * told of a check-in made before a technician may check in, which was no arrival for this visit.
 */
async function noShowRuling(db: D1Database, visit: VisitArrivedAt, params: string[]): Promise<Composed> {
  if (await arrivedTooEarly(db, visit)) return { skip: ARRIVED_TOO_EARLY };
  const appointmentId = visit.id;
  const ruling = await db
    .prepare(
      `SELECT decision, wait_started_at, COALESCE(closed_at, wait_ends_at) AS ended_at, waiver_payment, waiver_credit,
         charge, kept_amount, refund_amount
       FROM no_show_cases WHERE appointment_id = ?1 ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(appointmentId)
    .first<{
      decision: NoShowDecision;
      wait_started_at: string;
      ended_at: string;
      waiver_payment: Waiver["payment"] | null;
      waiver_credit: Waiver["credit"] | null;
      charge: Charge | null;
      kept_amount: number | null;
      refund_amount: number | null;
    }>();
  if (ruling === null || ruling.decision === "undecided") return { skip: "ops have not ruled on it" };
  // The ninth param, which only these templates take.
  params.push(String(minutesBetween(ruling.wait_started_at, ruling.ended_at)));
  if (ruling.charge !== null && ruling.kept_amount !== null && ruling.refund_amount !== null) {
    const charge = { charge: ruling.charge, kept: ruling.kept_amount, refund: ruling.refund_amount };
    return chargedMessage(db, appointmentId, charge, params);
  }
  const paid = await paidAhead(db, appointmentId);
  if (paid.kind === "payment") {
    params[5] = rupees(paid.amount);
    params[7] = DESTINATIONS[paid.method ?? ""] ?? "payment method";
  }
  if (ruling.decision === "charged") return { template: CHARGED_TEMPLATES[paid.kind], params };
  const waiver = {
    payment: ruling.waiver_payment ?? WAIVER_GIVES_BACK.payment,
    credit: ruling.waiver_credit ?? WAIVER_GIVES_BACK.credit,
  };
  return { template: waivedTemplate(paid.kind, waiver, await creditOfVisit(db, appointmentId)), params };
}

/**
 * Ops' ruling on the client's dispute of a no-show's charge: refunded, with what goes back, or upheld. The credit is
 * back only where the ledger holds it back: a grant expired or clawed back since the visit could not take it.
 */
async function disputeRuling(db: D1Database, appointmentId: string, params: string[]): Promise<Composed> {
  const dispute = await db
    .prepare(
      `SELECT d.ruling, n.kept_amount FROM no_show_disputes d JOIN no_show_cases n ON n.id = d.case_id
       WHERE n.appointment_id = ?1 ORDER BY d.created_at DESC LIMIT 1`,
    )
    .bind(appointmentId)
    .first<{ ruling: DisputeRuling | null; kept_amount: number | null }>();
  const ruling = dispute?.ruling ?? null;
  if (ruling === null) return { skip: "ops have not ruled on the dispute" };
  if (ruling === "upheld") return { template: "no_show_dispute_upheld_v1", params };
  const kept = dispute?.kept_amount ?? 0;
  if (kept === 0) {
    const credit = await creditOfVisit(db, appointmentId);
    return {
      template: credit === "restored" ? "no_show_dispute_credit_back_v1" : "no_show_dispute_credit_gone_v1",
      params,
    };
  }
  params[5] = rupees(kept);
  params[7] = await refundDestination(db, appointmentId);
  return { template: "no_show_dispute_refunded_v1", params };
}

/** What became of the credit a visit was paid with: back in the balance, kept, or none was used. */
export type VisitCredit = "restored" | "kept" | "none";

/**
 * What became of the credit a visit was paid with, as the ledger holds it: a cancel or a ruling that gives it back
 * writes its restore only where the grant can still take it.
 */
export async function creditOfVisit(db: D1Database, appointmentId: string): Promise<VisitCredit> {
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
       WHERE a.window_start >= ?1 AND a.window_start < ?2 AND a.status IN ('scheduled', 'dispatched')
         AND a.deleted_at IS NULL AND a.person_id IS NOT NULL AND a.type IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM outbound_messages m
           WHERE m.subject_id = a.id AND m.kind = 'visit_reminder' AND m.created_at >= ?3
         )
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
