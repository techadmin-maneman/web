// POST /api/tryon/claim: the gate that asks where to send the result.
//
// Accepted while the render is still running, not only once it is ready: the
// design shows the gate after 20 seconds, and renders take 30 to 180, so the
// lead is captured the moment the gate is submitted. The person gets a
// session (the mm_tryon cookie) to see the result. What a claim writes is
// src/domain/tryon-claims.ts.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../http/context.ts";
import { onAllowlist, type MessagingSettings } from "../config/settings.ts";
import { takeOne } from "../domain/rate-limit.ts";
import { loadJob, loadSession, type JobRow } from "../domain/tryon.ts";
import { reclaimJob, recordClaim, reserveJob } from "../domain/tryon-claims.ts";
import { errorBody, errorResponse, type ErrorCode } from "../http/errors.ts";
import { IdempotencyKeyHeaderSchema, onceForKey } from "../http/idempotency.ts";
import { setSessionCookie } from "../http/tryon-session.ts";
import { visitorOf } from "../http/visitor.ts";
import { saltedHash } from "../lib/hash.ts";
import { indiaDate } from "../lib/india-time.ts";
import { INDIAN_MOBILE_PATTERN, toE164 } from "../lib/mobile.ts";
import type { MessagingMessage } from "../queues/messaging.ts";
import { AttributionSchema } from "./lead.ts";

export const ClaimRequestSchema = z
  .object({
    job_id: z.uuid(),
    name: z.string().trim().min(1).max(60),
    mobile: z.string().regex(INDIAN_MOBILE_PATTERN).openapi({ example: "98100 00000" }),
    attribution: AttributionSchema.optional(),
  })
  .strict()
  .openapi("ClaimRequest");

export const ClaimResponseSchema = z
  .object({
    lead_id: z.uuid(),
    whatsapp_copy: z.boolean().openapi({
      description:
        "True only if messaging is on and may reach this number: the page may then say a copy is on its way.",
    }),
  })
  .strict()
  .openapi("ClaimResponse");
type ClaimResponse = z.infer<typeof ClaimResponseSchema>;

export const claimRoute = createRoute({
  method: "post",
  path: "/api/tryon/claim",
  summary: "The gate: save the lead and start a session, whether or not the result is ready",
  request: {
    headers: IdempotencyKeyHeaderSchema,
    body: { required: true, content: { "application/json": { schema: ClaimRequestSchema } } },
  },
  responses: {
    201: {
      description: "Saved. Sets the mm_tryon cookie.",
      content: { "application/json": { schema: ClaimResponseSchema } },
    },
    400: errorResponse("invalid_request: see error.fields"),
    404: errorResponse("not_found"),
    409: errorResponse(
      "job_not_claimable: no render was started, it failed, or it is another number's; idempotency_in_progress",
    ),
    422: errorResponse("idempotency_key_reused"),
    429: errorResponse("rate_limited: too many claims from this number today"),
  },
});

const IDEMPOTENCY_ROUTE = "POST /api/tryon/claim";

type Outcome =
  | { readonly ok: true; readonly body: ClaimResponse; readonly sessionId: string }
  | {
      readonly ok: false;
      readonly status: 400 | 404 | 409 | 429;
      readonly code: ErrorCode;
      readonly fields?: string[];
    };

export function registerTryonClaim(app: App): void {
  app.openapi(claimRoute, async (c) => {
    const request = c.req.valid("json");
    const { requestId } = c.var;
    const key = c.req.valid("header")["idempotency-key"];

    const run = await onceForKey(c, { route: IDEMPOTENCY_ROUTE, key, request }, () => claim(c, request));
    if (run.kind === "replay") {
      await restoreSessionCookie(c, request.job_id);
      return c.json(run.body, 201);
    }
    if (run.kind === "in_progress") return c.json(errorBody("idempotency_in_progress", requestId), 409);
    if (run.kind === "key_reused") return c.json(errorBody("idempotency_key_reused", requestId), 422);

    const { outcome } = run;
    if (!outcome.ok) return c.json(errorBody(outcome.code, requestId, outcome.fields), outcome.status);
    setSessionCookie(c, outcome.sessionId);
    return c.json(outcome.body, 201);
  });
}

