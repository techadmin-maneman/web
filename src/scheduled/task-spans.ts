// The cron's look at the Tasks board each night, due from 11 pm in India (its slot, src/scheduled/cron.ts): it opens and
// closes each task's span (docs/decisions/0147-task-spans.md). Late in the day, so a task closed that day is dated so.

import { recordTaskSpans } from "../domain/ops/task-spans.ts";
import { outstandingTasks } from "../domain/ops/tasks.ts";
import { boardDays } from "../policy/next-visit.ts";
import { selfServeKinds } from "../policy/self-serve.ts";
import type { CronContext } from "./cron.ts";

export async function taskSpansJob({ env, deps, log, inputs, config }: CronContext): Promise<void> {
  const now = deps.now();
  const { taskSlaHours, nextVisitDays, careHours, lostAfterDays } = await inputs();
  const days = boardDays(nextVisitDays, selfServeKinds(config.settings).includes("first_fit"));
  const scope = { days, hours: careHours, lostAfter: lostAfterDays };
  const board = await outstandingTasks(env.DB, now, taskSlaHours, scope);
  const { opened, closed } = await recordTaskSpans(env.DB, board, now);
  if (opened + closed > 0) log.info("task_spans_recorded", { opened, closed });
}
