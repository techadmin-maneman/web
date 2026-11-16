// GET /api/packages: the packages a client compares in their app, priced for them in their city
// (src/domain/booking/client-packages.ts).

import { z } from "@hono/zod-openapi";
import { packagesOffered } from "../../domain/booking/client-packages.ts";
import { cityOfPerson } from "../../domain/cities/cities.ts";
import { clientOf } from "../../http/client-session.ts";
import type { App } from "../../http/context.ts";
import { errorResponse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { clientRoute } from "../../http/session-routes.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { PriceSchema } from "../schemas/booking.ts";

const PackageSchema = z
  .object({
    code: z.string(),
    name: z.string(),
    first_fit: PriceSchema.openapi({
      description:
        "The hair system made to the client where their profile matches one, else the cheapest, and the service visit.",
    }),
    replacement: z.union([PriceSchema, z.null()]).openapi({ description: "The replacement and its service visit." }),
    service_visit: z.union([PriceSchema, z.null()]),
    service_every_days: z.number().int().openapi({ description: "Days from a visit to the service visit after it." }),
    replace_after_months: z.number().int().openapi({ description: "Months from a fit to its replacement." }),
  })
  .strict()
  .openapi("ClientPackage");

const packagesRoute = clientRoute({
  method: "get",
  path: "/api/packages",
  summary: "The packages sold today, in ops' order, priced for the client in their city",
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
    const on = indiaDate(c.var.deps.now());
    return c.json(
      { packages: await packagesOffered(db, { personId, on, city: await cityOfPerson(db, personId) }) },
      200,
    );
  });
}
