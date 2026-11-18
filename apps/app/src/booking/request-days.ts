// The days Ask for a time offers (./RequestSheet.tsx): a fortnight, as the design draws it, from tomorrow or from the
// first day the visit may be booked, whichever is later; and on to the day the app offered, where that is further. A
// replacement may be booked from the day its hair system's replacement opens, whichever button books it.

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

/** The first day a visit may be asked for: the one given, else a replacement's from the hair system worn. */
export function requestFrom(
  kind: string | undefined,
  from: string | undefined,
  worn: { readonly replacement_opens_on: string } | null,
): string | undefined {
  if (from !== undefined || kind !== "replacement") return from;
  return worn?.replacement_opens_on;
}
