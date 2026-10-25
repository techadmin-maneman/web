// A package's figures as the list sets them out, a column each (./PackagesScreen.tsx): its cheapest hair system, what
// a first fit costs us, and the margin on it before GST.

import type { Package, PackageHairSystem, ProductCost } from "./packages-api.ts";

/** The cheapest hair system priced today, which a first fit is sold from. */
export function cheapestHairSystem(each: Package): PackageHairSystem | null {
  const priced = each.hair_systems.filter((one) => one.offered && one.price !== null);
  return priced.reduce<PackageHairSystem | null>(
    (cheapest, one) =>
      cheapest === null || (one.price?.amount_ex_gst ?? 0) < (cheapest.price?.amount_ex_gst ?? 0) ? one : cheapest,
    null,
  );
}

/** What a first fit costs us, in paise: the cost ops set for it, else its cheapest hair system's, where it has one. */
export function firstFitCost(each: Package, costs: readonly ProductCost[]): number | null {
  const set = costs.find((one) => one.item === "first_fit" && one.tier === each.code)?.cost ?? null;
  if (set !== null) return set;
  const cheapest = cheapestHairSystem(each);
  return cheapest === null || cheapest.unit_cost === 0 ? null : cheapest.unit_cost;
}

/** A first fit's price before GST less what it costs us, in paise. */
export function firstFitMargin(each: Package, cost: number | null): number | null {
  const from = each.first_fit.from;
  return from === null || cost === null ? null : from.amount_ex_gst - cost;
}
