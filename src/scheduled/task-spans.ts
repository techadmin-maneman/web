// The cron's look at the Tasks board each night, in the hour from 11 pm in India, which opens and closes each task's
// span (docs/decisions/0147-task-spans.md). Late in the day, so a task closed that day is dated that day.

import { recordTaskSpans } from "../domain/ops/task-spans.ts";
import { outstandingTasks } from "../domain/ops/tasks.ts";
import { indiaHour } from "../lib/india-time.ts";
import type { CronContext } from "./cron.ts";

export async function taskSpansJob({ env, deps, log, inputs }: CronContext): Promise<void> {
  const now = deps.now();
  if (!indiaHour(now).endsWith("T23")) return;
  const { taskSlaHours, nextVisitDays, careHours } = await inputs();
  const board = await outstandingTasks(env.DB, now, taskSlaHours, { days: nextVisitDays, hours: careHours });
  const { opened, closed } = await recordTaskSpans(env.DB, board, now);
  if (opened + closed > 0) log.info("task_spans_recorded", { opened, closed });
}
