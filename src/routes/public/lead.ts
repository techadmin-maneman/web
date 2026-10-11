// POST /api/lead: the name and number /book asks for first, kept as a lead before the visit is chosen
// (docs/decisions/0116-book-asks-for-the-name-and-number-first.md). Checked as a booking is, with Turnstile and the
// day's limits per number and address, which the booking that follows shares.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { leaveNameAndNumber } from "../../domain/booking/public-lead.ts";
import { errorResponse } from "../../http/errors.ts";
import { answerKeyed, IdempotencyKeyHeaderSchema, onceForKey } from "../../http/idempotency.ts";
import { PersonNameSchema } from "../../http/openapi.ts";
import { formRequest } from "../../http/public-form.ts";
import { AttributionSchema } from "../schemas/attribution.ts";

const LeadRequestSchema = z
  .object({
    name: PersonNameSchema,
    mobile: z.string().max(20),
    consent: z.literal(true).openapi({ description: '"You may contact me on WhatsApp about this consultation."' }),
    turnstile_token: z.string().min(1).max(2048),
    attribution: AttributionSchema,
  })
  .strict();

const LeadLeftSchema = z.object({}).strict().openapi("LeadLeft");

const leadRoute = createRoute({
  method: "post",
  path: "/api/lead",
  summary: "Leave a name and number before choosing the visit",
  request: {
    headers: IdempotencyKeyHeaderSchema,
    body: { required: true, content: { "application/json": { schema: LeadRequestSchema } } },
  },
  responses: {
    201: {
      description: "Kept. Every number gets this answer, a client's too, for whom nothing is written.",
      content: { "application/json": { schema: LeadLeftSchema } },
    },
    400: errorResponse("invalid_request: fields names what was refused"),
    403: errorResponse("turnstile_failed"),
    409: errorResponse("idempotency_in_progress: the first request with this key is still running"),
    422: errorResponse("idempotency_key_reused: the key was used with a different body"),
    429: errorResponse("rate_limited"),
    503: errorResponse("unavailable: Turnstile could not be reached"),
  },
});

export function registerLead(app: App): void {
  app.openapi(leadRoute, async (c) => {
    const body = c.req.valid("json");
    const keyed = { route: "POST /api/lead", key: c.req.valid("header")["idempotency-key"], request: body };
    const run = await onceForKey(c, keyed, async () => {
      const left = await leaveNameAndNumber(formRequest(c), {
        name: body.name,
        mobile: body.mobile,
        turnstileToken: body.turnstile_token,
        attribution: body.attribution ?? {},
      });
      return left.ok ? { ok: true as const, body: {} } : left;
    });
    return answerKeyed(c, run);
  });
}
