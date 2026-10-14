// A month's targets, city by city, behind Access (Admin; docs/decisions/0154-targets-and-reporting-access.md).

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { removeTarget, setTarget, targetsFor } from "../../domain/ops/targets.ts";
import { actorOf } from "../../http/audit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { addMonths, indiaDate, monthOf } from "../../lib/india-time.ts";
import { mostFor, TARGET_MEASURE_NAMES } from "../../policy/targets.ts";

/** How far either side of this month a target may be set. */
const MONTHS_EITHER_SIDE = 12;

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Which = z.object({ month: Month, city: z.string().trim().min(1).max(60), measure: z.enum(TARGET_MEASURE_NAMES) });

const TargetSchema = z
  .object({
    month: z.string(),
    city: z.string(),
    measure: z.enum(TARGET_MEASURE_NAMES),
    target: z.number().int().openapi({ description: "A count, whole rupees before GST, or a percentage." }),
    set_by: z.string(),
    set_at: z.iso.datetime(),
  })
  .strict()
  .openapi("Target");

const TargetsSchema = z
  .object({
    month: z.string(),
    targets: z.array(TargetSchema),
    cities: z.array(z.string()),
    measures: z.array(z.enum(TARGET_MEASURE_NAMES)),
    first_month: z.string(),
    last_month: z.string(),
  })
  .strict()
  .openapi("Targets");

const listRoute = opsRoute({
  method: "get",
  path: "/api/targets",
  summary: "A month's targets, city by city; this month's where none is asked for",
  request: { query: z.object({ month: Month.optional() }) },
  responses: {
    200: { description: "The month's targets", ...json(TargetsSchema) },
    400: errorResponse("invalid_request: a month outside the year either side of this one"),
  },
});

const setRoute = opsRoute({
  method: "post",
  path: "/api/targets",
  summary: "Set a month's target for a city, or set it again",
  request: {
    body: {
      required: true,
      ...json(
        Which.extend({ target: z.number().int().min(0).max(10_000_000) })
          .strict()
          .openapi("TargetChange"),
      ),
    },
  },
  responses: {
    200: { description: "Set; the month's targets", ...json(TargetsSchema) },
    400: errorResponse("invalid_request: fields names month, city or target for one out of bounds"),
  },
});

const removeRoute = opsRoute({
  method: "post",
  path: "/api/targets/remove",
  summary: "Take a month's target for a city off",
  request: { body: { required: true, ...json(Which.strict().openapi("TargetRemoval")) } },
  responses: {
    200: { description: "Taken off; the month's targets", ...json(TargetsSchema) },
    404: errorResponse("not_found: no such target set"),
  },
});

const changeOf = (c: Context<AppEnv>) => ({ actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() });

const boundsOf = (now: Date) => {
  const thisMonth = monthOf(indiaDate(now));
  return {
    thisMonth,
    first: addMonths(thisMonth, -MONTHS_EITHER_SIDE),
    last: addMonths(thisMonth, MONTHS_EITHER_SIDE),
  };
};

async function monthBody(c: Context<AppEnv>, month: string) {
  const { first, last } = boundsOf(c.var.deps.now());
  const [targets, cities] = await Promise.all([
    targetsFor(c.env.DB, month),
    c.env.DB.prepare("SELECT name FROM cities ORDER BY sort").all<{ name: string }>(),
  ]);
  return {
    month,
    targets,
    cities: cities.results.map((city) => city.name),
    measures: [...TARGET_MEASURE_NAMES],
    first_month: first,
    last_month: last,
  };
}

export function registerOpsTargets(app: App): void {
  app.openapi(listRoute, async (c) => {
    const { thisMonth, first, last } = boundsOf(c.var.deps.now());
    const month = c.req.valid("query").month ?? thisMonth;
    if (month < first || month > last) return refuse(c, "invalid_request", ["month"]);
    return c.json(await monthBody(c, month), 200);
  });

  app.openapi(setRoute, async (c) => {
    const body = c.req.valid("json");
    const { first, last } = boundsOf(c.var.deps.now());
    if (body.month < first || body.month > last) return refuse(c, "invalid_request", ["month"]);
    if (body.target > mostFor(body.measure)) return refuse(c, "invalid_request", ["target"]);
    const set = await setTarget(c.env.DB, { ...changeOf(c), ...body });
    if (set === "no_city") return refuse(c, "invalid_request", ["city"]);
    return c.json(await monthBody(c, body.month), 200);
  });

  app.openapi(removeRoute, async (c) => {
    const body = c.req.valid("json");
    const removed = await removeTarget(c.env.DB, { ...changeOf(c), ...body });
    if (!removed) return refuse(c, "not_found");
    return c.json(await monthBody(c, body.month), 200);
  });
}
