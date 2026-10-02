// The booking sheet's days and windows: which days are full or inside the notice, which to choose for a visit offered
// on a day, later days added to those shown, and what the date and window steps say of them.

import { weekdayDate } from "@maneman/web-kit/dates";
import type { Availability, BookingWindow } from "../api.ts";
import { booking } from "../content.ts";

export type Day = Availability["days"][number];
type WhoWouldCome = Day["windows"][number]["with"];

export const isFull = (day: Day): boolean => day.windows.every((window) => window.with === null);

/** Whether a visit booked now in any of the day's open windows would already cost the client to change. */
export const dayInsideNotice = (day: Day): boolean =>
  day.windows.some((window) => window.with !== null && window.change_charged);

/** The window step's button: on to payment, or, for a day that costs nothing, only on. */
export const windowContinue = (day: Day): string =>
  day.price.amount === 0 ? booking.window.continueFree : booking.window.continue;

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

/**
 * Where the day a visit is offered on is full: that it is, and that the next open day is chosen, or, with none open
 * after it, to pick another. Nothing once the client has chosen some other day.
 */
export function offeredFullLine(days: readonly Day[], offered: string | null, chosen: string | null): string | null {
  const day = days.find((each) => each.date === offered);
  if (offered === null || day === undefined || !isFull(day)) return null;
  if (chosen === null) return booking.date.offeredFullPickAnother(weekdayDate(offered));
  if (chosen === firstOpenFrom(days, offered)) return booking.date.offeredFull(weekdayDate(offered));
  return null;
}

/**
 * What a window says of who would come: the regular technician by name, or another where the client has a regular
 * one. A client who has none is told nothing of who.
 */
export function windowNote(who: WhoWouldCome, regularName: string | null): string | null {
  if (who === null) return booking.window.full;
  if (regularName === null) return null;
  return who === "regular" ? booking.window.withRegular(regularName) : booking.window.another;
}
