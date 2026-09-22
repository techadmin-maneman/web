// GST on what Mane Man sells, for a payment the price book did not price. Off
// (0%) until production: the owner switched GST off in Books on 22 September
// 2026 so billing works end to end on staging, and turns it on for production
// with the real GSTIN and the CA's rates (docs/open-points.md, items 2 and 3).

export const GST_PERCENT = 0;

/** The part of a GST-inclusive amount before GST, in paise. */
export function exGst(amount: number, percent: number = GST_PERCENT): number {
  return Math.round((amount * 100) / (100 + percent));
}

/** An ex-GST amount with GST added, in paise. */
export function withGst(amountExGst: number, percent: number): number {
  return Math.round((amountExGst * (100 + percent)) / 100);
}
