// A client's bookings that ops made, held on their payment link (src/domain/booking/held-bookings.ts), for their Home:
// so a client can always find the link and pay it, whether or not it reached them by text.

import { z } from "@hono/zod-openapi";
import { VISIT_TYPES } from "../../config/visit-types.ts";
import { heldBookingsOf } from "../../domain/booking/held-bookings.ts";
import { clientOf } from "../../http/client-session.ts";
import type { App } from "../../http/context.ts";
import { json } from "../../http/openapi.ts";
import { clientRoute, signedIn } from "../../http/session-routes.ts";

const HeldSchema = z
  .object({
    held: z.array(
      z
        .object({
          type: z.enum(VISIT_TYPES),
          date: z.iso.date(),
          starts_at: z.iso
            .datetime()
            .nullable()
            .openapi({ description: "Its start; null for one held before starts." }),
          amount: z.number().int().openapi({ description: "What it costs them, in paise." }),
          pay_url: z.string().openapi({ description: "The link to pay by." }),
          open_until: z.string().openapi({ description: "When it is held until; then its time goes back." }),
        })
        .strict(),
    ),
  })
  .strict()
  .openapi("MyHeldBookings");

const heldRoute = clientRoute({
  method: "get",
  path: "/api/me/held-bookings",
  summary: "The client's bookings held until they pay the link ops sent",
  responses: {
    200: { description: "Their bookings held on a link, soonest first", ...json(HeldSchema) },
    ...signedIn,
  },
});

export function registerClientHeldBookings(app: App): void {
  app.openapi(heldRoute, async (c) => {
    const held = await heldBookingsOf(c.env.DB, clientOf(c).subjectId, c.var.deps.now());
    return c.json(
      {
        held: held.map((each) => ({
          type: each.type,
          date: each.date,
          starts_at: each.startsAt,
          amount: each.amount,
          pay_url: each.url,
          open_until: each.openUntil,
        })),
      },
      200,
    );
  });
}
