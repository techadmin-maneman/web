// Blackout days, behind Access (Settings; docs/decisions/0088-every-policy-in-the-console.md).
//
// They were edited by the runbook's own SQL. A change here needs no release,
// and each records the Access identity behind it in the same batch
// (src/domain/dispatch/blackouts.ts).

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import {
  addBlackouts,
  additionRefusal,
  bookedBetween,
  BLACKOUT_MAX_DAYS,
  blackoutsFrom,
  periodRefusal,
  removeBlackouts,
} from "../../domain/dispatch/blackouts.ts";
import { listCities } from "../../domain/cities/cities.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { isBlackoutReason } from "../../policy/blackouts.ts";

/** A city of ours a day is closed in; left out, or null, for every city. */
const CitySchema = z.string().min(1).max(60).openapi({ description: "One of the cities the list names." });

const BlackoutSchema = z
  .object({
    date: z.iso.date(),
    city: z
      .union([z.string(), z.null()])
      .openapi({ description: "The one city it is closed in; null for every city." }),
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
    cities: z.array(z.string()).openapi({ description: "The cities a day may be closed in alone." }),
  })
  .strict()
  .openapi("Blackouts");

const Period = {
  from: z.iso.date().openapi({ description: "The first day, today or later." }),
  to: z.iso.date().openapi({ description: "The last day, the first included; a month on at most when adding." }),
};

const listRoute = opsRoute({
  method: "get",
  path: "/api/blackouts",
  summary: "Every day from today on that no visit is offered, with the visits still booked on each",
  responses: { 200: { description: "The days", ...json(ListSchema) } },
});

const bookedRoute = opsRoute({
  method: "get",
  path: "/api/blackouts/booked",
  summary: "How many visits are still booked on days ops are about to close, in one city or every city",
  request: { query: z.object({ ...Period, city: CitySchema.optional() }) },
  responses: {
    200: {
      description: "The visits closing the days would leave to move",
      ...json(z.object({ booked: z.number().int() }).strict().openapi("BlackoutBooked")),
    },
    400: errorResponse("invalid_request: fields names from, to or city as for adding the days"),
  },
});

const addRoute = opsRoute({
  method: "post",
  path: "/api/blackouts",
  summary: "Black out every day from one date to another. A day already blacked out takes the reason given now",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({ ...Period, city: CitySchema.optional(), reason: z.string().trim().refine(isBlackoutReason) })
          .strict()
          .openapi("BlackoutAdd"),
      ),
    },
  },
  responses: {
    200: { description: "The days as they now stand", ...json(ListSchema) },
    400: errorResponse(
      "invalid_request: fields names from when it is before today, to when it is before from or more than a month " +
        "on, city when it is not one of ours, and reason when there is none or it is not one a list can hold",
    ),
  },
});

const removeRoute = opsRoute({
  method: "post",
  path: "/api/blackouts/remove",
  summary: "Offer the days from one date to another again",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({ ...Period, city: CitySchema.optional() })
          .strict()
          .openapi("BlackoutRemove"),
      ),
    },
  },
  responses: {
    200: { description: "The days as they now stand", ...json(ListSchema) },
    400: errorResponse(
      "invalid_request: fields names from when it is before today, to when it is before from, and city when it is " +
        "not one of ours",
    ),
    404: errorResponse("not_found: none of those days is blacked out"),
  },
});

export function registerOpsBlackouts(app: App): void {
  const list = async (db: D1Database, today: string) => {
    const [blackouts, cities] = await Promise.all([blackoutsFrom(db, today), listCities(db)]);
    return { blackouts, today, max_days: BLACKOUT_MAX_DAYS, cities: cities.map((city) => city.name) };
  };
  /** The city asked for, where it is one of ours; null for every city, or undefined for one we do not have. */
  const cityAsked = async (db: D1Database, city: string | undefined): Promise<string | null | undefined> => {
    if (city === undefined) return null;
    return (await listCities(db)).some((each) => each.name === city) ? city : undefined;
  };

  app.openapi(listRoute, async (c) => c.json(await list(c.env.DB, indiaDate(c.var.deps.now())), 200));

  app.openapi(bookedRoute, async (c) => {
    const today = indiaDate(c.var.deps.now());
    const { from, to, city: asked } = c.req.valid("query");
    const refused = additionRefusal({ from, to }, today);
    if (refused !== null) return refuse(c, "invalid_request", [refused]);
    const city = await cityAsked(c.env.DB, asked);
    if (city === undefined) return refuse(c, "invalid_request", ["city"]);
    return c.json({ booked: await bookedBetween(c.env.DB, { from, to, city }) }, 200);
  });

  app.openapi(addRoute, async (c) => {
    const now = c.var.deps.now();
    const today = indiaDate(now);
    const { from, to, reason, city: asked } = c.req.valid("json");
    const refused = additionRefusal({ from, to }, today);
    if (refused !== null) return refuse(c, "invalid_request", [refused]);
    const city = await cityAsked(c.env.DB, asked);
    if (city === undefined) return refuse(c, "invalid_request", ["city"]);
    await addBlackouts(c.env.DB, { from, to, city, reason, actor: actorOf(c), requestId: c.var.requestId, now });
    return c.json(await list(c.env.DB, today), 200);
  });

  app.openapi(removeRoute, async (c) => {
    const now = c.var.deps.now();
    const today = indiaDate(now);
    const { from, to, city: asked } = c.req.valid("json");
    const refused = periodRefusal({ from, to }, today);
    if (refused !== null) return refuse(c, "invalid_request", [refused]);
    const city = await cityAsked(c.env.DB, asked);
    if (city === undefined) return refuse(c, "invalid_request", ["city"]);
    const removed = await removeBlackouts(c.env.DB, {
      from,
      to,
      city,
      actor: actorOf(c),
      requestId: c.var.requestId,
      now,
    });
    if (removed === "not_found") return refuse(c, "not_found");
    return c.json(await list(c.env.DB, today), 200);
  });
}
