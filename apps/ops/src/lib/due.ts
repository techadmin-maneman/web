// How long something waiting on ops has left. Board D2's column counts it, and
// so do the three queues where a client has asked something of us about their
// own data and we have promised an answer within a time
// (docs/decisions/0049-dpdp.md).

import { indiaDate } from "@maneman/web-kit/dates";

/** Whole days in India from today to the day something falls due: 0 is today, below zero is overdue. */
export function daysUntil(due: string, now: Date): number {
  const midnight = (instant: string) => Date.parse(`${indiaDate(instant)}T00:00:00Z`);
  return Math.round((midnight(due) - midnight(now.toISOString())) / 86_400_000);
}

/** When a request made at `from` falls due, the promise being `days` long. */
export function dueAfter(from: string, days: number): string {
  return new Date(Date.parse(from) + days * 86_400_000).toISOString();
}
