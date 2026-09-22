// GST on what Mane Man sells. A placeholder at the standard 18% on everything
// until the CA's answers set each item's rate and code (docs/open-points.md,
// item 2); the price book (P2-M5) then carries a rate per item.

export const GST_PERCENT = 18;

/** The part of a GST-inclusive amount before GST, in paise. */
export function exGst(amount: number, percent: number = GST_PERCENT): number {
  return Math.round((amount * 100) / (100 + percent));
}
