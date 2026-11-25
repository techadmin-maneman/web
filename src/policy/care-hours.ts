// When Customer Care answer (docs/decisions/0132-the-reply-clock.md): the times the team is on, the same every day,
// public holidays too; how soon a message written in them is answered; the time a message written outside them is
// answered by the next morning; and how long a new lead waits before Care are alerted
// (docs/decisions/0323-the-unanswered-lead-alert.md). Ops set all five in the console
// (docs/decisions/0088-every-policy-in-the-console.md); the times are minutes past midnight in India, so Care may open at
// 9:30 (docs/decisions/0322-care-times.md).

import { MINUTE_MS } from "../lib/durations.ts";
import { addDays, indiaDate, indiaInstant } from "../lib/india-time.ts";

export const CARE_HOURS_KEYS = ["opens", "closes", "first_reply", "answered_by", "lead_alert"] as const;
export type CareHours = Readonly<Record<(typeof CARE_HOURS_KEYS)[number], number>>;

/**
 * 9:30 am to 7 pm, a first reply within the hour, a message written after hours answered by 10 am, and a new lead's
 * alert after five minutes.
 */
export const CARE_HOURS: CareHours = { opens: 570, closes: 1140, first_reply: 60, answered_by: 600, lead_alert: 5 };

/** Hours whose figures each fit their bounds but not each other: Care close after they open, and answer in hours. */
export function careHoursConflicts(hours: CareHours): (readonly [string, string])[] {
  const conflicts: (readonly [string, string])[] = [];
  if (hours.closes <= hours.opens) conflicts.push(["closes", "opens"]);
  if (hours.answered_by < hours.opens) conflicts.push(["answered_by", "opens"]);
  if (hours.closes <= hours.answered_by) conflicts.push(["closes", "answered_by"]);
  return conflicts;
}

/** Care's times as the client app reads them: the minutes, and the whole hours an app copy older than the minutes reads. */
export function careHoursForClients(hours: CareHours) {
  return {
    opens: Math.floor(hours.opens / 60),
    closes: Math.floor(hours.closes / 60),
    opens_minute: hours.opens,
    closes_minute: hours.closes,
    first_reply: hours.first_reply,
  };
}

/** A time of the day, minutes past midnight, as a clock writes it: 570 is "09:30". */
export const clockOf = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

const onTheHour = (date: string, minute: number): Date => indiaInstant(date, clockOf(minute));

/** Whether Care are on at `instant`. */
export function careIsOn(instant: Date, hours: CareHours = CARE_HOURS): boolean {
  const date = indiaDate(instant);
  return instant >= onTheHour(date, hours.opens) && instant < onTheHour(date, hours.closes);
}

/** When Care last closed, at or before `instant`. */
export function lastClosed(instant: Date, hours: CareHours = CARE_HOURS): Date {
  const date = indiaDate(instant);
  const today = onTheHour(date, hours.closes);
  return instant >= today ? today : onTheHour(addDays(date, -1), hours.closes);
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

/**
 * The minutes between two moments that fall in Care hours, as the reply clock counts a wait: a message at 6:50 pm
 * answered at 9:40 am, with Care on from 9:30 am to 7 pm, has waited 20 minutes.
 */
export function careMinutesBetween(from: Date, to: Date, hours: CareHours = CARE_HOURS): number {
  let minutes = 0;
  for (let date = indiaDate(from); date <= indiaDate(to); date = addDays(date, 1)) {
    const opens = Math.max(onTheHour(date, hours.opens).getTime(), from.getTime());
    const closes = Math.min(onTheHour(date, hours.closes).getTime(), to.getTime());
    if (closes > opens) minutes += (closes - opens) / MINUTE_MS;
  }
  return Math.round(minutes);
}

/**
 * When a lead that came in at `since` has waited the alert minutes inside Care's times: five minutes after it came in
 * while Care are on, and a lead at 6:58 pm, with Care closing at 7, at 9:33 the next morning.
 */
export function leadAlertAt(since: Date, hours: CareHours = CARE_HOURS): Date {
  let left = hours.lead_alert * MINUTE_MS;
  // Hours that never open, which the setting refuses, would never be reached.
  if (hours.closes <= hours.opens) return new Date(since.getTime() + left);
  for (let date = indiaDate(since); ; date = addDays(date, 1)) {
    const opens = Math.max(onTheHour(date, hours.opens).getTime(), since.getTime());
    const closes = onTheHour(date, hours.closes).getTime();
    if (closes - opens >= left) return new Date(opens + left);
    left -= Math.max(0, closes - opens);
  }
}
