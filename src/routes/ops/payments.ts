// A day's money, behind Access (src/domain/money/day-money.ts):
//   GET /api/payments?date=   what was collected and refunded, and each charge
//
// Nothing here takes or gives back money. The figures are read from the rows
// Razorpay's webhook already wrote, so this route cannot make the books say
// something the payments do not.
//
// The third figure, "Charges and no-shows", adds what each late cancellation and
// each charged no-show kept, which the charge records as ops rule
// (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md). The board's
// disputed charge is GET /api/no-shows/disputes, since a dispute belongs to no day.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { dayMoney } from "../../domain/money/day-money.ts";
import { errorResponse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { routeReach } from "../../http/staff-access.ts";
import { indiaDate } from "../../lib/india-time.ts";

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
      .openapi({ description: "Null for a visit with no client of ours." }),
    amount: z.union([paise("What was kept."), z.null()]).openapi({
      description: "Null on a no-show charged before a charge recorded what it kept (migration 0059).",
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
      'Kept from the client on the day: "Charges and no-shows", each late cancellation and charged no-show by what it kept.',
    ),
    charges: z.array(ChargeSchema).openapi({ description: "No-shows and late cancellations, the earliest first." }),
  })
  .strict()
  .openapi("OpsDayMoney", { description: "Derived at read time from the payments themselves; no total is kept." });

const dayRoute = createRoute({
  method: "get",
  path: "/api/payments",
  summary: "A day's money in the caller's cities: what was collected, what went back, and each charge kept or ruled on",
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
    const money = await dayMoney(c.env.DB, date ?? indiaDate(c.var.deps.now()), LIMIT, await routeReach(c));
    return c.json(money, 200);
  });
}
