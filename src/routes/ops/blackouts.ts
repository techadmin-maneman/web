// Blackout days, behind Access (Settings; docs/decisions/0088-every-policy-in-the-console.md):
//   GET  /api/blackouts          every day from today on that no visit is offered, and what is still booked on it
//   POST /api/blackouts          black out the days from one date to another, with a reason
//   POST /api/blackouts/remove   offer the days from one date to another again
//
// They were edited by the runbook's own SQL. A change here needs no release,
// and each records the Access identity behind it in the same batch
// (src/domain/blackouts.ts).

import { createRoute, z } from "@hono/zod-openapi";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import {
  addBlackouts,
  additionRefusal,
  BLACKOUT_MAX_DAYS,
  blackoutsFrom,
  periodRefusal,
  removeBlackouts,
} from "../../domain/blackouts.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { indiaDate } from "../../lib/india-time.ts";

/**
 * Why a day is blacked out, as the console lists it: a letter or a digit first, so a spreadsheet opening an
 * exported list never reads it as a formula, then letters, digits, spaces and . , ' ( ) & / -.
 */
const REASON = /^[\p{L}\p{N}][\p{L}\p{N} .,'()&/-]{0,59}$/u;

const BlackoutSchema = z
  .object({
    date: z.iso.date(),
    reason: z.string(),
    set_by: z.union([z.string(), z.null()]).openapi({
      description: "The Access identity that set it; null for a day the runbook's SQL wrote before this screen.",
    }),
    set_at: z.union([z.iso.datetime(), z.null()]),
    booked: z.number().int().openapi({
      description: "Visits still booked on the day. Blacking a day out moves none of them: ops do.",
    }),
  })
  .strict()
  .openapi("Blackout");

const ListSchema = z
  .object({
    blackouts: z.array(BlackoutSchema),
    today: z.iso.date().openapi({ description: "India's date, the first a day may be blacked out from." }),
    max_days: z.number().int().openapi({ description: "The most days one addition may cover." }),
  })
  .strict()
  .openapi("Blackouts");

const Period = {
  from: z.iso.date().openapi({ description: "The first day, today or later." }),
  to: z.iso.date().openapi({ description: "The last day, the first included; a month on at most when adding." }),
};

const listRoute = createRoute({
  method: "get",
  path: "/api/blackouts",
  summary: "Every day from today on that no visit is offered, with the visits still booked on each",
  responses: { 200: { description: "The days", ...json(ListSchema) }, 403: errorResponse("access_required") },
});

const addRoute = createRoute({
  method: "post",
  path: "/api/blackouts",
  summary: "Black out every day from one date to another. A day already blacked out takes the reason given now",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({ ...Period, reason: z.string().trim().regex(REASON) })
          .strict()
          .openapi("BlackoutAdd"),
      ),
    },
  },
  responses: {
    200: { description: "The days as they now stand", ...json(ListSchema) },
    400: errorResponse(
      "invalid_request: fields names from when it is before today, to when it is before from or more than a month " +
        "on, and reason when there is none or it is not one a list can hold",
    ),
    403: errorResponse("access_required"),
  },
});

const removeRoute = createRoute({
  method: "post",
  path: "/api/blackouts/remove",
  summary: "Offer the days from one date to another again",
  request: { body: { required: true, ...json(z.object(Period).strict().openapi("BlackoutRemove")) } },
  responses: {
    200: { description: "The days as they now stand", ...json(ListSchema) },
    400: errorResponse("invalid_request: fields names from when it is before today, and to when it is before from"),
    403: errorResponse("access_required"),
    404: errorResponse("not_found: none of those days is blacked out"),
  },
});

export function registerOpsBlackouts(app: App): void {
  const list = async (db: D1Database, today: string) => ({
    blackouts: await blackoutsFrom(db, today),
    today,
    max_days: BLACKOUT_MAX_DAYS,
  });

  app.openapi(listRoute, async (c) => c.json(await list(c.env.DB, indiaDate(c.var.deps.now())), 200));

  app.openapi(addRoute, async (c) => {
    const now = c.var.deps.now();
    const today = indiaDate(now);
    const { from, to, reason } = c.req.valid("json");
    const refused = additionRefusal({ from, to }, today);
    if (refused !== null) return refuse(c, "invalid_request", [refused]);
    await addBlackouts(c.env.DB, { from, to, reason, actor: actorOf(c), requestId: c.var.requestId, now });
    return c.json(await list(c.env.DB, today), 200);
  });

  app.openapi(removeRoute, async (c) => {
    const now = c.var.deps.now();
    const today = indiaDate(now);
    const { from, to } = c.req.valid("json");
    const refused = periodRefusal({ from, to }, today);
    if (refused !== null) return refuse(c, "invalid_request", [refused]);
    const removed = await removeBlackouts(c.env.DB, { from, to, actor: actorOf(c), requestId: c.var.requestId, now });
    if (removed === "not_found") return refuse(c, "not_found");
    return c.json(await list(c.env.DB, today), 200);
  });
}
