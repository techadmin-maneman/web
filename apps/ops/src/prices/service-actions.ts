// What can be done to a service or a late fee on Prices (./Services.tsx), and where each is done: the action open, the
// block it is open in, a service's prices in force and to come, and the book read again with a price changed.

import { longDate } from "@maneman/web-kit/dates";
import type { Kind, LateFee, OpsService, Price, ServiceCatalogue } from "../api.ts";
import { settings } from "../content/settings.ts";
import type { OpsCall } from "../lib/access.ts";
import type { Priced } from "./PriceForms.tsx";

const copy = settings.services;

/** A service's buttons, each named by its words and its label. */
export type ServiceWord = "price" | "rename" | "describe" | "length" | "retire" | "restore" | "up" | "down";

/** The one action open, and the block it is open in. */
export type Action =
  | { readonly kind: "price"; readonly target: Priced }
  | { readonly kind: "correct" | "takeBack"; readonly target: Priced; readonly row: Price }
  | { readonly kind: "rename" | "describe" | "length" | "retire" | "restore"; readonly service: OpsService }
  | { readonly kind: "order"; readonly of: Kind; readonly tiers: readonly string[] }
  | { readonly kind: "add"; readonly of: Kind };

/** The call each action makes: an action is offered only where the person's access reaches its call. */
export const CALL_OF: Readonly<Record<Action["kind"], OpsCall>> = {
  price: "POST /api/prices",
  correct: "POST /api/prices/correct",
  takeBack: "POST /api/prices/withdraw",
  rename: "POST /api/services/{kind}/{tier}/name",
  describe: "POST /api/services/{kind}/{tier}/description",
  length: "POST /api/services/{kind}/{tier}/length",
  retire: "POST /api/services/{kind}/{tier}/retire",
  restore: "POST /api/services/{kind}/{tier}/restore",
  order: "POST /api/services/{kind}/order",
  add: "POST /api/services",
};

/** Where a block is, so an action and what came of it are shown in the one it belongs to. */
export const whereOf = (item: string, tier: string) => `${item}/${tier}`;

export const actionWhere = (action: Action): string => {
  if (action.kind === "order" || action.kind === "add") return action.of;
  if ("target" in action) return whereOf(action.target.item, action.target.tier);
  return whereOf(action.service.kind, action.service.tier);
};

/** The services after a price is set or taken back: each service's and late fee's rows, from the book's answer. */
export function withPrices(services: ServiceCatalogue, prices: readonly Price[]): ServiceCatalogue {
  const rowsOf = (item: string, tier: string) => prices.filter((row) => row.item === item && row.tier === tier);
  return {
    ...services,
    services: services.services.map((service) => ({ ...service, prices: rowsOf(service.kind, service.tier) })),
    late_fees: services.late_fees.map((fee) => ({ ...fee, prices: rowsOf(fee.item, "standard") })),
  };
}

export const asPriced = (service: OpsService): Priced => ({
  item: service.kind,
  tier: service.tier,
  name: service.name,
  prices: service.prices,
});

export const lateFeePriced = (fee: LateFee): Priced => ({
  item: fee.item,
  tier: "standard",
  name: copy.lateFees[fee.item],
  prices: fee.prices,
});
/** When a service stops, or stopped, being offered; nothing while it is offered. */
export function standing(service: OpsService, today: string): string | null {
  if (service.retired_date === null) return null;
  const from = longDate(service.retired_date);
  return service.retired_date > today ? copy.retiring(from) : copy.retired(from);
}

/** A row's own prices: the one in force, those still to come, soonest first, and the spent ones. */
export function pricesOf(target: Priced, today: string) {
  return {
    inForce: target.prices.find((price) => price.in_force),
    toCome: target.prices.filter((price) => price.valid_from > today).reverse(),
    spent: target.prices.filter((price) => !price.in_force && price.valid_from <= today),
  };
}
