// A consultation and the first fit in one visit (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md). The
// owner's ruling D2 of 1 October 2026, with the piece, the payment and the length ruled the same day (ADR 0025, item
// 89), and what the build took for a booking that holds no payment, for the owner to confirm (item 90).
//
// The site books it as a first fit marked as one visit, with nothing paid (src/domain/public-booking.ts). The client
// chooses the product with the technician, who fits it from his kit; closing the visit as done sends the client a
// Razorpay payment link for it (src/domain/payment-links.ts). A client who decides against it ends the visit as a
// consultation, with nothing charged.

import { FIRST_FIT_WINDOWS, type BookingWindow } from "../config/scheduling.ts";
import { FREE_CHANGE_NOTICE_HOURS, type SoldTerms } from "./moving-a-visit.ts";

export const RULES = [
  "Clients can choose one vs. two visits. If they choose consultation, the technician can measure and explain the product with the fit coming in later. If they choose consultation + fit, the technician can fit them their chosen product during the first visit itself",
  "once the client has agreed and been fitted, the technician sends a Razorpay payment link, and nothing is paid if the client decides against it.",
  "a one-visit booking holds no payment, so no no-show charge and no late fee apply to it, and moving or cancelling it is free.",
] as const;

/** What the site's form books: the consultation alone, or the consultation and the fit in one visit. */
export const PLANS = ["consultation", "one_visit"] as const;
export type Plan = (typeof PLANS)[number];

/**
 * The windows a one visit can start in: the first fit's, whose three hours do not fit in the evening's half-slots
 * (docs/decisions/0035-window-slot-map.md). The owner asked on 1 October 2026 for an evening visit that ends by 8 pm,
 * which waits for a visit's minutes to be counted against the day's times (window times, part B).
 */
export const ONE_VISIT_WINDOWS = FIRST_FIT_WINDOWS;

/** Whether a plan's visit can start in a window: the consultation in any, one visit in the morning or the afternoon. */
export function planStartsIn(plan: Plan, window: BookingWindow): boolean {
  if (plan === "consultation") return true;
  return (ONE_VISIT_WINDOWS as readonly BookingWindow[]).includes(window);
}

/** What a one visit is sold under (RULES[2]): nothing is charged for missing it or for changing it late. */
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
 * fitted with, whose payment link closing the visit sends (RULES[1]), or that they decided against it, which makes
 * the visit a consultation, with nothing to pay.
 */
export type Decision = { readonly declined: true } | { readonly product: string };

/** Whether a visit is paid for at the visit: a one visit still to happen, or one the client was fitted at. */
export const paidAtTheVisit = (state: OneVisitState | null): boolean => state === "booked" || state === "fitted";
