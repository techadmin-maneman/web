// Demand and recent launches under Areas (src/domain/clients/pincode-demand.ts, ADR 0224): the pincodes to open next,
// by those waiting and those who looked them up, and the pincodes launched in the last thirty days.

import { z } from "@hono/zod-openapi";
import { nextToOpen, recentLaunches } from "../../domain/clients/pincode-demand.ts";
import type { App } from "../../http/context.ts";
import { errorResponse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { opsRoute } from "../../http/session-routes.ts";

const nextRoute = opsRoute({
  method: "get",
  path: "/api/pincode-demand/next",
  summary: "The pincodes not served, most waiting first, then most looked up in the last ninety days",
  request: { query: z.object({ most: z.coerce.number().int().min(1).max(100).default(20) }) },
  responses: {
    200: {
      description: "The pincodes, in order",
      ...json(
        z
          .object({
            pincodes: z.array(
              z
                .object({
                  pincode: z.string(),
                  city: z.union([z.string(), z.null()]),
                  area: z.union([z.string(), z.null()]),
                  district: z.union([z.string(), z.null()]),
                  state: z.union([z.string(), z.null()]),
                  waiting: z.number().int(),
                  looked: z.number().int().openapi({ description: "Lookups on the site in the last ninety days." }),
                })
                .strict(),
            ),
          })
          .strict()
          .openapi("NextToOpen"),
      ),
    },
    400: errorResponse("invalid_request: most outside 1 to 100"),
  },
});

const recentRoute = opsRoute({
  method: "get",
  path: "/api/pincode-launches/recent",
  summary: "The pincodes served from a day in the last thirty, with who was told and what has been booked there",
  responses: {
    200: {
      description: "The launches, newest first",
      ...json(
        z
          .object({
            launches: z.array(
              z
                .object({
                  pincode: z.string(),
                  area: z.string(),
                  city: z.string(),
                  launched_on: z.iso.date(),
                  told: z.number().int(),
                  booked: z
                    .number()
                    .int()
                    .openapi({ description: "Visits booked there since, cancelled ones left out." }),
                })
                .strict(),
            ),
          })
          .strict()
          .openapi("RecentLaunches"),
      ),
    },
  },
});

export function registerPincodeDemand(app: App): void {
  app.openapi(nextRoute, async (c) => {
    const { most } = c.req.valid("query");
    return c.json({ pincodes: await nextToOpen(c.env.DB, c.var.deps.now(), most) }, 200);
  });

  app.openapi(recentRoute, async (c) => c.json({ launches: await recentLaunches(c.env.DB, c.var.deps.now()) }, 200));
}
