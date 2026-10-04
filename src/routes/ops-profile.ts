// Ops' side of the client's profile, on the ops surface behind Access
// (docs/decisions/0042-client-profile.md):
//   GET  /api/number-changes                  changes waiting for ops, both numbers proven
//   POST /api/number-changes/:id/decision     confirm or reject
//   GET  /api/deletion-requests               requests waiting for ops
//   POST /api/deletion-requests/:id/decision  delete (the Phase 1 erasure) or reject
// Each decision is audited under the member of staff who made it, in the same batch as the decision. Ops answer
// all three in the console's own sections (apps/ops/src). Each route keeps to the caller's cities.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { afterResponse } from "../http/after-response.ts";
import { staffOf } from "../http/audit.ts";
import type { App, AppEnv } from "../http/context.ts";
import { fieldRecord } from "../config/field-record.ts";
import { type AuditAction, type AuditEntry } from "../domain/audit.ts";
import { decideDeletion, deletionDoneMessage, deletionsWaiting, type ErasedContact } from "../domain/deletion.ts";
import { changesAwaitingOps, decideNumberChange } from "../domain/number-change.ts";
import { NUMBER_CHANGE_WAITING_SINCE } from "../domain/tasks.ts";
import { queueContactSync } from "../http/contact-sync.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { opsInputs } from "../http/ops-inputs.ts";
import { queueMessage } from "../http/queue-message.ts";
import { routeReach, withinRouteReach } from "../http/staff-access.ts";
import { needsReason, REASON_MAX_CHARS } from "../policy/decision-reasons.ts";
import { dueAt } from "../policy/tasks.ts";
import { heldBackByAllowlist } from "../queues/messaging.ts";
import { scrubString } from "../log.ts";
import { ErasureRefusedSchema, erasureRefused } from "./ops-erasure.ts";

const Reason = z.string().trim().max(REASON_MAX_CHARS).nullable().openapi({
  description: "Required to reject; kept with the decision, and the client reads it (src/policy/decision-reasons.ts).",
});
const DueSchema = z.iso.datetime().openapi({
  description: "When ops should have decided: the Tasks board's allowance for this queue, which ops set.",
});

export const numberChangesRoute = createRoute({
  method: "get",
  path: "/api/number-changes",
  summary: "Number changes waiting for ops in the caller's cities: both numbers proven by code",
  responses: {
    200: {
      description: "Oldest first",
      ...json(
        z
          .object({
            changes: z.array(
              z
                .object({
                  id: z.uuid(),
                  person_id: z.uuid(),
                  name: z.string(),
                  old_mobile: z.string(),
                  new_mobile: z.string(),
                  requested_at: z.iso.datetime(),
                  due: DueSchema,
                })
                .strict(),
            ),
          })
          .strict(),
      ),
    },
  },
});

export const numberChangeDecisionRoute = createRoute({
  method: "post",
  path: "/api/number-changes/{id}/decision",
  summary: "Confirm a number change, which then takes effect, or reject it",
  request: {
    params: z.object({ id: z.uuid() }),
    body: {
      required: true,
      ...json(
        z
          .object({ decision: z.enum(["confirm", "reject"]), reason: Reason })
          .strict()
          .openapi("NumberChangeDecision"),
      ),
    },
  },
  responses: {
    200: { description: "Decided", ...json(z.object({ state: z.enum(["confirmed", "rejected"]) }).strict()) },
    400: errorResponse("invalid_request: a rejection needs a reason"),
    404: errorResponse("not_found: no change waiting for ops by that ID in the caller's cities"),
    409: errorResponse("number_in_use: another person holds the new number"),
  },
});

