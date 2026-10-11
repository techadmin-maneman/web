// The cron's look at the Tasks board each hour, which opens and closes each task's span
// (docs/decisions/0147-task-spans.md).

import { recordTaskSpans } from "../domain/ops/task-spans.ts";
import { outstandingTasks } from "../domain/ops/tasks.ts";
import type { CronContext } from "./cron.ts";

export async function taskSpansJob({ env, deps, log, inputs }: CronContext): Promise<void> {
  const now = deps.now();
  const { taskSlaHours, nextVisitDays, careHours } = await inputs();
  const board = await outstandingTasks(env.DB, now, taskSlaHours, { days: nextVisitDays, hours: careHours });
  const { opened, closed } = await recordTaskSpans(env.DB, board, now);
  if (opened + closed > 0) log.info("task_spans_recorded", { opened, closed });
}
