// A client's hair profile on their page in the console (docs/decisions/0106-a-clients-hair-profile.md). On the ops
// surface behind Access:
//
//   GET  /api/clients/:id/hair-profile   the profile as it stands, and every version
//   POST /api/clients/:id/hair-profile   ops' correction: a new version under the member of staff
//
// The technician records the profile at a visit (POST /api/tech/jobs/:id/profile); ops correct it here. A correction
// names the version it started from, and is refused, 409 superseded, once another has become the latest since, so
// it never silently replaces a newer one. It is audited by the client's ID and the version's, never a word of it.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../../http/context.ts";
import { staffMemberOf } from "../../http/audit.ts";
import { correctByOps, versionsOf } from "../../domain/hair-profiles.ts";
import { offeredProducts } from "../../domain/services.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { indiaDate } from "../../lib/india-time.ts";
import {
  BasedOnSchema,
  FitSpecSchema,
  HairProfileSchema,
  HairProfileVersionSchema,
  HistorySchema,
} from "../schemas/hair-profile.ts";
import { clientInReach } from "./clients.ts";

const clientId = z.object({ id: z.uuid() });
const unknownClient = errorResponse(
  "not_found: no such client, or the client has been erased or is outside the caller's cities",
);

const ClientHairProfileSchema = z
  .object({
    latest: z.union([HairProfileSchema, z.null()]).openapi({ description: "The latest version; null before one." }),
    versions: z.array(HairProfileVersionSchema).openapi({ description: "Every version, newest first." }),
    products: z.array(z.object({ tier: z.string(), name: z.string() }).strict()).openapi({
      description:
        "The products a correction may name: the hair systems offered today, as the technician's card lists them.",
    }),
  })
  .strict()
  .openapi("ClientHairProfile");

const CorrectionSchema = z
  .object({ fit: FitSpecSchema, history: z.union([HistorySchema, z.null()]), based_on: BasedOnSchema })
  .strict()
  .openapi("HairProfileCorrection", { description: "The whole profile as it now stands, sent as a new version." });

const readRoute = createRoute({
  method: "get",
  path: "/api/clients/{id}/hair-profile",
  summary: "The client's hair profile, and every version of it",
  request: { params: clientId },
  responses: {
    200: { description: "The profile", ...json(ClientHairProfileSchema) },
    403: errorResponse("access_required"),
    404: unknownClient,
  },
});

const correctRoute = createRoute({
  method: "post",
  path: "/api/clients/{id}/hair-profile",
  summary: "Correct the client's hair profile: a new version, under the member of staff, audited",
  request: { params: clientId, body: { required: true, ...json(CorrectionSchema) } },
  responses: {
    200: { description: "Recorded, and the profile as it now stands", ...json(ClientHairProfileSchema) },
    400: errorResponse("invalid_request: see error.fields"),
    403: errorResponse("access_required: no Access token, or a service token, which names no member of staff"),
    404: unknownClient,
    409: errorResponse("superseded: the latest version is no longer based_on; read the profile again"),
  },
});

/** The client's page's section: the latest version, every version, and the products to name. */
async function pageOf(c: Context<AppEnv>, personId: string): Promise<z.infer<typeof ClientHairProfileSchema>> {
  const versions = await versionsOf(c.env.DB, personId);
  const latest = versions[0];
  const hairSystems = await offeredProducts(c.env.DB, indiaDate(c.var.deps.now()));
  return {
    latest:
      latest === undefined
        ? null
        : { id: latest.id, recorded_at: latest.recorded_at, fit: latest.fit, history: latest.history },
    versions,
    products: hairSystems.map((service) => ({ tier: service.tier, name: service.name })),
  };
}

export function registerOpsHairProfile(app: App): void {
  app.openapi(readRoute, async (c) => {
    const { id } = c.req.valid("param");
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");
    return c.json(await pageOf(c, id), 200);
  });

  app.openapi(correctRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { fit, history, based_on } = c.req.valid("json");
    const { requestId, deps } = c.var;
    const staff = staffMemberOf(c);
    if (staff === null) return refuse(c, "access_required");
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");

    const written = await correctByOps(c.env.DB, {
      personId: id,
      staff: staff.id,
      fit,
      history,
      basedOn: based_on,
      now: deps.now(),
      audit: { surface: "ops", actor: staff, requestId },
    });
    if (written.kind === "invalid") return refuse(c, "invalid_request", written.fields);
    if (written.kind === "moved") return refuse(c, "superseded");
    return c.json(await pageOf(c, id), 200);
  });
}
