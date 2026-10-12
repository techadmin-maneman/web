// How right the forecast was (docs/decisions/0183-forecast-accuracy.md): how far off it ran, which way, and how often
// use stayed within its high case, each over whatever lines are given, an item's or a city's.

/** One stock code in one city in one period: what was expected, its high case, and what was used. */
export interface Measured {
  readonly expected: number;
  readonly high: number;
  readonly actual: number;
}

/** How many past periods the Supply plan shows. */
export const ACCURACY_PERIODS_SHOWN = 12;

const sumOf = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

/** How far off, as a share of what was used: each line's miss added up, over the use. Null where nothing was used. */
export function errorPercent(lines: readonly Measured[]): number | null {
  const used = sumOf(lines.map((line) => line.actual));
  if (used <= 0) return null;
  return Math.round((100 * sumOf(lines.map((line) => Math.abs(line.expected - line.actual)))) / used);
}

/** Which way: above nought where the forecast ran high, below where it ran low. Null where nothing was used. */
export function biasPercent(lines: readonly Measured[]): number | null {
  const used = sumOf(lines.map((line) => line.actual));
  if (used <= 0) return null;
  return Math.round((100 * sumOf(lines.map((line) => line.expected - line.actual))) / used);
}

/** The share of lines whose use stayed within the high case. Null where there are none. */
export function withinHighPercent(lines: readonly Measured[]): number | null {
  if (lines.length === 0) return null;
  return Math.round((100 * lines.filter((line) => line.actual <= line.high).length) / lines.length);
}
