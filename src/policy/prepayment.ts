// Paying for a visit (docs/prompts/phase2-backend.md, "Business rules, decided").
// Every visit is prepaid at booking, and technicians never handle money: what that means for the tax invoice. The payment is taken in
// src/domain/bookings.ts before anything is booked; the invoice is held or issued in src/domain/books-invoices.ts.
//
// A visit is paid for before it happens, so its tax invoice records a sale
// already settled: it must total what the client was sold the visit for. A
// consultation and fit in one visit is the exception: it is paid for at the visit, by a link once the client is
// fitted (src/policy/one-visit.ts), and its invoice is held to the same total.
// An invoice raised in Books is issued only then. Otherwise it stays a draft, which
// can still be corrected or deleted, and ops are told
// (docs/decisions/0070-vendor-correctness.md).

/** Why an invoice raised in Books stays a draft rather than being issued. */
export type InvoiceHold =
  /**
   * A referral credit paid for the visit. How such a visit is invoiced waits
   * for the CA: a zero-priced line, a discount, or no invoice at all
   * (docs/open-points.md, item 14).
   */
  | "paid_with_credit"
  /**
   * Booked on a referral credit the client no longer had by then, so nothing paid for it, and ops were told to decide
   * the charge (src/domain/bookings.ts). The invoice waits on their decision.
   */
  | "credit_missing"
  /** The invoice totals something other than what the client was sold the visit for. */
  | "price_differs"
  /** Nothing here says what the visit was sold for, so its total cannot be checked. */
  | "price_unknown";

export interface SoldVisit {
  /** What the client was sold the visit for, in paise with GST; null where nothing here knows. */
  readonly soldFor: number | null;
  readonly paidWithCredit: boolean;
  /** Booked on a credit, and no credit paid for it. */
  readonly creditMissing: boolean;
}

/** Why the invoice may not be issued; null when it may. An issued invoice is undone only by a credit note. */
export function invoiceHold(invoiceTotal: number, visit: SoldVisit): InvoiceHold | null {
  if (visit.paidWithCredit) return "paid_with_credit";
  if (visit.creditMissing) return "credit_missing";
  if (visit.soldFor === null) return "price_unknown";
  if (invoiceTotal !== visit.soldFor) return "price_differs";
  return null;
}
