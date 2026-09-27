// POST /api/hooks/fsm/:token: FSM's webhooks (docs/decisions/0032-fsm-mirror.md).
// A workflow rule in FSM calls this whenever an appointment is created,
// edited or deleted (runbook, step 11b). FSM does not sign its webhooks, so the
// secret is in the URL, as Evolution's is.
//
// The body is only a hint: which appointment changed. It is kept once in the
// inbox and put on the fsm-sync queue, whose consumer reads the appointment
// afresh from FSM. The token is never logged: the request log records the
// route's pattern, not its path.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { secretsMatch } from "../lib/hash.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";

/** The only module the mirror follows by webhook; others are ignored. */
const APPOINTMENTS = "Service_Appointments";

/**
 * The fields the workflow rule sends: FSM puts a webhook's form parameters in the query string, with an
 * empty body; JSON or a form body are read too. Anything else is ignored.
 */
const FsmHintSchema = z.object({
  module: z.string(),
  id: z.string().min(1).max(40),
  modified_time: z.string().max(40).optional(),
  /** What happened, as the rule names it: "create", "edit" or "delete" (runbook, step 11b). */
  event: z.string().max(20).optional(),
});

export const fsmHookRoute = createRoute({
  method: "post",
  path: "/api/hooks/fsm/{token}",
  summary: "FSM's webhook: an appointment was created, edited or deleted",
  request: { params: z.object({ token: z.string() }) },
  responses: {
    204: { description: "Taken, or ignored. Either way FSM need not send it again" },
    401: errorResponse("unauthorized: the token is wrong"),
    404: errorResponse("not_found: FSM's webhook is not switched on (no FSM_WEBHOOK_TOKEN)"),
  },
});

export function registerFsmHook(app: App): void {
  app.openapi(fsmHookRoute, async (c) => {
    const { requestId, log } = c.var;
    const expected = c.var.config.settings.zohoFsm?.webhookToken ?? null;
    if (expected === null) return c.json(errorBody("not_found", requestId), 404);
    if (!(await secretsMatch(c.req.valid("param").token, expected))) {
      log.warn("fsm_hook_unauthorized");
      return c.json(errorBody("unauthorized", requestId), 401);
    }

    const isJson = (c.req.header("Content-Type") ?? "").includes("json");
    const body: unknown = isJson
      ? await c.req.json<unknown>().catch(() => null)
      : await c.req.parseBody().catch(() => null);
    const parsed = FsmHintSchema.safeParse({ ...c.req.query(), ...(typeof body === "object" ? body : {}) });
    if (!parsed.success) {
      log.warn("fsm_hook_unreadable");
      return c.body(null, 204);
    }
    const hint = parsed.data;
    if (hint.module !== APPOINTMENTS) {
      log.info("fsm_hook_ignored", { module: hint.module.slice(0, 40) });
      return c.body(null, 204);
    }

    const now = c.var.deps.now();
    // FSM sends no event ID. A delivery is the same event when it names the same record, the same event and the
    // same modified time; a hint without a time counts once a minute. A deletion keeps the modified time of the
    // last edit, so without its event it would read as a repeat of that edit and be dropped.
    const version = hint.modified_time ?? now.toISOString().slice(0, 16);
    const event = hint.event?.toLowerCase() ?? "change";
    const inboxId = crypto.randomUUID();
    const inserted = await c.env.DB.prepare(
      `INSERT INTO webhook_inbox (id, source, dedupe_key, module, record_id, received_at)
       VALUES (?1, 'fsm', ?2, ?3, ?4, ?5) ON CONFLICT (dedupe_key) DO NOTHING`,
    )
      .bind(inboxId, `fsm:${hint.module}:${hint.id}:${event}:${version}`, hint.module, hint.id, now.toISOString())
      .run();

    if (inserted.meta.changes === 0) {
      log.info("fsm_hook_repeat", { fsm_id: hint.id });
      return c.body(null, 204);
    }
    const message: FsmSyncMessage = { fsm_id: hint.id, inbox_id: inboxId, request_id: requestId };
    await c.env.FSM_QUEUE.send(message);
    log.info("fsm_hook_taken", { fsm_id: hint.id });
    return c.body(null, 204);
  });
}
