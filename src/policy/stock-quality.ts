// Failure rates and value at risk (docs/decisions/0188-failure-rates-and-value-at-risk.md): how often fitted pieces
// fail, and how much of a lot its place will not use before it expires.

export const STOCK_QUALITY_KEYS = ["failure_days", "pace_days"] as const;
/** The days of fits the failure rates count, and the days of use a place's pace is read over. Ops set them in Settings. */
export type StockQuality = Readonly<Record<(typeof STOCK_QUALITY_KEYS)[number], number>>;

export const STOCK_QUALITY: StockQuality = { failure_days: 365, pace_days: 28 };

/** The share of pieces fitted that failed, to a tenth. Null with none fitted. */
export function failureRatePercent(failed: number, fitted: number): number | null {
  if (fitted <= 0) return null;
  return Math.round((1000 * failed) / fitted) / 10;
}

export interface HeldLot {
  readonly lotId: string;
  readonly quantity: number;
  /** India's date it expires on. */
  readonly expiresOn: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How much of each lot a place will not use before it expires, using `perDay` and taking the soonest to expire first,
 * as every deduction does: by lot, what is left over when its day comes.
 */
export function unusedByExpiry(lots: readonly HeldLot[], perDay: number, today: string): Map<string, number> {
  const unused = new Map<string, number>();
  let usedSoFar = 0;
  for (const lot of [...lots].sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))) {
    const days = Math.max(0, Math.round((Date.parse(lot.expiresOn) - Date.parse(today)) / DAY_MS));
    const usable = Math.max(0, perDay * days - usedSoFar);
    const used = Math.min(lot.quantity, usable);
    usedSoFar += used;
    if (lot.quantity > used) unused.set(lot.lotId, lot.quantity - used);
  }
  return unused;
}
