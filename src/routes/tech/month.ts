// The technician's own month on their phone: the visits they closed in it, by kind and city, and what each earned at
// their rates, as payroll reads it (src/domain/field/pay-statement.ts). Their own lines alone; nobody else's.

import { z } from "@hono/zod-openapi";
import { payStatement } from "../../domain/field/pay-statement.ts";
import { VISIT_PAY_KINDS } from "../../domain/field/technician-pay.ts";
import type { App } from "../../http/context.ts";
import { errorResponse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { techRoute } from "../../http/session-routes.ts";
import { technicianOf } from "../../http/technician-session.ts";
import { indiaDate } from "../../lib/india-time.ts";

const MonthSchema = z
  .object({
    month: z.string().openapi({ description: "India's month, as YYYY-MM." }),
    lines: z.array(
      z
        .object({
          kind: z.enum(VISIT_PAY_KINDS),
          city: z.union([z.string(), z.null()]),
          visits: z.number().int(),
          rate: z
            .union([z.number().int(), z.null()])
            .openapi({ description: "Paise a visit; null where none was in force." }),
          amount: z.union([z.number().int(), z.null()]).openapi({ description: "Paise in all; null where none was." }),
        })
        .strict(),
    ),
  })
  .strict()
  .openapi("TechnicianMonth", {
    description: "The visits closed in the month, by kind and city, at the rate in force.",
  });

const monthRoute = techRoute({
  method: "get",
  path: "/api/tech/month",
  summary: "The technician's visits in a month, and what they earned at their rates",
  request: {
    query: z.object({
      month: z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .optional()
        .openapi({ description: "YYYY-MM; this month when left out." }),
    }),
  },
  responses: {
    200: { description: "The month", ...json(MonthSchema) },
    400: errorResponse("invalid_request: month is YYYY-MM"),
    401: errorResponse("session_required; device_revoked; technician_inactive: ops switched the technician off"),
  },
});

export function registerTechMonth(app: App): void {
  app.openapi(monthRoute, async (c) => {
    const month = c.req.valid("query").month ?? indiaDate(c.var.deps.now()).slice(0, 7);
    const lines = await payStatement(c.env.DB, month, technicianOf(c).technicianId);
    return c.json(
      {
        month,
        lines: lines.map((line) => ({
          kind: line.kind,
          city: line.city,
          visits: line.visits,
          rate: line.rate,
          amount: line.amount,
        })),
      },
      200,
    );
  });
}
