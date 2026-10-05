// Ops putting a client's service-visit credits right by hand, behind Access
// (docs/decisions/0033-credit-ledger.md, 0068-a-paid-hold-is-kept.md):
//
//   POST /api/clients/:id/credits   { visits, reason }: add visits, or take them away
//
// The ledger stays append-only: this writes a grant from ops, or adjust entries
// against the grants the client holds, with its audit entry in the same batch.
// The console's form for it arrives with the client page's other screens.

import { createRoute, z } from "@hono/zod-openapi";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { ADJUST_REASONS, adjustCredits } from "../../domain/credits.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { withinRouteReach } from "../../http/staff-access.ts";

/** More than a year of monthly visits either way is not a correction. */
const MOST_VISITS = 12;

const adjustRoute = createRoute({
  method: "post",
  path: "/api/clients/{id}/credits",
  summary: "Add service-visit credits to a client, or take them away, with the reason",
  request: {
    params: z.object({ id: z.uuid() }),
    body: {
      required: true,
      ...json(
        z
          .object({
            visits: z
              .number()
              .int()
              .min(-MOST_VISITS)
              .max(MOST_VISITS)
              .refine((visits) => visits !== 0, "nothing to change")
              .openapi({ description: "Visits to add, or, below nought, to take away." }),
            reason: z.enum(ADJUST_REASONS).openapi({
              description: "correction: given or taken in error; goodwill: given to make up for something.",
            }),
          })
          .strict()
          .openapi("CreditAdjustment"),
      ),
    },
  },
  responses: {
    200: {
      description: "The client's balance now",
      ...json(
        z
          .object({
            visits: z.number().int(),
            earliest_expiry: z.union([z.iso.datetime(), z.null()]),
          })
          .strict()
          .openapi("CreditBalance"),
      ),
    },
    400: errorResponse("invalid_request: visits takes away more than the client has"),
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such client in the caller's cities, or one who has been erased"),
  },
});

export function registerOpsCredits(app: App): void {
  app.openapi(adjustRoute, async (c) => {
    const staff = actorOf(c);
    const personId = c.req.valid("param").id;
    const { visits, reason } = c.req.valid("json");
    const db = c.env.DB;
    const person = await db
      .prepare("SELECT id FROM people WHERE id = ?1 AND erased_at IS NULL")
      .bind(personId)
      .first<{ id: string }>();
    if (person === null || !(await withinRouteReach(c, "client", personId))) {
      return refuse(c, "not_found");
    }

    const balance = await adjustCredits(db, {
      personId,
      visits,
      audit: {
        surface: "ops",
        actor: staff,
        action: "credit.adjust",
        subject: { kind: "person", id: personId },
        requestId: c.var.requestId,
        detail: { visits, reason },
      },
      now: c.var.deps.now(),
    });
    if (balance === null) return refuse(c, "invalid_request", ["visits"]);
    c.var.log.info("credits_adjusted", { person_id: personId, visits, reason });
    return c.json({ visits: balance.visits, earliest_expiry: balance.earliestExpiry }, 200);
  });
}
