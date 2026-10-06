// What a Books receipt says the money was for: its description of supply, which Books prints under the amount. The
// Books pass records it with the payment (src/domain/books/books-sync.ts).

import { shortDate } from "@maneman/web-kit/dates";
import { VISIT_TYPE_NAMES, type VisitType } from "../../config/visit-types.ts";
import { indiaDate } from "../../lib/india-time.ts";

/** A captured payment, with the visit or the booking it paid for, as the Books pass reads it. */
export interface PaymentPaidFor {
  readonly kind: "visit" | "late_fee";
  readonly captured_at: string;
  /** The kind of visit it paid for, or of the booking, which is not a visit yet; null where neither is known. */
  readonly visit_type: VisitType | null;
  /** When the visit starts; null for a booking that is not a visit yet. */
  readonly visit_start: string | null;
  /** The booking's day in India, for one that is not a visit yet. */
  readonly visit_day: string | null;
}

/**
 * "Advance for First fit, Sat 3 Oct" for a visit paid before it starts, as every booking is; "First fit, Sat 3 Oct"
 * for one paid at the visit, by link; "Late fee, First fit, Sat 3 Oct" for what moving a visit late cost.
 */
export function supplyOf(payment: PaymentPaidFor): string {
  if (payment.visit_type === null) return "Payment";
  const day = payment.visit_start === null ? payment.visit_day : indiaDate(new Date(payment.visit_start));
  const name = VISIT_TYPE_NAMES[payment.visit_type];
  const visit = day === null ? name : `${name}, ${shortDate(day)}`;
  if (payment.kind === "late_fee") return `Late fee, ${visit}`;
  const paidAtTheVisit = payment.visit_start !== null && payment.captured_at >= payment.visit_start;
  return paidAtTheVisit ? visit : `Advance for ${visit}`;
}
