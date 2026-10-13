// Cycle counts' rules (docs/decisions/0185-cycle-counts.md): how often each class is counted, which class an item is
// in until ops say otherwise, and which differences are counted again before the ledger takes them.

export const COUNT_CLASSES = ["weekly", "monthly", "quarterly"] as const;
export type CountClass = (typeof COUNT_CLASSES)[number];

export const CYCLE_COUNT_KEYS = [...COUNT_CLASSES, "recount_above_percent"] as const;
/**
 * The days between one count of each class at a place and the next, and the share of what was held past which a
 * consumable's difference is counted again. Ops set them in Settings.
 */
export type CycleCounts = Readonly<Record<(typeof CYCLE_COUNT_KEYS)[number], number>>;

export const CYCLE_COUNTS: CycleCounts = { weekly: 7, monthly: 30, quarterly: 90, recount_above_percent: 5 };

/** Each class's days, as the counts due read them. */
export const classDaysOf = (counts: CycleCounts): Readonly<Record<CountClass, number>> => ({
  weekly: counts.weekly,
  monthly: counts.monthly,
  quarterly: counts.quarterly,
});

/** An item's class: the one ops set, or its kind's own, a hair system weekly and the rest quarterly. */
export function classOf(set: CountClass | null, hairSystem: boolean): CountClass {
  return set ?? (hairSystem ? "weekly" : "quarterly");
}

/** Whether a count's difference is counted again first: any piece, or more of a consumable than the tolerance. */
export function needsRecount(
  counted: number,
  held: number,
  hairSystem: boolean,
  counts: CycleCounts = CYCLE_COUNTS,
): boolean {
  const difference = Math.abs(counted - held);
  if (difference === 0) return false;
  if (hairSystem) return true;
  return difference > Math.max(1, (held * counts.recount_above_percent) / 100);
}
