// What Book a visit (./BookVisit.tsx) books into: the kinds of visit ops choose from, the fortnight the API offers, and
// the day, start and technician picked, each the first still open where a pick is not
// (docs/decisions/0210-booking-by-start-time.md). A window asked for, as Tasks hands one on, picks its first open start.

import { type VisitAvailability, type VisitType } from "../api.ts";
import { clients } from "../content.ts";

export const copy = clients.visits.book;

/** What ops choose to book: a kind of visit, or a consultation and fit in one visit, which is a first fit. */
export type Choice = keyof typeof copy.kinds;

export const CHOICES = Object.keys(copy.kinds) as Choice[];

/** How many days the API offers at a time. */
export const STRIP_DAYS = 14;

export const kindOf = (choice: Choice): VisitType => (choice === "one_visit" ? "first_fit" : choice);

type Day = VisitAvailability["days"][number];
type Start = Day["starts"][number];

/** The choices that depend on what the API offered: the service, the day, the start and the technician. */
export interface Picked {
  readonly tier: string | undefined;
  readonly date: string | undefined;
  /** The window asked for, whose first open start is picked where no start is. */
  readonly window: string | undefined;
  readonly start: string | undefined;
  readonly technician: string;
}

/** The window a start falls in that day. */
const windowOf = (day: Day, start: Start) =>
  day.windows.find((each) => start.time >= each.start && start.time < each.end)?.window;

/** What the client may be booked into, from what the API offered and what ops have picked: the first of each where a pick is no longer open. */
export function slotOf(offered: VisitAvailability, picked: Picked) {
  const days = offered.days.filter((day) => day.starts.length > 0);
  const day = days.find((each) => each.date === picked.date) ?? days[0];
  const starts = day?.starts ?? [];
  const inWindow = starts.find((each) => day !== undefined && windowOf(day, each) === picked.window);
  const start = starts.find((each) => each.starts_at === picked.start) ?? inWindow ?? starts[0];
  const window = day === undefined || start === undefined ? undefined : windowOf(day, start);
  const technicians = start?.technicians ?? [];
  const technician = technicians.some((each) => each.id === picked.technician) ? picked.technician : "";
  return { days, day, starts, start, window, technicians, technician };
}
