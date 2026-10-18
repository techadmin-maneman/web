// What a first fit costs a client (docs/decisions/0211-packages.md): the hair system of the package chosen made to
// their hair profile, and the package's service visit. Until their profile matches one, it is offered from the
// package's cheapest hair system, as every service is priced for anyone (./services.ts).

import type { VisitType } from "../../config/visit-types.ts";
import { lowestPrice, priceOfParts } from "../../policy/packages.ts";
import { latestFits } from "../clients/hair-profiles.ts";
import { hairSystemSpecs, matchingCode } from "../inventory/hair-systems.ts";
import { fitCode } from "../inventory/stock-gap.ts";
import { priceOf, type PriceItem } from "../money/price-book.ts";
import { hairSystemPricesOn } from "../money/hair-system-prices.ts";
import { priceFrom, priceInForce, type Price } from "../money/price-lookup.ts";
import type { PricedService } from "./services.ts";

/** These services, each first fit priced for the client: the hair system made to them and the service visit. */
export async function pricedFor<T extends PricedService>(
  db: D1Database,
  services: readonly T[],
  client: { readonly personId: string; readonly on: string; readonly city: string | null },
): Promise<T[]> {
  if (!services.some((service) => service.kind === "first_fit")) return [...services];
  const [fit, specs, pieces, visits] = await Promise.all([
    latestFits(db, [client.personId]).then((fits) => fits.get(client.personId)),
    hairSystemSpecs(db),
    hairSystemPricesOn(db, client.on, client.city),
    db
      .prepare(
        `SELECT s.tier, ${priceInForce("s.kind", "s.tier", "?1", "?2")} AS price FROM services s WHERE s.kind = 'service'`,
      )
      .bind(client.on, client.city)
      .all<{ tier: string; price: string | null }>(),
  ]);
  if (fit === undefined) return [...services];
  return services.map((service) => {
    if (service.kind !== "first_fit") return service;
    const code = matchingCode(specs, { ...fit, product: service.tier });
    const piece = pieces.find((each) => each.code === code)?.price ?? null;
    const visit = visits.results.find((each) => each.tier === service.tier)?.price ?? null;
    const price = priceOfParts([piece, priceFrom(visit)]);
    return price === null ? service : { ...service, price };
  });
}

/** A visit as it is priced: its kind and service, the day and city it is in, and whose it is. */
interface PricedVisit {
  readonly type: VisitType;
  readonly tier: string;
  readonly on: string;
  readonly city: string | null;
  /** The client, whose hair system a first fit is priced by; null to price it from the package's cheapest. */
  readonly personId: string | null;
}

/**
 * A visit's price on its day, as it is sold: a first fit's the hair system made to the client and the package's
 * service visit, a replacement's the replacement and the service visit, any other its own. Null where a part has none.
 */
export async function visitPriceOf(db: D1Database, visit: PricedVisit): Promise<Price | null> {
  const { on, tier, city } = visit;
  const own = (item: PriceItem, of: string = tier) => priceOf(db, item, { on, tier: of, city });
  if (visit.type === "consultation" || visit.type === "service") return own(visit.type);
  if (visit.type === "replacement") return priceOfParts(await Promise.all([own("replacement"), own("service")]));
  const [code, pieces, serviceVisit] = await Promise.all([
    visit.personId === null ? null : fitCode(db, visit.personId, tier),
    hairSystemPricesOn(db, on, city),
    own("service"),
  ]);
  const ofPackage = pieces.filter((piece) => piece.product === tier);
  const theirs = ofPackage.find((piece) => piece.code === code)?.price ?? null;
  const from = lowestPrice(ofPackage.flatMap((piece) => (piece.price === null ? [] : [piece.price])));
  return priceOfParts([theirs ?? from, serviceVisit]);
}
