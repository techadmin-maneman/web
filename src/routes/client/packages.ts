// GET /api/packages: the packages a client compares in their app, priced for them in their city as a technician's
// Options price them (src/domain/field/job-options.ts), from tomorrow, the first day a price change or a visit can be on.

import { z } from "@hono/zod-openapi";
import { cityOfPerson } from "../../domain/cities/cities.ts";
import { packageOptions } from "../../domain/field/job-options.ts";
import { clientOf } from "../../http/client-session.ts";
import type { App } from "../../http/context.ts";
import { errorResponse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { clientRoute } from "../../http/session-routes.ts";
import { addDays, indiaDate } from "../../lib/india-time.ts";
import { PriceSchema } from "../schemas/booking.ts";

const PackageSchema = z
  .object({
    code: z.string(),
    name: z.string(),
    description: z.union([z.string(), z.null()]),
    first_fit: PriceSchema.openapi({
      description:
        "The hair system made to the client where their profile matches one, else the cheapest, and the service visit.",
    }),
    service: z.union([PriceSchema, z.null()]).openapi({ description: "Its service visit." }),
    service_every_days: z.number().int().openapi({ description: "Days from a visit to the service visit after it." }),
    replacement: z
      .union([PriceSchema, z.null()])
      .openapi({ description: "Its replacement as sold, the service visit with it." }),
    replace_after_months: z.number().int().openapi({ description: "Months from a fit to its replacement." }),
  })
  .strict()
  .openapi("ClientPackage");

const packagesRoute = clientRoute({
  method: "get",
  path: "/api/packages",
  summary: "The packages on sale from tomorrow, in ops' order, priced for the client in their city",
  responses: {
    200: {
      description: "The packages",
      ...json(
        z
          .object({ packages: z.array(PackageSchema) })
          .strict()
          .openapi("ClientPackages"),
      ),
    },
    401: errorResponse("session_required"),
  },
});

export function registerClientPackages(app: App): void {
  app.openapi(packagesRoute, async (c) => {
    const personId = clientOf(c).subjectId;
    const db = c.env.DB;
    const on = addDays(indiaDate(c.var.deps.now()), 1);
    return c.json(
      { packages: await packageOptions(db, { personId, on, city: await cityOfPerson(db, personId) }) },
      200,
    );
  });
}
