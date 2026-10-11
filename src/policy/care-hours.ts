// When Customer Care answer (docs/decisions/0132-the-reply-clock.md): the hours the team is on, the same every day,
// public holidays too; how soon a message written in them is answered; and the hour a message written outside them is
// answered by the next morning. Ops set all four in the console (docs/decisions/0088-every-policy-in-the-console.md).

import { MINUTE_MS } from "../lib/durations.ts";
import { addDays, indiaDate, indiaInstant } from "../lib/india-time.ts";

export const CARE_HOURS_KEYS = ["opens", "closes", "first_reply", "answered_by"] as const;
export type CareHours = Readonly<Record<(typeof CARE_HOURS_KEYS)[number], number>>;

/** 9 am to 9 pm, a first reply within the hour, and a message written after hours answered by 10 am. */
export const CARE_HOURS: CareHours = { opens: 9, closes: 21, first_reply: 60, answered_by: 10 };

/** Hours whose figures each fit their bounds but not each other: Care close after they open, and answer in hours. */
export function careHoursConflicts(hours: CareHours): (readonly [string, string])[] {
  const conflicts: (readonly [string, string])[] = [];
  if (hours.closes <= hours.opens) conflicts.push(["closes", "opens"]);
  if (hours.answered_by < hours.opens) conflicts.push(["answered_by", "opens"]);
  if (hours.closes <= hours.answered_by) conflicts.push(["closes", "answered_by"]);
  return conflicts;
}

const onTheHour = (date: string, hour: number): Date => indiaInstant(date, `${String(hour).padStart(2, "0")}:00`);

/** Whether Care are on at `instant`. */
export function careIsOn(instant: Date, hours: CareHours = CARE_HOURS): boolean {
  const date = indiaDate(instant);
  return instant >= onTheHour(date, hours.opens) && instant < onTheHour(date, hours.closes);
}

/**
 * When a message written at `written` is answered by: within the first-reply minutes while Care are on, where that
 * still falls before they close; otherwise by the answered-by hour of the next morning.
 */
export function replyBy(written: Date, hours: CareHours = CARE_HOURS): Date {
  const date = indiaDate(written);
  if (careIsOn(written, hours)) {
    const due = new Date(written.getTime() + hours.first_reply * MINUTE_MS);
    if (due <= onTheHour(date, hours.closes)) return due;
  }
  const morning = written < onTheHour(date, hours.opens) ? date : addDays(date, 1);
  return onTheHour(morning, hours.answered_by);
}
