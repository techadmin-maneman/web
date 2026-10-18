// The days and windows the site's booking form can book, asked before the form is filled in. Each is answered as
// bookConsultation (src/domain/booking/public-booking.ts) would take a booking in it: a slot someone is free for, a request
// ops fix the hour of, or not at all. The answer names nobody.

import { BOOKING_DAYS, BOOKING_WINDOWS, type BookingWindow } from "../../config/scheduling.ts";
import { startGrid, type GridStart } from "../../policy/start-times.ts";
import { readOpsInputs, type OpsInputs } from "../platform/ops-settings.ts";
import { addDays, indiaDate } from "../../lib/india-time.ts";
import { planStartsIn, type Plan } from "../../policy/one-visit.ts";
import { siteVisit } from "./site-visit.ts";
import { availability } from "./availability.ts";
import { ONE_VISIT_FIT, type Fitting } from "./occupancy.ts";
import { loadSlotSchedule } from "./slot-times.ts";
import { windowTimesOf, type WindowTimes } from "../../policy/slot-times.ts";
import { ALERT_WORDS } from "../../config/alert-words.ts";
import type { AlertOnce } from "../platform/alerts.ts";

/** A day the form offers, and whether booking each of its windows, and each of its starts, would be taken. */
interface OpenDay {
  readonly date: string;
  readonly windows: Readonly<Record<BookingWindow, boolean>>;
  /** Each window's hours that day. */
  readonly hours: Readonly<Record<BookingWindow, WindowTimes>>;
  /** The day's starts a step apart (docs/decisions/0210-booking-by-start-time.md), each open or taken. */
  readonly starts: readonly GridStart[];
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

/** The windows and starts someone is free in, for each length a slot is held for, keyed "minutes/date". */
async function freeWindows(
  db: D1Database,
  asked: { readonly bookings: readonly DayBooking[]; readonly pincode: string; readonly fitting: Fitting | null },
  first: string,
  now: Date,
): Promise<{ windows: Map<string, Set<BookingWindow>>; starts: Map<string, string[]> }> {
  const { bookings, pincode, fitting } = asked;
  const lengths = new Set(bookings.flatMap((booking) => (booking.by === "slot" ? [booking.minutes] : [])));
  const free = new Map<string, Set<BookingWindow>>();
  const starts = new Map<string, string[]>();
  for (const minutes of lengths) {
    for (const day of await availability({
      db,
      // Only the technicians in the pincode's city can take it.
      placing: { personId: null, pincode },
      visit: { minutes, fitting },
      from: first,
      days: BOOKING_DAYS,
      now,
    })) {
      const open = day.windows.filter((offer) => offer.open).map((offer) => offer.window);
      free.set(`${String(minutes)}/${day.date}`, new Set(open));
      starts.set(
        `${String(minutes)}/${day.date}`,
        day.starts.map((start) => start.time),
      );
    }
  }
  return { windows: free, starts };
}

const minutesOf = (booking: DayBooking): number => (booking.by === "slot" ? booking.minutes : 60);

/**
 * A day's grid of starts on the form: open where a slot is free at it, or, for a day the form asks ops to fix the hour
 * of, every start in a window the plan may start in; none on a day nothing is booked.
 */
function startsOfDay(day: {
  readonly booking: DayBooking;
  readonly plan: Plan;
  readonly hours: Readonly<Record<BookingWindow, WindowTimes>>;
  readonly inputs: OpsInputs;
  readonly free: readonly string[] | undefined;
}): GridStart[] {
  const { booking, inputs } = day;
  if (booking.by === "nothing") return [];
  const grid = startGrid(
    {
      hours: inputs.workingHours,
      step: inputs.bookingRules.step,
      minutes: minutesOf(booking) + inputs.bookingRules.wrap_up,
    },
    day.free ?? [],
  );
  if (booking.by === "slot") return grid;
  const startable = (time: string) =>
    BOOKING_WINDOWS.some(
      (window) => planStartsIn(day.plan, window) && time >= day.hours[window].start && time < day.hours[window].end,
    );
  return grid.map(({ time }) => ({ time, open: startable(time) }));
}

/** The days the form offers at a pincode, from tomorrow in India, each window open where booking it would be taken. */
export async function openDays(
  db: D1Database,
  asked: { readonly plan: Plan; readonly pincode: string },
  selfServeBooking: boolean,
  now: Date,
): Promise<OpenDay[]> {
  const { plan, pincode } = asked;
  const first = addDays(indiaDate(now), 1);
  const dates = Array.from({ length: BOOKING_DAYS }, (_, index) => addDays(first, index));
  const days = await Promise.all(
    dates.map(async (date) => ({ date, booking: await dayBooking(db, plan, date, selfServeBooking) })),
  );
  // The one visit fits a hair system, which only a technician trained to fit takes.
  const asking = {
    bookings: days.map((day) => day.booking),
    pincode,
    fitting: plan === "one_visit" ? ONE_VISIT_FIT : null,
  };
  const [free, schedule, inputs] = await Promise.all([
    freeWindows(db, asking, first, now),
    loadSlotSchedule(db),
    readOpsInputs(db, now),
  ]);

  return days.map(({ date, booking }) => {
    const isOpen = (window: BookingWindow): boolean => {
      if (!planStartsIn(plan, window) || booking.by === "nothing") return false;
      if (booking.by === "request") return true;
      return free.windows.get(`${String(booking.minutes)}/${date}`)?.has(window) ?? false;
    };
    const hours = windowTimesOf(schedule.on(date));
    return {
      date,
      windows: { morning: isOpen("morning"), afternoon: isOpen("afternoon"), evening: isOpen("evening") },
      hours,
      starts: startsOfDay({
        booking,
        plan,
        hours,
        inputs,
        free: free.starts.get(`${String(minutesOf(booking))}/${date}`),
      }),
    };
  });
}

/**
 * Ops told, once a day a city, when the form finds no consultation window open in the next fortnight at a pincode
 * served: every technician there is booked up, and clients are sent to WhatsApp instead. A one visit's days can be
 * shut by its hair systems, not by the technicians, so it tells nothing.
 */
export async function tellIfFullyBooked(
  db: D1Database,
  alertOnce: AlertOnce,
  asked: { readonly plan: Plan; readonly pincode: string; readonly days: readonly OpenDay[] },
  now: Date,
): Promise<void> {
  if (asked.plan !== "consultation" || asked.days.length === 0) return;
  if (asked.days.some((day) => Object.values(day.windows).some(Boolean))) return;
  const city = await db
    .prepare("SELECT city FROM serviceable_pincodes WHERE pincode = ?1")
    .bind(asked.pincode)
    .first<string>("city");
  if (city === null) return;
  await alertOnce({
    key: `fully_booked:${city}:${indiaDate(now)}`,
    message: ALERT_WORDS.fully_booked({ city, days: asked.days.length }),
    link: "/dispatch",
  });
}
