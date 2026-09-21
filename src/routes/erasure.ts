// POST /api/erasure: operators only. Erases a person, found by their mobile
// number, the day they ask (docs/decisions/0019-erasure.md and the runbook's
// "Erasure within the day"). Authorised by ERASURE_SECRET as a bearer token.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../app.ts";
import { erasePerson } from "../domain/erasure.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { secretsMatch } from "../lib/hash.ts";
import { INDIAN_MOBILE_PATTERN, toE164 } from "../lib/mobile.ts";
import type { CrmSyncMessage } from "../queues/crm-sync.ts";

export const ErasureRequestSchema = z
  .object({ mobile: z.string().regex(INDIAN_MOBILE_PATTERN).openapi({ example: "98100 00000" }) })
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

    const mobileE164 = toE164(c.req.valid("json").mobile);
    if (mobileE164 === null) return c.json(errorBody("invalid_request", requestId, ["mobile"]), 400);

    const summary = await erasePerson(c.env, mobileE164, c.var.deps.now());
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
