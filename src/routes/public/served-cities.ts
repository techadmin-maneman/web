// The cities the site says it comes to: each with a pincode ops serve, in the console's order. mm-site's Worker
// writes them into the home page's answer and the areas page, so a launch reaches the site without a rebuild.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";

const ServedCitiesSchema = z
  .object({
    cities: z.array(z.string()).openapi({ description: "Each city with a pincode ops serve, in the console's order." }),
  })
  .strict()
  .openapi("ServedCities");

const servedCitiesRoute = createRoute({
  method: "get",
  path: "/api/served-cities",
  summary: "The cities the site says it comes to. Cacheable for a minute.",
  responses: { 200: { description: "The cities", content: { "application/json": { schema: ServedCitiesSchema } } } },
});

export function registerServedCities(app: App): void {
  app.openapi(servedCitiesRoute, async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT p.city FROM serviceable_pincodes p LEFT JOIN cities k ON k.name = p.city
       WHERE p.served = 1
       GROUP BY p.city ORDER BY MIN(COALESCE(k.sort, 1000)), p.city`,
    ).all<{ city: string }>();
    return c.json({ cities: results.map((row) => row.city) }, 200, { "Cache-Control": "public, max-age=60" });
  });
}
