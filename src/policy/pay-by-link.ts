// A visit ops book from the console that the client pays for: the slot is held while a Razorpay payment link is
// open, and the visit is booked once it is paid. A visit nothing is paid for at booking, free, on a credit, or a
// consultation and fit in one visit, is booked at once.

import { HOUR_MS, MINUTE_MS } from "../lib/durations.ts";

// Its rules, as the brief states them:
// - What Book a visit in the console covers: every kind, consultation, first fit, one visit, service, replacement. A
//   paid visit goes out as a payment link; a free or credit visit books at once.

export const PAYMENT_LINK_KEYS = ["holds_hours", "closes_before_hours", "pay_within_days"] as const;
/**
 * The longest a console link keeps its slot; how long before the visit it closes at the latest, so the technician
 * knows of the visit in time; and how long a one visit's link takes payment once it is made. Ops set them in Settings.
 */
export type PaymentLinks = Readonly<Record<(typeof PAYMENT_LINK_KEYS)[number], number>>;

export const PAYMENT_LINKS: PaymentLinks = { holds_hours: 24, closes_before_hours: 2, pay_within_days: 14 };

/** Razorpay takes no link that closes sooner than this after it is made. */
const SHORTEST_LINK_MINUTES = 15;

/**
 * When the link stops taking payment and the slot is let go: the hold's end, or its close before the visit,
 * whichever comes first. Null for a visit too close for a link.
 */
export function linkOpenUntil(now: Date, visitStart: Date, links: PaymentLinks = PAYMENT_LINKS): Date | null {
  const dayOn = now.getTime() + links.holds_hours * HOUR_MS;
  const beforeVisit = visitStart.getTime() - links.closes_before_hours * HOUR_MS;
  const until = Math.min(dayOn, beforeVisit);
  if (until < now.getTime() + SHORTEST_LINK_MINUTES * MINUTE_MS) return null;
  return new Date(until);
}
