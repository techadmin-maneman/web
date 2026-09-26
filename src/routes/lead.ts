// POST /api/lead: the booking form. The lead is saved in D1 before any other
// system hears of it; Zoho gets it from the crm-sync queue, so Zoho being down
// never fails this request. See docs/decisions/0011-lead-api.md.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../app.ts";
import { LOSS_EXTENTS, VISIT_WINDOWS, WINDOW_LABELS, windowLabel } from "../config/booking.ts";
import { findActiveCity } from "../domain/cities.ts";
import { loadBlackouts, saveBookingLead } from "../domain/leads.ts";
import { takeOne } from "../domain/rate-limit.ts";
import { candidateRange, proposeVisitDate } from "../domain/visit-date.ts";
import { errorBody, errorResponse, type ErrorCode } from "../http/errors.ts";
import { abandonIdempotent, finishIdempotent, startIdempotent, type IdempotencyRecord } from "../http/idempotency.ts";
import { checkTurnstile, visitorOf } from "../http/visitor.ts";
import { saltedHash, sha256Hex } from "../lib/hash.ts";
import { indiaDate } from "../lib/india-time.ts";
import { INDIAN_MOBILE_PATTERN, toE164 } from "../lib/mobile.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";

export const AttributionSchema = z
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

export const LeadRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    mobile: z.string().regex(INDIAN_MOBILE_PATTERN).openapi({ example: "98100 00000" }),
    city: z.string().min(1).max(40).openapi({ description: "One of the names from GET /api/cities." }),
    first_choice_window: z.enum(VISIT_WINDOWS),
    loss_extent: z.enum(LOSS_EXTENTS),
    consent: z.literal(true).openapi({ description: "The booking notice was agreed to; see src/config/notices.ts." }),
    turnstile_token: z.string().min(1).max(2048),
    attribution: AttributionSchema.optional(),
  })
  .strict()
  .openapi("LeadRequest");
type LeadRequest = z.infer<typeof LeadRequestSchema>;

export const LeadResponseSchema = z
  .object({
    lead_id: z.uuid(),
    served: z.boolean(),
    proposed_visit_date: z.iso
      .date()
      .optional()
      .openapi({ description: "Served cities only. May be absent if every candidate day is blacked out." }),
    window_label: z.enum(WINDOW_LABELS).optional().openapi({ description: "Served cities only." }),
  })
  .strict()
  .openapi("LeadResponse");
type LeadResponse = z.infer<typeof LeadResponseSchema>;

export const leadRoute = createRoute({
  method: "post",
  path: "/api/lead",
  summary: "Book a free consultation, or join a city's waitlist",
  request: {
    headers: z.object({ "idempotency-key": z.string().min(8).max(200).optional() }),
    body: { required: true, content: { "application/json": { schema: LeadRequestSchema } } },
  },
  responses: {
    201: { description: "Saved", content: { "application/json": { schema: LeadResponseSchema } } },
    400: errorResponse("invalid_request: see error.fields"),
    403: errorResponse("turnstile_failed"),
    409: errorResponse("idempotency_in_progress: the first request with this key is still running"),
    422: errorResponse("idempotency_key_reused: the key was used with a different body"),
    429: errorResponse("rate_limited: too many requests from this number or address today"),
    503: errorResponse("unavailable: Turnstile or the database could not be reached"),
  },
});

const IDEMPOTENCY_ROUTE = "POST /api/lead";

type Outcome =
  | { readonly ok: true; readonly body: LeadResponse }
  | {
      readonly ok: false;
      readonly status: 400 | 403 | 429 | 503;
      readonly code: ErrorCode;
      readonly fields?: string[];
    };

export function registerLead(app: App): void {
  app.openapi(leadRoute, async (c) => {
    const request = c.req.valid("json");
    const key = c.req.valid("header")["idempotency-key"];
    const requestId = c.var.requestId;
    const db = c.env.DB;

    const record: IdempotencyRecord | null =
      key === undefined
        ? null
        : { key, route: IDEMPOTENCY_ROUTE, requestHash: await sha256Hex(JSON.stringify(request)) };

    if (record !== null) {
      const start = await startIdempotent(db, record, c.var.deps.now());
      if (start.kind === "replay") return c.json(start.body as LeadResponse, 201);
      if (start.kind === "in_progress") return c.json(errorBody("idempotency_in_progress", requestId), 409);
      if (start.kind === "key_reused") return c.json(errorBody("idempotency_key_reused", requestId), 422);
    }

    let outcome: Outcome;
    try {
      outcome = await createLead(c, request);
    } catch (error) {
      if (record !== null) await abandonIdempotent(db, record);
      throw error;
    }

    if (!outcome.ok) {
      if (record !== null) await abandonIdempotent(db, record); // a retry with a fresh Turnstile token may succeed
      return c.json(errorBody(outcome.code, requestId, outcome.fields), outcome.status);
    }
    if (record !== null) await finishIdempotent(db, record, { status: 201, body: outcome.body });
    return c.json(outcome.body, 201);
  });
}

