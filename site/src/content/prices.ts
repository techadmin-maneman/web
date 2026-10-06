// The only rupee figures the site holds itself (docs/decisions/0073-prices-from-the-price-book.md). Every price the
// site and the landing give is a hole in its sentence, "{firstFit}, then {service} a month", which the price book
// fills (src/lib/prices.ts). Amounts are in paise before GST, as the book keeps them.
//
// A first fit has no figure here. It is priced only as the hair systems ops offer in the console, so a page is built
// without one, and mm-site's Worker gives it once the book prices a hair system.

/** The prices a page gives: each hair system's first fit, cheapest first, a service visit and a replacement. */
export interface SitePrices {
  readonly firstFits: readonly number[];
  readonly service: number;
  readonly replacement: number;
}

/**
 * The service visit and the replacement as a page is built: the price book's own figures (migration 0018). mm-site's Worker writes the book's figures over them on every page it serves, so a visitor sees
 * these only where the book could not be read: the local build, the browser tests, and a page served while mm-api was
 * not answering.
 */
export const BUILT_PRICES: SitePrices = { firstFits: [], service: 200_000, replacement: 1_500_000 };
