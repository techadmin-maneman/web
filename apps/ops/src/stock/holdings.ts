// What each place holds of each item, and each item's unit, looked up by key rather than searched for: the stock
// table asks once a cell, and a list of every holding read once a cell grows with places times items.

import type { Stock } from "../api.ts";

type Holding = Stock["holdings"][number];

interface Index {
  readonly holdings: ReadonlyMap<string, Holding>;
  readonly units: ReadonlyMap<string, string>;
}

/** Each answer's index, made the first time it is asked and let go with the answer. */
const indexes = new WeakMap<Stock, Index>();

const keyOf = (code: string, place: string) => `${code} ${place}`;

function indexOf(stock: Stock): Index {
  const known = indexes.get(stock);
  if (known !== undefined) return known;
  const index = {
    holdings: new Map(stock.holdings.map((each) => [keyOf(each.consumable_code, each.place_id), each])),
    units: new Map(stock.consumables.map((each) => [each.code, each.unit])),
  };
  indexes.set(stock, index);
  return index;
}

/** What a place holds of an item; undefined where it has never held any. */
export const holdingOf = (stock: Stock, code: string, place: string): Holding | undefined =>
  indexOf(stock).holdings.get(keyOf(code, place));

/** The unit an item is counted in; "" for an item the answer does not name. */
export const unitOf = (stock: Stock, code: string): string => indexOf(stock).units.get(code) ?? "";
