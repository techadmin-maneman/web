// A city's reach under Areas (src/domain/clients/pincode-reach.ts, docs/decisions/0223-reach-from-home.md): its
// technicians, how far each goes from home, and its pincodes with the nearest of them; and the same as one picture,
// drawn by the routes provider and kept a quarter of an hour, as the day map is.

import { z } from "@hono/zod-openapi";
import { cityReach } from "../../domain/clients/pincode-reach.ts";
import { withinCeiling } from "../../domain/platform/ceilings.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { opsRoute } from "../../http/session-routes.ts";
import { sha256Hex } from "../../lib/hash.ts";
import type { AreaMap } from "../../providers/routes/index.ts";

const MAP_KEPT_SECONDS = 15 * 60;
const CITY = z.object({ city: z.string().trim().min(1).max(60) });
const PIN = z.object({ lat: z.number(), lng: z.number() }).strict();

/** The map's colours: served, held and not served, paused, served but out of every reach; and a home and its reach. */
const COLOURS = { served: "2e7d32", held: "8a8a8a", paused: "e0a100", unreached: "c62828", home: "1b2a49" } as const;

const reachRoute = opsRoute({
  method: "get",
  path: "/api/service-area/reach",
  summary: "A city's technicians and how far each goes from home, and its pincodes with the nearest of them",
  request: { query: CITY },
  responses: {
    200: {
      description: "The city's reach",
      ...json(
        z
          .object({
            technicians: z.array(
              z
                .object({
                  id: z.string(),
                  name: z.string(),
                  initials: z.string(),
                  home: z.union([PIN, z.null()]),
                  reach_min: z.number().int(),
                  reach_km: z.number(),
                })
                .strict(),
            ),
            pincodes: z.array(
              z
                .object({
                  pincode: z.string(),
                  area: z.string(),
                  served: z.boolean(),
                  paused_until: z.union([z.iso.date(), z.null()]),
                  centre: z.union([PIN, z.null()]),
                  nearest: z.union([
                    z.object({ technician_id: z.string(), minutes: z.number().int() }).strict(),
                    z.null(),
                  ]),
                  reached: z
                    .union([z.boolean(), z.null()])
                    .openapi({ description: "Whether any reach takes it in; null where nothing could be measured." }),
                  reached_by: z.array(z.string()).openapi({ description: "The technicians whose reach takes it in." }),
                })
                .strict(),
            ),
          })
          .strict()
          .openapi("CityReach"),
      ),
    },
    400: errorResponse("invalid_request: no city named"),
  },
});

const mapRoute = opsRoute({
  method: "get",
  path: "/api/service-area/map",
  summary: "A city's pincodes and its technicians' reach as one picture",
  request: { query: CITY },
  responses: {
    200: {
      description: "The map",
      content: { "image/png": { schema: z.string() }, "image/svg+xml": { schema: z.string() } },
    },
    400: errorResponse("invalid_request: no city named"),
    404: errorResponse("not_found: nothing in the city has a place on the map yet"),
    503: errorResponse("unavailable: no maps provider, today's ceiling reached, or Google could not draw it"),
  },
});

/** What the picture shows: each group of pincodes in its colour, each home, and each reach about it. */
function areaMapOf(reach: Awaited<ReturnType<typeof cityReach>>): AreaMap {
  const placed = reach.pincodes.flatMap((each) => (each.centre === null ? [] : [{ ...each, centre: each.centre }]));
  const groupOf = (each: (typeof placed)[number]): keyof typeof COLOURS => {
    if (!each.served) return "held";
    if (each.reached === false) return "unreached";
    return each.paused_until === null ? "served" : "paused";
  };
  const groups = (["served", "held", "paused", "unreached"] as const).map((group) => ({
    colour: COLOURS[group],
    points: placed.filter((each) => groupOf(each) === group).map((each) => each.centre),
  }));
  const homed = reach.technicians.flatMap((each) => (each.home === null ? [] : [{ ...each, home: each.home }]));
  return {
    pincodes: groups,
    homes: homed.map((each) => ({ colour: COLOURS.home, label: each.initials.slice(0, 1), point: each.home })),
    reaches: homed.map((each) => ({ colour: COLOURS.home, centre: each.home, km: each.reach_km })),
  };
}

export function registerPincodeReach(app: App): void {
  app.openapi(reachRoute, async (c) => {
    const { city } = c.req.valid("query");
    return c.json(await cityReach(c.env.DB, city, await opsInputs(c)), 200);
  });

  app.openapi(mapRoute, async (c) => {
    const { routes, alert } = c.var.deps;
    if (routes === null) return refuse(c, "unavailable");
    const { city } = c.req.valid("query");
    const area = areaMapOf(await cityReach(c.env.DB, city, await opsInputs(c)));
    if (area.pincodes.every((group) => group.points.length === 0) && area.homes.length === 0) {
      return refuse(c, "not_found");
    }
    const key = new Request(`https://area-map.cache.maneman.in/${await sha256Hex(JSON.stringify(area))}`);
    const kept = await caches.default.match(key).catch(() => undefined);
    const headers = (type: string | null) => ({
      "Content-Type": type ?? "image/png",
      "Cache-Control": `private, max-age=${String(MAP_KEPT_SECONDS)}`,
    });
    if (kept !== undefined) return new Response(kept.body, { headers: headers(kept.headers.get("Content-Type")) });
    const at = { now: c.var.deps.now(), settings: c.var.config.settings };
    if (!(await withinCeiling(c.env.DB, alert, "route_map", at))) return refuse(c, "unavailable");
    const map = await routes.areaMap(area);
    if (!map.ok) {
      c.var.log.warn("area_map_failed", { detail: map.detail });
      return refuse(c, "unavailable");
    }
    const keeping = { "Content-Type": map.contentType, "Cache-Control": `max-age=${String(MAP_KEPT_SECONDS)}` };
    await caches.default.put(key, new Response(map.image, { headers: keeping })).catch(() => undefined);
    return new Response(map.image, { headers: headers(map.contentType) });
  });
}
