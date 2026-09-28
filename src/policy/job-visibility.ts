// What a technician sees of each job, and when (docs/prompts/phase2-backend.md, "Technician and dispatch rules, from the designs").
// The rules as the prompt states them, and the day-before unlock they turn on.
// Dates are India's, since a working day is (docs/decisions/0035-window-slot-map.md).
//
// src/domain/tech-jobs.ts builds a job's answer from `unlocked`: a job still
// locked carries no address, access notes, client, pieces, last visit or
// reminder, and no answer to a technician carries an amount.

import { addDays, indiaDate, indiaInstant } from "../lib/india-time.ts";

export const RULES = [
  "Today's jobs in order; tomorrow collapsed.",
  "Jobs further out show only time, type and sector. The address, access notes and client card unlock the day before, and the API enforces this, not just the screen.",
  "A job shows a Prepaid or Credit badge only, and no API response to a technician carries an amount.",
  // Ruled by the owner on 27 September 2026 (docs/open-points.md, item 92).
  "the other technician's first name may reach the phone",
] as const;

/** Where a job sits on the technician's list. */
export type JobDay = "today" | "tomorrow" | "later";

export function jobDay(windowStart: Date, now: Date): JobDay {
  const today = indiaDate(now);
  const date = indiaDate(windowStart);
  if (date === today) return "today";
  return date === addDays(today, 1) ? "tomorrow" : "later";
}

/**
 * The hour in India the day-before WhatsApp goes at (docs/decisions/0047-visit-messages.md): 6 pm, as the owner
 * ruled on 27 September 2026 (docs/open-points.md, item 40), until ops set another in the console
 * (docs/decisions/0088-every-policy-in-the-console.md).
 */
export const DAY_BEFORE_REMINDER_HOUR = 18;

/**
 * The India clock time a job unlocks at on the day before the visit. The owner
 * ruled 6 pm on 24 September 2026 (docs/open-points.md, "When a job's address
 * unlocks"): the technician sees the address at the moment the client is told
 * someone is coming, when the day-before WhatsApp goes.
 *
 * It is a privacy boundary, not a convenience: it is what keeps a whole day's
 * client list off a phone that might be lost, so the six hours it takes off
 * midnight are the point of it.
 */
export const UNLOCK_HOUR = DAY_BEFORE_REMINDER_HOUR;

/**
 * The hour ops have set, or the one above. It is an ops-editable input
 * (docs/decisions/0061-ops-editable-inputs.md), so every caller passes the
 * hour in force; the default keeps the rule readable and standing on its own.
 */
export const unlocksAt = (windowStart: Date, hour: number = UNLOCK_HOUR): Date =>
  indiaInstant(addDays(indiaDate(windowStart), -1), `${String(hour).padStart(2, "0")}:00`);

/** Whether the address, access notes and client card are unlocked yet. */
export const unlocked = (windowStart: Date, now: Date, hour: number = UNLOCK_HOUR): boolean =>
  now.getTime() >= unlocksAt(windowStart, hour).getTime();

/**
 * The only money a technician's job carries: a badge, never an amount. The
 * prompt names two; board A1 draws a third, Free, on a visit the price book
 * charges nothing for, such as a consultation (ADR 0025, item 33).
 */
export const PAYMENT_BADGES = ["prepaid", "credit", "free"] as const;
export type PaymentBadge = (typeof PAYMENT_BADGES)[number];

/**
 * A visit a service-visit credit paid for is Credit; one the price book
 * charges nothing for on its day is Free; any other was paid for ahead. The
 * technician's card and the dispatch board read the same badge.
 */
export function paymentBadge(visit: { readonly onCredit: boolean; readonly free: boolean }): PaymentBadge {
  if (visit.onCredit) return "credit";
  if (visit.free) return "free";
  return "prepaid";
}

/**
 * Whether a write the phone sent for a job ops changed under it names who has
 * the job now, and when ops moved it: only when it went to another technician,
 * and never when it was cancelled, since then it went to nobody. `changed` is
 * what the superseded write names: status, technician or time. Only their
 * first name is given, and nothing else of theirs.
 */
export function namesTheOtherTechnician(changed: readonly string[]): boolean {
  return changed.includes("technician") && !changed.includes("status");
}
