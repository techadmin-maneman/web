// What Book a visit (./BookVisit.tsx) books into: the kinds of visit ops choose from, the fortnight the API offers, and
// the day, window and technician picked, each the first still open where a pick is not.

import { type VisitAvailability, type VisitType } from "../api.ts";
import { clients } from "../content.ts";

export const copy = clients.visits.book;

/** What ops choose to book: a kind of visit, or a consultation and fit in one visit, which is a first fit. */
export type Choice = keyof typeof copy.kinds;

export const CHOICES = Object.keys(copy.kinds) as Choice[];

/** How many days the API offers at a time. */
export const STRIP_DAYS = 14;

export const kindOf = (choice: Choice): VisitType => (choice === "one_visit" ? "first_fit" : choice);

/** A one visit's three hours do not fit in the evening. */
const fitsWindow = (choice: Choice, window: string) => choice !== "one_visit" || window !== "evening";

type Day = VisitAvailability["days"][number];

type Window = Day["windows"][number];

/** The windows of a day someone is free in, for what is being booked. */
const openWindows = (day: Day, choice: Choice): Window[] =>
  day.windows.filter((each) => each.technicians.length > 0 && fitsWindow(choice, each.window));

/** The choices that depend on what the API offered: the service, the day, the window and the technician. */
export interface Picked {
  readonly tier: string | undefined;
  readonly date: string | undefined;
  readonly window: string | undefined;
  readonly technician: string;
}

/** What the client may be booked into, from what the API offered and what ops have picked: the first of each where a pick is no longer open. */
export function slotOf(offered: VisitAvailability, choice: Choice, picked: Picked) {
  const days = offered.days.filter((day) => openWindows(day, choice).length > 0);
  const day = days.find((each) => each.date === picked.date) ?? days[0];
  const windows = day === undefined ? [] : openWindows(day, choice);
  const window = windows.find((each) => each.window === picked.window) ?? windows[0];
  const technicians = window?.technicians ?? [];
  const technician = technicians.some((each) => each.id === picked.technician) ? picked.technician : "";
  return { days, day, windows, window, technicians, technician };
}
