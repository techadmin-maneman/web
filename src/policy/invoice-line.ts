// The one line of a visit's invoice in Books (src/domain/books/books-invoices.ts): its rate, GST included, and its
// discount, which Books takes before tax (docs/decisions/0274-gst-on.md).

/** What the line is worked out from, every amount in paise and GST included unless named before GST. */
export interface LineFigures {
  /** The price book's price on the visit's day, and what its discount code left of it. */
  readonly price: { readonly amount: number; readonly gst_percent: number };
  readonly listed: { readonly amount: number };
  /** What the client paid for the visit; null for a visit no payment names. */
  readonly soldFor: number | null;
  readonly paidWithCredit: boolean;
  /** The GST the line is charged; null while GST is off. */
  readonly gst: number | null;
  /** The discount code's figure before GST; 0 for none. */
  readonly off: number;
}

/**
 * A visit a credit paid for is a line of nothing; one paid at a figure the price no longer lists is a line of what was
 * paid. Any other is the price and its code's part: with no tax, what the code took off the price as paid; with one,
 * Books adds the tax to the discount, so the line names the code's figure before GST, which comes to what was paid
 * where the code is in whole rupees at the price's own GST. Otherwise, as for a visit charged a GST its day's price
 * had not, or a code worth the whole price, the line is what was paid, with no discount: Books keeps a GST-inclusive
 * line's total to the paisa.
 */
export function invoiceLine(figures: LineFigures): { rate: number; discount: number } {
  const { price, listed, soldFor, gst, off } = figures;
  if (figures.paidWithCredit) return { rate: 0, discount: 0 };
  if (soldFor !== null && soldFor !== listed.amount) return { rate: soldFor, discount: 0 };
  if (gst === null) return { rate: price.amount, discount: price.amount - listed.amount };
  if (gst === price.gst_percent && off % 100 === 0) return { rate: price.amount, discount: off };
  return { rate: listed.amount, discount: 0 };
}
