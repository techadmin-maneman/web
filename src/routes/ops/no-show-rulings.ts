// Either side of ops' ruling on a no-show, behind Access (src/routes/ops/field.ts rules on it):
//   GET /api/no-shows/:id/charge     what charging the case would keep of the visit's payment, and refund
//   GET /api/no-shows/decided        the cases ruled on today, with their rulings
//
// The charge is asked about once more before it is sent, with these figures, worked out as charging works them out.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { casesDecidedSince } from "../../domain/no-show-rulings.ts";
import { chargePreview } from "../../domain/no-shows.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { routeReach, withinRouteReach } from "../../http/staff-access.ts";
import { indiaDate, indiaInstant } from "../../lib/india-time.ts";

/** As many as one day's rulings could run to. */
const LIMIT = 200;

const ChargePreviewSchema = z
  .object({
    paid: z.number().int().openapi({ description: "In paise: what was paid for the visit and not refunded." }),
    kept: z.number().int().openapi({ description: "In paise: what charging keeps of it. The rest is refunded." }),
    credit_kept: z.boolean().openapi({ description: "Whether charging keeps the credit the visit was paid with." }),
  })
  .strict()
  .openapi("NoShowChargePreview", { description: "What charging the case would do, worked out as charging does." });

const chargePreviewRoute = createRoute({
  method: "get",
  path: "/api/no-shows/{id}/charge",
  summary: "What charging an undecided no-show would keep of the visit's payment, and refund",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: { description: "What a charge would do", ...json(ChargePreviewSchema) },
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such case in the caller's cities, or it was ruled on already"),
  },
});

const DecidedCaseSchema = z
  .object({
    id: z.uuid(),
    person: z
      .union([z.object({ id: z.uuid(), name: z.string() }).strict(), z.null()])
      .openapi({ description: "Whose visit it was; null once they have been erased." }),
    visit_date: z.union([z.iso.date(), z.null()]),
    decision: z.enum(["charged", "waived"]),
    decided_at: z.iso.datetime(),
    charge: z
      .union([
        z
          .object({
            kept: z.number().int().openapi({ description: "In paise: what the charge kept of the visit's payment." }),
            credit_spent: z.boolean().openapi({ description: "Whether the charge spent the credit the visit used." }),
          })
          .strict(),
        z.null(),
      ])
      .openapi({
        description: "What a charge took; null for a waiver, and for a charge ruled before it was recorded.",
      }),
  })
  .strict()
  .openapi("NoShowDecided");

const decidedRoute = createRoute({
  method: "get",
  path: "/api/no-shows/decided",
  summary: "The no-shows in the caller's cities ruled on today in India, the latest first, each with its ruling",
  responses: {
    200: { description: "The day's rulings", ...json(z.object({ cases: z.array(DecidedCaseSchema) }).strict()) },
    403: errorResponse("access_required"),
  },
});

export function registerOpsNoShowRulings(app: App): void {
  app.openapi(chargePreviewRoute, async (c) => {
    const { id } = c.req.valid("param");
    if (!(await withinRouteReach(c, "no_show", id))) return refuse(c, "not_found");
    const preview = await chargePreview(c.env.DB, id, await opsInputs(c));
    if (preview === null) return refuse(c, "not_found");
    return c.json(preview, 200);
  });

  app.openapi(decidedRoute, async (c) => {
    const startOfToday = indiaInstant(indiaDate(c.var.deps.now()), "00:00");
    const cases = await casesDecidedSince(c.env.DB, startOfToday, LIMIT, await routeReach(c));
    return c.json({ cases }, 200);
  });
}
