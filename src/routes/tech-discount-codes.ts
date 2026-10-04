// A discount code the technician enters on a consultation and fit in one visit, before its payment link is made
// (docs/decisions/0108-discount-codes.md):
//
//   POST /api/tech/jobs/:id/discount-code   { code }: the code comes off the product's price at the link
//
// The link is made as the visit closes as done, so the code is entered before that, while the phone is online: it is
// not one of the outbox's steps, since the technician must hear at once whether it applies. A code that does not
// apply is answered code_not_applicable and nothing more; every check is counted against the technician and the
// address (src/http/code-checks.ts). No amount is answered: none reaches the technician's phone.

import { z } from "@hono/zod-openapi";
import { techRoute } from "../http/session-routes.ts";
import type { App } from "../http/context.ts";
import { enterOnVisit } from "../domain/discount-code-uses.ts";
import { workableJob } from "../domain/tech-jobs.ts";
import { mayCheckCode } from "../http/code-checks.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { technicianOf } from "../http/technician-session.ts";

const EntrySchema = z
  .object({ code: z.string().trim().min(1).max(40).openapi({ description: "As the client gave it, any case." }) })
  .strict()
  .openapi("TechnicianDiscountCode");

const AppliedSchema = z
  .object({ code: z.string().openapi({ description: "The code, as it is kept: in capitals." }) })
  .strict()
  .openapi("TechnicianDiscountCodeApplied");

const enterRoute = techRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/discount-code",
  summary: "Enter a discount code on a one visit, before its payment link is made",
  request: { params: z.object({ id: z.uuid() }), body: { required: true, ...json(EntrySchema) } },
  responses: {
    200: { description: "It comes off the product's price at the payment link", ...json(AppliedSchema) },
    401: errorResponse("session_required; device_revoked"),
    404: errorResponse("not_found: no such job of this technician's"),
    409: errorResponse(
      "already_discounted: the visit carries a code; price_settled: its payment link is made, or it is not a one " +
        "visit, whose client paid ahead",
    ),
    422: errorResponse("code_not_applicable: the code does not apply to this visit"),
    429: errorResponse("rate_limited: too many codes tried today, or from this address this hour"),
  },
});

export function registerTechDiscountCodes(app: App): void {
  app.openapi(enterRoute, async (c) => {
    const { technicianId } = technicianOf(c);
    const { requestId, log, deps } = c.var;
    const { id } = c.req.valid("param");
    const job = await workableJob(c.env.DB, id);
    if (job?.technicianId !== technicianId) return c.json(errorBody("not_found", requestId), 404);
    if (job.oneVisit === null) return c.json(errorBody("price_settled", requestId), 409);
    if (!(await mayCheckCode(c, technicianId))) return c.json(errorBody("rate_limited", requestId), 429);

    const entry = {
      visitId: id,
      text: c.req.valid("json").code,
      by: { kind: "technician", id: technicianId },
    } as const;
    const entered = await enterOnVisit(c.env.DB, entry, deps.now());
    if (entered.kind === "applied") {
      log.info("discount_code_applied", { appointment_id: id });
      return c.json({ code: entered.code }, 200);
    }
    if (entered.kind === "not_applicable") {
      log.info("discount_code_refused", { appointment_id: id, reason: entered.reason });
      return c.json(errorBody("code_not_applicable", requestId), 422);
    }
    if (entered.kind === "already_discounted") return c.json(errorBody("already_discounted", requestId), 409);
    if (entered.kind === "not_found") return c.json(errorBody("not_found", requestId), 404);
    return c.json(errorBody("price_settled", requestId), 409);
  });
}
