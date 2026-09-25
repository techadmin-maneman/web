// Ops' review of held referral grants (Ops Console, C1; docs/decisions/0048-referrals.md), on the ops surface
// behind Access:
//   GET  /api/referrals/held               grants waiting for review, with the fraud rules each met
//   POST /api/referrals/:id/decision       approve, and the credits follow, or reject with the reason
// Each decision is audited under the member of staff who made it.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../app.ts";
import { actorOf } from "../domain/audit.ts";
import { decideHeldReferral } from "../domain/referral-grants.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { indiaDate } from "../lib/india-time.ts";
import { FRAUD_SIGNALS } from "../policy/fraud-holds.ts";
import type { MessagingMessage } from "../queues/messaging.ts";

const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });
const PersonRef = z.object({ person_id: z.uuid(), name: z.string() }).strict();

const heldRoute = createRoute({
  method: "get",
  path: "/api/referrals/held",
  summary: "Referral grants held for review, oldest first",
  responses: {
    200: {
      description: "Held grants",
      ...json(
        z
          .object({
            held: z.array(
              z
                .object({
                  id: z.uuid(),
                  referrer: PersonRef,
                  referred: PersonRef,
                  fitted_on: z.iso.date(),
                  signals: z.array(z.enum(FRAUD_SIGNALS)),
                })
                .strict(),
            ),
          })
          .strict(),
      ),
    },
  },
});

const decisionRoute = createRoute({
  method: "post",
  path: "/api/referrals/{id}/decision",
  summary: "Approve a held grant, or reject it",
  request: {
    params: z.object({ id: z.uuid() }),
    body: {
      required: true,
      ...json(
        z
          .object({
            decision: z.enum(["approve", "reject"]),
            reason: z
              .string()
              .trim()
              .max(300)
              .nullable()
              .openapi({ description: "Required to reject, and kept with the decision either way." }),
          })
          .strict()
          .openapi("ReferralDecision"),
      ),
    },
  },
  responses: {
    200: { description: "Decided", ...json(z.object({ state: z.enum(["approved", "rejected"]) }).strict()) },
    400: errorResponse("invalid_request: a rejection needs a reason"),
    404: errorResponse("not_found: no held grant by that ID"),
  },
});

export function registerOpsReferrals(app: App): void {
  app.openapi(heldRoute, async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT r.id, rc.person_id AS referrer_id, rp.name AS referrer_name, r.referred_person_id,
         fp.name AS referred_name, a.window_start, r.fraud_signals
       FROM referral_attributions r JOIN referral_codes rc ON rc.code = r.code
       JOIN people rp ON rp.id = rc.person_id JOIN people fp ON fp.id = r.referred_person_id
       JOIN appointments a ON a.id = r.first_fit_appointment_id
       WHERE r.grant_state = 'held' ORDER BY r.updated_at`,
    ).all<{
      id: string;
      referrer_id: string;
      referrer_name: string;
      referred_person_id: string;
      referred_name: string;
      window_start: string;
      fraud_signals: string | null;
    }>();
    const known = new Set<string>(FRAUD_SIGNALS);
    return c.json(
      {
        held: results.map((row) => ({
          id: row.id,
          referrer: { person_id: row.referrer_id, name: row.referrer_name },
          referred: { person_id: row.referred_person_id, name: row.referred_name },
          fitted_on: indiaDate(new Date(row.window_start)),
          signals: (JSON.parse(row.fraud_signals ?? "[]") as string[]).filter(
            (signal): signal is (typeof FRAUD_SIGNALS)[number] => known.has(signal),
          ),
        })),
      },
      200,
    );
  });

  app.openapi(decisionRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { decision, reason } = c.req.valid("json");
    const { requestId, deps } = c.var;
    if (decision === "reject" && (reason ?? "") === "") {
      return c.json(errorBody("invalid_request", requestId, ["reason"]), 400);
    }
    const identity = c.var.accessIdentity;
    if (identity === undefined) throw new Error("ops routes run after requireAccess");
    const staff = actorOf(identity);
    const now = deps.now();
    const outcome = await decideHeldReferral(c.env.DB, {
      id,
      decision,
      staff: staff.id,
      reason,
      audit: {
        surface: "ops",
        actor: staff,
        action: "referral.decide",
        subject: { kind: "referral", id },
        requestId,
        detail: { decision },
      },
      now,
    });
    if (outcome === null) return c.json(errorBody("not_found", requestId), 404);
    if (outcome.messageId !== null) {
      await c.env.MESSAGE_QUEUE.send({
        message_id: outcome.messageId,
        request_id: requestId,
      } satisfies MessagingMessage);
    }
    return c.json({ state: outcome.state }, 200);
  });
}
