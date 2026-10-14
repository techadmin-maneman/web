// The supply plan, behind Access (docs/decisions/0180-supply-plan.md).
//
// Read with Operations VIEW, decided and drafted with MANAGE. Each write answers the whole of GET's answer.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { MAX_NOTE } from "../../config/consumables.ts";
import { draftPlan } from "../../domain/purchasing/supply-plan.ts";
import { approvePlanLine, planLines, rejectPlanLine, type Decided } from "../../domain/purchasing/supply-plan-lines.ts";
import { actorOf } from "../../http/audit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { opsInputs } from "../../http/ops-inputs.ts";

const LineSchema = z.object({
  id: z.string(),
  kind: z.enum(["transfer", "order"]),
  consumable_code: z.string(),
  name: z.string(),
  city: z.string().nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  supplier: z.string().nullable(),
  proposed: z.number().int(),
  quantity: z.number().int().nullable(),
  usable: z.number().int(),
  need: z.number(),
  safety: z.number(),
  state: z.enum(["proposed", "approved", "rejected"]),
  reject_reason: z.string().nullable(),
  po_number: z.number().int().nullable(),
});

const PLAN = {
  description: "The supply plan",
  ...json(z.object({ lines: z.array(LineSchema) }).openapi("SupplyPlan")),
};
const ACCESS = errorResponse("access_required");
const linePath = { params: z.object({ id: z.string().min(1).max(64) }) };
const LINE_ANSWERS = {
  200: PLAN,
  400: errorResponse("invalid_request: fields names what the move was refused for, as stock moved since"),
  403: ACCESS,
  404: errorResponse("not_found: no such line"),
  409: errorResponse("order_state: the line is decided already"),
};

const planRoute = createRoute({
  method: "get",
  path: "/api/supply-plan",
  summary: "The latest supply plan, each line with the figures behind it",
  responses: { 200: PLAN, 403: ACCESS },
});

const draftRoute = createRoute({
  method: "post",
  path: "/api/supply-plan/draft",
  summary: "The supply plan drafted again now, from the latest forecast",
  responses: { 200: PLAN, 403: ACCESS, 409: errorResponse("order_state: no forecast has run yet") },
});

const approveRoute = createRoute({
  method: "post",
  path: "/api/supply-plan/lines/{id}/approve",
  summary: "A proposal approved at a quantity: its transfer sent, or its order drafted",
  request: {
    ...linePath,
    body: {
      required: true,
      ...json(
        z
          .object({ quantity: z.number().int().min(1).max(1_000_000) })
          .strict()
          .openapi("PlanLineApproval"),
      ),
    },
  },
  responses: LINE_ANSWERS,
});

const rejectRoute = createRoute({
  method: "post",
  path: "/api/supply-plan/lines/{id}/reject",
  summary: "A proposal rejected, with why",
  request: {
    ...linePath,
    body: {
      required: true,
      ...json(
        z
          .object({ reason: z.string().trim().min(1).max(MAX_NOTE) })
          .strict()
          .openapi("PlanLineRejection"),
      ),
    },
  },
  responses: LINE_ANSWERS,
});

const written = (c: Context<AppEnv>) => ({ actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() });

async function planAnswer(c: Context<AppEnv>) {
  const lines = await planLines(c.env.DB, c.var.deps.now());
  return {
    lines: lines.map((line) => ({
      id: line.id,
      kind: line.kind,
      consumable_code: line.code,
      name: line.name,
      city: line.city,
      from: line.from,
      to: line.to,
      supplier: line.supplier,
      proposed: line.proposed,
      quantity: line.quantity,
      usable: line.usable,
      need: line.need,
      safety: line.safety,
      state: line.state,
      reject_reason: line.rejectReason,
      po_number: line.poNumber,
    })),
  };
}

async function after(c: Context<AppEnv>, decided: Decided) {
  if (!decided.ok) {
    if ("missing" in decided) return refuse(c, "not_found");
    if ("state" in decided) return refuse(c, "order_state");
    return refuse(c, "invalid_request", decided.fields);
  }
  return c.json(await planAnswer(c), 200);
}

export function registerOpsSupplyPlan(app: App): void {
  app.openapi(planRoute, async (c) => c.json(await planAnswer(c), 200));

  app.openapi(draftRoute, async (c) => {
    const run = await c.env.DB.prepare(
      "SELECT id FROM forecast_runs INDEXED BY forecast_runs_by_day ORDER BY run_on DESC LIMIT 1",
    ).first<string>("id");
    if (run === null) return refuse(c, "order_state");
    const { planningPeriodDays } = await opsInputs(c);
    await draftPlan(c.env.DB, run, c.var.deps.now(), planningPeriodDays);
    return c.json(await planAnswer(c), 200);
  });

  app.openapi(approveRoute, async (c) =>
    after(c, await approvePlanLine(c.env.DB, c.req.valid("param").id, c.req.valid("json").quantity, written(c))),
  );

  app.openapi(rejectRoute, async (c) =>
    after(c, await rejectPlanLine(c.env.DB, c.req.valid("param").id, c.req.valid("json").reason, written(c))),
  );
}
