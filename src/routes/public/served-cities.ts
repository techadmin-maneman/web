// The cities the site says it comes to: each with a pincode ops serve, in the console's order, and the areas served in
// each. mm-site's Worker writes them into the home page's answer, the areas page and each city's page, so a launch
// reaches the site without a rebuild.

import { createRoute, z } from "@hono/zod-openapi";
import { servedCities } from "../../domain/cities/served-cities.ts";
import type { App } from "../../http/context.ts";

const ServedCitiesSchema = z
  .object({
    cities: z.array(z.string()).openapi({ description: "Each city with a pincode ops serve, in the console's order." }),
    areas: z.record(z.string(), z.array(z.string())).openapi({
      description: "Each of those cities' areas, as a client would recognise them, from its served pincodes, A to Z.",
    }),
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
  app.openapi(servedCitiesRoute, async (c) =>
    c.json(await servedCities(c.env.DB), 200, { "Cache-Control": "public, max-age=60" }),
  );
}
