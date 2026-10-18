// Which of the booking form's days, windows and starts can be booked, as GET /api/availability/public answers
// (docs/decisions/0210-booking-by-start-time.md). Until that answer comes, or when it cannot be had, every window is
// drawn open and no start is offered, so the form books a window, and booking still refuses a full one.

import { timeRange, UNBROKEN } from "@rules/lib/time-range.ts";
import type { OpenWindows } from "./api.ts";

export type OpenDays = OpenWindows["days"];
type BookingWindow = keyof OpenDays[number]["windows"];

/** A day, a window on it, and the start chosen in it; null while no start is offered. */
export interface Slot {
  readonly date: string;
  readonly window: BookingWindow;
  readonly start: string | null;
}

type Start = OpenDays[number]["starts"][number];

/** A day's starts inside a window, open or taken; none before the answer. */
export function startsIn(days: OpenDays | null, date: string, window: BookingWindow): Start[] {
  const day = days?.find((each) => each.date === date);
  if (day === undefined) return [];
  const hours = day.hours[window];
  return day.starts.filter((start) => start.time >= hours.start && start.time < hours.end);
}

/** The first open start in a window that day; null for none, or before the answer. */
const firstStartIn = (days: OpenDays | null, date: string, window: BookingWindow): string | null =>
  startsIn(days, date, window).find((start) => start.open)?.starts_at ?? null;

/** Whether a window can be booked: any, before the answer; none on a day the answer does not list. */
export function isOpen(days: OpenDays | null, date: string, window: BookingWindow): boolean {
  if (days === null) return true;
  return days.find((day) => day.date === date)?.windows[window] ?? false;
}

/** A window's hours on a day, as the answer gives them: "12–4 pm". Nothing before the answer, or for a day it lacks. */
export function hoursOn(days: OpenDays | null, date: string, window: BookingWindow): string {
  const hours = days?.find((day) => day.date === date)?.hours[window];
  return hours === undefined ? "" : timeRange(hours.start, hours.end, UNBROKEN);
}

/** The first of these windows open on a day; null for none. */
function firstOpenOn(days: OpenDays | null, date: string, windows: readonly BookingWindow[]): BookingWindow | null {
  return windows.find((window) => isOpen(days, date, window)) ?? null;
}

/** Whether any of these windows is open on a day. */
export function dayOpen(days: OpenDays | null, date: string, windows: readonly BookingWindow[]): boolean {
  return firstOpenOn(days, date, windows) !== null;
}

/** Whether any of these windows is open on any day. */
export function anyOpen(days: OpenDays | null, windows: readonly BookingWindow[]): boolean {
  if (days === null) return true;
  return days.some((day) => dayOpen(days, day.date, windows));
}

/**
 * The slot the form shows chosen, of these windows: the visitor's pick while it is open; else the first open window
 * that day; else the first open window of the first day with one. With nothing open at all, the pick stands.
 */
export function chosenSlot(days: OpenDays | null, windows: readonly BookingWindow[], picked: Slot): Slot {
  const withStart = (slot: { date: string; window: BookingWindow }): Slot => {
    const kept = startsIn(days, slot.date, slot.window).some((start) => start.open && start.starts_at === picked.start);
    return { ...slot, start: kept ? picked.start : firstStartIn(days, slot.date, slot.window) };
  };
  if (windows.includes(picked.window) && isOpen(days, picked.date, picked.window)) return withStart(picked);

  const sameDay = firstOpenOn(days, picked.date, windows);
  if (sameDay !== null) return withStart({ date: picked.date, window: sameDay });

  for (const day of days ?? []) {
    const window = firstOpenOn(days, day.date, windows);
    if (window !== null) return withStart({ date: day.date, window });
  }
  return picked;
}
