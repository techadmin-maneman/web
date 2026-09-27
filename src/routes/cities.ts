import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { listCities } from "../domain/cities.ts";
import { errorResponse } from "../http/errors.ts";

export const CitySchema = z
  .object({
    name: z.string(),
    served: z.boolean().openapi({ description: "false: the booking form offers the waitlist instead." }),
  })
  .strict()
  .openapi("City");

export const citiesRoute = createRoute({
  method: "get",
  path: "/api/cities",
  summary: "The booking form's city list, in display order. Cacheable for five minutes.",
  responses: {
    200: { description: "Active cities", content: { "application/json": { schema: z.array(CitySchema) } } },
    503: errorResponse("The database is unavailable"),
  },
});

export function registerCities(app: App): void {
  app.openapi(citiesRoute, async (c) => {
    const cities = await listCities(c.env.DB);
    return c.json(cities, 200, { "Cache-Control": "public, max-age=300" });
  });
}
