import { isWeekendWindow, type VisitWindow } from "../config/booking.ts";
import { addDays, indiaDate, isWeekend } from "../lib/india-time.ts";

/** How far ahead to look before giving up (every day blacked out). */
export const SEARCH_DAYS = 60;

/**
 * The visit day the booked page proposes: the first date in India at least
 * `leadDays` days after `submittedAt` that falls on the chosen kind of day
 * (Monday to Friday, or Saturday and Sunday) and is not blacked out. Ops honour
 * it or change it on WhatsApp. Null if no day qualifies in the next SEARCH_DAYS.
 */
export function proposeVisitDate(
  submittedAt: Date,
  window: VisitWindow,
  leadDays: number,
  blackouts: ReadonlySet<string>,
): string | null {
  const wantWeekend = isWeekendWindow(window);
  const firstCandidate = addDays(indiaDate(submittedAt), leadDays);

  for (let offset = 0; offset < SEARCH_DAYS; offset++) {
    const date = addDays(firstCandidate, offset);
    if (isWeekend(date) === wantWeekend && !blackouts.has(date)) return date;
  }
  return null;
}

/** The date range proposeVisitDate may pick from, for loading blackouts in one query. */
export function candidateRange(submittedAt: Date, leadDays: number): { from: string; to: string } {
  const from = addDays(indiaDate(submittedAt), leadDays);
  return { from, to: addDays(from, SEARCH_DAYS - 1) };
}
