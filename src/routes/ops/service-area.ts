// The service area in the console (./settings.ts): every pincode, its city, whether we go there and who waits there;
// which pincodes we go to and what their areas are called; and a pincode added unserved. Serving a pincode
// launches it (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import { createRoute, z } from "@hono/zod-openapi";
import { addPincode, serviceArea, setServiceArea } from "../../domain/clients/service-area.ts";
import { listCities } from "../../domain/dispatch/cities.ts";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { queuePacedMessages } from "../../http/queue-message.ts";
import { routeReach } from "../../http/staff-access.ts";
import { reachesCity } from "../../policy/access.ts";

/**
 * An area's name, as a launch message and the waitlist show it: a letter or a
 * digit first, so a spreadsheet opening the exported list never reads it as a
 * formula, then letters, digits, spaces and . , ' ( ) & -.
 */
const AREA_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .,'()&-]{1,39}$/u;

const AreaSchema = z
  .object({
    pincode: z.string(),
    area: z.string(),
    city: z.string(),
    served: z.boolean(),
    launch_on: z.union([z.iso.date(), z.null()]),
    waiting: z.number().int().openapi({ description: "How many are on its waitlist." }),
    to_alert: z.number().int().openapi({
      description: "How many of them serving it would tell now: those who asked, and have not been told yet.",
    }),
  })
  .strict()
  .openapi("ServedPincode");

const serviceAreaRoute = createRoute({
  method: "get",
  path: "/api/service-area",
  summary: "Every pincode we hold, its city, and whether a technician goes there",
  responses: {
    200: {
      description: "Pincodes",
      ...json(
        z
          .object({
            pincodes: z.array(AreaSchema),
            cities: z.array(z.string()).openapi({ description: "Our cities, which a pincode added must be in." }),
          })
          .strict(),
      ),
    },
    403: errorResponse("access_required"),
  },
});

const addPincodeRoute = createRoute({
  method: "post",
  path: "/api/pincodes",
  summary: "Add a pincode the service area does not hold, unserved, in one of our cities",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            pincode: z.string().regex(/^[1-8]\d{5}$/),
            area: z.string().trim().regex(AREA_NAME).openapi({ description: "What messages call the area." }),
            city: z.string().trim().min(1).max(60),
          })
          .strict()
          .openapi("NewPincode"),
      ),
    },
  },
  responses: {
    201: { description: "The pincode, as the service area now lists it", ...json(AreaSchema) },
    400: errorResponse("invalid_request: fields names the box refused, city for a city that is not one of ours"),
    403: errorResponse("access_required, or not_permitted: the city is outside the caller's Growth MANAGE"),
    409: errorResponse("pincode_held: the service area holds that pincode already"),
  },
});

const setServiceAreaRoute = createRoute({
  method: "post",
  path: "/api/service-area",
  summary: "Which pincodes we go to, and from when. Only the pincodes named change",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            changes: z
              .array(
                z
                  .object({
                    pincode: z.string().regex(/^[1-8]\d{5}$/),
                    served: z.boolean(),
                    launch_on: z.union([z.iso.date(), z.null()]),
                    area: z.string().trim().regex(AREA_NAME).optional().openapi({
                      description: "A better name for the area than its post office's. Left out, the name stays.",
                    }),
                  })
                  .strict(),
              )
              .min(1)
              .max(500),
          })
          .strict()
          .openapi("ServiceAreaChange"),
      ),
    },
  },
  responses: {
    200: {
      description: "What changed",
      ...json(
        z
          .object({
            changed: z.number().int(),
            served: z.number().int(),
            alerted: z
              .number()
              .int()
              .openapi({ description: "Launch alerts queued for the pincodes it began serving." }),
          })
          .strict(),
      ),
    },
    400: errorResponse(
      "invalid_request: fields names a pincode we do not hold. launch_in_future: fields names a pincode it would " +
        "serve from a day still to come. no_service_area: it would leave none served",
    ),
    403: errorResponse("access_required"),
  },
});

export function registerOpsServiceArea(app: App): void {
  app.openapi(serviceAreaRoute, async (c) => {
    const [pincodes, cities] = await Promise.all([serviceArea(c.env.DB), listCities(c.env.DB)]);
    return c.json({ pincodes, cities: cities.map((city) => city.name) }, 200);
  });

  app.openapi(setServiceAreaRoute, async (c) => {
    const result = await setServiceArea(c.env.DB, {
      changes: c.req.valid("json").changes,
      actor: actorOf(c),
      requestId: c.var.requestId,
      now: c.var.deps.now(),
    });
    if ("kind" in result) {
      c.var.log.warn("service_area_refused", { reason: result.kind });
      if (result.kind === "empty_area") return refuse(c, "no_service_area");
      if (result.kind === "launch_in_future") {
        return refuse(c, "launch_in_future", result.pincodes);
      }
      return refuse(c, "invalid_request", result.pincodes);
    }
    await queuePacedMessages(c, result.alerts);
    return c.json({ changed: result.changed.length, served: result.served, alerted: result.alerts.length }, 200);
  });

  app.openapi(addPincodeRoute, async (c) => {
    const pincode = c.req.valid("json");
    // Whether we serve a pincode is no secret, as the site says so to anyone, so one elsewhere is refused, not hidden.
    if (!reachesCity(await routeReach(c), pincode.city)) {
      return refuse(c, "not_permitted");
    }
    const added = await addPincode(c.env.DB, {
      pincode,
      actor: actorOf(c),
      requestId: c.var.requestId,
      now: c.var.deps.now(),
    });
    if (added === "held") return refuse(c, "pincode_held");
    if (added === "unknown_city") return refuse(c, "invalid_request", ["city"]);
    return c.json(added, 201);
  });
}
