// What the local stack sells at, as its database holds it: the price book the migrations write, and the hair systems
// scripts/dev/seed-local.ts adds (src/config/local-hair-systems.ts). A test names a price from here, never in figures
// of its own, so a change to the price book is a change here; test/node/tooling/e2e-copy.test.ts holds these to the
// migrated price book. In paise, GST included: the price book charges none today.

import { booking } from "../apps/app/src/content.ts";
import { rupees } from "../packages/web-kit/money.ts";
import { LOCAL_HAIR_SYSTEMS } from "../src/config/local-hair-systems.ts";

export const LOCAL_PRICES = {
  service: 200_000,
  firstFit: 3_000_000,
  replacement: 1_500_000,
  lateFeeFirstFit: 400_000,
  lateFeeReplacement: 300_000,
} as const;

/** Each price as the surfaces write it: "Rs. 2,000". */
export const PRICE = {
  service: rupees(LOCAL_PRICES.service),
  firstFit: rupees(LOCAL_PRICES.firstFit),
  replacement: rupees(LOCAL_PRICES.replacement),
  lateFeeFirstFit: rupees(LOCAL_PRICES.lateFeeFirstFit),
  lateFeeReplacement: rupees(LOCAL_PRICES.lateFeeReplacement),
} as const;

/** The pay step's button for a service visit. */
export const PAY_SERVICE = booking.pay.pay(PRICE.service);

/** A local hair system's price, by its tier. */
export function hairSystemPrice(tier: (typeof LOCAL_HAIR_SYSTEMS)[number]["tier"]): string {
  const system = LOCAL_HAIR_SYSTEMS.find((each) => each.tier === tier);
  return rupees(system?.price ?? 0);
}
