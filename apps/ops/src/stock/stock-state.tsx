// A place's state in an item, by one rule wherever it shows: Stock's On hand and Needs attention, and a technician's
// Kit tab. In words, never by colour alone.

import { Badge, type BadgeTone } from "@maneman/ui/Badge";
import { type Stock } from "../api.ts";
import { stock as copy } from "../content/stock.ts";
import { holdingOf } from "./holdings.ts";

export type Consumable = Stock["consumables"][number];

export interface State {
  readonly tone: BadgeTone;
  readonly word: string;
  readonly need: "below" | "out" | "low";
}

/**
 * One rule for every place and item, in words, never by colour alone: below zero, which says a movement went
 * unrecorded; out, with none left; low, at or under the item's level for that kind of place. A retired item, or a
 * place no longer in use, is only ever below zero.
 */
export function stateOf(stock: Stock, consumable: Consumable, placeId: string): State | null {
  const holding = holdingOf(stock, consumable.code, placeId);
  const quantity = holding?.quantity ?? 0;
  if (quantity < 0) return { tone: "error", word: copy.belowZero, need: "below" };
  const place = stock.places.find((each) => each.id === placeId);
  if (consumable.retired || place?.active === false) return null;
  if (quantity === 0) return { tone: "error", word: copy.out, need: "out" };
  return holding?.low === true ? { tone: "warning", word: copy.low, need: "low" } : null;
}

export const StateBadge = ({ state }: { state: State | null }) =>
  state === null ? null : <Badge tone={state.tone}>{state.word}</Badge>;
