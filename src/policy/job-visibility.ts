// What a technician sees of each job, and when: a job's card opens the day before its visit and locks again the day
// after. Dates are India's, since a working day is (docs/decisions/0035-window-slot-map.md).
//
// src/domain/tech-jobs.ts builds a job's answer from `unlocked`: a job still
// locked carries no address, access notes, client, pieces, last visit or
// reminder, and no answer to a technician carries an amount.

import { addDays, indiaDate, indiaInstant } from "../lib/india-time.ts";

/** Where a job sits on the technician's list. */
export type JobDay = "past" | "today" | "tomorrow" | "later";

export function jobDay(windowStart: Date, now: Date): JobDay {
  const today = indiaDate(now);
  const date = indiaDate(windowStart);
  if (date < today) return "past";
  if (date === today) return "today";
  return date === addDays(today, 1) ? "tomorrow" : "later";
}

/**
 * Whether a technician's list may be read for the date: none before yesterday, kept for a phone whose clock is
 * behind. Dates ahead show only time, type and sector until the day before.
 */
export const listableDate = (date: string, now: Date): boolean => date >= addDays(indiaDate(now), -1);

/**
 * The hour in India the day-before WhatsApp goes at (docs/decisions/0047-visit-messages.md): 6 pm, until ops set
 * another in the console.
 */
export const DAY_BEFORE_REMINDER_HOUR = 18;

/**
 * The India clock time a job unlocks at on the day before the visit: the technician sees the address at the moment
 * the client is told someone is coming, when the day-before WhatsApp goes.
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

/**
 * When a job locks again: the end of the day after its visit. A day to finish, close and send what the phone still
 * holds, after which a lost phone, or a technician gone, can no longer read the client's door, number or profile.
 * The phone's writes name the job and need no card, so work it still holds goes through after.
 */
export const relocksAt = (windowStart: Date): Date => indiaInstant(addDays(indiaDate(windowStart), 2), "00:00");

/** Whether the address, access notes and client card are open: from the day before the visit to a day after it. */
export const unlocked = (windowStart: Date, now: Date, hour: number = UNLOCK_HOUR): boolean =>
  now.getTime() >= unlocksAt(windowStart, hour).getTime() && now.getTime() < relocksAt(windowStart).getTime();

/**
 * The only money a technician's job carries: a badge, never an amount. Free marks a visit the price book charges
 * nothing for, such as a consultation; at_visit a consultation and fit in one visit, paid for once the client is
 * fitted (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
 */
export const PAYMENT_BADGES = ["prepaid", "credit", "free", "at_visit"] as const;
export type PaymentBadge = (typeof PAYMENT_BADGES)[number];

/**
 * A one visit is paid for at the visit; a visit a service-visit credit paid
 * for is Credit; one the price book charges nothing for on its day is Free;
 * any other was paid for ahead. The technician's card and the dispatch board
 * read the same badge.
 */
export function paymentBadge(visit: {
  readonly onCredit: boolean;
  readonly free: boolean;
  readonly oneVisit: boolean;
}): PaymentBadge {
  if (visit.oneVisit) return "at_visit";
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
