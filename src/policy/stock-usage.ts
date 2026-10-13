// Usage against expected, and shrinkage (docs/decisions/0186-usage-and-shrinkage.md): how far a technician's use runs
// over what their visits were expected to use, which technicians and kits are flagged, and how much of what left a
// place was lost.

export const STOCK_USAGE_KEYS = ["days", "over_percent", "min_visits", "write_offs"] as const;
/**
 * The days the Usage page looks back over; the share over expected, across at least so many visits, past which a
 * technician is flagged; and the write-offs in the window that flag a kit. Ops set them in Settings.
 */
export type StockUsage = Readonly<Record<(typeof STOCK_USAGE_KEYS)[number], number>>;

export const STOCK_USAGE: StockUsage = { days: 28, over_percent: 20, min_visits: 5, write_offs: 3 };

/** How far use ran over expected, as a share of expected; below nought where it ran under. Null with nothing expected. */
export function overPercent(used: number, expected: number): number | null {
  if (expected <= 0) return null;
  return Math.round((100 * (used - expected)) / expected);
}

/** Whether a technician runs above expected, past the share and over enough visits to say so. */
export function technicianFlagged(over: number | null, visits: number, usage: StockUsage = STOCK_USAGE): boolean {
  return over !== null && over > usage.over_percent && visits >= usage.min_visits;
}

/** Whether a kit keeps needing write-offs. */
export function kitFlagged(kind: string, writeOffs: number, usage: StockUsage = STOCK_USAGE): boolean {
  return kind === "kit" && writeOffs >= usage.write_offs;
}

/** What was lost, counted short or written off, as a share of all that left the place, to a tenth. Null if nothing left. */
export function shrinkagePercent(lost: number, left: number): number | null {
  if (left <= 0) return null;
  return Math.round((1000 * lost) / left) / 10;
}

/** The share of a place's counted lines right the first time. Null with none counted. */
export function countAccuracyPercent(right: number, lines: number): number | null {
  if (lines <= 0) return null;
  return Math.round((100 * right) / lines);
}
