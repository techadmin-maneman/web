// GST on what Mane Man sells. A placeholder at 5% on everything, as the owner
// set for staging on 22 September 2026, until the CA's answers set each item's
// rate and code (docs/open-points.md, item 2); the price book (P2-M5) then
// carries a rate per item.

export const GST_PERCENT = 5;

/** The part of a GST-inclusive amount before GST, in paise. */
export function exGst(amount: number, percent: number = GST_PERCENT): number {
  return Math.round((amount * 100) / (100 + percent));
}

/** An ex-GST amount with GST added, in paise. */
export function withGst(amountExGst: number, percent: number): number {
  return Math.round((amountExGst * (100 + percent)) / 100);
}
