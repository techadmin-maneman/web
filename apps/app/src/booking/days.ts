// The booking sheet's days: which are full, which to choose for a visit offered on a day, and later days added to
// those shown.

import type { Availability, BookingWindow } from "../api.ts";

export type Day = Availability["days"][number];

export const isFull = (day: Day): boolean => day.windows.every((window) => window.with === null);

/** The first day on or after `date` with a window open; null where the days shown have none. */
export function firstOpenFrom(days: readonly Day[], date: string): string | null {
  return days.find((day) => day.date >= date && !isFull(day))?.date ?? null;
}

/** The offered window on a day, where it is open that day; null otherwise. */
export function openWindow(day: Day | undefined, window: BookingWindow | null | undefined): BookingWindow | null {
  return day?.windows.find((each) => each.window === window && each.with !== null)?.window ?? null;
}

/** The day after `date`, both YYYY-MM-DD. */
export const dayAfter = (date: string): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Whether days after the last shown may still be booked. */
export function hasLaterDays(availability: Availability): boolean {
  const lastShown = availability.days.at(-1)?.date;
  return lastShown !== undefined && lastShown < availability.last;
}

/** The days shown with `fresh` among them, in date order: a day in both is taken from `fresh`. */
export function withDays(shown: readonly Day[], fresh: readonly Day[]): Day[] {
  const byDate = new Map(shown.map((day) => [day.date, day]));
  for (const day of fresh) byDate.set(day.date, day);
  return [...byDate.values()].sort((one, other) => one.date.localeCompare(other.date));
}
