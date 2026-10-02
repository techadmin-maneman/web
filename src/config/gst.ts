// GST arithmetic, in paise. The rate is always the one a price was sold at:
// there is no default, so nothing is split at a rate nobody recorded.

/** The part of a GST-inclusive amount before GST. */
export function exGst(amount: number, percent: number): number {
  return Math.round((amount * 100) / (100 + percent));
}

/** An ex-GST amount with GST added. */
export function withGst(amountExGst: number, percent: number): number {
  return Math.round((amountExGst * (100 + percent)) / 100);
}
