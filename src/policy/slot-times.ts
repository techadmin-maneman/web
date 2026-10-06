// The times of a working day's half-slots, which ops set in the console (docs/decisions/0102-window-times.md).
//
// A day has eight half-slots, and each window is the half-slots WINDOW_SLOT_MAP gives it, which stay in code: the
// morning runs from its first half-slot's start to the afternoon's, the afternoon to the evening's, and the evening
// to the day's end. So the times are the eight starts and the day's end, and the windows are read from them.
//
// A booking keeps its half-slot's place in the day, not its clock time (slot_holds.start_unit), so a change of times
// would move every visit booked on a day it covers. A change therefore applies only from a day after the last a
// client can book and after the last visit already booked, and each day is read by the times in force on it.

import { DAY_END, UNIT_STARTS, UNITS_PER_DAY, WINDOW_SLOT_MAP } from "../config/scheduling.ts";
import type { BookingWindow } from "../config/scheduling.ts";
import { addDays } from "../lib/india-time.ts";
import { MINUTES_PER_UNIT } from "./visit-length.ts";

/** A day's times in India: when each half-slot starts, and when the day ends. */
export interface SlotTimes {
  readonly unitStarts: readonly string[];
  readonly dayEnd: string;
}

/** The times in code, in force until ops set others (src/config/scheduling.ts). */
export const DEFAULT_SLOT_TIMES: SlotTimes = { unitStarts: UNIT_STARTS, dayEnd: DAY_END };

/** The earliest a half-slot may start and the latest a day may end, in India's time. */
const DAY_BOUNDS = { earliest: "06:00", latest: "22:00" } as const;

/** Each window's span, from the day's times. */
export function windowTimesOf(times: SlotTimes): Readonly<Record<BookingWindow, { start: string; end: string }>> {
  const startOf = (window: BookingWindow) => times.unitStarts[WINDOW_SLOT_MAP[window][0] ?? 0] ?? "";
  return {
    morning: { start: startOf("morning"), end: startOf("afternoon") },
    afternoon: { start: startOf("afternoon"), end: startOf("evening") },
    evening: { start: startOf("evening"), end: times.dayEnd },
  };
}

/** The window a time of day in India ("HH:MM") falls in, by the day's times. */
export function windowAt(time: string, times: SlotTimes): BookingWindow {
  const windows = windowTimesOf(times);
  if (time < windows.afternoon.start) return "morning";
  if (time < windows.evening.start) return "afternoon";
  return "evening";
}

/** The half-slot a time of day in India falls in: the last one starting at or before it. */
export function unitAt(time: string, times: SlotTimes): number {
  let unit = 0;
  times.unitStarts.forEach((start, index) => {
    if (start <= time) unit = index;
  });
  return unit;
}

/** The first half-slot to start after a time of day in India; the day's count of half-slots once every one has. */
export function firstUnitAfter(time: string, times: SlotTimes): number {
  const ahead = times.unitStarts.findIndex((start) => start > time);
  return ahead === -1 ? times.unitStarts.length : ahead;
}

const isTime = (value: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/** Minutes since midnight of an "HH:MM" time. */
function minutesOf(time: string): number {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** How long each half-slot lasts, in minutes: from its start to the next one's, the last one to the day's end. */
function halfSlotLengths(times: SlotTimes): number[] {
  const boundaries = [...times.unitStarts, times.dayEnd].map(minutesOf);
  return boundaries.slice(1).map((end, index) => end - (boundaries[index] ?? end));
}

/** What is wrong with a day's times, as codes the console names; none for times that may be set. */
export function slotTimesProblems(times: SlotTimes): string[] {
  const all = [...times.unitStarts, times.dayEnd];
  if (times.unitStarts.length !== UNITS_PER_DAY) return ["not_eight_starts"];
  if (!all.every(isTime)) return ["not_a_time"];
  const problems: string[] = [];
  const lengths = halfSlotLengths(times);
  if (lengths.some((length) => length <= 0)) {
    problems.push("not_in_order");
  } else if (lengths.some((length) => length < MINUTES_PER_UNIT)) {
    problems.push("half_slot_too_short");
  }
  if ((all[0] ?? "") < DAY_BOUNDS.earliest || times.dayEnd > DAY_BOUNDS.latest) problems.push("outside_the_day");
  return problems;
}

/**
 * The earliest day a change of times may apply from: after the last day a client can book in the app (`horizon`
 * days from tomorrow, src/policy/next-visit.ts), after the last visit already booked, and after the last change.
 */
export function earliestAppliesFrom(
  today: string,
  horizonDays: number,
  lastBookedDate: string | null,
  lastChangeFrom: string | null,
): string {
  const after = [addDays(today, horizonDays), lastBookedDate, lastChangeFrom].reduce<string>(
    (latest, date) => (date !== null && date > latest ? date : latest),
    today,
  );
  return addDays(after, 1);
}
