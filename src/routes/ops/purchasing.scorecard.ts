// The supplier scorecard, behind Access (docs/decisions/0172-supplier-scorecard.md):
//   GET /api/supplier-scorecard    each supplier's year: on time in full, lead time against promised, what arrived
//                                  damaged or failed its check, and its claims
//
// Read with Operations VIEW.

import { createRoute, z } from "@hono/zod-openapi";
import { supplierScores } from "../../domain/field/supplier-scorecard.ts";
import type { App } from "../../http/context.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { errorResponse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";

const Percent = z.number().int().min(0).max(100).nullable();
const Days = z.number().nullable();

const ScoreSchema = z.object({
  supplier_id: z.string(),
  name: z.string(),
  currency: z.string(),
  orders: z.number().int(),
  on_time_in_full_percent: Percent,
  lead_days: Days,
  promised_days: Days,
  failed_check_percent: Percent,
  damaged_percent: Percent,
  claims_settled: z.number().int(),
  claims_accepted: z.number().int(),
  credited: z.number().int().openapi({ description: "What was credited, in the supplier's currency's smallest unit." }),
});

const scorecardRoute = createRoute({
  method: "get",
  path: "/api/supplier-scorecard",
  summary: "Each supplier's last year: on time in full, lead time, quality and claims",
  responses: {
    200: {
      description: "The scorecard",
      ...json(z.object({ suppliers: z.array(ScoreSchema) }).openapi("SupplierScorecard")),
    },
    403: errorResponse("access_required"),
  },
});

export function registerOpsScorecard(app: App): void {
  app.openapi(scorecardRoute, async (c) => {
    const scores = await supplierScores(c.env.DB, c.var.deps.now(), (await opsInputs(c)).scorecardDays);
    return c.json(
      {
        suppliers: scores.map((score) => ({
          supplier_id: score.supplierId,
          name: score.name,
          currency: score.currency,
          orders: score.orders,
          on_time_in_full_percent: score.onTimeInFull,
          lead_days: score.leadDays,
          promised_days: score.promisedDays,
          failed_check_percent: score.failedPercent,
          damaged_percent: score.damagedPercent,
          claims_settled: score.claims.settled,
          claims_accepted: score.claims.accepted,
          credited: score.claims.credited,
        })),
      },
      200,
    );
  });
}
