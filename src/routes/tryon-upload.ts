// POST /api/tryon/upload-url and PUT /api/tryon/upload/:job_id.
//
// The photo comes to this API, not straight to R2. A presigned R2 link could
// be replayed until it expires, and each replay is a billed R2 write that no
// ceiling here could count (docs/decisions/0014-try-on-api.md). Through the
// API, each job writes to R2 exactly once.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../app.ts";
import { findNotice } from "../config/notices.ts";
import { MAX_UPLOAD_BYTES, UPLOAD_LINK_TTL_MS } from "../config/tryon.ts";
import { alertCeilingReached, takeFromCeiling } from "../domain/ceilings.ts";
import { takeOne } from "../domain/rate-limit.ts";
import { loadJob } from "../domain/tryon.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { currentSession, lookCookieJob } from "../http/session.ts";
import { checkTurnstile, visitorOf } from "../http/visitor.ts";
import { checkPhoto } from "../domain/photo.ts";
import { indiaHour } from "../lib/india-time.ts";
import { signToken, verifyToken } from "../lib/signed-token.ts";

export const UploadUrlRequestSchema = z
  .object({
    photo_consent: z.literal(true).openapi({ description: "The photo notice was agreed to." }),
    notice_version: z.string().min(1).max(40).openapi({ example: "photo-v1", description: "The photo notice shown." }),
    turnstile_token: z.string().min(1).max(2048),
  })
  .strict()
  .openapi("UploadUrlRequest");

export const UploadUrlResponseSchema = z
  .object({
    job_id: z.uuid(),
    upload_url: z.string().openapi({
      description: "A path on this host. PUT the photo there within five minutes, as image/jpeg or image/png.",
    }),
    expires_at: z.iso.datetime(),
  })
  .strict()
  .openapi("UploadUrlResponse");

export const uploadUrlRoute = createRoute({
  method: "post",
  path: "/api/tryon/upload-url",
  summary: "Record the photo consent and get a link to upload one photo",
  request: { body: { required: true, content: { "application/json": { schema: UploadUrlRequestSchema } } } },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: UploadUrlResponseSchema } } },
    400: errorResponse("invalid_request: see error.fields"),
    403: errorResponse("turnstile_failed; look_limit_reached: this browser already has its look"),
    429: errorResponse("rate_limited: too many uploads from this address this hour"),
    503: errorResponse("busy: today's upload ceiling is reached; unavailable: Turnstile could not be reached"),
  },
});

export const uploadRoute = createRoute({
  method: "put",
  path: "/api/tryon/upload/{job_id}",
  summary: "Upload the photo: a JPEG or PNG, at most 5 MB and 200 to 4090 px a side",
  request: {
    params: z.object({ job_id: z.uuid() }),
    query: z.object({ token: z.string().min(1).max(500) }),
  },
  responses: {
    204: { description: "Received" },
    404: errorResponse("not_found: no such job, or the link has expired"),
    409: errorResponse("upload_already_received"),
    422: errorResponse("photo_invalid_file: not a JPEG or PNG, over 5 MB, or the wrong size"),
  },
});

