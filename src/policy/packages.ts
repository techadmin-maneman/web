// Packages (docs/decisions/0211-packages.md). A package is what a client chooses and stays on: its hair systems,
// each with a price of its own, its service visit, and its replacement. Its first fit is the hair system made to the
// client with a service visit; every visit after is its service visit; and when the hair system falls due, its
// replacement with a service visit. Each part's time, price and how often it falls due are ops' to set.

import type { VisitType } from "../config/visit-types.ts";
import { withGst } from "../config/gst.ts";

/** A price as the book holds it, and with GST, the rate between (src/domain/money/price-lookup.ts). */
interface Price {
  readonly amount_ex_gst: number;
  readonly amount: number;
  readonly gst_percent: number;
}

/** The kinds of visit a package is made of, in the order the console shows them. */
export const PACKAGE_KINDS = ["first_fit", "service", "replacement"] as const satisfies readonly VisitType[];
export type PackageKind = (typeof PACKAGE_KINDS)[number];

export const isPackageKind = (kind: VisitType): kind is PackageKind =>
  (PACKAGE_KINDS as readonly VisitType[]).includes(kind);

/**
 * How often a package's service visit falls due, in days after the visit before: never further than clients may book
 * ahead (`horizon`, src/policy/next-visit.ts), or the app would offer a day it cannot book.
 */
export const SERVICE_EVERY_DAYS = { min: 7, max: 90, start: 30 } as const;

/** How long a package's hair system is worn before its replacement falls due, in months after the fit. */
export const REPLACE_AFTER_MONTHS = { min: 1, max: 36, start: 6 } as const;

/**
 * The name each of a package's services carries, as Books' items and the visit lists read it: the first fit is the
 * package itself, "Mane Man Essential"; the others add their kind, "Mane Man Essential service visit".
 */
export function serviceNameOf(packageName: string, kind: PackageKind): string {
  if (kind === "service") return `${packageName} service visit`;
  if (kind === "replacement") return `${packageName} replacement`;
  return packageName;
}

/**
 * A visit's price from its parts: their prices before GST added up, at the GST of the first, which is what the visit
 * is chiefly for (the hair system, or the replacement). Null where a part has no price: nothing is sold at no price.
 */
export function priceOfParts(parts: readonly (Price | null)[]): Price | null {
  const [principal] = parts;
  if (principal === undefined || principal === null || parts.some((part) => part === null)) return null;
  const amountExGst = parts.reduce((sum, part) => sum + (part?.amount_ex_gst ?? 0), 0);
  return {
    amount_ex_gst: amountExGst,
    amount: withGst(amountExGst, principal.gst_percent),
    gst_percent: principal.gst_percent,
  };
}

/**
 * A visit's price on a day from its package's parts: a first fit's, its cheapest hair system priced and its service
 * visit, the price it is offered from; a replacement's, itself and its service visit; any other visit's, its own.
 */
export function priceByParts(
  kind: VisitType,
  parts: {
    readonly own: Price | null;
    readonly serviceVisit: Price | null;
    readonly hairSystems: readonly (Price | null)[];
  },
): Price | null {
  if (kind === "replacement") return priceOfParts([parts.own, parts.serviceVisit]);
  if (kind !== "first_fit") return parts.own;
  const priced = parts.hairSystems.filter((price): price is Price => price !== null);
  return priceOfParts([lowestPrice(priced), parts.serviceVisit]);
}

/** The price of the cheapest of these, before GST; null for none. */
export const lowestPrice = (prices: readonly Price[]): Price | null =>
  prices.reduce<Price | null>(
    (low, price) => (low === null || price.amount_ex_gst < low.amount_ex_gst ? price : low),
    null,
  );
