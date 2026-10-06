// A discount code at the app's pay step (docs/decisions/0108-discount-codes.md):
//
//   POST   /api/holds/:id/discount-code   { code }: the code comes off the hold's price before GST
//   DELETE /api/holds/:id/discount-code   the code comes off again, and the hold is back at its price
//
// Only while the hold's price is open: while nothing is paid, so Checkout's order is made for what is left; an order
// Checkout was closed on unpaid is let go, and the next Pay makes another. A code that does not apply is answered code_not_applicable and nothing more, whatever the reason, which is logged; every
// check is counted against the client and their address (src/http/code-checks.ts). Behind the session and
// self-serve booking, as every hold route is.

import { z } from "@hono/zod-openapi";
import { selfServeRoute } from "../../http/session-routes.ts";
import type { App } from "../../http/context.ts";
import { enterOnHold, removeFromHold } from "../../domain/money/discount-code-holds.ts";
import type { Entered, Removed } from "../../domain/money/discount-code-uses.ts";
import { clientHold } from "../../domain/booking/holds.ts";
import { clientOf } from "../../http/client-session.ts";
import { mayCheckCode } from "../../http/code-checks.ts";
import { errorBody, errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { HoldSchema } from "./booking.ts";

const holdId = z.object({ id: z.uuid() });

const DiscountCodeEntrySchema = z
  .object({ code: z.string().trim().min(1).max(40).openapi({ description: "As the client typed it, any case." }) })
  .strict()
  .openapi("DiscountCodeEntry");

const settled = errorResponse(
  "hold_expired: the hold ran out; price_settled: it is paid for, or a payment on Checkout's order is under way; " +
    "ops_assisted",
);

const enterRoute = selfServeRoute({
  method: "post",
  path: "/api/holds/{id}/discount-code",
  summary: "Take a discount code off the hold's price, while nothing is paid for it",
  request: { params: holdId, body: { required: true, ...json(DiscountCodeEntrySchema) } },
  responses: {
    200: { description: "The hold, priced with the code taken off", ...json(HoldSchema) },
    401: errorResponse("session_required"),
    404: errorResponse("not_found"),
    409: errorResponse(
      "already_discounted: the hold carries a code; hold_expired; price_settled: it is paid for, or a payment on " +
        "Checkout's order is under way; ops_assisted",
    ),
    422: errorResponse("code_not_applicable: the code does not apply to this booking"),
    429: errorResponse("rate_limited: too many codes tried today, or from this address this hour"),
  },
});

const removeRoute = selfServeRoute({
  method: "delete",
  path: "/api/holds/{id}/discount-code",
  summary: "Take the code off the hold again, while nothing is paid for it",
  request: { params: holdId },
  responses: {
    200: { description: "The hold, at its price again", ...json(HoldSchema) },
    401: errorResponse("session_required"),
    404: errorResponse("not_found: no such hold of the client's, or it carries no code"),
    409: settled,
  },
});

/** A refusal of entering a code, as the route answers it; null when it was applied. */
function refusalOf(entered: Entered) {
  if (entered.kind === "not_found") return { code: "not_found", status: 404 } as const;
  if (entered.kind === "not_applicable") return { code: "code_not_applicable", status: 422 } as const;
  if (entered.kind === "already_discounted") return { code: "already_discounted", status: 409 } as const;
  if (entered.kind === "expired") return { code: "hold_expired", status: 409 } as const;
  if (entered.kind === "price_settled") return { code: "price_settled", status: 409 } as const;
  return null;
}

/** A refusal of taking the code off, as the route answers it; null when it came off. */
function removalRefusalOf(removed: Removed) {
  if (removed === "not_found" || removed === "none") return { code: "not_found", status: 404 } as const;
  if (removed === "expired") return { code: "hold_expired", status: 409 } as const;
  if (removed === "price_settled") return { code: "price_settled", status: 409 } as const;
  return null;
}

export function registerClientDiscountCodes(app: App): void {
  app.openapi(enterRoute, async (c) => {
    const { subjectId: personId } = clientOf(c);
    const { requestId, log, deps } = c.var;
    if (!(await mayCheckCode(c, personId))) return refuse(c, "rate_limited");
    const { id } = c.req.valid("param");
    const now = deps.now();
    const entry = { holdId: id, personId, text: c.req.valid("json").code };
    const entered = await enterOnHold(c.env.DB, deps.payments, entry, now);
    if (entered.kind === "not_applicable") log.info("discount_code_refused", { hold_id: id, reason: entered.reason });
    const refused = refusalOf(entered);
    if (refused !== null) return c.json(errorBody(refused.code, requestId), refused.status);
    log.info("discount_code_applied", { hold_id: id });
    const held = await clientHold(c.env.DB, id, personId, now);
    if (held === null) return refuse(c, "not_found");
    return c.json(held, 200);
  });

  app.openapi(removeRoute, async (c) => {
    const { subjectId: personId } = clientOf(c);
    const { requestId, deps } = c.var;
    const { id } = c.req.valid("param");
    const now = deps.now();
    const removed = await removeFromHold(c.env.DB, deps.payments, { holdId: id, personId }, now);
    const refused = removalRefusalOf(removed);
    if (refused !== null) return c.json(errorBody(refused.code, requestId), refused.status);
    const held = await clientHold(c.env.DB, id, personId, now);
    if (held === null) return refuse(c, "not_found");
    return c.json(held, 200);
  });
}
