// Cycle counts, behind Access (docs/decisions/0185-cycle-counts.md):
//   GET  /api/count-tasks                     the tasks still to finish and those done in the last week, in the
//                                             caller's places, and every item with its class
//   GET  /api/count-tasks/{id}                one task and its items, never a figure
//   GET  /api/count-tasks/{id}/differences    the lines waiting for a sign-off, with what was held and both counts
//   POST /api/count-tasks/{id}/counts         an open task counted, every item it lists
//   POST /api/count-tasks/{id}/recounts       the lines that differed counted again
//   POST /api/count-tasks/{id}/sign-off       a recount that still differs signed off, with why
//   POST /api/consumables/{code}/count-class  an item's class set, or put back to its kind's own
//
// Read with Operations VIEW in the caller's places; counted with ACT; the differences and the sign-off with MANAGE;
// the classes with Operations MANAGE.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
  countClasses,
  countItems,
  countTask,
  countTasks,
  differences,
  setCountClass,
  signOff,
  submitCounts,
  submitRecounts,
  type CountTask,
  type Stepped,
} from "../../domain/field/count-tasks.ts";
import { isPlaceWithin, placesWithin } from "../../domain/field/stock-places.ts";
import { actorOf } from "../../http/audit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { routeReach } from "../../http/staff-access.ts";
import { addDays, indiaDate } from "../../lib/india-time.ts";
import { MAX_NOTE } from "../../config/consumables.ts";
import { COUNT_CLASSES } from "../../policy/cycle-counts.ts";

/** How long a done task stays on the list. */
const DONE_SHOWN_DAYS = 7;

const Code = z.string().min(1).max(64);
const Note = z
  .string()
  .trim()
  .min(1)
  .max(MAX_NOTE)
  .regex(/^[^p{Cc}]+$/u);
const Class = z.enum(COUNT_CLASSES);
const State = z.enum(["open", "recount", "sign_off", "done"]);

const TaskSchema = z.object({
  id: z.string(),
  place_id: z.string(),
  place: z.string(),
  count_class: Class,
  due_on: z.iso.date(),
  state: State,
});

const TASKS = {
  description: "The count tasks, and every item's class",
  ...json(
    z
      .object({
        tasks: z.array(TaskSchema),
        classes: z.array(
          z.object({
            consumable_code: z.string(),
            name: z.string(),
            count_class: Class,
            set: z.boolean().openapi({ description: "Whether ops set it, rather than its kind's own." }),
            hair_system: z.boolean(),
          }),
        ),
      })
      .openapi("CountTasks"),
  ),
};

const TASK = {
  description: "A count task and its items, never a figure",
  ...json(
    z
      .object({
        task: TaskSchema,
        items: z.array(
          z.object({
            consumable_code: z.string(),
            name: z.string(),
            state: z.enum(["to_count", "recount", "sign_off", "settled"]),
          }),
        ),
      })
      .openapi("CountTask"),
  ),
};

const ACCESS = errorResponse("access_required");
const taskPath = { params: z.object({ id: z.string().min(1).max(64) }) };
const Lines = z
  .object({
    lines: z
      .array(z.object({ consumable_code: Code, counted: z.number().int().min(0).max(1_000_000) }).strict())
      .max(500),
  })
  .strict();
const STEP_ANSWERS = {
  200: TASK,
  400: errorResponse("invalid_request: fields names lines where they are not every item the step counts"),
  403: ACCESS,
  404: errorResponse("not_found: no such task in the caller's places"),
  409: errorResponse("order_state: the task has moved past this step"),
};

const listRoute = createRoute({
  method: "get",
  path: "/api/count-tasks",
  summary: "The count tasks in the caller's places, and every item's class",
  responses: { 200: TASKS, 403: ACCESS },
});

const taskRoute = createRoute({
  method: "get",
  path: "/api/count-tasks/{id}",
  summary: "A count task and its items, never a figure",
  request: taskPath,
  responses: { 200: TASK, 403: ACCESS, 404: errorResponse("not_found: no such task in the caller's places") },
});

const differencesRoute = createRoute({
  method: "get",
  path: "/api/count-tasks/{id}/differences",
  summary: "The lines waiting for a sign-off, with what was held and both counts",
  request: taskPath,
  responses: {
    200: {
      description: "The differences",
      ...json(
        z
          .object({
            lines: z.array(
              z.object({
                consumable_code: z.string(),
                name: z.string(),
                held: z.number().int(),
                counted: z.number().int(),
                recounted: z.number().int().nullable(),
              }),
            ),
          })
          .openapi("CountDifferences"),
      ),
    },
    403: ACCESS,
    404: errorResponse("not_found: no such task in the caller's places"),
  },
});

const countsRoute = createRoute({
  method: "post",
  path: "/api/count-tasks/{id}/counts",
  summary: "An open task counted, every item it lists",
  request: { ...taskPath, body: { required: true, ...json(Lines.openapi("CountTaskCounts")) } },
  responses: STEP_ANSWERS,
});

const recountsRoute = createRoute({
  method: "post",
  path: "/api/count-tasks/{id}/recounts",
  summary: "The lines that differed counted again",
  request: { ...taskPath, body: { required: true, ...json(Lines.openapi("CountTaskRecounts")) } },
  responses: STEP_ANSWERS,
});

