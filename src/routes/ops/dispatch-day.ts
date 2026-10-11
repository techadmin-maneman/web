// The dispatch board's day on the road (ADR 0120), behind Access:
//   GET  /api/dispatch/day?date=&city=       each technician's visits in order, the drive between each two, and
//                                            whether it fits the gap the board left
//   GET  /api/dispatch/day/map?date=&city=   the picture of it, from Google through us: the console never holds the key
//
// Both keep to the caller's cities, as the board does.

import { createRoute, z } from "@hono/zod-openapi";
import { BOOKING_WINDOWS } from "../../config/scheduling.ts";
import { VISIT_TYPES } from "../../config/visit-types.ts";
import { dayRoute } from "../../domain/dispatch/day-route.ts";
import { withinCeiling } from "../../domain/platform/ceilings.ts";
import type { Context } from "hono";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { routeReach } from "../../http/staff-access.ts";
import { sha256Hex } from "../../lib/hash.ts";
import { indiaDate } from "../../lib/india-time.ts";

/** How long a day's picture is kept: the visits on it move during the day, so not long. */
const MAP_KEPT_SECONDS = 15 * 60;

const DayQuery = z.object({ date: z.iso.date().optional(), city: z.string().min(1).max(60).optional() });

const DayRouteSchema = z
  .object({
    date: z.iso.date(),
    city: z.union([z.string(), z.null()]),
    drive_times: z.enum(["shown", "off", "unavailable"]).openapi({
      description:
        "shown: every drive between two visits next to each other with a pin each is in legs. off: drive times are " +
        "not switched on here. unavailable: Google failed, or the day's ceiling is spent; some legs may be missing.",
    }),
    technicians: z.array(
      z
        .object({
          technician_id: z.uuid(),
          name: z.string(),
          initials: z.string(),
          colour: z
            .string()
            .regex(/^[0-9a-f]{6}$/)
            .openapi({ description: "Their route's colour on the map." }),
          stops: z.array(
            z
              .object({
                appointment_id: z.uuid(),
                starts_at: z.iso.datetime(),
                ends_at: z.iso.datetime().openapi({ description: "When the visit's time on the board ends." }),
                window: z.enum(BOOKING_WINDOWS),
                type: z.union([z.enum(VISIT_TYPES), z.null()]),
                sector: z.union([z.string(), z.null()]),
                client: z.union([z.string(), z.null()]),
                located: z.boolean().openapi({
                  description:
                    "Whether the client's address has a pin. A visit without one has no drive to or from it.",
                }),
              })
              .strict(),
          ),
          legs: z.array(
            z
              .object({
                from: z.uuid(),
                to: z.uuid(),
                minutes: z.number().int(),
                km: z.number(),
                gap_minutes: z.number().int().openapi({
                  description: "From the end of one visit's time on the board to the start of the next's.",
                }),
                fits: z.boolean().openapi({ description: "Whether the drive fits that gap." }),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict()
  .openapi("DispatchDay", { description: "Only technicians with a visit that day, each in board order." });

const dayRouteRoute = createRoute({
  method: "get",
  path: "/api/dispatch/day",
  summary: "A day's routes: each technician's visits in order, the drive between each two, and whether it fits",
  request: { query: DayQuery },
  responses: {
    200: { description: "The day", ...json(DayRouteSchema) },
    403: errorResponse("access_required"),
  },
});

const dayMapRoute = createRoute({
  method: "get",
  path: "/api/dispatch/day/map",
  summary: "The picture of a day's routes, each technician's in their colour, their visits numbered in order",
  request: { query: DayQuery },
  responses: {
    200: {
      description: "The map",
      content: { "image/png": { schema: z.string() }, "image/svg+xml": { schema: z.string() } },
    },
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no visit that day has a pin, so there is nothing to draw"),
    503: errorResponse("unavailable: the map is not switched on here, Google failed, or the day's ceiling is spent"),
  },
});

async function drawnDay(c: Context<AppEnv>, query: z.infer<typeof DayQuery>) {
  const at = { now: c.var.deps.now(), settings: c.var.config.settings };
  const { routes, alert } = c.var.deps;
  return dayRoute(
    c.env.DB,
    { routes, alert },
    {
      date: query.date ?? indiaDate(at.now),
      city: query.city ?? null,
      reach: await routeReach(c),
      at,
    },
  );
}

export function registerOpsDispatchDay(app: App): void {
  app.openapi(dayRouteRoute, async (c) => c.json((await drawnDay(c, c.req.valid("query"))).route, 200));

  app.openapi(dayMapRoute, async (c) => {
    const { routes, alert } = c.var.deps;
    if (routes === null) return refuse(c, "unavailable");
    const { maps } = await drawnDay(c, c.req.valid("query"));
    if (maps.length === 0) return refuse(c, "not_found");

    const key = new Request(`https://day-map.cache.maneman.in/${await sha256Hex(JSON.stringify(maps))}`);
    const kept = await caches.default.match(key).catch(() => undefined);
    if (kept !== undefined) {
      return new Response(kept.body, {
        headers: {
          "Content-Type": kept.headers.get("Content-Type") ?? "image/png",
          "Cache-Control": `private, max-age=${String(MAP_KEPT_SECONDS)}`,
        },
      });
    }
    const at = { now: c.var.deps.now(), settings: c.var.config.settings };
    if (!(await withinCeiling(c.env.DB, alert, "route_map", at))) return refuse(c, "unavailable");
    const map = await routes.map(maps);
    if (!map.ok) {
      c.var.log.warn("day_map_failed", { detail: map.detail });
      return refuse(c, "unavailable");
    }
    // The kept copy is ours alone: Cloudflare's cache keeps nothing marked private, and the browser's copy is.
    const keeping = { "Content-Type": map.contentType, "Cache-Control": `max-age=${String(MAP_KEPT_SECONDS)}` };
    await caches.default.put(key, new Response(map.image, { headers: keeping })).catch(() => undefined);
    return new Response(map.image, {
      headers: { "Content-Type": map.contentType, "Cache-Control": `private, max-age=${String(MAP_KEPT_SECONDS)}` },
    });
  });
}
