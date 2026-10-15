// What ops still have to do, behind Access (src/policy/tasks.ts).
//
// A task is not a record. It is a row in a queue the database already keeps,
// read at the moment ops look: a held grant, an undecided no-show, a number
// change waiting for ops, an erasure asked for, a grievance to answer, a piece
// past its replacement date, an invoice still a draft, a client past their next
// service with nothing booked, a client
// consulted and not fitted. Each task leaves when the thing itself is done,
// wherever it is done, but for the groups ops may close with why: a visit left
// partly done, an at-risk client, a City matter. What is kept about a task is whose it is, and why ops
// closed it, keyed by its group and its row's id
// (docs/decisions/0092-task-owners.md).
//
// Every count is the whole queue's within the caller's cities. Each group lists
// its longest waits and no more, since past that the section that decides them
// is the tool.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../../http/context.ts";
import { staffMemberOf } from "../../http/audit.ts";
import { closeTask } from "../../domain/ops/task-closures.ts";
import { assignTask, handBackTask, staffSeenSince, type TaskKey } from "../../domain/ops/task-owners.ts";
import { outstandingTasks, overdueCount, READ_CAP, type Task } from "../../domain/ops/tasks.ts";
import { lowStockPlaces } from "../../domain/inventory/low-stock.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { REASON_MAX_CHARS } from "../../policy/decision-reasons.ts";
import { DAY_MS } from "../../lib/durations.ts";
import {
  CLOSABLE_TASK_GROUPS,
  hasLapsed,
  isClosable,
  mayOwnTasks,
  STAFF_SEEN_WITHIN_DAYS,
  TASK_GROUPS,
  TASK_SLA_HOURS,
  type TaskGroup,
} from "../../policy/tasks.ts";
import { callerAccess, permits } from "../../http/staff-access.ts";
import { placesReached, type Level } from "../../policy/access.ts";
import { callerMeetsNeed, TASK_DEPARTMENTS, taskNeed } from "../../policy/console-routes.ts";
import { TaskFactsSchema } from "./tasks.schemas.ts";
import { boardDays } from "../../policy/next-visit.ts";
import { selfServeKinds } from "../../policy/self-serve.ts";

/** The tasks each group lists, the longest waits; its count is the whole queue's. */
export const TASKS_SHOWN = 50;

// Not held to an e-mail's form: what makes an owner is having signed in, and locally Access's stand-in is ops@localhost.
const OwnerSchema = z
  .union([z.string().trim().min(1).max(254), z.null()])
  .openapi({ description: "The Access e-mail of the member of staff it is theirs; null while it is nobody's." });

