// GET /api/tryon/result/:job_id: the result, as a signed link, for the
// session the gate gave, or for the browser that made the look (its signed
// mm_look cookie). The number at the gate is optional, so the browser's own
// look is enough. GET /api/tryon/look: which look this browser has, so a
// returning visitor sees it again. GET /api/result/:token: the image behind a
// link, streamed from R2. WhatsApp copies use the same link with a longer
// expiry.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { PRESET_IDS, type PresetId } from "../config/presets.ts";
import {
  FAILURE_CODES,
  JOB_STATES,
  RESULT_LINK_BROWSER_TTL_MS,
  RUNNING_STATES,
  TRYON_STAGES,
} from "../config/tryon.ts";
import { alertCeilingReached, takeFromCeiling } from "../domain/ceilings.ts";
import { loadJob } from "../domain/tryon.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { currentSession, lookCookieJob } from "../http/tryon-session.ts";
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

export const LookSchema = z
  .object({
    job_id: z.uuid(),
    state: z.enum(JOB_STATES),
    stage: z.enum(TRYON_STAGES),
    preset: z.enum(PRESET_IDS),
    failure_code: z.enum(FAILURE_CODES).optional().openapi({ description: "Only when state is failed." }),
  })
  .strict()
  .openapi("Look");

export const lookRoute = createRoute({
  method: "get",
  path: "/api/tryon/look",
  summary: "The look this browser already has, from its mm_look cookie",
  responses: {
    200: { description: "The browser's look", content: { "application/json": { schema: LookSchema } } },
    404: errorResponse("not_found: this browser has no look, or its result has been deleted"),
  },
});

export const resultRoute = createRoute({
  method: "get",
  path: "/api/tryon/result/{job_id}",
  summary: "The result, for the gate's session or the browser that made the look",
  request: { params: z.object({ job_id: z.uuid() }) },
  responses: {
    200: { description: "Ready", content: { "application/json": { schema: ResultReadySchema } } },
    202: { description: "Still rendering", content: { "application/json": { schema: ResultPendingSchema } } },
    403: errorResponse("session_required: neither the gate's session nor this browser's look is this job's"),
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

    const jobId = c.req.valid("param").job_id;
    const job = await loadJob(c.env.DB, jobId);
    const session = await currentSession(c);
    const ownedBySession = session !== null && job !== null && job.session_id === session.id;
    const madeByThisBrowser = (await lookCookieJob(c)) === jobId;
    // Neither: 403 whether or not the job exists, so a job ID alone reveals nothing.
    if (!ownedBySession && !madeByThisBrowser) return c.json(errorBody("session_required", requestId), 403);
    if (job === null) return c.json(errorBody("not_found", requestId), 404);

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

  app.openapi(lookRoute, async (c) => {
    const jobId = await lookCookieJob(c);
    const job = jobId === null ? null : await loadJob(c.env.DB, jobId);
    if (job === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    // An expired job's photo and result are gone; so, as far as the browser is concerned, is its look.
    if (job.stage === null || job.preset === null || job.state === "expired") {
      return c.json(errorBody("not_found", c.var.requestId), 404);
    }
    const look = { job_id: job.id, state: job.state, stage: job.stage, preset: job.preset as PresetId };
    return c.json(job.failure_code === null ? look : { ...look, failure_code: job.failure_code }, 200);
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
