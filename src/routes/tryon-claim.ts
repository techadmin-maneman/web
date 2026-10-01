// POST /api/tryon/claim: the gate that asks where to send the look.
//
// The look goes to WhatsApp only, and never to the site
// (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md), so the gate comes
// before the render: the claim is accepted once the photograph is uploaded,
// and POST /api/tryon/generate refuses a job no claim has. A claim whose look
// could not be sent is refused before anything is written. What a claim writes
// is src/domain/tryon-claims.ts.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../http/context.ts";
import { CURRENT_NOTICE } from "../config/notices.ts";
import { TRYON_STAGES } from "../config/tryon.ts";
import { isSpent, takeOne } from "../domain/rate-limit.ts";
import { loadJob, type JobRow } from "../domain/tryon.ts";
import { leadOfOwnClaim, recordClaim, reserveJob } from "../domain/tryon-claims.ts";
import { errorBody, errorResponse, type ErrorCode } from "../http/errors.ts";
import { IdempotencyKeyHeaderSchema, onceForKey } from "../http/idempotency.ts";
import { visitorOf } from "../http/visitor.ts";
import { saltedHash } from "../lib/hash.ts";
import { indiaDate } from "../lib/india-time.ts";
import { INDIAN_MOBILE_PATTERN, toE164 } from "../lib/mobile.ts";
import { undelivered } from "../policy/tryon-delivery.ts";
import { heldBackByAllowlist, resultMessageCap } from "../queues/messaging.ts";

const AttributionSchema = z
  .object({
    utm_source: z.string().max(200).optional(),
    utm_medium: z.string().max(200).optional(),
    utm_campaign: z.string().max(200).optional(),
    utm_content: z.string().max(200).optional(),
    gclid: z.string().max(200).optional(),
    fbclid: z.string().max(200).optional(),
    referrer: z.string().max(500).optional(),
    landing_path: z.string().max(500).startsWith("/").optional(),
  })
  .strict()
  .openapi("Attribution", { description: "Where the visitor came from, as the page saw it. All optional." });

export const ClaimRequestSchema = z
  .object({
    job_id: z.uuid(),
    name: z.string().trim().min(1).max(60),
    mobile: z.string().regex(INDIAN_MOBILE_PATTERN).openapi({ example: "98100 00000" }),
    stage: z
      .enum(TRYON_STAGES)
      .openapi({ description: "The hair-loss stage the visitor picked, which the render is asked for next." }),
    notice_version: z
      .string()
      .min(1)
      .max(40)
      .optional()
      .openapi({
        example: "gate-v3",
        description:
          "The gate's notice the page showed: the current one, the only one a claim may record, when left out " +
          "(docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md).",
      }),
    attribution: AttributionSchema.optional(),
  })
  .strict()
  .openapi("ClaimRequest");

export const ClaimResponseSchema = z
  .object({ lead_id: z.uuid() })
  .strict()
  .openapi("ClaimResponse", { description: "Saved: the look goes to this number on WhatsApp once it is made." });
type ClaimResponse = z.infer<typeof ClaimResponseSchema>;

export const claimRoute = createRoute({
  method: "post",
  path: "/api/tryon/claim",
  summary: "The gate: where to send the look on WhatsApp, given before the look is made",
  request: {
    headers: IdempotencyKeyHeaderSchema,
    body: { required: true, content: { "application/json": { schema: ClaimRequestSchema } } },
  },
  responses: {
    201: { description: "Saved", content: { "application/json": { schema: ClaimResponseSchema } } },
    400: errorResponse("invalid_request: see error.fields"),
    404: errorResponse("not_found"),
    409: errorResponse(
      "job_not_claimable: no photo was uploaded, its render was asked for already, or it is another number's; " +
        "idempotency_in_progress",
    ),
    422: errorResponse("idempotency_key_reused"),
    429: errorResponse("rate_limited: this number has had its claims, or its looks, for today"),
    503: errorResponse("whatsapp_unavailable: WhatsApp cannot send the look, so the try-on does not run"),
  },
});

