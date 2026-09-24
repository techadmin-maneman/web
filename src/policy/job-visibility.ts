// What a technician sees of each job, and when (docs/prompts/phase2-backend.md, "Technician and dispatch rules, from the designs").
// The rules as the prompt states them, and the day-before unlock they turn on.
// Dates are India's, since a working day is (docs/decisions/0035-window-slot-map.md).

import { addDays, indiaDate, indiaInstant } from "../lib/india-time.ts";

export const RULES = [
  "Today's jobs in order; tomorrow collapsed.",
  "Jobs further out show only time, type and sector. The address, access notes and client card unlock the day before, and the API enforces this, not just the screen.",
  "A job shows a Prepaid or Credit badge only, and no API response to a technician carries an amount.",
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
 * The India clock time a job unlocks at on the day before the visit. The owner
 * ruled 6 pm on 24 September 2026 (docs/open-points.md, "When a job's address
 * unlocks"): the technician sees the address at the moment the client is told
 * someone is coming, since the day-before WhatsApp goes at 6 pm (ADR 0047).
 *
 * It is a privacy boundary, not a convenience: it is what keeps a whole day's
 * client list off a phone that might be lost, so the six hours it takes off
 * midnight are the point of it.
 */
export const UNLOCK_TIME = "18:00";

/** When a job's address, access notes and client card unlock. */
export const unlocksAt = (windowStart: Date): Date => indiaInstant(addDays(indiaDate(windowStart), -1), UNLOCK_TIME);

/** Whether the address, access notes and client card are unlocked yet. */
export const unlocked = (windowStart: Date, now: Date): boolean => now.getTime() >= unlocksAt(windowStart).getTime();

/** What a locked job carries: "only time, type and sector". */
export const OUTLINE_FIELDS = ["window_start", "window_end", "type", "sector"] as const;

/** What it gains the day before. The API enforces this, not just the screen. */
export const UNLOCKED_FIELDS = ["address", "access_notes", "client_card"] as const;

/** The only money a technician's job carries: a badge, never an amount. */
export const PAYMENT_BADGES = ["prepaid", "credit"] as const;
export type PaymentBadge = (typeof PAYMENT_BADGES)[number];

/** The fields a job may carry at this moment, so a route can build its answer from one list. */
export const visibleFields = (windowStart: Date, now: Date): readonly string[] =>
  unlocked(windowStart, now) ? [...OUTLINE_FIELDS, ...UNLOCKED_FIELDS] : OUTLINE_FIELDS;
