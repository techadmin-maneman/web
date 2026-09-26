// The only rupee figures the site holds itself (docs/decisions/0073-prices-from-the-price-book.md). Every price the
// site and the landing give is a hole in its sentence, "{firstFit}, then {service} a month", which the price book
// fills (src/lib/prices.ts). Amounts are in paise before GST, as the book keeps them.

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

/**
 * The owner's Premium figures, as the site has always published them. The price book knows one tier, so these stay
 * here until the owner rules on the tier and gives its prices (ADR 0025, "Which tier the app books";
 * docs/open-points.md, "Which tier a client is booked at").
 */
export const PREMIUM: TierPrices = { first_fit: 4_000_000, service: 200_000, replacement: 3_000_000 };
