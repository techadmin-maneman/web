// The technician's own quality over the last 30 days, and their clients' ratings over the days ops set, for Me
// (src/domain/field/quality.ts). Their own counts alone.

import { z } from "@hono/zod-openapi";
import { qualityOf } from "../../domain/field/quality.ts";
import type { App } from "../../http/context.ts";
import { errorResponse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { techRoute } from "../../http/session-routes.ts";
import { technicianOf } from "../../http/technician-session.ts";

const count = z.number().int().nonnegative();

const QualitySchema = z
  .object({
    visits: count.openapi({ description: "Visits checked in, booked in the last 30 days." }),
    on_time: count.openapi({ description: "Of them, those checked in by the booked start." }),
    fits: count.openapi({
      description:
        'First fits done or left partly done in the last 30 days; a no-show or one closed "Can\'t fit today" is none.',
    }),
    redone: count.openapi({ description: "Of them, those whose free refit was booked within 30 days." }),
    rating: z.union([z.number(), z.null()]).openapi({
      description:
        "The average of clients' ratings of their visits over rating_days, one to five stars to one place; null with " +
        "fewer than ratings.shown_from. How many is never given (ADR 0260).",
    }),
    rating_days: count.openapi({ description: "The days the rating covers (ratings.average_days)." }),
  })
  .strict()
  .openapi("TechnicianQuality");

const qualityRoute = techRoute({
  method: "get",
  path: "/api/tech/quality",
  summary: "The technician's on-time visits and hairline redo rate over the last 30 days, and their rating",
  responses: {
    200: { description: "Their counts", ...json(QualitySchema) },
    401: errorResponse("session_required; device_revoked; technician_inactive: ops switched the technician off"),
  },
});

export function registerTechQuality(app: App): void {
  app.openapi(qualityRoute, async (c) =>
    c.json(
      await qualityOf(c.env.DB, technicianOf(c).technicianId, c.var.deps.now(), (await opsInputs(c)).ratings),
      200,
    ),
  );
}
