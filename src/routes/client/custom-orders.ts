// A client's custom orders, for their Home (docs/decisions/0177-custom-orders-in-the-app.md):
//
//   GET /api/me/custom-orders   each order still in hand: where it stands, the day it was promised, and while it waits
//                               for payment, the link to pay by
//
// Their own orders alone, never what the supplier charges us.

import { z } from "@hono/zod-openapi";
import { customOrdersOf } from "../../domain/field/custom-orders.ts";
import { clientOf } from "../../http/client-session.ts";
import type { App } from "../../http/context.ts";
import { clientRoute, signedIn } from "../../http/session-routes.ts";

/** Where an order stands, as the client follows it; one cancelled or refunded is no longer in hand. */
const IN_HAND = ["awaiting_payment", "paid", "ordered", "arrived"] as const;

const OrdersSchema = z
  .object({
    orders: z.array(
      z
        .object({
          number: z.number().int(),
          status: z.enum(IN_HAND),
          promised_on: z.iso.date().nullable(),
          amount: z.number().int().openapi({ description: "What it costs them, in paise." }),
          pay_url: z.string().nullable().openapi({ description: "The link to pay by, while it waits for payment." }),
        })
        .strict(),
    ),
  })
  .strict()
  .openapi("MyCustomOrders");

const ordersRoute = clientRoute({
  method: "get",
  path: "/api/me/custom-orders",
  summary: "The client's custom orders still in hand",
  responses: {
    200: { description: "Their custom orders", content: { "application/json": { schema: OrdersSchema } } },
    ...signedIn,
  },
});

export function registerClientCustomOrders(app: App): void {
  app.openapi(ordersRoute, async (c) => {
    const orders = await customOrdersOf(c.env.DB, clientOf(c).subjectId);
    return c.json(
      {
        orders: orders.flatMap((order) => {
          const status = IN_HAND.find((each) => each === order.status);
          if (status === undefined) return [];
          return [
            {
              number: order.number,
              status,
              promised_on: order.promisedOn,
              amount: order.amount,
              pay_url: status === "awaiting_payment" ? order.shortUrl : null,
            },
          ];
        }),
      },
      200,
    );
  });
}
