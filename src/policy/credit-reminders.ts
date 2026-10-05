// Free service visits running out: when the client is reminded (src/domain/credit-reminders.ts), and that a booking
// made before they expire keeps its credit (src/domain/credits.ts). Days are India's, YYYY-MM-DD; the visits' last day
// is the one they expire at the end of.

import { addDays } from "../lib/india-time.ts";

// Its rules, as the brief states them:
// - credit-expiry reminders at 30 and 7 days
// - a booking made before expiry keeps the credit

/** How many days before their last day a client is reminded of free service visits, earliest first. */
export const CREDIT_REMINDER_DAYS = [30, 7] as const;

/**
 * The day of the reminder due by `today` for visits whose last day is `lastDay`: the latest of the reminder days
 * reached. Null before the first, and for a reminder day on or before the day the visits were given, which the
 * message giving them already covers.
 */
export function creditReminderDay(lastDay: string, givenOn: string, today: string): string | null {
  let due: string | null = null;
  for (const daysBefore of CREDIT_REMINDER_DAYS) {
    const day = addDays(lastDay, -daysBefore);
    if (day <= today) due = day;
  }
  if (due === null || due <= givenOn) return null;
  return due;
}

/** Whether a reminder is owed: one is due, and none has gone on or since its day. */
export function creditReminderOwed(
  visits: { readonly lastDay: string; readonly givenOn: string; readonly remindedOn: string | null },
  today: string,
): boolean {
  const due = creditReminderDay(visits.lastDay, visits.givenOn, today);
  if (due === null) return false;
  return visits.remindedOn === null || visits.remindedOn < due;
}
