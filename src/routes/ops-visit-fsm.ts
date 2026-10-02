// A visit whose technician's steps were given up on, sent to FSM again from the ops console:
//
//   POST /api/visits/:id/fsm-resend   the steps given up on wait for FSM again, and the first is sent
//
// They go through the fsm-sync queue as they did the first time, so they reach FSM in the order they landed, and the
// change is audited in the batch that makes it.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AuditEntry } from "../domain/audit.ts";
import { putBackForFsm } from "../domain/job-events.ts";
import { staffOf } from "../http/audit.ts";
import type { App, AppEnv } from "../http/context.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { JOB_EVENT_KINDS } from "../policy/in-job-steps.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";

const resendRoute = createRoute({
  method: "post",
  path: "/api/visits/{id}/fsm-resend",
  summary: "Send a visit's steps that were given up on to FSM again, in the order the technician took them",
  request: { params: z.object({ id: z.uuid().openapi({ description: "The client's visit." }) }) },
  responses: {
    200: {
      description: "Waiting for FSM again, the first on its way",
      ...json(
        z
          .object({
            steps: z.array(z.enum(JOB_EVENT_KINDS)).openapi({ description: "The steps sent again, in order." }),
          })
          .strict()
          .openapi("VisitSentToFsm"),
      ),
    },
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such visit, or none of its steps was given up on"),
  },
});

const auditEntryOf = (c: Context<AppEnv>, visitId: string): AuditEntry => ({
  surface: "ops",
  actor: staffOf(c),
  action: "visit.fsm_resend",
  subject: { kind: "appointment", id: visitId },
  requestId: c.var.requestId,
});

export function registerOpsVisitFsm(app: App): void {
  app.openapi(resendRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { deps, requestId, log } = c.var;
    const putBack = await putBackForFsm(c.env.DB, id, deps.now(), auditEntryOf(c, id));
    if (putBack === null) return c.json(errorBody("not_found", requestId), 404);

    await c.env.FSM_QUEUE.send({ job_event_id: putBack.firstId, request_id: requestId } satisfies FsmSyncMessage);
    log.info("job_events_resent", { appointment_id: id, steps: putBack.kinds.length });
    return c.json({ steps: [...putBack.kinds] }, 200);
  });
}
