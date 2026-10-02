// Which of the booking form's days and windows can be booked, as GET /api/availability/public answers. Until that
// answer comes, or when it cannot be had, every one is drawn open, and booking still refuses a full one.

import type { OpenWindows } from "./api.ts";

export type OpenDays = OpenWindows["days"];
type BookingWindow = keyof OpenDays[number]["windows"];

/** A day and a window on it. */
export interface Slot {
  readonly date: string;
  readonly window: BookingWindow;
}

/** Whether a window can be booked: any, before the answer; none on a day the answer does not list. */
export function isOpen(days: OpenDays | null, date: string, window: BookingWindow): boolean {
  if (days === null) return true;
  return days.find((day) => day.date === date)?.windows[window] ?? false;
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
  if (windows.includes(picked.window) && isOpen(days, picked.date, picked.window)) return picked;

  const sameDay = firstOpenOn(days, picked.date, windows);
  if (sameDay !== null) return { date: picked.date, window: sameDay };

  for (const day of days ?? []) {
    const window = firstOpenOn(days, day.date, windows);
    if (window !== null) return { date: day.date, window };
  }
  return picked;
}