export const deletionRequestsRoute = createRoute({
  method: "get",
  path: "/api/deletion-requests",
  summary: "Deletion requests waiting for ops in the caller's cities",
  responses: {
    200: {
      description: "Oldest first",
      ...json(
        z
          .object({
            requests: z.array(
              z
                .object({
                  id: z.uuid(),
                  person_id: z.uuid(),
                  name: z.string(),
                  mobile: z.string(),
                  requested_at: z.iso.datetime(),
                  due: DueSchema,
                })
                .strict(),
            ),
          })
          .strict(),
      ),
    },
  },
});

export const deletionDecisionRoute = createRoute({
  method: "post",
  path: "/api/deletion-requests/{id}/decision",
  summary: "Delete the account now (photographs, results and details), or reject the request",
  request: {
    params: z.object({ id: z.uuid() }),
    body: {
      required: true,
      ...json(
        z
          .object({ decision: z.enum(["delete", "reject"]), reason: Reason })
          .strict()
          .openapi("DeletionDecision"),
      ),
    },
  },
  responses: {
    200: { description: "Decided", ...json(z.object({ state: z.enum(["done", "rejected"]) }).strict()) },
    400: errorResponse("invalid_request: a rejection needs a reason"),
    404: errorResponse("not_found: no request waiting for ops by that ID in the caller's cities"),
    409: {
      description: "visit_booked or payment_held: cancel the visits and refund the payments it names first",
      ...json(ErasureRefusedSchema),
    },
  },
});

/** A decision's audit entry, which the decision writes in its own batch. */
function decisionAudit(
  c: Context<AppEnv>,
  action: AuditAction,
  subject: { kind: string; id: string },
  decision: string,
): AuditEntry {
  return { surface: "ops", actor: staffOf(c), action, subject, requestId: c.var.requestId, detail: { decision } };
}

export function registerOpsProfile(app: App): void {
  app.openapi(numberChangesRoute, async (c) => {
    const changes = await changesAwaitingOps(c.env.DB, await routeReach(c));
    const [names, since, inputs] = await Promise.all([
      namesOf(
        c.env.DB,
        changes.map((change) => change.personId),
      ),
      waitingSince(c.env.DB),
      opsInputs(c),
    ]);
    const due = (id: string, requestedAt: string) =>
      dueAt(new Date(since.get(id) ?? requestedAt), "number_change", inputs.taskSlaHours).toISOString();
    return c.json(
      {
        changes: changes.map((change) => ({
          id: change.id,
          person_id: change.personId,
          name: names.get(change.personId) ?? "",
          old_mobile: change.oldMobileE164,
          new_mobile: change.newMobileE164,
          requested_at: change.createdAt,
          due: due(change.id, change.createdAt),
        })),
      },
      200,
    );
  });

  app.openapi(numberChangeDecisionRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { decision, reason } = c.req.valid("json");
    if (needsReason("number_change", decision) && (reason ?? "") === "") {
      return c.json(errorBody("invalid_request", c.var.requestId, ["reason"]), 400);
    }
    if (!(await withinRouteReach(c, "number_change", id))) return c.json(errorBody("not_found", c.var.requestId), 404);
    const outcome = await decideNumberChange(c.env.DB, {
      id,
      decision,
      staff: staffOf(c).id,
      reason,
      audit: decisionAudit(c, "number_change.decide", { kind: "number_change", id }, decision),
      now: c.var.deps.now(),
    });
    if (outcome === "not_waiting") return c.json(errorBody("not_found", c.var.requestId), 404);
    if (outcome === "number_in_use") return c.json(errorBody("number_in_use", c.var.requestId), 409);
    if (decision === "reject") return c.json({ state: "rejected" as const }, 200);
    await queueContactSync(c, outcome.personId);
    return c.json({ state: "confirmed" as const }, 200);
  });

  app.openapi(deletionRequestsRoute, async (c) => {
    const reached = await routeReach(c);
    const [requests, inputs] = await Promise.all([deletionsWaiting(c.env.DB, reached), opsInputs(c)]);
    return c.json(
      {
        requests: requests.map((request) => ({
          id: request.id,
          person_id: request.personId,
          name: request.name,
          mobile: request.mobileE164,
          requested_at: request.createdAt,
          due: dueAt(new Date(request.createdAt), "erasure_request", inputs.taskSlaHours).toISOString(),
        })),
      },
      200,
    );
  });

  app.openapi(deletionDecisionRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { decision, reason } = c.req.valid("json");
    if (needsReason("deletion", decision) && (reason ?? "") === "") {
      return c.json(errorBody("invalid_request", c.var.requestId, ["reason"]), 400);
    }
    if (!(await withinRouteReach(c, "deletion_request", id))) {
      return c.json(errorBody("not_found", c.var.requestId), 404);
    }
    const now = c.var.deps.now();
    // Recorded in the same batch as the erasure: an erasure cannot be undone, and one that failed did not happen.
    const outcome = await decideDeletion(c.env, {
      id,
      decision,
      staff: staffOf(c).id,
      reason,
      audit: decisionAudit(c, "deletion.decide", { kind: "deletion", id }, decision),
      fsmConnected: fieldRecord(c.var.config.providers) === "fsm",
      requestId: c.var.requestId,
      now,
      log: c.var.log,
    });
    if (outcome.kind === "not_waiting") return c.json(errorBody("not_found", c.var.requestId), 404);
    if (outcome.kind === "refused") {
      return c.json(erasureRefused(outcome.refusal, outcome.blockers, c.var.requestId), 409);
    }
    if (outcome.kind === "rejected") {
      await queueMessage(c, outcome.messageId);
      return c.json({ state: "rejected" as const }, 200);
    }
    if (outcome.told !== null) await tellDeletionDone(c, outcome.told);
    return c.json({ state: "done" as const }, 200);
  });
}

