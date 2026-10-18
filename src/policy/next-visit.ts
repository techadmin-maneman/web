// The next visit, offered in the app and booked by the client (docs/decisions/0086-the-next-visit-is-offered.md;
// ADR 0025, items 68 and 69; docs/archive/owner-answers-2026-09-27.md, "Booking"). Nothing books a visit for the client and
// the technician books none: the app offers the first fit once the consultation is done, and the next service
// once a first fit, a service or a replacement is done; a WhatsApp reminder follows while nothing is booked, and
// the Tasks board asks ops to step in after that.
//
// Every figure here is ops' to set, as the one input `booking_days` of Settings · Rules
// (docs/decisions/0061-ops-editable-inputs.md). These are the committed ones, which stand until ops set another. How
// often a service visit falls due is each package's (src/policy/packages.ts), given here as `every`, in days.
// A day is India's calendar day (src/lib/india-time.ts), and a visit's day is the day in India it started on.

import { windowsFor, type BookingWindow } from "../config/scheduling.ts";
import { addDays } from "../lib/india-time.ts";

/** The figures, each in days, in the order Settings · Rules lists them. */
export const NEXT_VISIT_DAY_KEYS = [
  // From the consultation's day to the first day a first fit may be booked on (open point 70).
  "first_fit_lead",
  // Before the due day, the WhatsApp reminder, while nothing is booked.
  "reminder_before_due",
  // After the due day, the At-risk client task, while nothing is booked.
  "at_risk_after_due",
  // After the consultation, the First fit to book task, for a client not fitted since and with nothing booked.
  "first_fit_to_book",
  // How far ahead a visit may be booked in the app, counted from tomorrow.
  "horizon",
  // How long a newly issued invoice is Home's prompt (open point 46).
  "invoice_prompt",
  // Before a hair system falls due, the Replacement order task: time to order one made to measure.
  "replacement_order_lead",
] as const;
export type NextVisitDayKey = (typeof NEXT_VISIT_DAY_KEYS)[number];
export type NextVisitDays = Readonly<Record<NextVisitDayKey, number>>;

export const NEXT_VISIT_DAYS: NextVisitDays = {
  first_fit_lead: 0,
  reminder_before_due: 7,
  at_risk_after_due: 7,
  // A week after the consultation: ours, since nobody has ruled how long a consulted client may wait to be called.
  first_fit_to_book: 7,
  horizon: 45,
  invoice_prompt: 14,
  // The supplier takes about a month to make one.
  replacement_order_lead: 30,
};

/** What ops may set each figure to. */
export const NEXT_VISIT_DAY_BOUNDS: Readonly<Record<NextVisitDayKey, { readonly min: number; readonly max: number }>> =
  {
    first_fit_lead: { min: 0, max: 30 },
    // Never before the visit it follows: the reminder goes a day after it at the soonest (src/domain/visits/next-visit.ts).
    reminder_before_due: { min: 1, max: 14 },
    at_risk_after_due: { min: 1, max: 60 },
    first_fit_to_book: { min: 1, max: 60 },
    // Never shorter than the booking sheet's fortnight of dates, which the app always shows whole.
    horizon: { min: 14, max: 90 },
    invoice_prompt: { min: 1, max: 60 },
    replacement_order_lead: { min: 1, max: 90 },
  };

/** The kinds of visit the app offers next: the first fit after a consultation, then a service or a replacement. */
export type NextVisitType = "first_fit" | "service" | "replacement";

const later = (a: string, b: string) => (a > b ? a : b);
const sooner = (a: string, b: string) => (a < b ? a : b);

/** The day the next service falls due: the day the last first fit, service or replacement was done, `every` days on. */
export const serviceDue = (lastVisitDay: string, every: number): string => addDays(lastVisitDay, every);

/**
 * What the next visit is: a service, or the replacement where the piece in wear falls due on or before the day the
 * service would be: "If the client's piece falls due before, offer the replacement instead."
 */
export const nextVisitType = (serviceDay: string, pieceDueDay: string | null): "service" | "replacement" =>
  pieceDueDay !== null && pieceDueDay <= serviceDay ? "replacement" : "service";

/** The day the app offers a visit on: its due day, or tomorrow once that has passed. */
export const offeredDay = (dueDay: string, tomorrow: string): string => later(dueDay, tomorrow);

/**
 * The window the next visit is offered in: the window of the visit it follows (for a first fit, the consultation),
 * where a visit of its kind can start in it; null where it cannot, as a first fit cannot in the evening.
 */
export const offeredWindow = (type: NextVisitType, followedWindow: BookingWindow): BookingWindow | null =>
  windowsFor(type).includes(followedWindow) ? followedWindow : null;

/** A fitted client's next visit: what it is, the day it fell or falls due, and the day the app offers it on. */
interface NextVisitDue {
  readonly type: "service" | "replacement";
  readonly dueOn: string;
  readonly offeredOn: string;
}

