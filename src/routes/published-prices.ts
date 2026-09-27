// The prices the public site publishes, from the price book, as they stand today
// in India (docs/decisions/0073-prices-from-the-price-book.md). mm-site's
// Worker writes them into each page that shows a price, and the booking form
// asks for them itself where the Worker could not.
//
//   GET /api/published-prices    the standard services' first fit, service visit and replacement, and every service
//
// The site draws two columns, Standard and Premium: each kind's service coded
// standard, and its service coded premium where the console offers one
// (docs/decisions/0085-services-ops-can-edit.md). Every service offered today
// is in the answer, so the site takes what it draws from it.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { STANDARD_TIER, VISIT_TYPES, type VisitType } from "../config/visit-types.ts";
import { offeredServices } from "../domain/services.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { indiaDate } from "../lib/india-time.ts";
import { PriceSchema } from "./client-booking.ts";

const PublishedPricesSchema = z
  .object({
    on: z.iso.date().openapi({ description: "The day in India these are in force." }),
    tier: z.literal("standard").openapi({ description: "The tier of the three figures below: each kind's standard." }),
    first_fit: PriceSchema,
    service: PriceSchema,
    replacement: PriceSchema,
    services: z
      .array(
        z
          .object({
            type: z.enum(VISIT_TYPES),
            tier: z.string().openapi({ description: "Its code within its kind: standard, premium, or another." }),
            name: z.string(),
            minutes: z.number().int(),
            price: PriceSchema,
          })
          .strict()
          .openapi("PublishedService"),
      )
      .openapi({ description: "Every service offered and priced today, a kind at a time, in the console's order." }),
  })
  .strict()
  .openapi("PublishedPrices");

export const publishedPricesRoute = createRoute({
  method: "get",
  path: "/api/published-prices",
  summary: "The prices the site publishes, from the price book, in force today. Cacheable for a minute.",
  responses: {
    200: { description: "The prices", content: { "application/json": { schema: PublishedPricesSchema } } },
    503: errorResponse("unavailable: the book lacks a standard one of them, so the site shows its own"),
  },
});

export function registerPublishedPrices(app: App): void {
  app.openapi(publishedPricesRoute, async (c) => {
    const on = indiaDate(c.var.deps.now());
    const offered = await offeredServices(c.env.DB, on);
    const standard = (kind: VisitType) =>
      offered.find((service) => service.kind === kind && service.tier === STANDARD_TIER)?.price ?? null;
    // The consultation is free in the site's own words, and a late fee is not published.
    const [firstFit, service, replacement] = [standard("first_fit"), standard("service"), standard("replacement")];
    if (firstFit === null || service === null || replacement === null) {
      c.var.log.warn("published_price_missing", { on });
      return c.json(errorBody("unavailable", c.var.requestId), 503);
    }
    const services = offered.map((each) => ({
      type: each.kind,
      tier: each.tier,
      name: each.name,
      minutes: each.minutes,
      price: each.price,
    }));
    const prices = { on, tier: "standard" as const, first_fit: firstFit, service, replacement, services };
    return c.json(prices, 200, { "Cache-Control": "public, max-age=60" });
  });
}
