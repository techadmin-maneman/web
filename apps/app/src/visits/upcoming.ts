// What Visits lists under Upcoming, soonest first: the visits FSM has, and what Home also shows before FSM has it.
// That is a booking's consultation from the site, while FSM has no visit of the client's, and a visit paid for, or
// booked free, that is being booked.

import type { Me, VisitSummary } from "../api.ts";

type Consultation = NonNullable<Me["consultation"]>;
type BeingBooked = NonNullable<Me["being_booked"]>;

export type UpcomingEntry =
  | { readonly kind: "visit"; readonly visit: VisitSummary }
  | { readonly kind: "consultation"; readonly consultation: Consultation }
  | { readonly kind: "being_booked"; readonly booking: BeingBooked };

function dateOf(entry: UpcomingEntry): string {
  switch (entry.kind) {
    case "visit":
      return entry.visit.date;
    case "consultation":
      return entry.consultation.date;
    case "being_booked":
      return entry.booking.date;
  }
}

export function upcomingEntries(
  upcoming: readonly VisitSummary[],
  consultation: Me["consultation"],
  beingBooked: Me["being_booked"],
): UpcomingEntry[] {
  const entries: UpcomingEntry[] = upcoming.map((visit) => ({ kind: "visit", visit }));
  if (consultation !== null && upcoming.length === 0) entries.push({ kind: "consultation", consultation });
  if (beingBooked !== null) entries.push({ kind: "being_booked", booking: beingBooked });
  // The sort keeps a day's visits FSM has ahead of one being booked that day.
  return entries.sort((first, second) => dateOf(first).localeCompare(dateOf(second)));
}
