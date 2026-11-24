// A place's state in an item, by one rule wherever it shows: Stock's On hand, its figures above it, and a
// technician's Kit tab. In words, never by colour alone.

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

/** The level an item is low at in a place, by its kind, as the server reads it (src/domain/inventory/low-stock.ts). */
export function reorderAt(stock: Stock, consumable: Consumable, placeId: string): number | null {
  const kind = stock.places.find((each) => each.id === placeId)?.kind;
  if (kind === "kit") return consumable.reorder_kit;
  return kind === "warehouse" ? consumable.reorder_central : consumable.reorder_store;
}

/** Whether an open place holds more of a live item than the level it is low at, where one is set. */
export function isEnough(stock: Stock, consumable: Consumable, place: string): boolean {
  if (stateOf(stock, consumable, place) !== null) return false;
  const open = stock.places.find((each) => each.id === place)?.active !== false;
  return open && !consumable.retired && reorderAt(stock, consumable, place) !== null;
}

/**
 * The state in a place's own table: as everywhere, or Enough where it holds more than its level; nothing where the
 * item has no level there, is retired, or the place is closed.
 */
export function PlaceState({ stock, consumable, place }: { stock: Stock; consumable: Consumable; place: string }) {
  const state = stateOf(stock, consumable, place);
  if (state !== null) return <StateBadge state={state} />;
  return isEnough(stock, consumable, place) ? <Badge tone="done">{copy.enough}</Badge> : null;
}
