// A visit ops book from the console that the client pays for: the slot is held while a Razorpay payment link is
// open, and the visit is booked once it is paid. A visit nothing is paid for at booking, free, on a credit, or a
// consultation and fit in one visit, is booked at once.

import { HOUR_MS, MINUTE_MS } from "../lib/durations.ts";

// Its rules, as the brief states them:
// - What Book a visit in the console covers: every kind, consultation, first fit, one visit, service, replacement. A
//   paid visit goes out as a payment link; a free or credit visit books at once.

/** The longest a link keeps the slot. PLACEHOLDER until the owner rules. */
const LINK_OPEN_HOURS = 24;

/** A link closes this long before the visit at the latest, so the technician knows of the visit in time. PLACEHOLDER. */
const LINK_CLOSES_BEFORE_VISIT_HOURS = 2;

/** Razorpay takes no link that closes sooner than this after it is made. */
const SHORTEST_LINK_MINUTES = 15;

/**
 * When the link stops taking payment and the slot is let go: a day on, or two hours before the visit, whichever comes
 * first. Null for a visit too close for a link.
 */
export function linkOpenUntil(now: Date, visitStart: Date): Date | null {
  const dayOn = now.getTime() + LINK_OPEN_HOURS * HOUR_MS;
  const beforeVisit = visitStart.getTime() - LINK_CLOSES_BEFORE_VISIT_HOURS * HOUR_MS;
  const until = Math.min(dayOn, beforeVisit);
  if (until < now.getTime() + SHORTEST_LINK_MINUTES * MINUTE_MS) return null;
  return new Date(until);
}
