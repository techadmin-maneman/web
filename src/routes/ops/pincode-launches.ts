// Launches ops schedule, a city's readiness, a pause, and what stopping leaves behind (ADR 0221;
// src/domain/clients/pincode-launches.ts, src/domain/clients/launch-readiness.ts). Serving today is
// POST /api/service-area's; a scheduled launch is served by the cron on its day, the same way.

import { z } from "@hono/zod-openapi";
import { pincodeLaunch } from "../../domain/clients/launch-runs.ts";
import { cancelLaunch, pincodeLaunches, scheduleLaunch } from "../../domain/clients/pincode-launches.ts";
import { launchReadiness, pausePincodes, READINESS_CHECKS, stopImpact } from "../../domain/clients/launch-readiness.ts";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { opsRoute } from "../../http/session-routes.ts";
import { routeReach } from "../../http/staff-access.ts";
import { reachesCity } from "../../policy/access.ts";

const PINCODE = z.string().regex(/^[1-9]\d{5}$/);
const PINCODES = z.array(PINCODE).min(1).max(300);
/** A query naming pincodes, one or several times. */
const PINCODES_QUERY = z
  .union([PINCODE, z.array(PINCODE).min(1).max(300)])
  .transform((value) => (Array.isArray(value) ? value : [value]))
  .openapi({ description: "Named once for each pincode." });

const LaunchSchema = z
  .object({
    id: z.string(),
    city: z.string(),
    go_live_on: z.iso.date(),
    state: z.enum(["scheduled", "live", "cancelled"]),
    pincodes: z.array(z.object({ pincode: z.string(), area: z.string() }).strict()),
    created_by: z.string(),
    created_at: z.string(),
    live_at: z.union([z.string(), z.null()]),
    alerted: z.union([z.number().int(), z.null()]),
    cancelled_at: z.union([z.string(), z.null()]),
    held_because: z
      .union([z.string(), z.null()])
      .openapi({ description: "Why the cron has not served it on its day; null when nothing holds it." }),
  })
  .strict()
  .openapi("ScheduledLaunch");

const listRoute = opsRoute({
  method: "get",
  path: "/api/pincode-launches",
  summary: "Every launch: those scheduled, soonest first, then the rest, newest first",
  responses: {
    200: { description: "The launches", ...json(z.object({ launches: z.array(LaunchSchema) }).strict()) },
  },
});

const scheduleRoute = opsRoute({
  method: "post",
  path: "/api/pincode-launches",
  summary: "Schedule pincodes of one city, held and not served, to be served from a later day",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({ city: z.string().trim().min(1).max(60), pincodes: PINCODES, go_live_on: z.iso.date() })
          .strict()
          .openapi("LaunchSchedule"),
      ),
    },
  },
  responses: {
    201: { description: "The launch, scheduled", ...json(LaunchSchema) },
    400: errorResponse(
      "invalid_request: go_live_on for a day not after today, or the pincodes we do not hold or hold in another city",
    ),
    403: errorResponse("access_required, or not_permitted: the city is outside the caller's Growth MANAGE"),
    409: errorResponse("already_served or already_scheduled: the pincodes named in fields"),
  },
});

const cancelRoute = opsRoute({
  method: "post",
  path: "/api/pincode-launches/{id}/cancel",
  summary: "Cancel a launch still scheduled; its pincodes stay unserved",
  request: { params: z.object({ id: z.string().min(1).max(64) }) },
  responses: {
    200: { description: "The launch, cancelled", ...json(LaunchSchema) },
    403: errorResponse("access_required, or not_permitted: the city is outside the caller's Growth MANAGE"),
    404: errorResponse("not_found: no launch scheduled with that ID"),
  },
});

const readinessRoute = opsRoute({
  method: "get",
  path: "/api/pincode-launches/readiness",
  summary: "What a city needs before its pincodes are served, each check with what it counts",
  request: { query: z.object({ city: z.string().trim().min(1).max(60), pincode: PINCODES_QUERY.optional() }) },
  responses: {
    200: {
      description: "The checks, in order",
      ...json(
        z
          .object({
            checks: z.array(
              z.object({ check: z.enum(READINESS_CHECKS), ready: z.boolean(), count: z.number().int() }).strict(),
            ),
          })
          .strict()
          .openapi("LaunchReadiness"),
      ),
    },
    400: errorResponse("invalid_request: no city named"),
  },
});

const pauseRoute = opsRoute({
  method: "post",
  path: "/api/service-area/pause",
  summary: "Pause served pincodes until a later day, taking no new clients, or take the pause off with null",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({ pincodes: PINCODES, until: z.union([z.iso.date(), z.null()]) })
          .strict()
          .openapi("PincodesPause"),
      ),
    },
  },
  responses: {
    200: { description: "How many pincodes changed", ...json(z.object({ changed: z.number().int() }).strict()) },
    400: errorResponse("invalid_request: until for a day not after today, or the pincodes we do not serve"),
  },
});

const impactRoute = opsRoute({
  method: "get",
  path: "/api/service-area/stop-impact",
  summary: "What stopping these pincodes leaves behind: the visits booked there still to come, and their clients",
  request: { query: z.object({ pincode: PINCODES_QUERY }) },
  responses: {
    200: {
      description: "The visits and clients",
      ...json(z.object({ visits: z.number().int(), clients: z.number().int() }).strict().openapi("StopImpact")),
    },
    400: errorResponse("invalid_request: no pincode named"),
  },
});

export function registerPincodeLaunches(app: App): void {
  app.openapi(listRoute, async (c) => c.json({ launches: await pincodeLaunches(c.env.DB) }, 200));

  app.openapi(scheduleRoute, async (c) => {
    const { city, pincodes, go_live_on: goLiveOn } = c.req.valid("json");
    if (!reachesCity(await routeReach(c), city)) return refuse(c, "not_permitted");
    const written = { actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() };
    const result = await scheduleLaunch(c.env.DB, { city, pincodes, goLiveOn, ...written });
    if (!("kind" in result)) return c.json(result, 201);
    if (result.kind === "not_later") return refuse(c, "invalid_request", ["go_live_on"]);
    if (result.kind === "served") return refuse(c, "already_served", result.pincodes);
    if (result.kind === "scheduled") return refuse(c, "already_scheduled", result.pincodes);
    return refuse(c, "invalid_request", result.pincodes);
  });

  app.openapi(cancelRoute, async (c) => {
    const { id } = c.req.valid("param");
    const launch = await pincodeLaunch(c.env.DB, id);
    if (launch?.state !== "scheduled") return refuse(c, "not_found");
    if (!reachesCity(await routeReach(c), launch.city)) return refuse(c, "not_permitted");
    const written = { actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() };
    const result = await cancelLaunch(c.env.DB, { id, ...written });
    return typeof result === "string" ? refuse(c, "not_found") : c.json(result, 200);
  });

  app.openapi(readinessRoute, async (c) => {
    const { city, pincode } = c.req.valid("query");
    return c.json({ checks: await launchReadiness(c.env.DB, city, pincode ?? []) }, 200);
  });

  app.openapi(pauseRoute, async (c) => {
    const { pincodes, until } = c.req.valid("json");
    const written = { actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() };
    const result = await pausePincodes(c.env.DB, { pincodes, until, ...written });
    if (!("kind" in result)) return c.json(result, 200);
    return refuse(c, "invalid_request", result.kind === "not_later" ? ["until"] : result.pincodes);
  });

  app.openapi(impactRoute, async (c) => {
    const { pincode } = c.req.valid("query");
    return c.json(await stopImpact(c.env.DB, pincode, c.var.deps.now()), 200);
  });
}
