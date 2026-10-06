// A consultation and the first fit in one visit (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md). How
// such a booking holds no payment is still to be confirmed (open point 90).
//
// The site books it as a first fit marked as one visit, with nothing paid (src/domain/public-booking.ts). The client
// chooses the product with the technician, who fits it from his kit; closing the visit as done sends the client a
// Razorpay payment link for it (src/domain/payment-links.ts). A client who decides against it ends the visit as a
// consultation, with nothing charged.

import { FIRST_FIT_WINDOWS, type BookingWindow } from "../config/scheduling.ts";
import { DAY_MS } from "../lib/durations.ts";
import { FREE_CHANGE_NOTICE_HOURS, type SoldTerms } from "./moving-a-visit.ts";

/** How long a one visit's payment link takes payment, from when Razorpay makes it. */
const PAYMENT_LINK_OPEN_DAYS = 14;

/** When a payment link Razorpay makes at this moment stops taking payment. */
export const paymentLinkClosesAt = (madeAt: Date): Date => new Date(madeAt.getTime() + PAYMENT_LINK_OPEN_DAYS * DAY_MS);

/** The latest a link can have been sent and be closed by `now`. */
export const closedIfSentBy = (now: Date): Date => new Date(now.getTime() - PAYMENT_LINK_OPEN_DAYS * DAY_MS);

/** What the site's form books: the consultation alone, or the consultation and the fit in one visit. */
export const PLANS = ["consultation", "one_visit"] as const;
export type Plan = (typeof PLANS)[number];

/**
 * The windows a one visit can start in: the first fit's, whose three hours do not fit in the evening's half-slots
 * (docs/decisions/0035-window-slot-map.md). An evening visit that ends by 8 pm waits for a visit's minutes to be
 * counted against the day's times.
 */
export const ONE_VISIT_WINDOWS = FIRST_FIT_WINDOWS;

/** Whether a plan's visit can start in a window: the consultation in any, one visit in the morning or the afternoon. */
export function planStartsIn(plan: Plan, window: BookingWindow): boolean {
  if (plan === "consultation") return true;
  return (ONE_VISIT_WINDOWS as readonly BookingWindow[]).includes(window);
}

/** What a one visit is sold under: nothing is charged for missing it or for changing it late. */
export const ONE_VISIT_TERMS: SoldTerms = {
  noticeHours: FREE_CHANGE_NOTICE_HOURS,
  lateCharge: "nothing",
  noShowCharge: "nothing",
};

/**
 * Where a visit booked as one stands: booked until the technician closes it, then fitted, or declined when the client
 * decided against it at the consultation, which makes it a consultation.
 */
export type OneVisitState = "booked" | "fitted" | "declined";

/**
 * What the client decided at the visit, as the technician's piece step records it: the product they chose and were
 * fitted with, whose payment link closing the visit sends, or that they decided against it, which makes
 * the visit a consultation, with nothing to pay.
 */
export type Decision = { readonly declined: true } | { readonly product: string };

/** Whether a visit is paid for at the visit: a one visit still to happen, or one the client was fitted at. */
export const paidAtTheVisit = (state: OneVisitState | null): boolean => state === "booked" || state === "fitted";
