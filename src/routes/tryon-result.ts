// GET /api/tryon/result/:job_id: the result for the session that owns the
// job, as a signed link. GET /api/result/:token: the image behind that link,
// streamed from R2. WhatsApp copies use the same link with a longer expiry.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../app.ts";
import { FAILURE_CODES, JOB_STATES, RESULT_LINK_BROWSER_TTL_MS, RUNNING_STATES } from "../config/tryon.ts";
import { alertCeilingReached, takeFromCeiling } from "../domain/ceilings.ts";
import { loadJob } from "../domain/tryon.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { currentSession } from "../http/session.ts";
import { signToken, verifyToken } from "../lib/signed-token.ts";

export const ResultReadySchema = z
  .object({
    url: z.string().openapi({ description: "A path on this host that serves the image for fifteen minutes." }),
    expires_at: z.iso.datetime(),
  })
  .strict()
  .openapi("ResultReady");

export const ResultPendingSchema = z
  .object({ state: z.enum(JOB_STATES) })
  .strict()
  .openapi("ResultPending");

export const ResultFailedSchema = z
  .object({ state: z.literal("failed"), failure_code: z.enum(FAILURE_CODES) })
  .strict()
  .openapi("ResultFailed");

export const resultRoute = createRoute({
  method: "get",
  path: "/api/tryon/result/{job_id}",
  summary: "The result, for the session the gate set. Also serves every further look",
  request: { params: z.object({ job_id: z.uuid() }) },
  responses: {
    200: { description: "Ready", content: { "application/json": { schema: ResultReadySchema } } },
    202: { description: "Still rendering", content: { "application/json": { schema: ResultPendingSchema } } },
    403: errorResponse("session_required: no session, or not this job's"),
    404: errorResponse("not_found: no such job, or its result has been deleted"),
    422: { description: "Failed", content: { "application/json": { schema: ResultFailedSchema } } },
  },
});

export const resultImageRoute = createRoute({
  method: "get",
  path: "/api/result/{token}",
  summary: "A result image, behind a signed link that expires",
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
  app.openapi(resultRoute, async (c) => {
    const { requestId } = c.var;
    const now = c.var.deps.now();

    const session = await currentSession(c);
    if (session === null) return c.json(errorBody("session_required", requestId), 403);
    const job = await loadJob(c.env.DB, c.req.valid("param").job_id);
    if (job === null) return c.json(errorBody("not_found", requestId), 404);
    if (job.session_id !== session.id) return c.json(errorBody("session_required", requestId), 403);

    if (job.state === "ready" && job.result_key !== null) {
      const expiresAt = new Date(now.getTime() + RESULT_LINK_BROWSER_TTL_MS);
      const token = await signToken(c.var.config.settings.tryon.linkSigningKey, "result", job.result_key, expiresAt);
      return c.json({ url: `/api/result/${token}`, expires_at: expiresAt.toISOString() }, 200);
    }
    if (job.state === "failed") {
      return c.json({ state: "failed" as const, failure_code: job.failure_code ?? "render_failed" }, 422);
    }
    if (job.state === "awaiting_upload" || RUNNING_STATES.includes(job.state)) return c.json({ state: job.state }, 202);
    return c.json(errorBody("not_found", requestId), 404);
  });

  app.openapi(resultImageRoute, async (c) => {
    const { settings } = c.var.config;
    const { deps, requestId } = c.var;
    const now = deps.now();

    const resultKey = await verifyToken(settings.tryon.linkSigningKey, "result", c.req.valid("param").token, now);
    if (resultKey === null) return c.json(errorBody("not_found", requestId), 404);

    const ceiling = settings.tryon.resultReadDailyCeiling;
    if (!(await takeFromCeiling(c.env.DB, "result_read", ceiling, now))) {
      await alertCeilingReached(c.env.DB, deps.alert, "result_read", ceiling, now);
      return c.json(errorBody("busy", requestId), 503);
    }

    const object = await c.env.RESULTS.get(resultKey);
    if (object === null) return c.json(errorBody("not_found", requestId), 404);
    return c.body(object.body, 200, {
      "Content-Type": object.httpMetadata?.contentType ?? "image/png",
      "Content-Length": String(object.size),
      // The link itself expires; the browser may keep the image as long as the link lasts.
      "Cache-Control": "private, max-age=900",
    });
  });
}
