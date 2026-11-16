// The days Ask for a time offers (./RequestSheet.tsx): a fortnight, as the design draws it, from tomorrow or from the
// first day the visit may be booked, whichever is later, such as a replacement's month; and on to the day the app
// offered, where that is further.

import { addDays } from "@maneman/web-kit/dates";

/** The design's strip: two weeks of days. */
const FORTNIGHT = 14;

export function requestDays(today: string, from: string | undefined, offered: string | undefined): string[] {
  const tomorrow = addDays(today, 1);
  const start = from !== undefined && from > tomorrow ? from : tomorrow;
  const fortnight = addDays(start, FORTNIGHT - 1);
  const last = offered !== undefined && offered > fortnight ? offered : fortnight;
  const days: string[] = [];
  for (let day = start; day <= last; day = addDays(day, 1)) days.push(day);
  return days;
}
