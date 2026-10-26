// India Post's pincodes, for opening a city (src/domain/clients/pincode-directory.ts): the states and their districts,
// a district's pincodes with the name each area would take and what we already hold, and adding the ones ops tick or a
// file names, unserved. Serving them is POST /api/service-area's.

import { z } from "@hono/zod-openapi";
import {
  addFromDirectory,
  directoryDistricts,
  directoryPincodes,
  directoryStates,
} from "../../domain/clients/pincode-directory.ts";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { opsRoute } from "../../http/session-routes.ts";
import { routeReach } from "../../http/staff-access.ts";
import { reachesCity } from "../../policy/access.ts";
import { AREA_NAME } from "../../policy/area-names.ts";
import { AreaSchema } from "../schemas/service-area.ts";

/** One the service area can serve, as its own routes take it: 9 begins the Army Postal Service's, no address. */
const PINCODE = z.string().regex(/^[1-8]\d{5}$/);
const NAME = z.string().trim().min(1).max(80);

const statesRoute = opsRoute({
  method: "get",
  path: "/api/pincode-directory/states",
  summary: "The states India Post's directory lists",
  responses: {
    200: { description: "The states", ...json(z.object({ states: z.array(z.string()) }).strict()) },
  },
});

const districtsRoute = opsRoute({
  method: "get",
  path: "/api/pincode-directory/districts",
  summary: "A state's districts, each with its pincodes and how many the service area holds",
  request: { query: z.object({ state: NAME }) },
  responses: {
    200: {
      description: "The districts, in order",
      ...json(
        z
          .object({
            districts: z.array(
              z
                .object({
                  state: z.string(),
                  district: z.string(),
                  pincodes: z.number().int(),
                  held: z.number().int().openapi({ description: "Of them, those the service area holds." }),
                })
                .strict(),
            ),
          })
          .strict()
          .openapi("DirectoryDistricts"),
      ),
    },
    400: errorResponse("invalid_request: no state named"),
  },
});

const pincodesRoute = opsRoute({
  method: "get",
  path: "/api/pincode-directory/pincodes",
  summary: "The pincodes of up to ten of a state's districts, with what each area would be called",
  request: {
    query: z.object({
      state: NAME,
      district: z
        .union([NAME, z.array(NAME).min(1).max(10)])
        .transform((value) => (Array.isArray(value) ? value : [value]))
        .openapi({ description: "Named once for each district." }),
    }),
  },
  responses: {
    200: {
      description: "The pincodes, in order",
      ...json(
        z
          .object({
            pincodes: z.array(
              z
                .object({
                  pincode: z.string(),
                  district: z.string(),
                  area: z.string().openapi({ description: "The shortest of its post offices, until ops name it." }),
                  offices: z.array(z.string()),
                  latitude: z.union([z.number(), z.null()]),
                  longitude: z.union([z.number(), z.null()]),
                  held: z.union([
                    z.object({ city: z.string(), area: z.string(), served: z.boolean() }).strict(),
                    z.null(),
                  ]),
                })
                .strict(),
            ),
          })
          .strict()
          .openapi("DirectoryPincodes"),
      ),
    },
    400: errorResponse("invalid_request: no state, or no district or more than ten"),
  },
});

const addRoute = opsRoute({
  method: "post",
  path: "/api/pincodes/from-directory",
  summary: "Add pincodes the directory lists, unserved, in one of our cities",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            city: z.string().trim().min(1).max(60),
            pincodes: z
              .array(
                z
                  .object({
                    pincode: PINCODE,
                    area: z.string().trim().regex(AREA_NAME).optional().openapi({
                      description:
                        "What messages call the area. Left out, the directory's suggestion, until ops name it.",
                    }),
                  })
                  .strict(),
              )
              .min(1)
              .max(300),
          })
          .strict()
          .openapi("PincodesFromDirectory"),
      ),
    },
  },
  responses: {
    201: {
      description: "Those added, as the service area lists them",
      ...json(
        z
          .object({
            added: z.array(AreaSchema),
            held: z
              .array(z.string())
              .openapi({ description: "Pincodes the service area held already, left as they were." }),
            unlisted: z.array(z.string()).openapi({ description: "Pincodes the directory does not list, not added." }),
          })
          .strict(),
      ),
    },
    400: errorResponse("invalid_request: city for a city that is not one of ours"),
    403: errorResponse("access_required, or not_permitted: the city is outside the caller's Growth MANAGE"),
  },
});

export function registerPincodeDirectory(app: App): void {
  app.openapi(statesRoute, async (c) => c.json({ states: await directoryStates(c.env.DB) }, 200));

  app.openapi(districtsRoute, async (c) => {
    const { state } = c.req.valid("query");
    return c.json({ districts: await directoryDistricts(c.env.DB, state) }, 200);
  });

  app.openapi(pincodesRoute, async (c) => {
    const { state, district } = c.req.valid("query");
    return c.json({ pincodes: await directoryPincodes(c.env.DB, state, district) }, 200);
  });

  app.openapi(addRoute, async (c) => {
    const add = c.req.valid("json");
    if (!reachesCity(await routeReach(c), add.city)) return refuse(c, "not_permitted");
    const added = await addFromDirectory(c.env.DB, {
      add,
      actor: actorOf(c),
      requestId: c.var.requestId,
      now: c.var.deps.now(),
    });
    if (added === "unknown_city") return refuse(c, "invalid_request", ["city"]);
    return c.json(added, 201);
  });
}
