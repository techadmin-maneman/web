// The Tasks board as the caller reads it (docs/decisions/0303-snoozing-a-task.md): each group where their grants
// reach, the groups of their own departments, and the tasks past the lapse days apart. Tasks (src/routes/ops/tasks.ts)
// answers it; Clients' view "Needs something" (src/routes/ops/clients.ts) reads the clients it names.

import type { Context } from "hono";
import type { AppEnv } from "./context.ts";
import { opsInputs } from "./ops-inputs.ts";
import { callerAccess } from "./staff-access.ts";
import { outstandingTasks, type Task } from "../domain/ops/tasks.ts";
import { narrowedTo, placesReached, type Level } from "../policy/access.ts";
import { callerMeetsNeed, TASK_DEPARTMENTS, taskNeed } from "../policy/console-routes.ts";
import { boardDays } from "../policy/next-visit.ts";
import { selfServeKinds } from "../policy/self-serve.ts";
import { hasLapsed, lapsesFrom, TASK_GROUPS, type TaskGroup } from "../policy/tasks.ts";

/**
 * Every task on the board in the caller's cities, or one client's, as a look at it reads them now: each group's where
 * their grants in its department reach at the level asked.
 */
export async function readTheBoard(c: Context<AppEnv>, level: Level, person?: string, city?: string) {
  const [inputs, access] = await Promise.all([opsInputs(c), callerAccess(c)]);
  const fitsSelfBooked = selfServeKinds(c.var.config.settings).includes("first_fit");
  return outstandingTasks(c.env.DB, c.var.deps.now(), inputs.taskSlaHours, {
    days: boardDays(inputs.nextVisitDays, fitsSelfBooked),
    hours: inputs.careHours,
    lostAfter: inputs.lostAfterDays,
    arrival: inputs.bookingRules.arrival,
    lapseDays: inputs.taskLapseDays,
    reach: (group: TaskGroup) => narrowedTo(placesReached(access, TASK_DEPARTMENTS[group], level), city),
    person,
    awake: true,
  });
}

/** The groups of the caller's own departments; every group while the Staff list is not enforced. */
export async function groupsSeenBy(c: Context<AppEnv>): Promise<TaskGroup[]> {
  const access = await callerAccess(c);
  if (!access.enforced) return [...TASK_GROUPS];
  return TASK_GROUPS.filter((group) => callerMeetsNeed(access.caller, taskNeed(group, "view"), access.zoneOf));
}

/** The tasks of the groups seen, less those past the lapse days unless they are asked for, and those apart. */
export function splitLapsed(
  all: readonly Task[],
  look: { seen: readonly TaskGroup[]; asked: "include" | undefined; now: Date; lapseDays: number },
) {
  const lapsedOf = (task: Task) => look.asked !== "include" && hasLapsed(lapsesFrom(task), look.now, look.lapseDays);
  const seen = all.filter((task) => look.seen.includes(task.group));
  return { tasks: seen.filter((task) => !lapsedOf(task)), lapsed: seen.filter(lapsedOf) };
}

/**
 * The clients a task waits on, as the caller's board reads it now in the city given, and whether a queue was read
 * only in part, so some may be missing.
 */
export async function clientsWaitedOn(c: Context<AppEnv>, city: string | undefined) {
  const [board, seen, inputs] = await Promise.all([
    readTheBoard(c, "view", undefined, city),
    groupsSeenBy(c),
    opsInputs(c),
  ]);
  const look = { seen, asked: undefined, now: c.var.deps.now(), lapseDays: inputs.taskLapseDays };
  const people = splitLapsed(board.tasks, look).tasks.flatMap((task) => (task.person === null ? [] : [task.person.id]));
  return { ids: [...new Set(people)], truncated: board.truncated };
}
