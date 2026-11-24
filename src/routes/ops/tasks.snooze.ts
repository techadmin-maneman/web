// A task snoozed on Tasks until the next morning (docs/decisions/0303-snoozing-a-task.md): it leaves the board, and its
// counts, until 10 am tomorrow in India, then comes back as it was. A request about a client's own data cannot be.

import { z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { staffMemberOf } from "../../http/audit.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { permits } from "../../http/staff-access.ts";
import { opsRoute } from "../../http/session-routes.ts";
import { snoozeTask } from "../../domain/ops/task-snoozes.ts";
import { addDays, indiaDate, indiaInstant } from "../../lib/india-time.ts";
import { taskNeed } from "../../policy/console-routes.ts";
import { isSnoozable, SNOOZE_UNTIL, TASK_GROUPS } from "../../policy/tasks.ts";
import { noMemberOfStaff, taskOnTheBoard } from "./tasks.ts";

const snoozeRoute = opsRoute({
  method: "post",
  path: "/api/tasks/{group}/{id}/snooze",
  summary: "Snooze a task until 10 am tomorrow in India; it leaves the board and its counts until then",
  request: { params: z.object({ group: z.enum(TASK_GROUPS), id: z.uuid() }) },
  responses: {
    200: {
      description: "Snoozed, and until when",
      ...json(z.object({ until: z.iso.datetime() }).strict().openapi("TaskSnoozed")),
    },
    400: errorResponse("invalid_request: a request about a client's own data, which cannot be snoozed (group)"),
    403: errorResponse(
      "access_required: a service token; or not_permitted: it asks Act in the department that decides the task's group",
    ),
    404: errorResponse("not_found: no such task on the board now in the caller's cities"),
  },
});

export function registerOpsTaskSnooze(app: App): void {
  app.openapi(snoozeRoute, async (c) => {
    const key = c.req.valid("param");
    const staff = staffMemberOf(c);
    if (staff === null) return noMemberOfStaff(c);
    if (!(await permits(c, taskNeed(key.group, "act")))) return refuse(c, "not_permitted");
    if (!isSnoozable(key.group)) return refuse(c, "invalid_request", ["group"]);
    const task = await taskOnTheBoard(c, key);
    if (task === null) return refuse(c, "not_found");

    const now = c.var.deps.now();
    const until = indiaInstant(addDays(indiaDate(now), 1), SNOOZE_UNTIL);
    await snoozeTask(c.env.DB, task, {
      until,
      by: staff.id,
      now,
      audit: {
        surface: "ops",
        actor: staff,
        action: "task.snooze",
        subject: { kind: "task", id: key.id },
        requestId: c.var.requestId,
        detail: { group: key.group },
      },
    });
    return c.json({ until: until.toISOString() }, 200);
  });
}
