// A day's money, behind Access (Ops Console, board D1; src/domain/day-money.ts):
//   GET /api/payments?date=   what was collected and refunded, and each charge
//
// Nothing here takes or gives back money. The figures are read from the rows
// Razorpay's webhook already wrote, so this route cannot make the books say
// something the payments do not.
//
// Two of the board's three figures it can answer whole. The third, "Charges and
// no-shows", it cannot: a no-show is ruled on and never priced, so what was
// kept is added and the no-shows are counted beside it rather than being given
// an amount nothing recorded. Nothing records a dispute either, and no client
// can raise one, so `dispute` is always null: the board's Refund and Uphold
// rule on a record that is still to be built (docs/open-points.md, item 57).

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { dayMoney } from "../domain/day-money.ts";
import { errorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { indiaDate } from "../lib/india-time.ts";

/** As many lines as the board can usefully hold; past this the day is not one to read on a card. */
const LIMIT = 200;

const paise = (description: string) =>
  z
    .number()
    .int()
    .openapi({ description: `In paise. ${description}` });

const ChargeSchema = z
  .object({
    id: z.uuid().openapi({ description: "The change's or the case's own id." }),
    kind: z.enum(["late_cancellation", "no_show"]),
    person: z
      .union([z.object({ id: z.uuid(), name: z.string() }).strict(), z.null()])
      .openapi({ description: "Null for a visit FSM never matched to one of our people." }),
    amount: z.union([paise("What was kept."), z.null()]).openapi({
      description:
        "Null on a no-show: ops record the ruling and nothing records an amount, because the charge itself is applied at P2-M5.",
    }),
    at: z.iso.datetime().openapi({ description: "When the client cancelled, or when ops ruled on the no-show." }),
    visit_started_at: z.union([z.iso.datetime(), z.null()]).openapi({ description: "When the visit was to start." }),
    change: z
      .union([z.enum(["cancelled", "moved"]), z.null()])
      .openapi({ description: "How the client ended the visit; null on a no-show, where they ended nothing." }),
    technician: z
      .union([z.string(), z.null()])
      .openapi({ description: "Who attended and found nobody in; null on a late cancellation." }),
  })
  .strict()
  .openapi("OpsCharge");

const DayMoneySchema = z
  .object({
    date: z.iso.date().openapi({ description: "India's calendar date the figures cover." }),
    collected: paise('Captured on the day: the board\'s "Collected today".'),
    refunds_processing: paise('Asked for on the day and not back with the client yet: "Refunds processing".'),
    refunded: paise("Processed by Razorpay on the day, which the board draws no figure of its own for."),
    charged: paise(
      'Kept from the client on the day: "Charges and no-shows", less the no-shows, which carry no amount.',
    ),
    no_shows_charged: z.number().int().openapi({
      description:
        "How many no-shows ops ruled charged on the day. Counted and not added, because nothing records what one was charged (docs/open-points.md, item 57).",
    }),
    dispute: z.null().openapi({
      description:
        "The charge under dispute, with the note ops write on it. Nothing records a dispute and no client can raise one, so this is always null (docs/open-points.md, item 57).",
    }),
    charges: z.array(ChargeSchema).openapi({ description: "No-shows and late cancellations, the earliest first." }),
  })
  .strict()
  .openapi("OpsDayMoney", { description: "Derived at read time from the payments themselves; no total is kept." });

const dayRoute = createRoute({
  method: "get",
  path: "/api/payments",
  summary: "A day's money: what was collected, what went back, and each charge kept or ruled on",
  request: {
    query: z.object({
      date: z.iso.date().optional().openapi({ description: "India's calendar date; today when it is left out." }),
    }),
  },
  responses: {
    200: { description: "The day", ...json(DayMoneySchema) },
    400: errorResponse("invalid_request"),
    403: errorResponse("access_required"),
  },
});

export function registerOpsPayments(app: App): void {
  app.openapi(dayRoute, async (c) => {
    const { date } = c.req.valid("query");
    const money = await dayMoney(c.env.DB, date ?? indiaDate(c.var.deps.now()), LIMIT);
    return c.json({ ...money, dispute: null }, 200);
  });
}
