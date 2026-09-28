// What ops still have to do, behind Access (Ops Console, board D2;
// src/policy/tasks.ts):
//   GET /api/tasks                        the groups, their counts, how many have run over, and whose each task is
//   PUT /api/tasks/:group/:id/owner       make a task a member of staff's, or nobody's
//
// A task is not a record. It is a row in a queue the database already keeps,
// read at the moment ops look: a held grant, an undecided no-show, a number
// change waiting for ops, an erasure asked for, a grievance to answer, a piece
// past its replacement date, an invoice still a draft, an erasure FSM would not
// finish, a client past their next service with nothing booked, a first fit
// asked for and not booked. Each task leaves when the thing itself is done,
// wherever it is done. What is kept about a task is whose it is, keyed by its
// group and its row's id (docs/decisions/0092-task-owners.md).
//
// Every count is the whole queue's. Each group lists its longest waits and no
// more, since past that the section that decides them is the tool.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../http/context.ts";
import { staffOf } from "../http/audit.ts";
import { assignTask, handBackTask, staffWhoHaveSignedIn, type TaskKey } from "../domain/task-owners.ts";
import { outstandingTasks, overdueCount, READ_CAP, type Task } from "../domain/tasks.ts";
import { opsInputs } from "../http/ops-inputs.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { isClosable, mayOwnTasks, TASK_GROUPS, TASK_SLA_HOURS } from "../policy/tasks.ts";

/** The tasks each group lists, the longest waits; its count is the whole queue's. */
export const TASKS_SHOWN = 50;

// Not held to an e-mail's form: what makes an owner is having signed in, and locally Access's stand-in is ops@localhost.
const OwnerSchema = z
  .union([z.string().trim().min(1).max(254), z.null()])
  .openapi({ description: "The Access e-mail of the member of staff it is theirs; null while it is nobody's." });

const TaskSchema = z
  .object({
    id: z.uuid().openapi({ description: "The queued row's own id, so the task can be reached where it is decided." }),
    person: z
      .union([z.object({ id: z.uuid(), name: z.string() }).strict(), z.null()])
      .openapi({ description: "Null for an erased client, whose record is gone." }),
    detail: z.union([z.string(), z.null()]).openapi({
      description:
        "The one fact the group turns on: a piece's label, a fraud rule, a technician, a Books invoice, an FSM " +
        "contact; for a consultation asked for, its day and window and, where a first fit was asked for with it, " +
        '"first_fit" and the window wanted ("any" for either); for an at-risk client, the last visit\'s start and ' +
        "the day the next service fell due; for a first fit to book, the consultation's start and the window wanted.",
    }),
    since: z.iso.datetime().openapi({ description: "When it started waiting." }),
    due: z.iso.datetime().openapi({
      description: `since plus the group's allowance, which ops set; ${String(TASK_SLA_HOURS.referral_review)} hours until they do.`,
    }),
    owner: OwnerSchema,
  })
  .strict()
  .openapi("Task");

const TasksSchema = z
  .object({
    overdue: z.number().int().openapi({ description: "How many are past their day in India, across every group." }),
    truncated: z.boolean().openapi({
      description: `More were waiting than one look reads (${String(READ_CAP)} a statement), so a count may be short.`,
    }),
    staff: z.array(z.string()).openapi({
      description: "The members of staff a task may be given to: everyone who has signed in to the console, by e-mail.",
    }),
    groups: z.array(
      z
        .object({
          group: z.enum(TASK_GROUPS),
          count: z.number().int().openapi({ description: "How many are waiting in the group, all of them." }),
          closable: z
            .boolean()
            .openapi({ description: "Ops may close a task of the group without doing its thing, with a reason." }),
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

/** A task by its group and the id of the row it is read from, as the board names it. */
const TaskParams = z.object({ group: z.enum(TASK_GROUPS), id: z.uuid() });

const ownerRoute = createRoute({
  method: "put",
  path: "/api/tasks/{group}/{id}/owner",
  summary: "Make a task a member of staff's, or hand it back to nobody",
  request: {
    params: TaskParams,
    body: {
      required: true,
      ...json(
        z
          .object({
            owner: OwnerSchema.openapi({
              description:
                "A member of staff who has signed in to the console, by their Access e-mail: one's own to take " +
                "the task, another's to give it to them; null to hand it back.",
            }),
          })
          .strict()
          .openapi("TaskOwnerChange"),
      ),
    },
  },
  responses: {
    200: {
      description: "Whose it is now",
      ...json(z.object({ owner: OwnerSchema }).strict().openapi("TaskOwner")),
    },
    400: errorResponse("invalid_request: nobody has signed in to the console with that e-mail"),
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such task on the board now; its thing may be done already"),
  },
});

/** Every task on the board, as a look at it reads them now. */
async function readTheBoard(c: Context<AppEnv>) {
  const inputs = await opsInputs(c);
  return outstandingTasks(c.env.DB, c.var.deps.now(), inputs.taskSlaHours, inputs.nextVisitDays);
}

/** The task as the board reads it now; null once its thing is done, or if there never was one. */
async function taskOnTheBoard(c: Context<AppEnv>, key: TaskKey): Promise<Task | null> {
  const { tasks } = await readTheBoard(c);
  return tasks.find((task) => task.group === key.group && task.id === key.id) ?? null;
}

export function registerOpsTasks(app: App): void {
  app.openapi(tasksRoute, async (c) => {
    const now = c.var.deps.now();
    const [{ tasks, truncated }, staff] = await Promise.all([readTheBoard(c), staffWhoHaveSignedIn(c.env.DB)]);
    // In the policy's order, and a group with nothing in it is left out, as the board draws none.
    const groups = TASK_GROUPS.map((group) => {
      const waiting = tasks.filter((task) => task.group === group);
      const shown = waiting.slice(0, TASKS_SHOWN);
      return {
        group,
        count: waiting.length,
        closable: isClosable(group),
        tasks: shown.map(({ id, person, detail, since, due, owner }) => ({ id, person, detail, since, due, owner })),
      };
    }).filter((each) => each.count > 0);

    return c.json({ overdue: overdueCount(tasks, now), truncated, staff, groups }, 200);
  });

  app.openapi(ownerRoute, async (c) => {
    const key = c.req.valid("param");
    const asked = c.req.valid("json").owner;
    // Access gives every e-mail in lower case, and the log keeps it so.
    const owner = asked === null ? null : asked.toLowerCase();
    const { requestId } = c.var;
    const db = c.env.DB;

    const task = await taskOnTheBoard(c, key);
    if (task === null) return c.json(errorBody("not_found", requestId), 404);
    if (task.owner === owner) return c.json({ owner }, 200);

    const now = c.var.deps.now();
    const staff = staffOf(c);
    const entry = { surface: "ops" as const, actor: staff, subject: { kind: "task", id: key.id }, requestId };
    if (owner === null) {
      await handBackTask(db, key, { now, audit: { ...entry, action: "task.hand_back", detail: { group: key.group } } });
      return c.json({ owner: null }, 200);
    }
    if (!mayOwnTasks(owner, await staffWhoHaveSignedIn(db))) {
      return c.json(errorBody("invalid_request", requestId, ["owner"]), 400);
    }
    await assignTask(db, key, {
      owner,
      by: staff.id,
      now,
      audit: { ...entry, action: "task.assign", detail: { group: key.group, owner } },
    });
    return c.json({ owner }, 200);
  });
}
