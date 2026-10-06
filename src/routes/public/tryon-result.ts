// The look goes to WhatsApp only, never to the site
// (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md), so no route hands
// a browser the look or a link to it. What the page asks on arrival:
// GET /api/tryon/availability, whether the try-on can run at all, and
// GET /api/tryon/look, whether this browser has had its one look. And
// GET /api/result/:token, the image behind the signed link a WhatsApp message
// carries, which the WhatsApp bridge fetches to send it.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { FAILURE_CODES, JOB_STATES } from "../../config/tryon.ts";
import { withinCeiling } from "../../domain/platform/ceilings.ts";
import { loadJob } from "../../domain/try-on/tryon.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { lookCookieJob } from "../../http/look-cookie.ts";
import { verifyToken } from "../../lib/signed-token.ts";
import { tryOnRuns } from "../../policy/tryon-delivery.ts";
import { statusOf } from "./tryon-generate.ts";

const AvailabilitySchema = z
  .object({
    available: z.boolean().openapi({
      description: "False while WhatsApp cannot send a look: the try-on does not run, and the page says so.",
    }),
  })
  .strict()
  .openapi("TryOnAvailability");

// Only whether the browser has had its look, and whether it failed: never the image, nor what was asked of it, which
// outlives an erasure on an expired job's row (src/domain/privacy/erasure.ts).
const LookSchema = z
  .object({
    job_id: z.uuid(),
    state: z.enum(JOB_STATES),
    failure_code: z.enum(FAILURE_CODES).optional().openapi({ description: "Only when state is failed." }),
  })
  .strict()
  .openapi("Look", { description: "The look this browser has had: its state alone. The look goes to WhatsApp only." });

const availabilityRoute = createRoute({
  method: "get",
  path: "/api/tryon/availability",
  summary: "Whether the try-on can run: its look is sent on WhatsApp, so not while WhatsApp cannot send it",
  responses: {
    200: { description: "Whether it runs", content: { "application/json": { schema: AvailabilitySchema } } },
  },
});

const lookRoute = createRoute({
  method: "get",
  path: "/api/tryon/look",
  summary: "Whether this browser has had its look, from its mm_look cookie",
  responses: {
    200: { description: "The browser's look", content: { "application/json": { schema: LookSchema } } },
    204: { description: "This browser has had no look yet" },
  },
});

const resultImageRoute = createRoute({
  method: "get",
  path: "/api/result/{token}",
  summary: "A result image, behind the signed link a WhatsApp message carries, which expires",
  request: { params: z.object({ token: z.string().min(1).max(600) }) },
  responses: {
    200: {
      description: "The image",
      content: {
        "image/png": { schema: z.string().openapi({ format: "binary" }) },
        "image/jpeg": { schema: z.string().openapi({ format: "binary" }) },
      },
    },
    404: errorResponse("not_found: the link is invalid or expired, or the result was deleted"),
    503: errorResponse("busy: today's result-read ceiling is reached"),
  },
});

export function registerTryonResult(app: App): void {
  app.openapi(availabilityRoute, (c) => c.json({ available: tryOnRuns(c.var.config.settings.messaging) }, 200));

  app.openapi(lookRoute, async (c) => {
    const jobId = await lookCookieJob(c);
    const job = jobId === null ? null : await loadJob(c.env.DB, jobId);
    if (job === null) return c.body(null, 204);
    // Once the look has expired, the browser has still had it: the upload link refuses it another (ADR 0104).
    return c.json(statusOf(job), 200);
  });

  app.openapi(resultImageRoute, async (c) => {
    const { settings } = c.var.config;
    const { deps } = c.var;
    const now = deps.now();

    const resultKey = await verifyToken(settings.tryon.linkSigningKey, "result", c.req.valid("param").token, now);
    if (resultKey === null) return refuse(c, "not_found");

    if (!(await withinCeiling(c.env.DB, deps.alert, "result_read", { now, settings }))) {
      return refuse(c, "busy");
    }

    const object = await c.env.RESULTS.get(resultKey);
    if (object === null) return refuse(c, "not_found");
    return c.body(object.body, 200, {
      "Content-Type": object.httpMetadata?.contentType ?? "image/png",
      "Content-Length": String(object.size),
      // The link itself expires within the hour; the bridge may keep the image for fifteen minutes of it.
      "Cache-Control": "private, max-age=900",
    });
  });
}
