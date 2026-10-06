// The visit the site books on a day, for the forms (./public-consultation.ts) and the windows they offer
// (./open-windows.ts).

import type { SoldTerms } from "../../policy/moving-a-visit.ts";
import { type Plan, ONE_VISIT_TERMS } from "../../policy/one-visit.ts";
import type { Price } from "../money/price-book.ts";
import type { HeldService } from "./hold-slot.ts";
import { offeredProducts, bookableService } from "./services.ts";

/** What the site holds a slot for: the service, what is paid for it now, and the terms it is sold under. */
export interface SiteVisit {
  readonly service: HeldService;
  readonly price: Price;
  /** Left out for a consultation, which is sold under the committed terms. */
  readonly terms: SoldTerms | undefined;
}

/** Nothing paid now, at the service's own rate of GST. */
const nothingPaid = (price: Price): Price => ({ amount: 0, amount_ex_gst: 0, gst_percent: price.gst_percent });

/**
 * What the site books on a day: the consultation its kind offers, the standard one while it is
 * (docs/decisions/0085-services-ops-can-edit.md), and only while it is free, since a form with no payment cannot
 * book one the price book charges for; or, for one visit, a first fit held as the first hair system the console
 * offers, for its length, with nothing paid until the client chooses theirs and is fitted
 * (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md). Null when the day offers neither, and what the
 * person asked for waits for ops.
 */
export async function siteVisit(db: D1Database, plan: Plan, date: string): Promise<SiteVisit | null> {
  if (plan === "one_visit") {
    const [fit] = await offeredProducts(db, date);
    if (fit === undefined) return null;
    return {
      service: { type: "first_fit", tier: fit.tier, minutes: fit.minutes },
      price: nothingPaid(fit.price),
      terms: ONE_VISIT_TERMS,
    };
  }
  const consultation = await bookableService(db, "consultation", undefined, date);
  if (consultation?.price.amount !== 0) return null;
  return {
    service: { type: "consultation", tier: consultation.tier, minutes: consultation.minutes },
    price: consultation.price,
    terms: undefined,
  };
}
