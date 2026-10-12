// Cycle counts' rules (docs/decisions/0185-cycle-counts.md): how often each class is counted, which class an item is
// in until ops say otherwise, and which differences are counted again before the ledger takes them.

export const COUNT_CLASSES = ["weekly", "monthly", "quarterly"] as const;
export type CountClass = (typeof COUNT_CLASSES)[number];

/** Days between one count of a class at a place and the next. */
export const CLASS_DAYS: Readonly<Record<CountClass, number>> = { weekly: 7, monthly: 30, quarterly: 90 };

/** A consumable's difference past this share of what was held is counted again. */
const RECOUNT_ABOVE_PERCENT = 5;

/** An item's class: the one ops set, or its kind's own, a hair system weekly and the rest quarterly. */
export function classOf(set: CountClass | null, hairSystem: boolean): CountClass {
  return set ?? (hairSystem ? "weekly" : "quarterly");
}

/** Whether a count's difference is counted again first: any piece, or more of a consumable than the tolerance. */
export function needsRecount(counted: number, held: number, hairSystem: boolean): boolean {
  const difference = Math.abs(counted - held);
  if (difference === 0) return false;
  if (hairSystem) return true;
  return difference > Math.max(1, (held * RECOUNT_ABOVE_PERCENT) / 100);
}
