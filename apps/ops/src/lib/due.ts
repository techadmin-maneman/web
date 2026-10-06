// How long something waiting on ops has left. The Tasks board's column counts it, and
// so does every queue that decides a task, each against the due day the API
// gives it, which the Tasks board reads as well (src/policy/tasks.ts).

import { indiaDate } from "@maneman/web-kit/dates";

/** Whole days in India from today to the day something falls due: 0 is today, below zero is overdue. */
export function daysUntil(due: string, now: Date): number {
  const midnight = (instant: string) => Date.parse(`${indiaDate(instant)}T00:00:00Z`);
  return Math.round((midnight(due) - midnight(now.toISOString())) / 86_400_000);
}
