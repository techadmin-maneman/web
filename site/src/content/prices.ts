// The only rupee figures the site holds itself (docs/decisions/0073-prices-from-the-price-book.md). Every price the
// site and the landing give is a hole in its sentence, "{firstFit}, then {service} a month", which the price book
// fills (src/lib/prices.ts). Amounts are in paise before GST, as the book keeps them.
//
// Premium has no figures here. It is the services ops code premium in the console, priced in the book like any
// other (docs/decisions/0085-services-ops-can-edit.md), so a page is built without it and mm-site's Worker shows it
// once the book prices a premium first fit.

/** A tier's prices: the first fit, a service visit and a replacement. */
export interface TierPrices {
  readonly first_fit: number;
  readonly service: number;
  readonly replacement: number;
}

/**
 * The standard tier as a page is built: the price book's own figures since 22 September 2026 (migration 0018).
 * mm-site's Worker writes the book's figures over them on every page it serves, so a visitor sees these only where
 * the book could not be read: the local build, the browser tests, and a page served while mm-api was not answering.
 */
export const BUILT_STANDARD: TierPrices = { first_fit: 3_000_000, service: 200_000, replacement: 1_500_000 };
