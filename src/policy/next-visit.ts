// The next visit, offered in the app and booked by the client (docs/decisions/0086-the-next-visit-is-offered.md;
// ADR 0025, items 68 and 69; docs/owner-answers-2026-09-27.md, "Booking"). Nothing books a visit for the client and
// the technician books none: the app offers the first fit once the consultation is done, and the next service
// once a first fit, a service or a replacement is done; a WhatsApp reminder follows while nothing is booked, and
// the Tasks board asks ops to step in after that.
//
// Every figure here is ops' to set, as the one input `booking_days` of Settings · Rules
// (docs/decisions/0061-ops-editable-inputs.md). These are the committed ones, which stand until ops set another.
// A day is India's calendar day (src/lib/india-time.ts), and a visit's day is the day in India it started on.

import { windowsFor, type BookingWindow } from "../config/scheduling.ts";
import { addDays } from "../lib/india-time.ts";

export const RULES = [
  "the app offers the next service the moment a first fit, a service or a replacement closes, due 30 days later; a WhatsApp reminder follows 7 days before it is due, and an At-risk client task 7 days after.",
  "The client books it; the technician does not.",
  "A replacement is booked and paid in the app like any other visit.",
  "the fit may be booked as soon as the consultation is completed; the gap becomes a console setting starting at 0 days, so a lead time can be set later without a release.",
  "the fit is booked and paid in the app after the consultation, and ops see any request not yet booked on the Tasks board.",
  "the horizon becomes a console setting starting at 45 days (item 12), so a service due in 30 days can be booked the day the last visit closes.",
  "overdue hair system offered on the earlier of its own due date and the service due date",
] as const;

/** The figures, each in days, in the order Settings · Rules lists them. */
export const NEXT_VISIT_DAY_KEYS = [
  // From the consultation's day to the first day a first fit may be booked on (open point 70).
  "first_fit_lead",
  // From the last first fit, service or replacement to the next service's due day.
  "service_cadence",
  // Before the due day, the WhatsApp reminder, while nothing is booked.
  "reminder_before_due",
  // After the due day, the At-risk client task, while nothing is booked (board D2's own group).
  "at_risk_after_due",
  // After the consultation, the First fit to book task, for a client not fitted since and with nothing booked.
  "first_fit_to_book",
  // How far ahead a visit may be booked in the app, counted from tomorrow.
  "horizon",
  // How long a newly issued invoice is Home's prompt (open point 46).
  "invoice_prompt",
] as const;
export type NextVisitDayKey = (typeof NEXT_VISIT_DAY_KEYS)[number];
export type NextVisitDays = Readonly<Record<NextVisitDayKey, number>>;

export const NEXT_VISIT_DAYS: NextVisitDays = {
  first_fit_lead: 0,
  service_cadence: 30,
  reminder_before_due: 7,
  at_risk_after_due: 7,
  // A week after the consultation: ours, since nobody has ruled how long a consulted client may wait to be called.
  first_fit_to_book: 7,
  horizon: 45,
  invoice_prompt: 14,
};

/** What ops may set each figure to. */
export const NEXT_VISIT_DAY_BOUNDS: Readonly<Record<NextVisitDayKey, { readonly min: number; readonly max: number }>> =
  {
    first_fit_lead: { min: 0, max: 30 },
    service_cadence: { min: 14, max: 90 },
    // Never before the visit it follows: the reminder goes a day after it at the soonest (src/domain/next-visit.ts).
    reminder_before_due: { min: 1, max: 14 },
    at_risk_after_due: { min: 1, max: 60 },
    first_fit_to_book: { min: 1, max: 60 },
    // Never shorter than the date strip's fortnight (board C2), which the app always shows whole.
    horizon: { min: 14, max: 90 },
    invoice_prompt: { min: 1, max: 60 },
  };

/** The kinds of visit the app offers next: the first fit after a consultation, then a service or a replacement. */
export type NextVisitType = "first_fit" | "service" | "replacement";

const later = (a: string, b: string) => (a > b ? a : b);
const sooner = (a: string, b: string) => (a < b ? a : b);

/** The day the next service falls due: the day the last first fit, service or replacement was done, plus the cadence. */
export const serviceDue = (lastVisitDay: string, days: NextVisitDays): string =>
  addDays(lastVisitDay, days.service_cadence);

/**
 * What the next visit is: a service, or the replacement where the piece in wear falls due on or before the day the
 * service would be. The owner's words for it: "If the client's piece falls due before, offer the replacement instead."
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
export interface NextVisitDue {
  readonly type: "service" | "replacement";
  readonly dueOn: string;
  readonly offeredOn: string;
}

/**
 * The visit after a first fit, a service or a replacement. The service falls due `service_cadence` days after the
 * last visit. Where the piece in wear falls due on or before the day the service is offered, the replacement is
 * offered instead: due on the piece's own day, and offered on the earlier of the two due days.
 */
export function nextVisitAfter(
  lastVisitDay: string,
  pieceDueDay: string | null,
  tomorrow: string,
  days: NextVisitDays,
): NextVisitDue {
  const serviceDueDay = serviceDue(lastVisitDay, days);
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
 * The days a last visit may have been done on for its next service to be reminded of today: those whose service is
 * due from today to `reminder_before_due` days from now, and never the visit done today.
 */
export function remindedIfDoneBetween(today: string, days: NextVisitDays): { from: string; to: string } {
  return {
    from: addDays(today, -days.service_cadence),
    to: sooner(addDays(today, days.reminder_before_due - days.service_cadence), addDays(today, -1)),
  };
}

/** The day a client with nothing booked becomes an At-risk client task: `at_risk_after_due` days past the due day. */
export const atRiskFrom = (lastVisitDay: string, days: NextVisitDays): string =>
  addDays(serviceDue(lastVisitDay, days), days.at_risk_after_due);

/** The latest day a last visit may have been done on for its client to be at risk today. */
export const atRiskIfDoneBy = (today: string, days: NextVisitDays): string =>
  addDays(today, -(days.service_cadence + days.at_risk_after_due));

/** The day a client consulted and not fitted, with nothing booked, becomes a First fit to book task. */
export const firstFitToBookFrom = (consultationDay: string, days: NextVisitDays): string =>
  addDays(consultationDay, days.first_fit_to_book);

/** The latest day a consultation may have been done on for its first fit to be a task today. */
export const firstFitToBookIfConsultedBy = (today: string, days: NextVisitDays): string =>
  addDays(today, -days.first_fit_to_book);
