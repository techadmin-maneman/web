// POST /api/tryon/claim: the gate that asks where to send the result.
//
// Accepted while the render is still running, not only once it is ready: the
// design shows the gate after 20 seconds, and renders take 30 to 180, so the
// lead is captured the moment the gate is submitted. The person gets a
// session (the mm_tryon cookie) to see the result.
//
// A try-on lead does not make the person contactable: the gate's consent
// permits sending this result and nothing else (docs/decisions/0012-zoho-sync.md).

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../http/context.ts";
import { CURRENT_NOTICE } from "../config/notices.ts";
import { onAllowlist, type MessagingSettings } from "../config/settings.ts";
import { SESSION_TTL_MS } from "../config/tryon.ts";
import { takeOne } from "../domain/rate-limit.ts";
import { loadJob, loadSession, recordEvent, type JobRow } from "../domain/tryon.ts";
import { errorBody, errorResponse, type ErrorCode } from "../http/errors.ts";
import { IdempotencyKeyHeaderSchema, onceForKey } from "../http/idempotency.ts";
import { setSessionCookie } from "../http/session.ts";
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

  // Reserve the job first, so two claims at once cannot both create a lead.
  const reserved = await db
    .prepare("UPDATE tryon_jobs SET claimed_at = ?2 WHERE id = ?1 AND claimed_at IS NULL RETURNING id")
    .bind(job.id, now.toISOString())
    .first();
  if (reserved === null) return { ok: false, status: 409, code: "job_not_claimable" };

  const leadId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const at = now.toISOString();
  const personId = "(SELECT id FROM people WHERE mobile_e164 = ?)";
  const visitor = await visitorOf(c);
  const attribution = request.attribution ?? {};
  // The result may already be ready; then the message can go straight away.
  const messageState = job.state === "ready" ? "queued" : "waiting";

  try {
    await db.batch([
      // A returning person keeps their ID and whether they are contactable.
      db
        .prepare(
          `INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES (?, ?, ?, ?, 0)
           ON CONFLICT (mobile_e164) DO UPDATE SET name = excluded.name`,
        )
        .bind(crypto.randomUUID(), at, mobileE164, request.name),
      db
        .prepare(
          `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, ip_hash)
           VALUES (?, ${personId}, 'result_delivery', ?, 1, ?, ?)`,
        )
        .bind(crypto.randomUUID(), mobileE164, CURRENT_NOTICE.result_delivery, at, visitor.ipHash),
      // The photo consent was given before the upload; it is recorded now that we know who gave it.
      db
        .prepare(
          `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, ip_hash)
           VALUES (?, ${personId}, 'tryon_photo', ?, 1, ?, ?)`,
        )
        .bind(crypto.randomUUID(), mobileE164, job.photo_consent_version, job.photo_consent_at, job.ip_hash),
      db
        .prepare(
          `INSERT INTO leads (id, person_id, created_at, source, loss_extent, utm_source, utm_medium, utm_campaign,
             utm_content, gclid, fbclid, referrer, landing_path, request_id)
           VALUES (?, ${personId}, ?, 'tryon', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          leadId,
          mobileE164,
          at,
          job.stage,
          attribution.utm_source ?? null,
          attribution.utm_medium ?? null,
          attribution.utm_campaign ?? null,
          attribution.utm_content ?? null,
          attribution.gclid ?? null,
          attribution.fbclid ?? null,
          attribution.referrer ?? null,
          attribution.landing_path ?? null,
          requestId,
        ),
      db
        .prepare(`INSERT INTO tryon_sessions (id, person_id, created_at, expires_at) VALUES (?, ${personId}, ?, ?)`)
        .bind(sessionId, mobileE164, at, new Date(now.getTime() + SESSION_TTL_MS).toISOString()),
      db
        .prepare(`UPDATE tryon_jobs SET person_id = ${personId}, lead_id = ?, session_id = ? WHERE id = ?`)
        .bind(mobileE164, leadId, sessionId, job.id),
      db
        .prepare(
          `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state, queued_at)
           VALUES (?, ?, ${personId}, 'tryon_result', ?, ?, ?)`,
        )
        .bind(messageId, at, mobileE164, job.id, messageState, messageState === "queued" ? at : null),
      recordEvent(db, "tryon_claimed", leadId, { job_id: job.id, job_state: job.state }, now),
    ]);
  } catch (error) {
    await db.prepare("UPDATE tryon_jobs SET claimed_at = NULL WHERE id = ?1").bind(job.id).run();
    throw error;
  }
  log.info("tryon_claimed", { lead_id: leadId, job_id: job.id, job_state: job.state });

  // Both are safe in D1 if sending fails: the sweeper re-enqueues pending leads and queued messages.
  try {
    await c.env.CRM_QUEUE.send({ lead_id: leadId, request_id: requestId });
  } catch (error) {
    log.warn("crm_enqueue_failed", { lead_id: leadId, error });
  }
  if (messageState === "queued") {
    try {
      await c.env.MESSAGE_QUEUE.send({ message_id: messageId, request_id: requestId } satisfies MessagingMessage);
    } catch (error) {
      log.warn("message_enqueue_failed", { message_id: messageId, error });
    }
  }

  return {
    ok: true,
    body: { lead_id: leadId, whatsapp_copy: promisesCopy(settings.messaging, mobileE164) },
    sessionId,
  };
}

/** The page may say a copy is on its way only when the messaging queue will send it, not skip it. */
const promisesCopy = (messaging: MessagingSettings, mobileE164: string): boolean =>
  messaging.enabled && onAllowlist(messaging, mobileE164);

/**
 * A job already claimed, claimed again: by the same number it gets a fresh
 * session (the first cookie may have been lost); by another it is refused,
 * so a job ID alone never opens someone else's result.
 */
async function reclaim(c: Context<AppEnv>, job: JobRow, mobileE164: string): Promise<Outcome> {
  const db = c.env.DB;
  const now = c.var.deps.now();
  const owner = await db
    .prepare("SELECT id FROM people WHERE id = ?1 AND mobile_e164 = ?2")
    .bind(job.person_id, mobileE164)
    .first<{ id: string }>();
  if (owner === null || job.lead_id === null) return { ok: false, status: 409, code: "job_not_claimable" };

  const sessionId = crypto.randomUUID();
  await db.batch([
    db
      .prepare("INSERT INTO tryon_sessions (id, person_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(sessionId, owner.id, now.toISOString(), new Date(now.getTime() + SESSION_TTL_MS).toISOString()),
    db.prepare("UPDATE tryon_jobs SET session_id = ?1 WHERE id = ?2").bind(sessionId, job.id),
  ]);
  return {
    ok: true,
    body: { lead_id: job.lead_id, whatsapp_copy: promisesCopy(c.var.config.settings.messaging, mobileE164) },
    sessionId,
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
