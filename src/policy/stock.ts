// Stock of consumables, in each technician's kit and the central store
// (docs/decisions/0087-consumables-and-stock.md). Stock is kept in our own
// ledger, which deducts what a job used whether or not an invoice is sent: a free consultation or a credit visit
// deducts too.
//
// What a place holds is the sum of its rows in stock_movements, never a figure
// anyone sets, so a count or a correction is a row of its own and the ledger
// always explains the number. The database keeps that sum in stock_balances as
// each row is written, so it is read without the rows (migration 0053).

/** A place is low at or below its reorder level; a place with no level set is never low. */
export const isLow = (held: number, level: number | null): boolean => level !== null && held <= level;

/** A count writes the difference between what was counted and what the rows said: nought when they agree. */
export const countDifference = (counted: number, held: number): number => counted - held;

/**
 * The movements a job's use still needs, by consumable: what the technician's
 * latest step says he used, less what his kit's rows for the job already took.
 * The first step takes the whole amount; a later step corrects by the
 * difference; the same step again, however often it is replayed, takes
 * nothing more. Negative is taken out of the kit, positive given back.
 */
export function useStillToRecord(
  used: ReadonlyMap<string, number>,
  recorded: ReadonlyMap<string, number>,
): Map<string, number> {
  const owed = new Map<string, number>();
  for (const code of new Set([...used.keys(), ...recorded.keys()])) {
    const difference = -(used.get(code) ?? 0) - (recorded.get(code) ?? 0);
    if (difference !== 0) owed.set(code, difference);
  }
  return owed;
}
