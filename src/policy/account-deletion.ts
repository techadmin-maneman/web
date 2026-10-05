// What deleting an account deletes, and when (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rule as the prompt states it, and what stands in its way. A request is decided in the console
// (src/domain/deletion.ts); the erasure that follows, which deletes the photographs at once and blanks the person
// while the invoices stay in Books, is src/domain/erasure.ts.

import { VISIT_LIVE } from "../config/statuses.ts";

export const RULES = [
  "Photographs deleted within 7 days (config); invoices kept 8 years (config). Both need counsel's sign-off before launch, and the design flags this.",
] as const;

/** A request to delete an account is decided within this many days of it (docs/decisions/0049-dpdp.md). */
export const DELETION_DECIDED_WITHIN_DAYS = 7;

/**
 * Ours, not the prompt's (docs/decisions/0066-erasure-all-or-nothing.md): an
 * account is not erased while a visit of theirs is still to happen, or a booking
 * of theirs is paid for or free but not yet a visit; while we hold a payment of
 * theirs with no visit behind it, or owe them a cancelled visit's refund; or
 * while a payment link of theirs is unpaid.
 * Erasing then would send a technician to nobody, keep money owed back, or leave
 * Razorpay asking an erased client to pay. Ops settle each first.
 */
export const LIVE_VISIT_STATUSES = VISIT_LIVE;

export type ErasureRefusal = "visit_booked" | "payment_held" | "payment_owed";

/**
 * Why the account cannot be erased yet: a visit or booking first, since cancelling it settles its payment too, then a
 * held payment, then an unpaid link. Null when nothing stands in the way.
 */
export function erasureRefusal(held: {
  readonly visits: readonly unknown[];
  readonly bookings: readonly unknown[];
  readonly payments: readonly unknown[];
  readonly links: readonly unknown[];
}): ErasureRefusal | null {
  if (held.visits.length > 0 || held.bookings.length > 0) return "visit_booked";
  if (held.payments.length > 0) return "payment_held";
  if (held.links.length > 0) return "payment_owed";
  return null;
}