const signOffRoute = createRoute({
  method: "post",
  path: "/api/count-tasks/{id}/sign-off",
  summary: "A recount that still differs signed off, with why",
  request: {
    ...taskPath,
    body: { required: true, ...json(z.object({ note: Note }).strict().openapi("CountTaskSignOff")) },
  },
  responses: STEP_ANSWERS,
});

const classRoute = createRoute({
  method: "post",
  path: "/api/consumables/{code}/count-class",
  summary: "An item's count class set, or put back to its kind's own with null",
  request: {
    params: z.object({ code: Code }),
    body: {
      required: true,
      ...json(z.object({ count_class: Class.nullable() }).strict().openapi("CountClassChange")),
    },
  },
  responses: { 200: TASKS, 403: ACCESS, 404: errorResponse("not_found: no such item, or it is retired") },
});

const written = (c: Context<AppEnv>) => ({ actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() });

const taskJson = (task: CountTask) => ({
  id: task.id,
  place_id: task.placeId,
  place: task.place,
  count_class: task.countClass,
  due_on: task.dueOn,
  state: task.state,
});

async function tasksAnswer(c: Context<AppEnv>) {
  const now = c.var.deps.now();
  const within = await placesWithin(c.env.DB, await routeReach(c));
  const [tasks, classes] = await Promise.all([
    countTasks(c.env.DB, within, addDays(indiaDate(now), -DONE_SHOWN_DAYS)),
    countClasses(c.env.DB),
  ]);
  return {
    tasks: tasks.map(taskJson),
    classes: classes.map((item) => ({
      consumable_code: item.code,
      name: item.name,
      count_class: item.countClass,
      set: item.set,
      hair_system: item.hairSystem,
    })),
  };
}

/** The task, where it is in the caller's places; null otherwise, as though there were none. */
async function taskInReach(c: Context<AppEnv>, id: string): Promise<CountTask | null> {
  const task = await countTask(c.env.DB, id);
  if (task === null) return null;
  return isPlaceWithin(await placesWithin(c.env.DB, await routeReach(c)), task.placeId) ? task : null;
}

async function taskAnswer(c: Context<AppEnv>, task: CountTask) {
  const items = await countItems(c.env.DB, task);
  return {
    task: taskJson(task),
    items: items.map((item) => ({ consumable_code: item.code, name: item.name, state: item.state })),
  };
}

const COUNT_DIFFERS = "count_differs:";

async function after(c: Context<AppEnv>, stepped: Stepped) {
  if (!stepped.ok) {
    if ("missing" in stepped) return refuse(c, "not_found");
    if ("state" in stepped) return refuse(c, "order_state");
    return refuse(c, "invalid_request", stepped.fields);
  }
  const { task } = stepped;
  if (task.state === "sign_off") {
    await c.var.deps.alertOnce({
      key: `${COUNT_DIFFERS}${task.id}`,
      message: `${task.place}'s count still differs on ${String(stepped.waiting)} after a recount. It waits for a manager's sign-off on Counts.`,
      link: "/counts",
    });
  }
  if (task.state === "done") await c.var.deps.resolveAlert(`${COUNT_DIFFERS}${task.id}`);
  return c.json(await taskAnswer(c, task), 200);
}

const linesOf = (body: z.infer<typeof Lines>) =>
  body.lines.map((line) => ({ code: line.consumable_code, counted: line.counted }));

export function registerOpsCountTasks(app: App): void {
  app.openapi(listRoute, async (c) => c.json(await tasksAnswer(c), 200));

  app.openapi(taskRoute, async (c) => {
    const task = await taskInReach(c, c.req.valid("param").id);
    if (task === null) return refuse(c, "not_found");
    return c.json(await taskAnswer(c, task), 200);
  });

  app.openapi(differencesRoute, async (c) => {
    const task = await taskInReach(c, c.req.valid("param").id);
    if (task === null) return refuse(c, "not_found");
    const lines = await differences(c.env.DB, task.id);
    return c.json(
      {
        lines: lines.map((line) => ({
          consumable_code: line.code,
          name: line.name,
          held: line.held,
          counted: line.counted,
          recounted: line.recounted,
        })),
      },
      200,
    );
  });

  app.openapi(countsRoute, async (c) => {
    const { id } = c.req.valid("param");
    if ((await taskInReach(c, id)) === null) return refuse(c, "not_found");
    return after(c, await submitCounts(c.env.DB, id, linesOf(c.req.valid("json")), written(c)));
  });

  app.openapi(recountsRoute, async (c) => {
    const { id } = c.req.valid("param");
    if ((await taskInReach(c, id)) === null) return refuse(c, "not_found");
    return after(c, await submitRecounts(c.env.DB, id, linesOf(c.req.valid("json")), written(c)));
  });

  app.openapi(signOffRoute, async (c) => {
    const { id } = c.req.valid("param");
    if ((await taskInReach(c, id)) === null) return refuse(c, "not_found");
    return after(c, await signOff(c.env.DB, id, c.req.valid("json").note, written(c)));
  });

  app.openapi(classRoute, async (c) => {
    const set = await setCountClass(c.env.DB, c.req.valid("param").code, c.req.valid("json").count_class, written(c));
    if (!set) return refuse(c, "not_found");
    return c.json(await tasksAnswer(c), 200);
  });
}
