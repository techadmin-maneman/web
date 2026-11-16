// The packages a client compares in their app (docs/decisions/0211-packages.md; the redesign's gap G2): each package
// sold today, in ops' order, with what its first fit, replacement and service visit cost in the client's city, the
// first fit of the hair system made to them where their profile matches one, and how often it is serviced and replaced.
// The words about each stay in the app's content.

import type { Price } from "../money/price-lookup.ts";
import { pricedFor, visitPriceOf } from "./client-prices.ts";
import { offeredProducts } from "./services.ts";

export interface PackageOffered {
  readonly code: string;
  readonly name: string;
  readonly first_fit: Price;
  /** Null where the price book holds no replacement or service visit for it, which ops set before it is sold. */
  readonly replacement: Price | null;
  readonly service_visit: Price | null;
  readonly service_every_days: number;
  readonly replace_after_months: number;
}

interface Figures {
  code: string;
  service_every_days: number;
  replace_after_months: number;
}

/** The packages sold on `on`, priced for this client in their city, in the order ops gave them. */
export async function packagesOffered(
  db: D1Database,
  client: { readonly personId: string; readonly on: string; readonly city: string | null },
): Promise<PackageOffered[]> {
  const offered = await pricedFor(db, await offeredProducts(db, client.on, client.city), client);
  if (offered.length === 0) return [];
  const { results } = await db
    .prepare(
      `SELECT code, service_every_days, replace_after_months FROM packages
       WHERE code IN (SELECT value FROM json_each(?1))`,
    )
    .bind(JSON.stringify(offered.map((service) => service.tier)))
    .all<Figures>();
  const figures = new Map(results.map((row) => [row.code, row]));
  const priced = (type: "replacement" | "service", tier: string) =>
    visitPriceOf(db, { type, tier, on: client.on, city: client.city, personId: client.personId });
  return Promise.all(
    offered.flatMap((service) => {
      const of = figures.get(service.tier);
      if (of === undefined) return [];
      return [
        (async (): Promise<PackageOffered> => ({
          code: service.tier,
          name: service.name,
          first_fit: service.price,
          replacement: await priced("replacement", service.tier),
          service_visit: await priced("service", service.tier),
          service_every_days: of.service_every_days,
          replace_after_months: of.replace_after_months,
        }))(),
      ];
    }),
  );
}
