// The prices the public site publishes, from the price book, as they stand today
// in India (docs/decisions/0073-prices-from-the-price-book.md). mm-site's
// Worker writes them into each page that shows a price, and the booking form
// asks for them itself where the Worker could not.
//
//   GET /api/published-prices    the standard tier's first fit, service visit and replacement

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../app.ts";
import { priceOf } from "../domain/price-book.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { indiaDate } from "../lib/india-time.ts";
import { PriceSchema } from "./client-booking.ts";

const PublishedPricesSchema = z
  .object({
    on: z.iso.date().openapi({ description: "The day in India these are in force." }),
    tier: z.literal("standard").openapi({ description: "The one tier the price book holds (ADR 0025, item 35)." }),
    first_fit: PriceSchema,
    service: PriceSchema,
    replacement: PriceSchema,
  })
  .strict()
  .openapi("PublishedPrices");

export const publishedPricesRoute = createRoute({
  method: "get",
  path: "/api/published-prices",
  summary: "The prices the site publishes, from the price book, in force today. Cacheable for a minute.",
  responses: {
    200: { description: "The prices", content: { "application/json": { schema: PublishedPricesSchema } } },
    503: errorResponse("unavailable: the book lacks one of them, so the site shows its own"),
  },
});

export function registerPublishedPrices(app: App): void {
  app.openapi(publishedPricesRoute, async (c) => {
    const on = indiaDate(c.var.deps.now());
    // The consultation is free in the site's own words, and a late fee is not published.
    const [firstFit, service, replacement] = await Promise.all([
      priceOf(c.env.DB, "first_fit", on),
      priceOf(c.env.DB, "service", on),
      priceOf(c.env.DB, "replacement", on),
    ]);
    if (firstFit === null || service === null || replacement === null) {
      c.var.log.warn("published_price_missing", { on });
      return c.json(errorBody("unavailable", c.var.requestId), 503);
    }
    const prices = { on, tier: "standard" as const, first_fit: firstFit, service, replacement };
    return c.json(prices, 200, { "Cache-Control": "public, max-age=60" });
  });
}
