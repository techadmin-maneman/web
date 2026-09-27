// What ops may set a consumable, its expected use and its stock to
// (docs/decisions/0087-consumables-and-stock.md). The console reads these from
// the API, so the bounds under a box and the refusal of a figure past them are
// the same numbers.

export const CONSUMABLE_BOUNDS = {
  /** In paise, for one unit: a sachet or a millilitre never costs Rs. 1,00,000. */
  maxUnitCost: 10_000_000,
  /** How many of a unit a service may be expected to use: the technician's stepper stops here too. */
  maxExpected: 999,
  /** How many a movement may move, and a count may find, at once. */
  maxQuantity: 100_000,
  /** A reorder level, in the consumable's own unit. */
  maxReorderLevel: 100_000,
} as const;

/**
 * A consumable's name, as the technician's step, FSM's catalogue and the
 * console show it: a letter or a digit first, so a spreadsheet never reads it
 * as a formula, then letters, digits, spaces and . , ' ( ) & / + % -.
 */
export const CONSUMABLE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .,'()&/+%-]{0,59}$/u;

/** What one is counted in: strip, ml, sachet, g. */
export const CONSUMABLE_UNIT = /^\p{L}[\p{L} .]{0,19}$/u;

/** Ops' own words on a movement: a supplier's note, what was lost. */
export const MAX_NOTE = 200;
