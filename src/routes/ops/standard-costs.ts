// What each hair system costs us, behind Access (Finance; docs/decisions/0152-standard-costs.md).

import { createRoute, z } from "@hono/zod-openapi";
import { COSTED_KINDS, productCosts, setProductCost } from "../../domain/money/standard-costs.ts";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { indiaDate } from "../../lib/india-time.ts";

/** The most one hair system may cost, in paise: a guard against a figure typed a hundred times too big. */
const MOST_COST = 100_000_000;

const ProductCostsSchema = z
  .object({
    products: z.array(
      z
        .object({
          item: z.enum(COSTED_KINDS),
          tier: z.string(),
          name: z.string(),
          cost: z
            .union([z.number().int(), z.null()])
            .openapi({ description: "Paise before GST; null while none is set." }),
          since: z.union([z.string(), z.null()]).openapi({ description: "The day the cost stands from." }),
        })
        .strict(),
    ),
  })
  .strict()
  .openapi("ProductCosts");

const listRoute = createRoute({
  method: "get",
  path: "/api/standard-costs",
  summary: "Each first fit and replacement product still sold, with what it costs us today",
  responses: {
    200: { description: "The products", ...json(ProductCostsSchema) },
    403: errorResponse("access_required"),
  },
});

const setRoute = createRoute({
  method: "post",
  path: "/api/standard-costs",
  summary: "Set what a product costs us, from today",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            item: z.enum(COSTED_KINDS),
            tier: z.string().min(1).max(32),
            cost: z.number().int().min(0).max(MOST_COST).openapi({ description: "Paise before GST." }),
          })
          .strict()
          .openapi("ProductCostChange"),
      ),
    },
  },
  responses: {
    200: { description: "Set; the products as they now stand", ...json(ProductCostsSchema) },
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such product still sold"),
  },
});

export function registerOpsStandardCosts(app: App): void {
  app.openapi(listRoute, async (c) =>
    c.json({ products: await productCosts(c.env.DB, indiaDate(c.var.deps.now())) }, 200),
  );

  app.openapi(setRoute, async (c) => {
    const now = c.var.deps.now();
    const today = indiaDate(now);
    const set = await setProductCost(c.env.DB, {
      ...c.req.valid("json"),
      today,
      actor: actorOf(c),
      requestId: c.var.requestId,
      now,
    });
    if (set === "not_found") return refuse(c, "not_found");
    return c.json({ products: await productCosts(c.env.DB, today) }, 200);
  });
}
