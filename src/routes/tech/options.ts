// A consultation's Options on the technician's phone (src/domain/field/job-options.ts): the packages on sale with what
// each costs the client, from the price book, and the looks the client made with the try-on, each image read through
// the job under the card's own unlock and never cached.

import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { optionsJob, packageOptions } from "../../domain/field/job-options.ts";
import { clientTryOns, ownTryOnImage } from "../../domain/try-on/client-try-ons.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { techRoute } from "../../http/session-routes.ts";
import { technicianOf } from "../../http/technician-session.ts";
import type { ImageType } from "../../lib/image-bytes.ts";
import { PriceSchema } from "../schemas/booking.ts";

const jobId = z.object({ id: z.uuid() });

const OptionsSchema = z
  .object({
    packages: z.array(
      z
        .object({
          code: z.string(),
          name: z.string(),
          description: z.union([z.string(), z.null()]),
          first_fit: PriceSchema.openapi({
            description:
              "The hair system made to the client's profile and the service visit; from the cheapest before.",
          }),
          service: z.union([PriceSchema, z.null()]),
          service_every_days: z.number().int(),
          replacement: z
            .union([PriceSchema, z.null()])
            .openapi({ description: "The replacement and its service visit, as the visit is sold." }),
          replace_after_months: z.number().int(),
        })
        .strict(),
    ),
    looks: z.array(
      z
        .object({
          id: z.uuid(),
          made_on: z.iso.date(),
          url: z.string().openapi({ description: "The look's image, through the job." }),
        })
        .strict(),
    ),
  })
  .strict()
  .openapi("TechnicianOptions");

const SESSION_REFUSED = errorResponse(
  "session_required; device_revoked; technician_inactive: ops switched the technician off",
);

const optionsRoute = techRoute({
  method: "get",
  path: "/api/tech/jobs/{id}/options",
  summary: "A consultation's packages and prices, and the client's try-on looks, under the card's own unlock",
  request: { params: jobId },
  responses: {
    200: { description: "The options", ...json(OptionsSchema) },
    401: SESSION_REFUSED,
    404: errorResponse("not_found: no such consultation of this technician's, or not unlocked yet"),
  },
});

const lookRoute = techRoute({
  method: "get",
  path: "/api/tech/jobs/{id}/looks/{look}",
  summary: "One of the client's try-on looks, under the card's own unlock, never cached",
  request: { params: jobId.extend({ look: z.uuid() }) },
  responses: {
    200: {
      description: "The image",
      content: { "image/jpeg": { schema: z.string() }, "image/png": { schema: z.string() } },
    },
    401: SESSION_REFUSED,
    404: errorResponse("not_found: no such consultation of this technician's, not unlocked yet, or no such look held"),
  },
});

async function jobOf(c: Context<AppEnv>, id: string) {
  return optionsJob(c.env.DB, {
    technicianId: technicianOf(c).technicianId,
    jobId: id,
    now: c.var.deps.now(),
    unlockHour: (await opsInputs(c)).addressUnlockHour,
  });
}

export function registerTechOptions(app: App): void {
  app.openapi(optionsRoute, async (c) => {
    const job = await jobOf(c, c.req.valid("param").id);
    if (job === null) return refuse(c, "not_found");
    const [packages, tryOns] = await Promise.all([
      packageOptions(c.env.DB, job),
      clientTryOns(c.env.DB, job.personId, c.var.config.settings.tryon.linkSigningKey, c.var.deps.now()),
    ]);
    // The looks still held, newest first; a photograph alone is the client's, not for the phone.
    const urls = tryOns.flatMap((each) =>
      each.look === null
        ? []
        : [{ id: each.id, made_on: each.made_on, url: `/api/tech/jobs/${job.id}/looks/${each.id}` }],
    );
    return c.json({ packages: [...packages], looks: urls }, 200);
  });

  app.openapi(lookRoute, async (c) => {
    const { id, look } = c.req.valid("param");
    const job = await jobOf(c, id);
    const held =
      job === null
        ? null
        : await ownTryOnImage({
            db: c.env.DB,
            personId: job.personId,
            jobId: look,
            image: "look",
            now: c.var.deps.now(),
          });
    const object = held === null ? null : await c.env[held.bucket].get(held.key);
    if (held === null || object === null) return refuse(c, "not_found");
    // Each bucket holds only JPEG and PNG, each checked on its way in (src/domain/try-on/photo.ts, src/queues/render.ts).
    const type: ImageType = object.httpMetadata?.contentType === "image/png" ? "image/png" : "image/jpeg";
    // A client's look stays off a technician's phone: neither the browser nor the service worker keeps it.
    return new Response(object.body, { headers: { "Content-Type": type, "Cache-Control": "private, no-store" } });
  });
}
