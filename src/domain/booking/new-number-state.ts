// What a new number booking from a site's form would be answered (src/policy/site-booking.ts): booked, at the start
// it chose or the first open start in its window; asked of ops while self-serve booking is off; or taken. A number we
// know that books nothing is answered the same, so the form never tells who we know.

import type { BookingWindow } from "../../config/scheduling.ts";
import type { Plan } from "../../policy/one-visit.ts";
import { windowTimesOf } from "../../policy/slot-times.ts";
import { availability } from "./availability.ts";
import { ONE_VISIT_FIT } from "./occupancy.ts";
import { siteVisit } from "./site-visit.ts";
import { loadSlotSchedule } from "./slot-times.ts";

/** What the form asked for. */
interface Asked {
  readonly plan: Plan;
  readonly date: string;
  readonly pincode: string;
  readonly window: BookingWindow;
  readonly startsAt: Date | null;
}

export async function newNumbersState(
  form: { readonly db: D1Database; readonly now: Date; readonly selfServeBooking: boolean },
  request: Asked,
): Promise<{ readonly state: "booked" | "requested" | "taken"; readonly startsAt: Date | null }> {
  const visit = form.selfServeBooking ? await siteVisit(form.db, request.plan, request.date, request.pincode) : null;
  if (visit === null) return { state: "requested", startsAt: null };
  const length = { minutes: visit.service.minutes, fitting: request.plan === "one_visit" ? ONE_VISIT_FIT : null };
  const [[day], schedule] = await Promise.all([
    availability({
      db: form.db,
      placing: { personId: null, pincode: request.pincode },
      visit: length,
      from: request.date,
      days: 1,
      now: form.now,
    }),
    loadSlotSchedule(form.db),
  ]);
  const hours = windowTimesOf(schedule.on(request.date))[request.window];
  const asked = request.startsAt;
  const start =
    asked === null
      ? day?.starts.find((each) => each.time >= hours.start && each.time < hours.end)
      : day?.starts.find((each) => each.startsAt.getTime() === asked.getTime());
  return start === undefined ? { state: "taken", startsAt: null } : { state: "booked", startsAt: start.startsAt };
}