const TaskSchema = z
  .object({
    id: z.uuid().openapi({
      description:
        "The queued row's own id, so the task can be reached where it is decided; for a first fit to book, the client's.",
    }),
    person: z
      .union([
        z
          .object({
            id: z.uuid(),
            name: z.string(),
            mobile: z.string().optional().openapi({
              description: "On a move the client has not heard of, their mobile, for the call. Left out elsewhere.",
            }),
          })
          .strict(),
        z.null(),
      ])
      .openapi({ description: "Null for an erased client, whose record is gone." }),
    visit: z
      .object({ id: z.uuid(), starts_at: z.iso.datetime() })
      .strict()
      .optional()
      .openapi({
        description:
          "The visit to come the dispatch board settles the task on, so the task can open it there: a move the " +
          "client has not heard of, and a job on its technician's day off. Left out for every other group.",
      }),
    facts: TaskFactsSchema,
    detail: z.union([z.string(), z.null()]).openapi({
      description:
        "Read facts instead: detail goes once no console reads it. The one fact the group turns on: a piece's label and the day it falls due, a fraud rule, a technician, a Books invoice; " +
        'for a move the client has not heard of, the start it moved to and why ("no_consent" or ' +
        '"not_sent", as the dispatch board\'s untold says); for a consultation asked for, its day and window and, ' +
        "where a first fit was asked for with it, " +
        '"first_fit" and the window wanted ("any" for either); for an at-risk client, the last visit\'s start and ' +
        "the day the next service fell due; for a first fit to book, the consultation's start and the window the fit " +
        "is offered in, the consultation's (\"any\" where a fit cannot start in it); for a payment owed, the link's state " +
        '("sent", "unsent" or "refused"), its amount in paise, its address ("-" until Razorpay made it) and the product; ' +
        'for a payment to refund, why ("let_go", a hold let go whose refund Razorpay would not make, or ' +
        '"refund_failed"), what is owed back in paise, and the Razorpay payment.',
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
      description:
        `More were waiting than one look reads (${String(READ_CAP)} a statement): every count is whole, but the ` +
        "overdue figure may be short.",
    }),
    staff: z.array(z.string()).openapi({
      description:
        "The members of staff a task may be given to: those who have used the console in the last " +
        `${String(STAFF_SEEN_WITHIN_DAYS)} days, by e-mail.`,
    }),
    low_stock_places: z.number().int().openapi({
      description:
        "How many places, the central store and each kit, hold something at or below its level: Stock's badge.",
    }),
    lapsed: z.number().int().openapi({
      description: "How many tasks the board leaves out for having waited past the days ops set; none when asked for.",
    }),
    groups: z.array(
      z
        .object({
          group: z.enum(TASK_GROUPS),
          count: z
            .number()
            .int()
            .openapi({ description: "How many are waiting in the group in the caller's cities, all of them." }),
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

const tasksRoute = opsRoute({
  method: "get",
  path: "/api/tasks",
  summary: "What ops still have to do, by group, the longest wait first",
  request: {
    query: z.object({
      person: z.uuid().optional().openapi({
        description: "One client's tasks alone, for their page; every count is then theirs.",
      }),
      lapsed: z.enum(["include"]).optional().openapi({
        description:
          "The tasks past the days ops set for a task to lapse as well, which the board otherwise leaves out.",
      }),
    }),
  },
  responses: {
    200: {
      description:
        "The groups with something in them, of the caller's own departments and cities once the Staff list is enforced",
      ...json(TasksSchema),
    },
    400: errorResponse("invalid_request: person is not a client's id"),
    403: errorResponse("access_required, or not_permitted: no View in any department"),
  },
});

/** A task by its group and the id of the row it is read from, as the board names it. */
const TaskParams = z.object({ group: z.enum(TASK_GROUPS), id: z.uuid() });

const ownerRoute = opsRoute({
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
                `A member of staff who has used the console in the last ${String(STAFF_SEEN_WITHIN_DAYS)} days, by their ` +
                "Access e-mail: one's own to take " +
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
    400: errorResponse("invalid_request: nobody has used the console lately with that e-mail"),
    403: errorResponse(
      "access_required: no Access token, or a service token, which names no member of staff; or not_permitted: " +
        "it asks Act in the department that decides the task's group",
    ),
    404: errorResponse(
      "not_found: no such task on the board now in the caller's cities; its thing may be done already",
    ),
  },
});

const closeRoute = opsRoute({
  method: "post",
  path: "/api/tasks/{group}/{id}/close",
  summary:
    "Close a visit left partly done, an at-risk client or a City matter without doing its thing, with why; it leaves the board and stays closed",
  request: {
    params: z.object({ group: z.enum(CLOSABLE_TASK_GROUPS), id: z.uuid() }),
    body: {
      required: true,
      ...json(
        z
          .object({
            reason: z.string().trim().min(1).max(REASON_MAX_CHARS).openapi({
              description:
                "Why no follow-up is booked, in ops' words: kept with the closing, blanked if the client is erased.",
            }),
          })
          .strict()
          .openapi("TaskClosing"),
      ),
    },
  },
  responses: {
    204: { description: "Closed, under the member of staff who closed it" },
    400: errorResponse("invalid_request: no reason, or a group whose tasks close only when their thing is done"),
    403: errorResponse("access_required: no Access token, or a service token, which names no member of staff"),
    404: errorResponse(
      "not_found: no such task on the board now in the caller's cities; a follow-up may be booked, or it is closed already",
    ),
  },
});

/**
 * Every task on the board in the caller's cities, or one client's, as a look at it reads them now: each group's where
 * their grants in its department reach at the level asked.
 */
async function readTheBoard(c: Context<AppEnv>, level: Level, person?: string) {
  const [inputs, access] = await Promise.all([opsInputs(c), callerAccess(c)]);
  const fitsSelfBooked = selfServeKinds(c.var.config.settings).includes("first_fit");
  return outstandingTasks(c.env.DB, c.var.deps.now(), inputs.taskSlaHours, {
    days: boardDays(inputs.nextVisitDays, fitsSelfBooked),
    hours: inputs.careHours,
    lostAfter: inputs.lostAfterDays,
    reach: (group: TaskGroup) => placesReached(access, TASK_DEPARTMENTS[group], level),
    person,
  });
}

/** A task as the board answers it: the visit and the client's mobile only where its group carries them. */
function taskBody(task: Task) {
  const { id, facts, detail, since, due, owner, visit } = task;
  const body = { id, person: personBody(task.person), facts, detail, since, due, owner };
  return visit === null ? body : { ...body, visit };
}

function personBody(person: Task["person"]) {
  if (person === null) return null;
  const { id, name, mobile } = person;
  return mobile === null ? { id, name } : { id, name, mobile };
}

/** The members of staff a task may be given to: those who have used the console lately (src/policy/tasks.ts). */
const staffNow = (c: Context<AppEnv>): Promise<string[]> =>
  staffSeenSince(c.env.DB, new Date(c.var.deps.now().getTime() - STAFF_SEEN_WITHIN_DAYS * DAY_MS));

/** A write kept under whoever made it, asked for by a service token, which names nobody. */
const noMemberOfStaff = (c: Context<AppEnv>) => refuse(c, "access_required");

/** The task as the board reads it now; null once its thing is done, if there never was one, or if it is elsewhere. */
async function taskOnTheBoard(c: Context<AppEnv>, key: TaskKey): Promise<Task | null> {
  const { tasks } = await readTheBoard(c, "act");
  return tasks.find((task) => task.group === key.group && task.id === key.id) ?? null;
}

/** The groups of the caller's own departments; every group while the Staff list is not enforced. */
async function groupsSeenBy(c: Context<AppEnv>): Promise<TaskGroup[]> {
  const access = await callerAccess(c);
  if (!access.enforced) return [...TASK_GROUPS];
  return TASK_GROUPS.filter((group) => callerMeetsNeed(access.caller, taskNeed(group, "view"), access.zoneOf));
}

/** The tasks of the groups seen, less those past the lapse days unless they are asked for, and those apart. */
function splitLapsed(
  all: readonly Task[],
  look: { seen: readonly TaskGroup[]; asked: "include" | undefined; now: Date; lapseDays: number },
) {
  const lapsedOf = (task: Task) => look.asked !== "include" && hasLapsed(task.since, look.now, look.lapseDays);
  const seen = all.filter((task) => look.seen.includes(task.group));
  return { tasks: seen.filter((task) => !lapsedOf(task)), lapsed: seen.filter(lapsedOf) };
}

export function registerOpsTasks(app: App): void {
  app.openapi(tasksRoute, async (c) => {
    const now = c.var.deps.now();
    const { person, lapsed: asked } = c.req.valid("query");
    const [board, staff, seen, lowStock, inputs] = await Promise.all([
      readTheBoard(c, "view", person),
      staffNow(c),
      groupsSeenBy(c),
      lowStockPlaces(c.env.DB),
      opsInputs(c),
    ]);
    const { tasks, lapsed } = splitLapsed(board.tasks, { seen, asked, now, lapseDays: inputs.taskLapseDays });
    // In the policy's order, and a group with nothing in it is left out, as the board draws none.
    const groups = seen
      .map((group) => {
        const shown = tasks.filter((task) => task.group === group).slice(0, TASKS_SHOWN);
        return {
          group,
          count: (board.counts.get(group) ?? 0) - lapsed.filter((task) => task.group === group).length,
          closable: isClosable(group),
          tasks: shown.map(taskBody),
        };
      })
      .filter((each) => each.count > 0);

    const overdue = overdueCount(tasks, now);
    const answer = { overdue, truncated: board.truncated, staff, low_stock_places: lowStock, lapsed: lapsed.length };
    return c.json({ ...answer, groups }, 200);
  });

  app.openapi(ownerRoute, async (c) => {
    const key = c.req.valid("param");
    const asked = c.req.valid("json").owner;
    // Access gives every e-mail in lower case, and the log keeps it so.
    const owner = asked === null ? null : asked.toLowerCase();
    const { requestId } = c.var;
    const db = c.env.DB;
    if (!(await permits(c, taskNeed(key.group, "act")))) return refuse(c, "not_permitted");
    const staff = staffMemberOf(c);
    if (staff === null) return noMemberOfStaff(c);

    const task = await taskOnTheBoard(c, key);
    if (task === null) return refuse(c, "not_found");
    if (task.owner === owner) return c.json({ owner }, 200);

    const now = c.var.deps.now();
    const entry = { surface: "ops" as const, actor: staff, subject: { kind: "task", id: key.id }, requestId };
    if (owner === null) {
      await handBackTask(db, key, { now, audit: { ...entry, action: "task.hand_back", detail: { group: key.group } } });
      return c.json({ owner: null }, 200);
    }
    if (!mayOwnTasks(owner, await staffNow(c))) {
      return refuse(c, "invalid_request", ["owner"]);
    }
    await assignTask(db, task, {
      owner,
      by: staff.id,
      now,
      audit: { ...entry, action: "task.assign", detail: { group: key.group, owner } },
    });
    return c.json({ owner }, 200);
  });

  app.openapi(closeRoute, async (c) => {
    const key = c.req.valid("param");
    const { reason } = c.req.valid("json");
    const { requestId } = c.var;
    const staff = staffMemberOf(c);
    if (staff === null) return noMemberOfStaff(c);
    if ((await taskOnTheBoard(c, key)) === null) return refuse(c, "not_found");

    const now = c.var.deps.now();
    await closeTask(c.env.DB, key, {
      reason,
      by: staff.id,
      now,
      // The reason is ops' words about the client, kept with the closing and never in the log (ADR 0072).
      audit: {
        surface: "ops",
        actor: staff,
        action: "task.close",
        subject: { kind: "task", id: key.id },
        requestId,
        detail: { group: key.group },
      },
    });
    return c.body(null, 204);
  });
}
