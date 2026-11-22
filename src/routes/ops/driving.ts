// Reports › Driving, behind Access (Operations, nationally; docs/decisions/0294-learned-drive-times.md).

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { json } from "../../http/openapi.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { drivingReport } from "../../domain/booking/driving-report.ts";
import { DRIVE_TIMES_CHOICES } from "../../policy/learned-drives.ts";
import { CityAsked } from "../schemas/city.ts";

const WEEKS = ["1", "4", "8"] as const;

const Drives = {
  period: z.iso.date().openapi({ description: "The day, or the Monday its week starts on." }),
  drives: z.number().int(),
  planned_minutes: z.number().int().openapi({ description: "What booking plans for these drives at today's pace." }),
  actual_minutes: z.number().int().openapi({ description: "What they took, from each close to the next check-in." }),
};

const DrivingSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    by_technician: z.array(
      z.object({ ...Drives, technician_id: z.string(), name: z.string(), city: z.string() }).strict(),
    ),
    by_city: z.array(z.object({ ...Drives, city: z.string() }).strict()),
    factors: z.array(
      z
        .object({
          city: z.string(),
          day_kind: z.enum(["weekday", "weekend"]),
          hour: z.number().int().min(0).max(23),
          factor_pct: z
            .number()
            .int()
            .openapi({ description: "The middle drive's time, as a per cent of its estimate." }),
          drives: z.number().int(),
          in_use: z.boolean().openapi({ description: "Whether booking plans with it now." }),
        })
        .strict(),
    ),
    learning: z.object({ use: z.enum(DRIVE_TIMES_CHOICES), min_drives: z.number().int() }).strict(),
  })
  .strict()
  .openapi("Driving");

const drivingRoute = opsRoute({
  method: "get",
  path: "/api/reports/driving",
  summary: "Drives between jobs, planned against taken, by technician and city, and the drive times learned",
  request: {
    query: z.object({
      weeks: z.enum(WEEKS).default("4"),
      by: z.enum(["day", "week"]).default("week"),
      city: CityAsked,
    }),
  },
  responses: {
    200: { description: "The report", ...json(DrivingSchema) },
  },
});

export function registerOpsDriving(app: App): void {
  app.openapi(drivingRoute, async (c) => {
    const asked = c.req.valid("query");
    const report = await drivingReport(
      c.env.DB,
      { now: c.var.deps.now(), weeks: Number(asked.weeks), by: asked.by, city: asked.city },
      await opsInputs(c),
    );
    return c.json(report, 200);
  });
}
