// Paying for a visit (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rule as the prompt states it, and what it means for the tax invoice. The payment is taken in
// src/domain/bookings.ts before anything is booked; the invoice is held or issued in src/domain/fsm-invoices.ts.
//
// A visit is paid for before it happens, so its tax invoice records a sale
// already settled: it must total what the client was sold the visit for. A
// consultation and fit in one visit is the exception the owner ruled on 1
// October 2026: it is paid for at the visit, by a link once the client is
// fitted (src/policy/one-visit.ts), and its invoice is held to the same total.
// An invoice FSM raises is issued only then. Otherwise it stays a draft, which
// can still be corrected or deleted, and ops are told
// (docs/decisions/0070-vendor-correctness.md).

export const RULES = [
  "Every visit is prepaid at booking. Technicians never handle money, and no amount to collect is ever sent to FSM.",
] as const;

/** Why an invoice FSM has raised stays a draft rather than being issued. */
export type InvoiceHold =
  /**
   * A referral credit paid for the visit. How such a visit is invoiced waits
   * for the CA: a zero-priced line, a discount, or no invoice at all
   * (docs/open-points.md, item 14).
   */
  | "paid_with_credit"
  /** FSM's work order totals something other than what the client was sold the visit for. */
  | "price_differs"
  /** Nothing here says what the visit was sold for, so its total cannot be checked. */
  | "price_unknown";

export interface SoldVisit {
  /** What the client was sold the visit for, in paise with GST; null where nothing here knows. */
  readonly soldFor: number | null;
  readonly paidWithCredit: boolean;
}

/** Why the invoice may not be issued; null when it may. An issued invoice is undone only by a credit note. */
export function invoiceHold(invoiceTotal: number, visit: SoldVisit): InvoiceHold | null {
  if (visit.paidWithCredit) return "paid_with_credit";
  if (visit.soldFor === null) return "price_unknown";
  if (invoiceTotal !== visit.soldFor) return "price_differs";
  return null;
}
