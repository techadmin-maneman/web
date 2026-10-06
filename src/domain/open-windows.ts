// The days and windows the site's booking form can book, asked before the form is filled in. Each is answered as
// bookConsultation (src/domain/public-booking.ts) would take a booking in it: a slot someone is free for, a request
// ops fix the hour of, or not at all. The answer names nobody.

import { BOOKING_DAYS, type BookingWindow } from "../config/scheduling.ts";
import { addDays, indiaDate } from "../lib/india-time.ts";
import { planStartsIn, type Plan } from "../policy/one-visit.ts";
import { siteVisit } from "./public-booking.ts";
import { availability } from "./availability.ts";

/** A day the form offers, and whether booking each of its windows would be taken. */
interface OpenDay {
  readonly date: string;
  readonly windows: Readonly<Record<BookingWindow, boolean>>;
}

/** How a booking on a day is taken: not at all, as a request ops fix the hour of, or as a slot of this length. */
type DayBooking =
  { readonly by: "nothing" } | { readonly by: "request" } | { readonly by: "slot"; readonly minutes: number };

/** One visit with no hair system offered is refused; anything else the site cannot hold is asked of ops. */
async function dayBooking(db: D1Database, plan: Plan, date: string, selfServeBooking: boolean): Promise<DayBooking> {
  const visit = await siteVisit(db, plan, date);
  if (visit === null) return plan === "one_visit" ? { by: "nothing" } : { by: "request" };
  if (!selfServeBooking) return { by: "request" };
  return { by: "slot", minutes: visit.service.minutes };
}

/** The windows someone is free in, for each length a slot is held for, keyed "minutes/date". */
async function freeWindows(
  db: D1Database,
  bookings: readonly DayBooking[],
  first: string,
  now: Date,
): Promise<Map<string, Set<BookingWindow>>> {
  const lengths = new Set(bookings.flatMap((booking) => (booking.by === "slot" ? [booking.minutes] : [])));
  const free = new Map<string, Set<BookingWindow>>();
  for (const minutes of lengths) {
    for (const day of await availability(db, { personId: null }, { minutes }, first, BOOKING_DAYS, now)) {
      const open = day.windows.filter((offer) => offer.open).map((offer) => offer.window);
      free.set(`${String(minutes)}/${day.date}`, new Set(open));
    }
  }
  return free;
}

/** The days the form offers, from tomorrow in India, each window open where booking it would be taken. */
export async function openDays(db: D1Database, plan: Plan, selfServeBooking: boolean, now: Date): Promise<OpenDay[]> {
  const first = addDays(indiaDate(now), 1);
  const dates = Array.from({ length: BOOKING_DAYS }, (_, index) => addDays(first, index));
  const days = await Promise.all(
    dates.map(async (date) => ({ date, booking: await dayBooking(db, plan, date, selfServeBooking) })),
  );
  const free = await freeWindows(
    db,
    days.map((day) => day.booking),
    first,
    now,
  );

  return days.map(({ date, booking }) => {
    const isOpen = (window: BookingWindow): boolean => {
      if (!planStartsIn(plan, window) || booking.by === "nothing") return false;
      if (booking.by === "request") return true;
      return free.get(`${String(booking.minutes)}/${date}`)?.has(window) ?? false;
    };
    return {
      date,
      windows: { morning: isOpen("morning"), afternoon: isOpen("afternoon"), evening: isOpen("evening") },
    };
  });
}
