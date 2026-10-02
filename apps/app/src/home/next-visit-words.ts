// What Home's prompt says of a visit it offers: the day it falls due, or, once that day has passed, the day it was
// due, with the day offered on the button. A replacement is said as its month and never a day, as Visits says it.

import { listMonth, shortDate } from "@maneman/web-kit/dates";
import type { Me } from "../api.ts";
import { home, VISIT_TYPES, visits, WINDOW_NAMES } from "../content.ts";

type NextVisitPrompt = Extract<NonNullable<Me["prompt"]>, { kind: "next_visit" }>;

/** The prompt's line, and its button's label. */
export interface NextVisitWords {
  readonly line: string;
  readonly book: string;
}

/** The phone's month now, YYYY-MM. */
export const monthNow = (now: Date): string =>
  `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}`;

/** The month a replacement falls due, YYYY-MM, said as past once that month is. */
export function replacementLine(dueMonth: string, thisMonth: string): string {
  const month = listMonth(dueMonth, Number(thisMonth.slice(0, 4)));
  return dueMonth < thisMonth ? visits.record.overdue(month) : visits.record.due(month);
}

function serviceLine(prompt: NextVisitPrompt, pastDue: boolean): string {
  const what = VISIT_TYPES[prompt.type];
  if (pastDue) return home.prompt.wasDue(what, shortDate(prompt.due_on));
  const window = prompt.window === null ? null : WINDOW_NAMES[prompt.window];
  return home.prompt.nextVisit(what, shortDate(prompt.date), window);
}

/** What the prompt says of the next visit offered, in `thisMonth` (YYYY-MM). */
export function nextVisitWords(prompt: NextVisitPrompt, thisMonth: string): NextVisitWords {
  // A visit is offered after its due day only once that day has passed.
  const pastDue = prompt.due_on < prompt.date;
  const line =
    prompt.type === "replacement"
      ? replacementLine(prompt.due_on.slice(0, 7), thisMonth)
      : serviceLine(prompt, pastDue);
  const book = pastDue ? home.prompt.bookOn(shortDate(prompt.date)) : home.prompt.bookNext;
  return { line, book };
}
