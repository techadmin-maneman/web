// Booking by start time (docs/decisions/0210-booking-by-start-time.md). A client picks when the technician comes, from
// starts a step apart, and the technician arrives within the arrival window after it. Each visit keeps a wrap-up after
// it, a technician's day keeps a break, and no technician takes more than so many visits, or so many fits, a day. A day
// runs to the technician's own hours, or to their city's where they have none. Ops set every figure in the console.

import { VISIT_TYPES, type VisitType } from "../config/visit-types.ts";

export const BOOKING_RULE_KEYS = [
  "step",
  "arrival",
  "wrap_up",
  "lead",
  "break",
  "break_from",
  "break_to",
  "visits",
  "fits",
] as const;
export type BookingRules = Readonly<Record<(typeof BOOKING_RULE_KEYS)[number], number>>;

/**
 * Starts every half hour; arrival within half an hour of the start; ten minutes after each visit for its photographs,
 * payment and packing; today's earliest start three hours from now; a half-hour break between noon and 4 pm; five
 * visits a day, two of them fits, at the most.
 */
export const BOOKING_RULES: BookingRules = {
  step: 30,
  arrival: 30,
  wrap_up: 10,
  lead: 3,
  break: 30,
  break_from: 12,
  break_to: 16,
  visits: 5,
  fits: 2,
};

/** Rules whose figures each fit their bounds but not each other. */
export function bookingRuleConflicts(rules: BookingRules): (readonly [string, string])[] {
  const conflicts: (readonly [string, string])[] = [];
  if (rules.break_to <= rules.break_from) conflicts.push(["break_to", "break_from"]);
  else if ((rules.break_to - rules.break_from) * 60 < rules.break) conflicts.push(["break", "break_to"]);
  if (rules.fits > rules.visits) conflicts.push(["fits", "visits"]);
  return conflicts;
}

export const SAME_DAY_CHOICES = ["yes", "no"] as const;
type SameDay = (typeof SAME_DAY_CHOICES)[number];

/** Which visits a client may book for today, from the lead time on: never a fit, whose hair system is packed the evening before. */
export const SAME_DAY_BOOKING: Readonly<Record<VisitType, SameDay>> = {
  consultation: "yes",
  first_fit: "no",
  service: "yes",
  replacement: "yes",
};

export const SAME_DAY_KEYS = VISIT_TYPES;

export const WORKING_HOURS_KEYS = ["opens", "closes"] as const;
export type WorkingHours = Readonly<Record<(typeof WORKING_HOURS_KEYS)[number], number>>;

/** A city's working day, which a technician with no week of their own works every day: 9 am to 8 pm. */
export const WORKING_HOURS: WorkingHours = { opens: 9, closes: 20 };

export function workingHoursConflicts(hours: WorkingHours): (readonly [string, string])[] {
  return hours.closes <= hours.opens ? [["closes", "opens"]] : [];
}

/** A day's hours as "HH:MM" times, from a city's whole hours. */
export const hoursOfCity = (hours: WorkingHours): { readonly starts: string; readonly ends: string } => ({
  starts: `${String(hours.opens).padStart(2, "0")}:00`,
  ends: `${String(hours.closes).padStart(2, "0")}:00`,
});

/** A time of day as ops type it on a technician's week: "09:00" to "23:30", on the half hour or the quarter. */
export const isDayTime = (value: string): boolean => /^([01]\d|2[0-3]):(00|15|30|45)$/.test(value);

/** One day of a technician's own week: 0 for Sunday to 6 for Saturday, and the hours they work, India's clock. */
export interface WorkingDay {
  readonly weekday: number;
  readonly starts: string;
  readonly ends: string;
}

/** What is wrong with a week ops are setting, as codes the console names; none for one that may be set. */
export function weekProblems(days: readonly WorkingDay[]): string[] {
  const problems: string[] = [];
  const weekdays = days.map((day) => day.weekday);
  if (new Set(weekdays).size !== weekdays.length) problems.push("day_twice");
  if (days.some((day) => !isDayTime(day.starts) || !isDayTime(day.ends))) problems.push("not_a_time");
  else if (days.some((day) => day.ends <= day.starts)) problems.push("ends_before_it_starts");
  return problems;
}
