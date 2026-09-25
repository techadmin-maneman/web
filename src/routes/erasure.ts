// POST /api/erasure: operators only. Erases a person, found by their mobile
// number, the day they ask (docs/decisions/0019-erasure.md and the runbook's
// "Erasure within the day"). Authorised by ERASURE_SECRET as a bearer token.
// Refused while the person has a visit booked or a payment held, unless the
// operator says they have settled both by hand (docs/decisions/0066).

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../app.ts";
import { VISIT_TYPES } from "../config/visit-types.ts";
import { erasePerson, erasureBlockers, personWithMobile, type ErasureBlockers } from "../domain/erasure.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { secretsMatch } from "../lib/hash.ts";
import { INDIAN_MOBILE_PATTERN, toE164 } from "../lib/mobile.ts";
import { erasureRefusal, LIVE_VISIT_STATUSES, type ErasureRefusal } from "../policy/account-deletion.ts";
import type { CrmSyncMessage } from "../queues/crm-sync.ts";

export const ErasureRequestSchema = z
  .object({
    mobile: z.string().regex(INDIAN_MOBILE_PATTERN).openapi({ example: "98100 00000" }),
    override_open_bookings: z
      .boolean()
      .optional()
      .openapi({
        description:
          "Erase even with a visit booked or a payment held: only once ops have cancelled and refunded them by hand " +
          '(the runbook\'s "Erasure within the day").',
      }),
  })
  .strict()
  .openapi("ErasureRequest");

export const ErasureResponseSchema = z
  .object({
    person_id: z.uuid(),
    erased_at: z.iso.datetime(),
    photos_deleted: z.number().int(),
    results_deleted: z.number().int(),
    messages_cancelled: z.number().int(),
    crm: z
      .literal("queued")
      .openapi({ description: "The CRM record is blanked by the crm-sync queue, retried until done." }),
  })
  .strict()
  .openapi("ErasureResponse");

/** Why an erasure waits, and what ops must settle first: the visits to cancel and the payments to refund. */
export const ErasureRefusedSchema = z
  .object({
    error: z.object({ code: z.enum(["visit_booked", "payment_held"]), request_id: z.string() }).strict(),
    visits: z.array(
      z
        .object({
          id: z.string(),
          type: z.enum(VISIT_TYPES).nullable(),
          status: z.enum(LIVE_VISIT_STATUSES),
          window_start: z.iso.datetime().nullable(),
        })
        .strict(),
    ),
    payments: z.array(
      z
        .object({
          id: z.string(),
          reference: z.string().nullable(),
          amount: z.number().int().openapi({ description: "In paise." }),
        })
        .strict(),
    ),
  })
  .strict()
  .openapi("ErasureRefused");

export function erasureRefused(
  code: ErasureRefusal,
  blockers: ErasureBlockers,
  requestId: string,
): z.infer<typeof ErasureRefusedSchema> {
  return { error: { code, request_id: requestId }, visits: [...blockers.visits], payments: [...blockers.payments] };
}

export const erasureRoute = createRoute({
  method: "post",
  path: "/api/erasure",
  summary: "Operators only: erase a person's photos, results and details, found by their number",
  request: {
    headers: z.object({ authorization: z.string().optional().openapi({ example: "Bearer <ERASURE_SECRET>" }) }),
    body: { required: true, content: { "application/json": { schema: ErasureRequestSchema } } },
  },
  responses: {
    200: { description: "Erased", content: { "application/json": { schema: ErasureResponseSchema } } },
    400: errorResponse("invalid_request: see error.fields"),
    401: errorResponse("unauthorized"),
    404: errorResponse("not_found: no one with this number, or already erased"),
    409: {
      description: "visit_booked or payment_held: settle what it names first, or say it is settled",
      content: { "application/json": { schema: ErasureRefusedSchema } },
    },
  },
});

export function registerErasure(app: App): void {
  app.openapi(erasureRoute, async (c) => {
    const { requestId, log } = c.var;
    const token = /^Bearer\s+(\S+)$/i.exec(c.req.valid("header").authorization ?? "")?.[1] ?? "";
    if (!(await secretsMatch(token, c.var.config.settings.erasureSecret))) {
      log.warn("erasure_unauthorized");
      return c.json(errorBody("unauthorized", requestId), 401);
    }

    const body = c.req.valid("json");
    const mobileE164 = toE164(body.mobile);
    if (mobileE164 === null) return c.json(errorBody("invalid_request", requestId, ["mobile"]), 400);
    const personId = await personWithMobile(c.env.DB, mobileE164);
    if (personId === null) return c.json(errorBody("not_found", requestId), 404);

    const blockers = await erasureBlockers(c.env.DB, personId);
    const refusal = erasureRefusal(blockers);
    if (refusal !== null) {
      if (body.override_open_bookings !== true) return c.json(erasureRefused(refusal, blockers, requestId), 409);
      log.warn("erasure_override", {
        person_id: personId,
        visits: blockers.visits.length,
        payments: blockers.payments.length,
      });
    }

    const summary = await erasePerson(c.env, personId, c.var.deps.now(), log);
    if (summary === null) return c.json(errorBody("not_found", requestId), 404);
    log.info("person_erased", {
      person_id: summary.personId,
      photos_deleted: summary.photosDeleted,
      results_deleted: summary.resultsDeleted,
      messages_cancelled: summary.messagesCancelled,
    });

    try {
      await c.env.CRM_QUEUE.send({ erase_person_id: summary.personId, request_id: requestId } satisfies CrmSyncMessage);
    } catch (error) {
      log.warn("crm_enqueue_failed", { person_id: summary.personId, error }); // the sweeper sends it on
    }

    return c.json(
      {
        person_id: summary.personId,
        erased_at: summary.erasedAt,
        photos_deleted: summary.photosDeleted,
        results_deleted: summary.resultsDeleted,
        messages_cancelled: summary.messagesCancelled,
        crm: "queued" as const,
      },
      200,
    );
  });
}
