// What a new number booking from a site's form would be answered (src/policy/site-booking.ts): booked, at the start
// it chose or the first open start in its window; asked of ops while self-serve booking is off; or taken. A number we
// know that books nothing is answered the same, so the form never tells who we know.

import type { BookingWindow } from "../../config/scheduling.ts";
import type { Plan } from "../../policy/one-visit.ts";
import type { DriveCheck } from "./drive-check.ts";
import { wouldHold } from "./hold-slot.ts";
import { siteVisit } from "./site-visit.ts";

/** What the form asked for. */
interface Asked {
  readonly plan: Plan;
  readonly date: string;
  readonly pincode: string;
  readonly window: BookingWindow;
  readonly startsAt: Date | null;
}

export async function newNumbersState(
  form: {
    readonly db: D1Database;
    readonly now: Date;
    readonly selfServeBooking: boolean;
    /** Google, as the new number's hold asks it; null where the routes provider is off. */
    readonly drives: DriveCheck | null;
  },
  request: Asked,
): Promise<{ readonly state: "booked" | "requested" | "taken"; readonly startsAt: Date | null }> {
  const visit = form.selfServeBooking ? await siteVisit(form.db, request.plan, request.date, request.pincode) : null;
  if (visit === null) return { state: "requested", startsAt: null };
  // The hold a new number would make, run without writing: someone with no visits of their own, whose address is not
  // written yet, so placed by the pincode as a new number's hold places it, and its drives checked as that hold's are.
  const held = await wouldHold({
    db: form.db,
    input: {
      personId: crypto.randomUUID(),
      service: visit.service,
      date: request.date,
      window: request.window,
      ...(request.startsAt === null ? {} : { startsAt: request.startsAt }),
      price: visit.price,
      terms: visit.terms,
      oneVisit: request.plan === "one_visit",
      pincode: request.pincode,
      from: "site",
    },
    now: form.now,
    drives: form.drives,
  });
  return held === null ? { state: "taken", startsAt: null } : { state: "booked", startsAt: held.startsAt };
}
