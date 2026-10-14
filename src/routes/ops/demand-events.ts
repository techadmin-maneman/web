// The events calendar, behind Access (docs/decisions/0182-the-events-calendar.md).
//
// Read with Operations VIEW, changed with MANAGE. Each write answers the whole of GET's answer.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { addEvent, removeEvent, upcomingEvents } from "../../domain/purchasing/demand-events.ts";
import { written } from "../../http/audit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { indiaDate } from "../../lib/india-time.ts";

const EventSchema = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string().nullable(),
  starts_on: z.iso.date(),
  ends_on: z.iso.date(),
  uplift_percent: z.number().int(),
});

const EVENTS = {
  description: "The events calendar",
  ...json(z.object({ events: z.array(EventSchema), cities: z.array(z.string()) }).openapi("DemandEvents")),
};
const ACCESS = errorResponse("access_required");

const listRoute = opsRoute({
  method: "get",
  path: "/api/demand-events",
  summary: "The events still to end, and the cities one may be set in",
  responses: { 200: EVENTS, 403: ACCESS },
});

const addRoute = opsRoute({
  method: "post",
  path: "/api/demand-events",
  summary: "An event added to the calendar",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            name: z.string().trim().min(1).max(80),
            city: z.string().trim().min(1).max(80).nullable(),
            starts_on: z.iso.date(),
            ends_on: z.iso.date(),
            uplift_percent: z.number().int().min(-90).max(500),
          })
          .strict()
          .openapi("DemandEventAdd"),
      ),
    },
  },
  responses: {
    200: EVENTS,
    400: errorResponse("invalid_request: fields names ends_on for an end before the start, or city for one not served"),
    403: ACCESS,
  },
});

const removeRoute = opsRoute({
  method: "post",
  path: "/api/demand-events/{id}/remove",
  summary: "An event taken off the calendar",
  request: { params: z.object({ id: z.string().min(1).max(64) }) },
  responses: { 200: EVENTS, 403: ACCESS, 404: errorResponse("not_found: no such event on the calendar") },
});

async function eventsAnswer(c: Context<AppEnv>) {
  const [events, cities] = await Promise.all([
    upcomingEvents(c.env.DB, indiaDate(c.var.deps.now())),
    c.env.DB.prepare("SELECT name FROM cities WHERE active = 1 ORDER BY sort, name").all<{ name: string }>(),
  ]);
  return {
    events: events.map((event) => ({
      id: event.id,
      name: event.name,
      city: event.city,
      starts_on: event.startsOn,
      ends_on: event.endsOn,
      uplift_percent: event.upliftPercent,
    })),
    cities: cities.results.map((row) => row.name),
  };
}

export function registerOpsDemandEvents(app: App): void {
  app.openapi(listRoute, async (c) => c.json(await eventsAnswer(c), 200));

  app.openapi(addRoute, async (c) => {
    const body = c.req.valid("json");
    const added = await addEvent(
      c.env.DB,
      {
        name: body.name,
        city: body.city,
        startsOn: body.starts_on,
        endsOn: body.ends_on,
        upliftPercent: body.uplift_percent,
      },
      written(c),
    );
    if (!added.ok) return refuse(c, "invalid_request", added.fields);
    return c.json(await eventsAnswer(c), 200);
  });

  app.openapi(removeRoute, async (c) => {
    if (!(await removeEvent(c.env.DB, c.req.valid("param").id, written(c)))) return refuse(c, "not_found");
    return c.json(await eventsAnswer(c), 200);
  });
}
