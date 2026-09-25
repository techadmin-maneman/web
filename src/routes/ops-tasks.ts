// What ops still have to do, behind Access (Ops Console, board D2;
// src/policy/tasks.ts):
//   GET /api/tasks     the groups, their counts, and how many have run over
//
// A task is not a record. It is a row in a queue the database already keeps,
// read at the moment ops look: a held grant, an undecided no-show, a number
// change waiting for ops, an erasure asked for, a grievance to answer, a piece
// past its replacement date, an invoice still a draft, an erasure FSM would not
// finish. Nothing here writes, and there is nothing to close: each task leaves
// when the thing itself is done, wherever it is done.
//
// Every count is the whole queue's. Each group lists its longest waits and no
// more, since past that the section that decides them is the tool.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../app.ts";
import { outstandingTasks, overdueCount, READ_CAP } from "../domain/tasks.ts";
import { opsInputs } from "../http/ops-inputs.ts";
import { errorResponse } from "../http/errors.ts";
import { TASK_GROUPS, TASK_SLA_HOURS } from "../policy/tasks.ts";

const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });

/** The tasks each group lists, the longest waits; its count is the whole queue's. */
export const TASKS_SHOWN = 50;

const TaskSchema = z
  .object({
    id: z.uuid().openapi({ description: "The queued row's own id, so the task can be reached where it is decided." }),
    person: z
      .union([z.object({ id: z.uuid(), name: z.string() }).strict(), z.null()])
      .openapi({ description: "Null for an erased client, whose record is gone." }),
    detail: z.union([z.string(), z.null()]).openapi({
      description:
        "The one fact the group turns on: a piece's label, a fraud rule, a technician, a Books invoice, an FSM contact.",
    }),
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
    truncated: z.boolean().openapi({
      description: `More were waiting than one look reads (${String(READ_CAP)} a statement), so a count may be short.`,
    }),
    groups: z.array(
      z
        .object({
          group: z.enum(TASK_GROUPS),
          count: z.number().int().openapi({ description: "How many are waiting in the group, all of them." }),
          tasks: z
            .array(TaskSchema)
            .openapi({ description: `The longest wait first, at most ${String(TASKS_SHOWN)}.` }),
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
    const { tasks, truncated } = await outstandingTasks(c.env.DB, now, (await opsInputs(c)).taskSlaHours);
    // In the policy's order, and a group with nothing in it is left out, as the board draws none.
    const groups = TASK_GROUPS.map((group) => {
      const waiting = tasks.filter((task) => task.group === group);
      const shown = waiting.slice(0, TASKS_SHOWN);
      return {
        group,
        count: waiting.length,
        tasks: shown.map(({ id, person, detail, since, due }) => ({ id, person, detail, since, due })),
      };
    }).filter((each) => each.count > 0);

    return c.json({ overdue: overdueCount(tasks, now), truncated, groups }, 200);
  });
}
