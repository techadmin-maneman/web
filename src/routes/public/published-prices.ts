// The prices the public site publishes, from the price book, as they stand today
// in India (docs/decisions/0073-prices-from-the-price-book.md). mm-site's
// Worker writes them into each page that shows a price, and the booking form
// asks for them itself where the Worker could not.
//
//   GET /api/published-prices    the standard service visit and replacement, and every service offered
//
// A first fit is priced only as the hair systems ops offer in the console: the
// first-fit services among `services`, which the site takes its first-fit
// figures from. With none offered, the site gives no first-fit price, and
// nothing is booked as one.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { STANDARD_TIER, VISIT_TYPES, type VisitType } from "../../config/visit-types.ts";
import { offeredServices } from "../../domain/booking/services.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { PriceSchema } from "../client/booking.ts";

const PublishedPricesSchema = z
  .object({
    on: z.iso.date().openapi({ description: "The day in India these are in force." }),
    tier: z.literal("standard").openapi({ description: "The tier of the two figures below: each kind's standard." }),
    service: PriceSchema,
    replacement: PriceSchema,
    services: z
      .array(
        z
          .object({
            type: z.enum(VISIT_TYPES),
            tier: z.string().openapi({ description: "Its code within its kind." }),
            name: z.string(),
            minutes: z.number().int(),
            price: PriceSchema,
          })
          .strict()
          .openapi("PublishedService"),
      )
      .openapi({
        description:
          "Every service offered and priced today, a kind at a time, in the console's order. A first fit's are the " +
          "hair systems ops offer; none while ops offer none.",
      }),
  })
  .strict()
  .openapi("PublishedPrices");

const publishedPricesRoute = createRoute({
  method: "get",
  path: "/api/published-prices",
  summary: "The prices the site publishes, from the price book, in force today. Cacheable for a minute.",
  responses: {
    200: { description: "The prices", content: { "application/json": { schema: PublishedPricesSchema } } },
    503: errorResponse(
      "unavailable: the book lacks the standard service visit or replacement, so the site shows its own",
    ),
  },
});

export function registerPublishedPrices(app: App): void {
  app.openapi(publishedPricesRoute, async (c) => {
    const on = indiaDate(c.var.deps.now());
    const offered = await offeredServices(c.env.DB, on);
    const standard = (kind: VisitType) =>
      offered.find((service) => service.kind === kind && service.tier === STANDARD_TIER)?.price ?? null;
    // The consultation is free in the site's own words, and a late fee is not published.
    const [service, replacement] = [standard("service"), standard("replacement")];
    if (service === null || replacement === null) {
      c.var.log.warn("published_price_missing", { on });
      return refuse(c, "unavailable");
    }
    const services = offered.map((each) => ({
      type: each.kind,
      tier: each.tier,
      name: each.name,
      minutes: each.minutes,
      price: each.price,
    }));
    const prices = { on, tier: "standard" as const, service, replacement, services };
    return c.json(prices, 200, { "Cache-Control": "public, max-age=60" });
  });
}