async function createLead(c: Context<AppEnv>, request: LeadRequest): Promise<Outcome> {
  const { settings } = c.var.config;
  const { deps, log, requestId } = c.var;
  const db = c.env.DB;
  const now = deps.now();

  const mobileE164 = toE164(request.mobile);
  if (mobileE164 === null) return { ok: false, status: 400, code: "invalid_request", fields: ["mobile"] };

  const visitor = await visitorOf(c);
  const { ipHash } = visitor;

  const turnstile = await checkTurnstile(c, request.turnstile_token, visitor);
  if (turnstile === "rejected") return { ok: false, status: 403, code: "turnstile_failed" };
  if (turnstile === "unavailable") return { ok: false, status: 503, code: "unavailable" };

  // A city the form cannot take costs the number nothing, and neither does a refusal of its address.
  const city = await findActiveCity(db, request.city);
  if (city === null) return { ok: false, status: 400, code: "invalid_request", fields: ["city"] };

  const today = indiaDate(now);
  const withinLimits =
    (await takeOne(db, { scope: "lead:ip", key: ipHash, window: today, limit: settings.leadIpDailyLimit })) &&
    (await takeOne(db, {
      scope: "lead:mobile",
      key: await saltedHash(settings.ipHashSalt, `mobile:${mobileE164}`),
      window: today,
      limit: settings.leadMobileDailyLimit,
    }));
  if (!withinLimits) {
    log.warn("lead_rate_limited", { ip_hash: ipHash });
    return { ok: false, status: 429, code: "rate_limited" };
  }

  let proposedVisitDate: string | null = null;
  if (city.served) {
    const range = candidateRange(now, settings.visitLeadDays);
    const blackouts = await loadBlackouts(db, range.from, range.to);
    proposedVisitDate = proposeVisitDate(now, request.first_choice_window, settings.visitLeadDays, blackouts);
    if (proposedVisitDate === null) log.error("no_visit_date_available", { city: city.name });
  }

  const leadId = crypto.randomUUID();
  await saveBookingLead(db, {
    leadId,
    newPersonId: crypto.randomUUID(),
    name: request.name,
    mobileE164,
    city: city.name,
    source: city.served ? "form" : "waitlist",
    window: request.first_choice_window,
    lossExtent: request.loss_extent,
    proposedVisitDate,
    attribution: request.attribution ?? {},
    ipHash,
    requestId,
    now,
  });
  log.info("lead_created", { lead_id: leadId, served: city.served });

  try {
    await c.env.CRM_QUEUE.send({ lead_id: leadId, request_id: requestId });
  } catch (error) {
    // The lead is safe in D1; the sweeper enqueues anything left pending.
    log.warn("crm_enqueue_failed", { lead_id: leadId, error });
  }

  if (!city.served) return { ok: true, body: { lead_id: leadId, served: false } };

  // A booking goes to FSM too, as a Request for ops to schedule (src/domain/fsm-leads.ts).
  // It is stamped once it is on the queue; the sweeper sends one left unstamped.
  if (c.var.config.providers.FSM_PROVIDER !== "none") {
    try {
      await c.env.FSM_QUEUE.send({ lead_id: leadId, request_id: requestId } satisfies FsmSyncMessage);
      await db.prepare("UPDATE leads SET fsm_queued_at = ?1 WHERE id = ?2").bind(now.toISOString(), leadId).run();
    } catch (error) {
      log.warn("fsm_enqueue_failed", { lead_id: leadId, error });
    }
  }

  const body: LeadResponse = { lead_id: leadId, served: true, window_label: windowLabel(request.first_choice_window) };
  if (proposedVisitDate !== null) body.proposed_visit_date = proposedVisitDate;
  return { ok: true, body };
}
