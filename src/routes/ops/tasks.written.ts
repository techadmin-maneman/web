// Tasks ops write themselves (docs/decisions/0302-tasks-written-by-hand.md): written on Tasks for any department, about
// a client or a city the writer's work reaches, and marked done by that department's people.

import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../../http/context.ts";
import { staffMemberOf } from "../../http/audit.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { callerAccess, permits } from "../../http/staff-access.ts";
import { opsRoute } from "../../http/session-routes.ts";
import { cityOf } from "../../domain/clients/places.ts";
import { markStaffTaskDone, openStaffTask, staffTaskGroup, writeStaffTask } from "../../domain/ops/staff-tasks.ts";
import { DEPARTMENTS, EVERYWHERE, placesReached, reachesCity, type PlacesReached } from "../../policy/access.ts";
import { taskNeed } from "../../policy/console-routes.ts";
import { mayOwnTasks } from "../../policy/tasks.ts";
import { noMemberOfStaff, OwnerSchema, staffNow, taskOnTheBoard } from "./tasks.ts";

/** The most a task written by hand says. */
const STAFF_TASK_MAX_CHARS = 200;

const writeRoute = opsRoute({
  method: "post",
  path: "/api/tasks",
  summary: "Write a task by hand, for a department, about a client or a city, due when it is due",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            what: z.string().trim().min(1).max(STAFF_TASK_MAX_CHARS).openapi({ description: "What needs doing." }),
            department: z.enum(DEPARTMENTS).openapi({ description: "The department it is for, whose people see it." }),
            client: z.uuid().nullable().openapi({ description: "The client it is about; null for none." }),
            city: z.string().trim().min(1).max(60).nullable().openapi({
              description: "Where a task about no client is: a city the writer's work reaches; null for every city.",
            }),
            due: z.iso.datetime().openapi({ description: "When it is due; not before now." }),
            owner: OwnerSchema,
          })
          .strict()
          .openapi("StaffTaskWritten"),
      ),
    },
  },
  responses: {
    201: {
      description: "Written, and on the board of the department it is for",
      ...json(z.object({ id: z.uuid() }).strict().openapi("StaffTaskId")),
    },
    400: errorResponse(
      "invalid_request: a due time past, a client or a city the writer's work does not reach, or an owner who has not " +
        "used the console lately",
    ),
    403: errorResponse("access_required: a service token, which names no member of staff; or not_permitted"),
  },
});

const doneRoute = opsRoute({
  method: "post",
  path: "/api/tasks/staff/{id}/done",
  summary: "Mark a task written by hand done; it leaves the board",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    204: { description: "Done" },
    403: errorResponse(
      "access_required: a service token; or not_permitted: it asks Act in the department the task is for",
    ),
    404: errorResponse("not_found: no such task open on the board in the caller's cities"),
  },
});

/** Where the caller's work reaches in any department: a task may be about anywhere they can look. */
async function anyDepartmentReach(c: Context<AppEnv>): Promise<PlacesReached> {
  const access = await callerAccess(c);
  const reaches = DEPARTMENTS.map((department) => placesReached(access, department, "view"));
  if (reaches.some((reach) => reach.kind === "everywhere")) return EVERYWHERE;
  return {
    kind: "cities",
    cities: new Set(reaches.flatMap((reach) => (reach.kind === "cities" ? [...reach.cities] : []))),
  };
}

/** Where a task about this client, or in this city, is; the field refused where the writer's work does not reach it. */
async function placeOf(
  c: Context<AppEnv>,
  asked: { client: string | null; city: string | null },
): Promise<{ city: string | null } | { refused: "client" | "city" }> {
  const reach = await anyDepartmentReach(c);
  if (asked.client !== null) {
    const person = await c.env.DB.prepare("SELECT 1 FROM people WHERE id = ?1 AND erased_at IS NULL")
      .bind(asked.client)
      .first();
    const city = await cityOf(c.env.DB, "client", asked.client);
    return person !== null && reachesCity(reach, city) ? { city: null } : { refused: "client" };
  }
  if (asked.city === null) return reach.kind === "everywhere" ? { city: null } : { refused: "city" };
  const known = await c.env.DB.prepare("SELECT 1 FROM cities WHERE name = ?1").bind(asked.city).first();
  return known !== null && reachesCity(reach, asked.city) ? { city: asked.city } : { refused: "city" };
}

export function registerOpsStaffTasks(app: App): void {
  app.openapi(writeRoute, async (c) => {
    const asked = c.req.valid("json");
    const staff = staffMemberOf(c);
    if (staff === null) return noMemberOfStaff(c);
    const now = c.var.deps.now();
    if (Date.parse(asked.due) < now.getTime()) return refuse(c, "invalid_request", ["due"]);
    const place = await placeOf(c, asked);
    if ("refused" in place) return refuse(c, "invalid_request", [place.refused]);
    // Access gives every e-mail in lower case, and the log keeps it so.
    const owner = asked.owner === null ? null : asked.owner.toLowerCase();
    if (owner !== null && !mayOwnTasks(owner, await staffNow(c))) return refuse(c, "invalid_request", ["owner"]);

    const id = await writeStaffTask(
      c.env.DB,
      {
        what: asked.what,
        department: asked.department,
        personId: asked.client,
        city: place.city,
        dueAt: new Date(asked.due),
        owner,
      },
      {
        by: staff.id,
        now,
        // What it says is ops' words, which may be about a client: kept with the task and never in the log.
        audit: {
          surface: "ops",
          actor: staff,
          action: "task.write",
          requestId: c.var.requestId,
          detail: { group: staffTaskGroup(asked.department), ...(owner === null ? {} : { owner }) },
        },
      },
    );
    return c.json({ id }, 201);
  });

  app.openapi(doneRoute, async (c) => {
    const { id } = c.req.valid("param");
    const staff = staffMemberOf(c);
    if (staff === null) return noMemberOfStaff(c);
    const department = await openStaffTask(c.env.DB, id);
    if (department === null) return refuse(c, "not_found");
    const group = staffTaskGroup(department);
    if (!(await permits(c, taskNeed(group, "act")))) return refuse(c, "not_permitted");
    if ((await taskOnTheBoard(c, { group, id })) === null) return refuse(c, "not_found");

    const now = c.var.deps.now();
    const done = await markStaffTaskDone(c.env.DB, id, {
      by: staff.id,
      now,
      audit: {
        surface: "ops",
        actor: staff,
        action: "task.done",
        subject: { kind: "task", id },
        requestId: c.var.requestId,
        detail: { group },
      },
    });
    return done ? c.body(null, 204) : refuse(c, "not_found");
  });
}
