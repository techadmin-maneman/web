// A client's ask for a hair system made to order (docs/decisions/0253-replacement-when-due-and-change-of-hair-system.md,
// decision 6): sent by the app as it says the client's size is made to order, kept once while open, and a task on the
// board until ops close it.

import { z } from "@hono/zod-openapi";
import { askToOrder } from "../../domain/booking/made-to-order-asks.ts";
import { bookable } from "../../http/client-booking.ts";
import { clientOf } from "../../http/client-session.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { clientRoute } from "../../http/session-routes.ts";
import { addDays, indiaDate } from "../../lib/india-time.ts";
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
    422: errorResponse(
      "not_made_to_order: booking the visit would not answer made_to_order: the client may not book it now, no such " +
        "package is on sale, or their size of it is in stock",
    ),
  },
});

export function registerClientMadeToOrder(app: App): void {
  app.openapi(askRoute, async (c) => {
    const { type, tier } = c.req.valid("json");
    const personId = clientOf(c).subjectId;
    const now = c.var.deps.now();
    // Kept only where booking it would answer made to order, by the rule the days and the hold refuse it by.
    const why = await bookable(c, personId, { type, tier }, addDays(indiaDate(now), 1));
    if (why !== "made_to_order") return refuse(c, "not_made_to_order");
    return c.json(await askToOrder(c.env.DB, { personId, kind: type, tier, now }), 201);
  });
}