const IDEMPOTENCY_ROUTE = "POST /api/tryon/claim";

type Outcome =
  | { readonly ok: true; readonly body: ClaimResponse }
  | {
      readonly ok: false;
      readonly status: 400 | 404 | 409 | 429 | 503;
      readonly code: ErrorCode;
      readonly fields?: string[];
    };

export function registerTryonClaim(app: App): void {
  app.openapi(claimRoute, async (c) => {
    const request = c.req.valid("json");
    const { requestId } = c.var;
    const key = c.req.valid("header")["idempotency-key"];

    const run = await onceForKey(c, { route: IDEMPOTENCY_ROUTE, key, request }, () => claim(c, request));
    if (run.kind === "replay") return c.json(run.body, 201);
    if (run.kind === "in_progress") return c.json(errorBody("idempotency_in_progress", requestId), 409);
    if (run.kind === "key_reused") return c.json(errorBody("idempotency_key_reused", requestId), 422);

    const { outcome } = run;
    if (!outcome.ok) return c.json(errorBody(outcome.code, requestId, outcome.fields), outcome.status);
    return c.json(outcome.body, 201);
  });
}

/** A job the gate may claim: its photograph is uploaded, and its render is not yet asked for. */
function claimable(job: JobRow): boolean {
  return job.state === "awaiting_upload" && job.uploaded_at !== null;
}

async function claim(c: Context<AppEnv>, request: z.infer<typeof ClaimRequestSchema>): Promise<Outcome> {
  const { settings } = c.var.config;
  const { deps, log, requestId } = c.var;
  const db = c.env.DB;
  const now = deps.now();

  const mobileE164 = toE164(request.mobile);
  if (mobileE164 === null) return { ok: false, status: 400, code: "invalid_request", fields: ["mobile"] };
  const gateNotice = request.notice_version ?? CURRENT_NOTICE.result_delivery;
  if (gateNotice !== CURRENT_NOTICE.result_delivery) {
    return { ok: false, status: 400, code: "invalid_request", fields: ["notice_version"] };
  }

  const job = await loadJob(db, request.job_id);
  if (job === null) return { ok: false, status: 404, code: "not_found" };
  if (job.lead_id !== null) return claimAgain(c, job, mobileE164);
  if (!claimable(job)) return { ok: false, status: 409, code: "job_not_claimable" };

  const why = undelivered({
    messagingOn: settings.messaging.enabled,
    heldBack: heldBackByAllowlist(settings.messaging, {
      mobile_e164: mobileE164,
      name: request.name,
      kind: "tryon_result",
    }),
    capSpent: await isSpent(db, await resultMessageCap(settings, mobileE164, now)),
  });
  if (why === "number_capped") return { ok: false, status: 429, code: "rate_limited" };
  if (why !== null) {
    log.info("tryon_claim_undelivered", { job_id: job.id, why });
    return { ok: false, status: 503, code: "whatsapp_unavailable" };
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
  const leadId = await recordClaim(db, {
    job,
    mobileE164,
    name: request.name,
    stage: request.stage,
    gateNotice,
    attribution: request.attribution ?? {},
    ipHash: visitor.ipHash,
    requestId,
    now,
  });
  log.info("tryon_claimed", { lead_id: leadId, job_id: job.id });

  // Safe in D1 if sending fails: the sweeper re-enqueues pending leads.
  try {
    await c.env.CRM_QUEUE.send({ lead_id: leadId, request_id: requestId });
  } catch (error) {
    log.warn("crm_enqueue_failed", { lead_id: leadId, error });
  }
  return { ok: true, body: { lead_id: leadId } };
}

/** A job already claimed, claimed again: its lead for its own number, refused for any other. */
async function claimAgain(c: Context<AppEnv>, job: JobRow, mobileE164: string): Promise<Outcome> {
  const leadId = await leadOfOwnClaim(c.env.DB, job, mobileE164);
  if (leadId === null) return { ok: false, status: 409, code: "job_not_claimable" };
  return { ok: true, body: { lead_id: leadId } };
}
