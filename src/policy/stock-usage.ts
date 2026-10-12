// Usage against expected, and shrinkage (docs/decisions/0186-usage-and-shrinkage.md): how far a technician's use runs
// over what their visits were expected to use, which technicians and kits are flagged, and how much of what left a
// place was lost.

/** Days the Usage page looks back over. */
export const USAGE_DAYS = 28;

/** A technician is flagged past this share over expected, across at least so many visits. */
const OVER_FLAG_PERCENT = 20;
const FLAG_MIN_VISITS = 5;

/** A kit is flagged with this many write-offs in the window. */
const WRITE_OFFS_FLAGGED = 3;

/** How far use ran over expected, as a share of expected; below nought where it ran under. Null with nothing expected. */
export function overPercent(used: number, expected: number): number | null {
  if (expected <= 0) return null;
  return Math.round((100 * (used - expected)) / expected);
}

/** Whether a technician runs above expected, past the share and over enough visits to say so. */
export function technicianFlagged(over: number | null, visits: number): boolean {
  return over !== null && over > OVER_FLAG_PERCENT && visits >= FLAG_MIN_VISITS;
}

/** Whether a kit keeps needing write-offs. */
export function kitFlagged(kind: string, writeOffs: number): boolean {
  return kind === "kit" && writeOffs >= WRITE_OFFS_FLAGGED;
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
