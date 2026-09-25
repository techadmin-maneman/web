// What ops still have to do, behind Access (Ops Console, board D2;
// src/policy/tasks.ts):
//   GET /api/tasks     the groups, their counts, and how many have run over
//
// A task is not a record. It is a row in a queue the database already keeps,
// read at the moment ops look: a held grant, an undecided no-show, a number
// change waiting for ops, an erasure asked for, a piece past its replacement
// date, an invoice still a draft. Nothing here writes, and there is nothing to
// close: each task leaves when the thing itself is done, wherever it is done.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../app.ts";
import { outstandingTasks, overdueCount } from "../domain/tasks.ts";
import { opsInputs } from "../http/ops-inputs.ts";
import { errorResponse } from "../http/errors.ts";
import { TASK_GROUPS, TASK_SLA_HOURS } from "../policy/tasks.ts";

const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });

/** As many as the board can usefully hold; past this, the queues themselves are the tool. */
const LIMIT = 200;

const TaskSchema = z
  .object({
    id: z.uuid().openapi({ description: "The queued row's own id, so the task can be reached where it is decided." }),
    person: z
      .union([z.object({ id: z.uuid(), name: z.string() }).strict(), z.null()])
      .openapi({ description: "Null for a no-show, whose case names the technician and never the client." }),
    detail: z
      .union([z.string(), z.null()])
      .openapi({ description: "The one fact the group turns on: a piece's label, a fraud rule, a technician." }),
    since: z.iso.datetime().openapi({ description: "When it started waiting." }),
    due: z.iso.datetime().openapi({
      description: `since plus the group's allowance, which ops set; ${String(TASK_SLA_HOURS.referral_review)} hours until they do.`,
    }),
  })
  .strict()
  .openapi("Task");

const TasksSchema = z
  .object({
    overdue: z.number().int().openapi({ description: "How many are past their day in India, across every group." }),
    groups: z.array(
      z
        .object({
          group: z.enum(TASK_GROUPS),
          count: z.number().int(),
          tasks: z.array(TaskSchema).openapi({ description: "The longest wait first." }),
        })
        .strict(),
    ),
  })
  .strict()
  .openapi("Tasks", { description: "Derived at read time from the queues themselves; there is no tasks table." });

const tasksRoute = createRoute({
  method: "get",
  path: "/api/tasks",
  summary: "What ops still have to do, by group, the longest wait first",
  responses: {
    200: { description: "The groups with something in them", ...json(TasksSchema) },
    403: errorResponse("access_required"),
  },
});

export function registerOpsTasks(app: App): void {
  app.openapi(tasksRoute, async (c) => {
    const now = c.var.deps.now();
    const tasks = await outstandingTasks(c.env.DB, now, LIMIT, (await opsInputs(c)).taskSlaHours);
    // In the policy's order, and a group with nothing in it is left out, as the board draws none.
    const groups = TASK_GROUPS.map((group) => {
      const waiting = tasks.filter((task) => task.group === group);
      return {
        group,
        count: waiting.length,
        tasks: waiting.map(({ id, person, detail, since, due }) => ({ id, person, detail, since, due })),
      };
    }).filter((each) => each.count > 0);

    return c.json({ overdue: overdueCount(tasks, now), groups }, 200);
  });
}