/**
 * The visit after a first fit, a service or a replacement. The service falls due `every` days after the last visit. Where the piece in wear falls due on or before the day the service is offered, the replacement is
 * offered instead: due on the piece's own day, and offered on the earlier of the two due days.
 */
export function nextVisitAfter(
  lastVisitDay: string,
  pieceDueDay: string | null,
  tomorrow: string,
  every: number,
): NextVisitDue {
  const serviceDueDay = serviceDue(lastVisitDay, every);
  const serviceOfferedOn = offeredDay(serviceDueDay, tomorrow);
  if (pieceDueDay === null || nextVisitType(serviceOfferedOn, pieceDueDay) === "service") {
    return { type: "service", dueOn: serviceDueDay, offeredOn: serviceOfferedOn };
  }
  return {
    type: "replacement",
    dueOn: pieceDueDay,
    offeredOn: offeredDay(sooner(pieceDueDay, serviceDueDay), tomorrow),
  };
}

/** The day a first fit falls due: the consultation's day and the lead time ops set. */
export const firstFitDue = (consultationDay: string, days: NextVisitDays): string =>
  addDays(consultationDay, days.first_fit_lead);

/** The first day a first fit may be booked on: the day it falls due, and never before tomorrow. */
export const firstFitOpens = (consultationDay: string, tomorrow: string, days: NextVisitDays): string =>
  offeredDay(firstFitDue(consultationDay, days), tomorrow);

/**
 * The figures the horizon must reach: the app offers a first fit on the day its lead time ends; a day past the horizon
 * could be offered and never booked. A package's service visit is held to it as ops set it (src/policy/packages.ts).
 */
const WITHIN_HORIZON = ["first_fit_lead"] as const;

/** The figures that reach past the horizon, so the app would offer a day it cannot book; none for figures that fit. */
export const daysPastHorizon = (days: NextVisitDays): NextVisitDayKey[] =>
  WITHIN_HORIZON.filter((key) => days[key] > days.horizon);

/** The last day a visit may be booked on in the app: `horizon` days, counted from tomorrow. */
export const lastBookableDay = (tomorrow: string, days: NextVisitDays): string => addDays(tomorrow, days.horizon - 1);

/**
 * The first day of a date strip `stripDays` long: the day asked for, within the days a visit may be booked on
 * (`opens` to `last`), and early enough for the strip to end by the last where it can.
 */
export function stripStart(
  from: string | undefined,
  { opens, last }: { readonly opens: string; readonly last: string },
  stripDays: number,
): string {
  const latest = addDays(last, -(stripDays - 1));
  const asked = from === undefined || from < opens ? opens : from;
  return later(opens, sooner(asked, latest));
}

/**
 * The days a next service may fall due on for it to be reminded of today: up to `reminder_before_due` days from now,
 * or past its day but its client not yet at risk. A visit done today is never reminded of, whatever its due day.
 */
export function remindedIfDueBetween(today: string, days: NextVisitDays): { from: string; to: string } {
  // A reminder whose day passed unsent still goes, once, until the client is at risk and a task takes over.
  return { from: addDays(today, 1 - days.at_risk_after_due), to: addDays(today, days.reminder_before_due) };
}

/**
 * The days a last visit may have been done on for its next service to be reminded of today, for services due
 * between `least` and `most` days after: the widest the reminders read, each then held to its own due day.
 */
export function remindedIfDoneBetween(
  today: string,
  days: NextVisitDays,
  every: { readonly least: number; readonly most: number },
): { from: string; to: string } {
  const due = remindedIfDueBetween(today, days);
  return { from: addDays(due.from, -every.most), to: sooner(addDays(due.to, -every.least), addDays(today, -1)) };
}

/** The day a client with nothing booked becomes an At-risk client task: `at_risk_after_due` days past the due day. */
export const atRiskFrom = (lastVisitDay: string, days: NextVisitDays, every: number): string =>
  addDays(serviceDue(lastVisitDay, every), days.at_risk_after_due);

/** The latest day a last visit may have been done on for its client to be at risk today, their service `every` days. */
export const atRiskIfDoneBy = (today: string, days: NextVisitDays, every: number): string =>
  addDays(today, -(every + days.at_risk_after_due));

/** The day a client consulted and not fitted, with nothing booked, becomes a First fit to book task. */
export const firstFitToBookFrom = (consultationDay: string, days: NextVisitDays): string =>
  addDays(consultationDay, days.first_fit_to_book);

/**
 * The days the board reads with: a consulted client waits `first_fit_to_book` days to book their first fit themselves
 * before ops are asked to, and none while they cannot, when only ops book it (src/policy/self-serve.ts).
 */
export const boardDays = (days: NextVisitDays, fitsSelfBooked: boolean): NextVisitDays =>
  fitsSelfBooked ? days : { ...days, first_fit_to_book: 0 };

/** The latest day a consultation may have been done on for its first fit to be a task today. */
export const firstFitToBookIfConsultedBy = (today: string, days: NextVisitDays): string =>
  addDays(today, -days.first_fit_to_book);
