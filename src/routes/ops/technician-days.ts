// A technician's week and home, which ops set on the technician's page (docs/decisions/0210-booking-by-start-time.md),
// with Operations MANAGE in the technician's city. The week is each day they work and its hours; the home is a place
// found with the building search, geocoded once, where the drive to their first visit starts.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../../http/context.ts";
import { actorOf } from "../../http/audit.ts";
import { placeFor, suggestBuildings } from "../../http/address-save.ts";
import { errorBody, errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { routeReach } from "../../http/staff-access.ts";
import { reachesCity } from "../../policy/access.ts";
import { weekProblems } from "../../policy/start-times.ts";
import { rosterTechnician } from "../../domain/dispatch/technician-roster.ts";
import { setHome, setReach, setWeek } from "../../domain/dispatch/technician-days.ts";
import { SuggestionsSchema } from "../schemas/address.ts";
import { HomeSchema, WorkingDaySchema } from "../schemas/technician-days.ts";

const technicianId = z.object({ id: z.uuid() });
const unknownTechnician = errorResponse("not_found: no such technician in the caller's cities");

const weekRoute = opsRoute({
  method: "post",
  path: "/api/technicians/{id}/hours",
  summary: "Set the days a technician works and the hours of each, or return them to their city's hours",
  request: {
    params: technicianId,
    body: {
      required: true,
      ...json(
        z
          .object({
            days: z.array(WorkingDaySchema).max(7).openapi({
              description: "Each day they work. None returns them to their city's hours every day.",
            }),
          })
          .strict()
          .openapi("TechnicianWeek"),
      ),
    },
  },
  responses: {
    200: { description: "Set", ...json(z.object({ days: z.array(WorkingDaySchema) }).strict()) },
    400: errorResponse(
      "invalid_request: a day twice, a time off the quarter hour, or a day that ends before it starts",
    ),
    404: unknownTechnician,
  },
});

const suggestionsRoute = opsRoute({
  method: "post",
  path: "/api/technicians/{id}/home/suggestions",
  summary: "Places matching what ops have typed of where a technician's day starts",
  request: {
    params: technicianId,
    body: {
      required: true,
      ...json(
        z
          .object({
            q: z.string().trim().min(1).max(200).openapi({ description: "What ops have typed so far." }),
            session: z.string().trim().min(1).max(100).openapi({
              description: "One token for the whole search, sent again when the place is chosen.",
            }),
          })
          .strict()
          .openapi("TechnicianHomeSearch"),
      ),
    },
  },
  responses: {
    200: { description: "The suggestions, which may be empty", ...json(SuggestionsSchema) },
    400: errorResponse("invalid_request"),
    404: unknownTechnician,
    503: errorResponse("busy: today's address-lookup ceiling is reached; unavailable: Google could not be reached"),
  },
});

const homeRoute = opsRoute({
  method: "post",
  path: "/api/technicians/{id}/home",
  summary: "Set where a technician's day starts, from a place the search found",
  request: {
    params: technicianId,
    body: {
      required: true,
      ...json(
        z
          .object({
            place_id: z.string().trim().min(1).max(300),
            session_token: z.string().trim().min(1).max(100),
          })
          .strict()
          .openapi("TechnicianHomeChoice"),
      ),
    },
  },
  responses: {
    200: { description: "Set", ...json(z.object({ home: HomeSchema }).strict()) },
    400: errorResponse("invalid_request"),
    404: unknownTechnician,
    503: errorResponse("unavailable: Google could not place it, or today's address-lookup ceiling is reached"),
  },
});

const reachRoute = opsRoute({
  method: "post",
  path: "/api/technicians/{id}/reach",
  summary: "Set how far a technician goes from home, in minutes of driving, or return them to the business's with null",
  request: {
    params: technicianId,
    body: {
      required: true,
      ...json(
        z
          .object({ reach_min: z.union([z.number().int().min(10).max(180), z.null()]) })
          .strict()
          .openapi("TechnicianReach"),
      ),
    },
  },
  responses: {
    200: { description: "Set", ...json(z.object({ reach_min: z.union([z.number().int(), z.null()]) }).strict()) },
    400: errorResponse("invalid_request: a reach outside 10 to 180 minutes"),
    404: unknownTechnician,
  },
});

/** Whether the path names a technician in the caller's cities. */
async function inReach(c: Context<AppEnv>, id: string): Promise<boolean> {
  const technician = await rosterTechnician(c.env.DB, id);
  return technician !== null && reachesCity(await routeReach(c), technician.city);
}

export function registerOpsTechnicianDays(app: App): void {
  app.openapi(weekRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { days } = c.req.valid("json");
    if (weekProblems(days).length > 0) return refuse(c, "invalid_request", ["days"]);
    if (!(await inReach(c, id))) return refuse(c, "not_found");
    const actor = actorOf(c);
    const sorted = [...days].sort((a, b) => a.weekday - b.weekday);
    await setWeek(c.env.DB, {
      technicianId: id,
      days: sorted,
      actor: actor.id,
      audit: {
        surface: "ops",
        actor,
        action: "technician.hours",
        subject: { kind: "technician", id },
        requestId: c.var.requestId,
        detail: { days: String(sorted.length) },
      },
      now: c.var.deps.now(),
    });
    return c.json({ days: sorted }, 200);
  });

  app.openapi(suggestionsRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { q, session } = c.req.valid("json");
    if (!(await inReach(c, id))) return refuse(c, "not_found");
    const answer = await suggestBuildings(c, { limitScope: "ops_address_suggest", asker: actorOf(c).id, q, session });
    if (!answer.ok) return c.json(errorBody(answer.code, c.var.requestId), 503);
    return c.json({ suggestions: answer.suggestions, attribution: "Google Maps" as const }, 200);
  });

  app.openapi(homeRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { place_id: placeId, session_token: session } = c.req.valid("json");
    if (!(await inReach(c, id))) return refuse(c, "not_found");
    const place = await placeFor(c, placeId, session);
    if (place === null) return refuse(c, "unavailable");
    await setHome(c.env.DB, {
      technicianId: id,
      home: place,
      audit: {
        surface: "ops",
        actor: actorOf(c),
        action: "technician.home",
        subject: { kind: "technician", id },
        requestId: c.var.requestId,
      },
      now: c.var.deps.now(),
    });
    return c.json({ home: { label: place.label } }, 200);
  });

  app.openapi(reachRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { reach_min: reachMin } = c.req.valid("json");
    if (!(await inReach(c, id))) return refuse(c, "not_found");
    await setReach(c.env.DB, {
      technicianId: id,
      reachMin,
      audit: {
        surface: "ops",
        actor: actorOf(c),
        action: "technician.reach",
        subject: { kind: "technician", id },
        requestId: c.var.requestId,
      },
      now: c.var.deps.now(),
    });
    return c.json({ reach_min: reachMin }, 200);
  });
}
