// A client's ask for a hair system made to order (docs/decisions/0253-replacement-when-due-and-change-of-hair-system.md,
// decision 6): sent by the app as it says the client's size is made to order, kept once while open, and a task on the
// board until ops close it.

import { z } from "@hono/zod-openapi";
import { askToOrder } from "../../domain/booking/made-to-order-asks.ts";
import { clientOf } from "../../http/client-session.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { clientRoute } from "../../http/session-routes.ts";
import { PRICE_TIER } from "../../policy/services.ts";

const askRoute = clientRoute({
  method: "post",
  path: "/api/me/made-to-order",
  summary: "Ask ops to order a hair system made to the client's size",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            type: z.enum(["first_fit", "replacement"]).openapi({ description: "The visit it is asked at." }),
            tier: z.string().regex(PRICE_TIER).openapi({ description: "The package whose hair system it is." }),
          })
          .strict()
          .openapi("MadeToOrderAsk"),
      ),
    },
  },
  responses: {
    201: {
      description: "Kept, or already open: ops order it and message the client",
      ...json(
        z
          .object({ requested_at: z.iso.datetime().openapi({ description: "When it was first asked." }) })
          .strict()
          .openapi("MadeToOrderAsked"),
      ),
    },
    400: errorResponse("invalid_request: see error.fields"),
    401: errorResponse("session_required"),
    422: errorResponse("not_made_to_order: no such package, or the client's size of it is not made to order"),
  },
});

export function registerClientMadeToOrder(app: App): void {
  app.openapi(askRoute, async (c) => {
    const { type, tier } = c.req.valid("json");
    const asked = await askToOrder(c.env.DB, {
      personId: clientOf(c).subjectId,
      kind: type,
      tier,
      now: c.var.deps.now(),
    });
    return asked === null ? refuse(c, "not_made_to_order") : c.json(asked, 201);
  });
}
