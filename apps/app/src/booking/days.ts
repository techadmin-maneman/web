// The booking sheet's days and starts (docs/decisions/0210-booking-by-start-time.md): which days are full, the earliest
// open start, which start to choose for a visit offered on a day and in a window, later days added to those shown, and
// what the day and time step says of them.

import { weekdayDate } from "@maneman/web-kit/dates";
import type { Availability, BookingWindow } from "../api.ts";
import { booking } from "../content.ts";

export type Day = Availability["days"][number];
export const isFull = (day: Day): boolean => day.starts.every((start) => !start.open);

/** How many of the day's starts are open. */
export const openStarts = (day: Day): number => day.starts.filter((start) => start.open).length;

/** The first open start among the days shown, offered at a tap; null where every day shown is full. */
export function earliestOpen(
  days: readonly Day[],
): { readonly date: string; readonly start: Day["starts"][number] } | null {
  for (const day of days) {
    const start = day.starts.find((each) => each.open);
    if (start !== undefined) return { date: day.date, start };
  }
  return null;
}

/** The first day on or after `date` with a window open; null where the days shown have none. */
export function firstOpenFrom(days: readonly Day[], date: string): string | null {
  return days.find((day) => day.date >= date && !isFull(day))?.date ?? null;
}

/** The first open start inside the window offered on a day; null where it has none, or no window is offered. */
export function firstOpenIn(day: Day | undefined, window: BookingWindow | null | undefined): string | null {
  const hours = day?.windows.find((each) => each.window === window);
  if (day === undefined || hours === undefined) return null;
  return (
    day.starts.find((start) => start.open && start.time >= hours.start && start.time < hours.end)?.starts_at ?? null
  );
}

/** A start the client picked, where it is still open on the day; null otherwise. */
export function stillOpen(day: Day | undefined, startsAt: string | null): string | null {
  return day?.starts.find((start) => start.starts_at === startsAt && start.open)?.starts_at ?? null;
}

/** Whether days after the last shown may still be booked. */
export function hasLaterDays(availability: Availability): boolean {
  const lastShown = availability.days.at(-1)?.date;
  return lastShown !== undefined && lastShown < availability.last;
}

/**
 * The days with each start the API refused in this sheet shut: one offered on the plan's estimate of the drives, then
 * found by the drives themselves not to fit, is offered again on the next read, and would only be refused again.
 */
export function withoutRefused(days: readonly Day[], refused: ReadonlySet<string>): Day[] {
  if (refused.size === 0) return [...days];
  return days.map((day) => ({
    ...day,
    starts: day.starts.map((start) => (refused.has(start.starts_at) ? { ...start, open: false } : start)),
  }));
}

/** The days shown with `fresh` among them, in date order: a day in both is taken from `fresh`. */
export function withDays(shown: readonly Day[], fresh: readonly Day[]): Day[] {
  const byDate = new Map(shown.map((day) => [day.date, day]));
  for (const day of fresh) byDate.set(day.date, day);
  return [...byDate.values()].sort((one, other) => one.date.localeCompare(other.date));
}

/**
 * Where the day a visit is offered on is full: that it is, and that the next open day is chosen, or, with none open
 * after it, to pick another. Nothing once the client has chosen some other day.
 */
export function offeredFullLine(days: readonly Day[], offered: string | null, chosen: string | null): string | null {
  const day = days.find((each) => each.date === offered);
  if (offered === null || day === undefined || !isFull(day)) return null;
  if (chosen === null) return booking.when.offeredFullPickAnother(weekdayDate(offered));
  if (chosen === firstOpenFrom(days, offered)) return booking.when.offeredFull(weekdayDate(offered));
  return null;
}
