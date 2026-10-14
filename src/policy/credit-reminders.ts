// Free service visits running out: when the client is reminded (src/domain/money/credit-reminders.ts), and that a booking
// made before they expire keeps its credit (src/domain/money/credits.ts). Days are India's, YYYY-MM-DD; the visits' last day
// is the one they expire at the end of.

import { addDays } from "../lib/india-time.ts";

export const CREDIT_REMINDER_KEYS = ["first", "last"] as const;
/** How many days before their last day a client is reminded of free service visits: first, and last. */
export type CreditReminderDays = Readonly<Record<(typeof CREDIT_REMINDER_KEYS)[number], number>>;

export const CREDIT_REMINDER_DAYS: CreditReminderDays = { first: 30, last: 7 };

/** The first reminder comes before the last. */
export const creditReminderConflicts = (days: CreditReminderDays): (readonly [string, string])[] =>
  days.first <= days.last ? [["first", "last"]] : [];

/**
 * The day of the reminder due by `today` for visits whose last day is `lastDay`: the latest of the reminder days
 * reached. Null before the first, and for a reminder day on or before the day the visits were given, which the
 * message giving them already covers.
 */
export function creditReminderDay(
  lastDay: string,
  givenOn: string,
  today: string,
  days: CreditReminderDays = CREDIT_REMINDER_DAYS,
): string | null {
  let due: string | null = null;
  for (const daysBefore of [days.first, days.last]) {
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
  days: CreditReminderDays = CREDIT_REMINDER_DAYS,
): boolean {
  const due = creditReminderDay(visits.lastDay, visits.givenOn, today, days);
  if (due === null) return false;
  return visits.remindedOn === null || visits.remindedOn < due;
}