async function claim(c: Context<AppEnv>, request: z.infer<typeof ClaimRequestSchema>): Promise<Outcome> {
  const { settings } = c.var.config;
  const { deps, log, requestId } = c.var;
  const db = c.env.DB;
  const now = deps.now();

  const mobileE164 = toE164(request.mobile);
  if (mobileE164 === null) return { ok: false, status: 400, code: "invalid_request", fields: ["mobile"] };

  const job = await loadJob(db, request.job_id);
  if (job === null) return { ok: false, status: 404, code: "not_found" };
  if (job.lead_id !== null) return reclaim(c, job, mobileE164);
  if (job.state === "awaiting_upload" || job.state === "failed" || job.state === "expired" || job.stage === null) {
    return { ok: false, status: 409, code: "job_not_claimable" };
  }

  const withinLimit = await takeOne(db, {
    scope: "tryon:claim:mobile",
    key: await saltedHash(settings.ipHashSalt, `mobile:${mobileE164}`),
    window: indiaDate(now),
    limit: settings.tryon.claimMobileDailyLimit,
  });
  if (!withinLimit) return { ok: false, status: 429, code: "rate_limited" };

  if (!(await reserveJob(db, job.id, now))) return { ok: false, status: 409, code: "job_not_claimable" };
  const visitor = await visitorOf(c);
  const claimed = await recordClaim(db, {
    job,
    mobileE164,
    name: request.name,
    attribution: request.attribution ?? {},
    ipHash: visitor.ipHash,
    requestId,
    now,
  });
  const { leadId, messageId } = claimed;
  log.info("tryon_claimed", { lead_id: leadId, job_id: job.id, job_state: job.state });

  // Both are safe in D1 if sending fails: the sweeper re-enqueues pending leads and queued messages.
  try {
    await c.env.CRM_QUEUE.send({ lead_id: leadId, request_id: requestId });
  } catch (error) {
    log.warn("crm_enqueue_failed", { lead_id: leadId, error });
  }
  if (claimed.messageState === "queued") {
    try {
      await c.env.MESSAGE_QUEUE.send({ message_id: messageId, request_id: requestId } satisfies MessagingMessage);
    } catch (error) {
      log.warn("message_enqueue_failed", { message_id: messageId, error });
    }
  }

  return {
    ok: true,
    body: { lead_id: leadId, whatsapp_copy: promisesCopy(settings.messaging, mobileE164) },
    sessionId: claimed.sessionId,
  };
}

/** The page may say a copy is on its way only when the messaging queue will send it, not skip it. */
const promisesCopy = (messaging: MessagingSettings, mobileE164: string): boolean =>
  messaging.enabled && onAllowlist(messaging, mobileE164);

/** A job already claimed, claimed again: a fresh session for its own number, refused for any other. */
async function reclaim(c: Context<AppEnv>, job: JobRow, mobileE164: string): Promise<Outcome> {
  const reclaimed = await reclaimJob(c.env.DB, { job, mobileE164, now: c.var.deps.now() });
  if (reclaimed === null) return { ok: false, status: 409, code: "job_not_claimable" };
  return {
    ok: true,
    body: { lead_id: reclaimed.leadId, whatsapp_copy: promisesCopy(c.var.config.settings.messaging, mobileE164) },
    sessionId: reclaimed.sessionId,
  };
}

/** A replayed claim sets the cookie again, if the job's session is still valid. */
async function restoreSessionCookie(c: Context<AppEnv>, jobId: string): Promise<void> {
  const job = await loadJob(c.env.DB, jobId);
  const sessionId = job?.session_id ?? null;
  if (sessionId === null) return;
  const session = await loadSession(c.env.DB, sessionId, c.var.deps.now());
  if (session !== null) setSessionCookie(c, session.id);
}
