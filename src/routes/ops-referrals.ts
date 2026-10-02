// Ops' review of held referral grants (Ops Console, C1; docs/decisions/0048-referrals.md), on the ops surface
// behind Access:
//   GET  /api/referrals/held               grants waiting for review, with the fraud rules each met
//   POST /api/referrals/:id/decision       approve, and the credits follow, or reject; either with its reason
// Each decision is audited under the member of staff who made it.

import { createRoute, z } from "@hono/zod-openapi";
import { staffOf } from "../http/audit.ts";
import type { App } from "../http/context.ts";
import { decideHeldReferral } from "../domain/referral-grants.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { opsInputs } from "../http/ops-inputs.ts";
import { indiaDate } from "../lib/india-time.ts";
import { needsReason, REASON_MAX_CHARS } from "../policy/decision-reasons.ts";
import { HOLD_REASONS } from "../policy/fraud-holds.ts";
import { dueAt } from "../policy/tasks.ts";
import type { MessagingMessage } from "../queues/messaging.ts";

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
                  signals: z.array(z.enum(HOLD_REASONS)),
                  held_since: z.iso.datetime().openapi({ description: "When the fraud rules held it for review." }),
                  due: z.iso.datetime().openapi({
                    description: "When ops should have decided: the Tasks board's allowance for a review.",
                  }),
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
            reason: z.string().trim().max(REASON_MAX_CHARS).nullable().openapi({
              description: "Required either way, and kept with the decision (src/policy/decision-reasons.ts).",
            }),
          })
          .strict()
          .openapi("ReferralDecision"),
      ),
    },
  },
  responses: {
    200: { description: "Decided", ...json(z.object({ state: z.enum(["approved", "rejected"]) }).strict()) },
    400: errorResponse("invalid_request: a decision needs a reason"),
    404: errorResponse("not_found: no held grant by that ID"),
  },
});

export function registerOpsReferrals(app: App): void {
  app.openapi(heldRoute, async (c) => {
    // A held grant's row was last written when the fraud rules held it, which the Tasks board waits from too.
    const { results } = await c.env.DB.prepare(
      `SELECT r.id, rc.person_id AS referrer_id, rp.name AS referrer_name, r.referred_person_id,
         fp.name AS referred_name, a.window_start, r.fraud_signals, r.updated_at AS held_since
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
      held_since: string;
    }>();
    const sla = (await opsInputs(c)).taskSlaHours;
    const known = new Set<string>(HOLD_REASONS);
    return c.json(
      {
        held: results.map((row) => ({
          id: row.id,
          referrer: { person_id: row.referrer_id, name: row.referrer_name },
          referred: { person_id: row.referred_person_id, name: row.referred_name },
          fitted_on: indiaDate(new Date(row.window_start)),
          signals: (JSON.parse(row.fraud_signals ?? "[]") as string[]).filter(
            (signal): signal is (typeof HOLD_REASONS)[number] => known.has(signal),
          ),
          held_since: row.held_since,
          due: dueAt(new Date(row.held_since), "referral_review", sla).toISOString(),
        })),
      },
      200,
    );
  });

  app.openapi(decisionRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { decision, reason } = c.req.valid("json");
    const { requestId, deps } = c.var;
    if (needsReason("referral", decision) && (reason ?? "") === "") {
      return c.json(errorBody("invalid_request", requestId, ["reason"]), 400);
    }
    const staff = staffOf(c);
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
      rewardNow: (await opsInputs(c)).referralReward,
      now,
    });
    if (outcome === null) return c.json(errorBody("not_found", requestId), 404);
    for (const messageId of outcome.messageIds) {
      await c.env.MESSAGE_QUEUE.send({ message_id: messageId, request_id: requestId } satisfies MessagingMessage);
    }
    return c.json({ state: outcome.state }, 200);
  });
}