/**
 * Tells the client their account is deleted, once the response has gone. The erasure has already blanked their
 * number, so this goes straight to the provider with the number read before it, and is not tried again. Staging's
 * allowlist holds it back as it does any message ops' action sends.
 */
async function tellDeletionDone(c: Context<AppEnv>, contact: ErasedContact): Promise<void> {
  const { config, deps, log } = c.var;
  const { messaging } = config.settings;
  const work = (async () => {
    if (!messaging.enabled) {
      log.info("deletion_done_not_sent", { reason: "messaging is off" });
      return;
    }
    if (
      heldBackByAllowlist(messaging, { mobile_e164: contact.mobileE164, name: contact.name, kind: "deletion_done" })
    ) {
      log.info("deletion_done_not_sent", { reason: "number not on the allowlist" });
      return;
    }
    const result = await deps.messaging.send(deletionDoneMessage(contact));
    if (result.ok) log.info("deletion_done_sent");
    else log.warn("deletion_done_failed", { detail: scrubString(result.detail).slice(0, 200) });
  })().catch((error: unknown) => {
    log.error("deletion_done_error", { error });
  });
  await afterResponse(c, work);
}

/** When each change waiting for ops started waiting, by its ID, as the Tasks board counts it. */
async function waitingSince(db: D1Database): Promise<Map<string, string>> {
  const rows = await db
    .prepare(
      `SELECT nc.id, ${NUMBER_CHANGE_WAITING_SINCE} AS since FROM number_change_requests nc
       WHERE nc.state = 'awaiting_ops'`,
    )
    .all<{ id: string; since: string }>();
  return new Map(rows.results.map((row) => [row.id, row.since]));
}

async function namesOf(db: D1Database, personIds: readonly string[]): Promise<Map<string, string>> {
  if (personIds.length === 0) return new Map();
  const placeholders = personIds.map((_, index) => `?${String(index + 1)}`).join(", ");
  const rows = await db
    .prepare(`SELECT id, name FROM people WHERE id IN (${placeholders})`)
    .bind(...personIds)
    .all<{ id: string; name: string }>();
  return new Map(rows.results.map((row) => [row.id, row.name]));
}