export function registerTryonUpload(app: App): void {
  app.openapi(uploadUrlRoute, async (c) => {
    const request = c.req.valid("json");
    const { settings } = c.var.config;
    const { deps, requestId } = c.var;
    const db = c.env.DB;
    const now = deps.now();

    if (findNotice(request.notice_version)?.purpose !== "tryon_photo") {
      return c.json(errorBody("invalid_request", requestId, ["notice_version"]), 400);
    }

    // One look per visitor: a browser whose last render did not fail gets no second photo.
    const lastJobId = await lookCookieJob(c);
    const lastJob = lastJobId === null ? null : await loadJob(db, lastJobId);
    if (lastJob !== null && lastJob.state !== "failed") return c.json(errorBody("look_limit_reached", requestId), 403);

    const visitor = await visitorOf(c);
    const turnstile = await checkTurnstile(c, request.turnstile_token, visitor);
    if (turnstile === "rejected") return c.json(errorBody("turnstile_failed", requestId), 403);
    if (turnstile === "unavailable") return c.json(errorBody("unavailable", requestId), 503);

    const { tryon } = settings;
    const withinLimit = await takeOne(db, {
      scope: "tryon:upload:ip",
      key: visitor.ipHash,
      window: indiaHour(now),
      limit: tryon.uploadIpHourlyLimit,
    });
    if (!withinLimit) return c.json(errorBody("rate_limited", requestId), 429);

    if (!(await takeFromCeiling(db, "upload", tryon.uploadDailyCeiling, now))) {
      await alertCeilingReached(db, deps.alert, "upload", tryon.uploadDailyCeiling, now);
      return c.json(errorBody("busy", requestId), 503);
    }

    // A visitor who passed the gate keeps their session for a new photo, so its result needs no second gate
    // (docs/decisions/0014-try-on-api.md, "Jobs, looks and sessions").
    const session = await currentSession(c);
    const jobId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO tryon_jobs (id, created_at, upload_key, state, person_id, session_id, photo_consent_version,
           photo_consent_at, ip_hash, request_id)
         VALUES (?1, ?2, ?3, 'awaiting_upload', ?4, ?5, ?6, ?2, ?7, ?8)`,
      )
      .bind(
        jobId,
        now.toISOString(),
        `uploads/${jobId}`,
        session?.person_id ?? null,
        session?.id ?? null,
        request.notice_version,
        visitor.ipHash,
        requestId,
      )
      .run();

    const expiresAt = new Date(now.getTime() + UPLOAD_LINK_TTL_MS);
    const token = await signToken(tryon.linkSigningKey, "upload", jobId, expiresAt);
    c.var.log.info("tryon_upload_link", { job_id: jobId, session: session !== null });
    return c.json(
      { job_id: jobId, upload_url: `/api/tryon/upload/${jobId}?token=${token}`, expires_at: expiresAt.toISOString() },
      201,
    );
  });

  app.openapi(uploadRoute, async (c) => {
    const { job_id: jobId } = c.req.valid("param");
    const { token } = c.req.valid("query");
    const { settings } = c.var.config;
    const { deps, requestId } = c.var;
    const db = c.env.DB;
    const now = deps.now();

    const subject = await verifyToken(settings.tryon.linkSigningKey, "upload", token, now);
    const job = subject === jobId ? await loadJob(db, jobId) : null;
    if (job === null) return c.json(errorBody("not_found", requestId), 404);
    if (job.state !== "awaiting_upload" || job.uploaded_at !== null) {
      return c.json(errorBody("upload_already_received", requestId), 409);
    }

    const declared = Number(c.req.header("Content-Length") ?? "0");
    if (declared > MAX_UPLOAD_BYTES) return c.json(errorBody("photo_invalid_file", requestId), 422);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const photo = checkPhoto(bytes);
    if (!photo.ok) {
      c.var.log.info("tryon_upload_refused", { job_id: jobId, problem: photo.problem });
      return c.json(errorBody("photo_invalid_file", requestId), 422);
    }

    // Claim the one write this job gets, before making it.
    const claimed = await db
      .prepare(
        "UPDATE tryon_jobs SET uploaded_at = ?2 WHERE id = ?1 AND state = 'awaiting_upload' AND uploaded_at IS NULL RETURNING id",
      )
      .bind(jobId, now.toISOString())
      .first();
    if (claimed === null) return c.json(errorBody("upload_already_received", requestId), 409);

    try {
      await c.env.UPLOADS.put(job.upload_key, bytes, { httpMetadata: { contentType: photo.type } });
    } catch (error) {
      await db.prepare("UPDATE tryon_jobs SET uploaded_at = NULL WHERE id = ?1").bind(jobId).run();
      throw error;
    }
    c.var.log.info("tryon_uploaded", { job_id: jobId, bytes: bytes.byteLength, type: photo.type });
    return c.body(null, 204);
  });
}
