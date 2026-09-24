// Ops' side of the client's profile, on the ops surface behind Access
// (docs/decisions/0042-client-profile.md):
//   GET  /api/number-changes                  changes waiting for ops, both numbers proven
//   POST /api/number-changes/:id/decision     confirm or reject
//   GET  /api/deletion-requests               requests waiting for ops
//   POST /api/deletion-requests/:id/decision  delete (the Phase 1 erasure) or reject
// Each decision is audited under the member of staff who made it. Ops answer
// all three in the console's own sections (apps/ops/src).

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../app.ts";
import { actorOf, recordAudit, type AuditAction } from "../domain/audit.ts";
import { decideDeletion, deletionsWaiting } from "../domain/deletion.ts";
import { changesAwaitingOps, decideNumberChange } from "../domain/number-change.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import type { CrmSyncMessage } from "../queues/crm-sync.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";

const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });
const Reason = z
  .string()
  .trim()
  .max(300)
  .nullable()
  .openapi({ description: "Required to reject; kept with the decision." });

export const numberChangesRoute = createRoute({
  method: "get",
  path: "/api/number-changes",
  summary: "Number changes waiting for ops: both numbers proven by code",
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
    404: errorResponse("not_found: no change waiting for ops by that ID"),
    409: errorResponse("number_in_use: another person holds the new number"),
  },
});

export const deletionRequestsRoute = createRoute({
  method: "get",
  path: "/api/deletion-requests",
  summary: "Deletion requests waiting for ops",
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
    404: errorResponse("not_found: no request waiting for ops by that ID"),
  },
});

/** The member of staff behind the call; requireAccess has set it on every ops route. */
function staffOf(c: Context<AppEnv>) {
  const identity = c.var.accessIdentity;
  if (identity === undefined) throw new Error("ops routes run after requireAccess");
  return actorOf(identity);
}

async function auditDecision(
  c: Context<AppEnv>,
  action: AuditAction,
  subject: { kind: string; id: string },
  decision: string,
): Promise<void> {
  await recordAudit(
    c.env.DB,
    { surface: "ops", actor: staffOf(c), action, subject, requestId: c.var.requestId, detail: { decision } },
    c.var.deps.now(),
  );
}

export function registerOpsProfile(app: App): void {
  app.openapi(numberChangesRoute, async (c) => {
    const changes = await changesAwaitingOps(c.env.DB);
    const names = await namesOf(
      c.env.DB,
      changes.map((change) => change.personId),
    );
    return c.json(
      {
        changes: changes.map((change) => ({
          id: change.id,
          person_id: change.personId,
          name: names.get(change.personId) ?? "",
          old_mobile: change.oldMobileE164,
          new_mobile: change.newMobileE164,
          requested_at: change.createdAt,
        })),
      },
      200,
    );
  });

  app.openapi(numberChangeDecisionRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { decision, reason } = c.req.valid("json");
    if (decision === "reject" && (reason ?? "") === "") {
      return c.json(errorBody("invalid_request", c.var.requestId, ["reason"]), 400);
    }
    const staff = staffOf(c).id;
    const outcome = await decideNumberChange(c.env.DB, { id, decision, staff, reason, now: c.var.deps.now() });
    if (outcome === "not_waiting") return c.json(errorBody("not_found", c.var.requestId), 404);
    if (outcome === "number_in_use") return c.json(errorBody("number_in_use", c.var.requestId), 409);
    await auditDecision(c, "number_change.decide", { kind: "number_change", id }, decision);
    return c.json({ state: decision === "confirm" ? ("confirmed" as const) : ("rejected" as const) }, 200);
  });

  app.openapi(deletionRequestsRoute, async (c) => {
    const requests = await deletionsWaiting(c.env.DB);
    return c.json(
      {
        requests: requests.map((request) => ({
          id: request.id,
          person_id: request.personId,
          name: request.name,
          mobile: request.mobileE164,
          requested_at: request.createdAt,
        })),
      },
      200,
    );
  });

  app.openapi(deletionDecisionRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { decision, reason } = c.req.valid("json");
    if (decision === "reject" && (reason ?? "") === "") {
      return c.json(errorBody("invalid_request", c.var.requestId, ["reason"]), 400);
    }
    const waiting = await c.env.DB.prepare(
      "SELECT person_id FROM deletion_requests WHERE id = ?1 AND state = 'requested'",
    )
      .bind(id)
      .first<{ person_id: string }>();
    if (waiting === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    // Audited before it runs: an erasure cannot be undone.
    await auditDecision(c, "deletion.decide", { kind: "deletion", id }, decision);
    const outcome = await decideDeletion(c.env, { id, decision, staff: staffOf(c).id, reason, now: c.var.deps.now() });
    if (outcome === "not_waiting") return c.json(errorBody("not_found", c.var.requestId), 404);
    if (decision === "delete") await queueOutsideErasure(c, waiting.person_id);
    return c.json({ state: decision === "delete" ? ("done" as const) : ("rejected" as const) }, 200);
  });
}

/**
 * The blanking of the CRM record and the FSM contact, queued here rather than
 * left to the five-minute sweeper, so this door is as quick as the other one
 * (`POST /api/erasure`). Both consumers do nothing for a person already done,
 * so the sweeper finding them as well costs nothing.
 */
async function queueOutsideErasure(c: Context<AppEnv>, personId: string): Promise<void> {
  const message = { erase_person_id: personId, request_id: c.var.requestId };
  try {
    await c.env.CRM_QUEUE.send(message satisfies CrmSyncMessage);
    if (c.var.config.providers.FSM_PROVIDER !== "none") await c.env.FSM_QUEUE.send(message satisfies FsmSyncMessage);
  } catch (error) {
    c.var.log.warn("erasure_enqueue_failed", { person_id: personId, error }); // the sweeper sends it on
  }
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
