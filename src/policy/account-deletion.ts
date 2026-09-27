// What deleting an account deletes, and when (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rule as the prompt states it, and what stands in its way. A request is decided in the console
// (src/domain/deletion.ts); the erasure that follows, which deletes the photographs at once and blanks the person
// while the invoices stay in Books, is src/domain/erasure.ts.

export const RULES = [
  "Photographs deleted within 7 days (config); invoices kept 8 years (config). Both need counsel's sign-off before launch, and the design flags this.",
] as const;

/** A request to delete an account is decided within this many days of it (docs/decisions/0049-dpdp.md). */
export const DELETION_DECIDED_WITHIN_DAYS = 7;

/**
 * Ours, not the prompt's (docs/decisions/0066-erasure-all-or-nothing.md): an
 * account is not erased while a visit of theirs is still to happen, or while we
 * hold a payment of theirs with no visit behind it. Erasing then would send a
 * technician to nobody, or keep money owed back. Ops cancel the visit, or
 * refund the payment, first.
 */
export const LIVE_VISIT_STATUSES = ["scheduled", "dispatched", "in_progress"] as const;

export type ErasureRefusal = "visit_booked" | "payment_held";

/** Why the account cannot be erased yet, a booked visit before a held payment; null when nothing stands in the way. */
export function erasureRefusal(held: {
  readonly visits: readonly unknown[];
  readonly payments: readonly unknown[];
}): ErasureRefusal | null {
  if (held.visits.length > 0) return "visit_booked";
  if (held.payments.length > 0) return "payment_held";
  return null;
}
