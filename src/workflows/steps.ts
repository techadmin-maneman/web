// What the Workflows share (docs/decisions/0196-long-work-in-workflows.md): the part of a Workflow's step they use, so
// a test can stand in for it; how each step is tried again; and how the cron starts a Workflow's run or follows it.

import type { WorkflowStepConfig } from "cloudflare:workers";
import type { Dependencies } from "../dependencies.ts";
import type { StaticConfig } from "../guard.ts";
import { STILL_RUNNING } from "../scheduled/schedule.ts";

/** The part of a Workflow's step the Workflows use. */
export interface Steps {
  do<T extends Rpc.Serializable<T>>(name: string, config: WorkflowStepConfig, run: () => Promise<T>): Promise<T>;
}

/** Each step tried three times more, a minute apart and longer each time, within ten minutes a try. */
export const STEP_RETRIES: WorkflowStepConfig = {
  retries: { limit: 3, delay: "1 minute", backoff: "exponential" },
  timeout: "10 minutes",
};

/** What a Workflow's run is given, as the Worker's other handlers are. */
export interface WorkflowRun {
  readonly env: Env;
  readonly config: StaticConfig;
  readonly deps: Dependencies;
}

async function instanceOf<Params>(workflow: Workflow<Params>, id: string): Promise<WorkflowInstance | null> {
  try {
    return await workflow.get(id);
  } catch {
    return null;
  }
}

/**
 * Starts the Workflow's run under this id, or follows the one started: "complete" once it has finished, otherwise
 * still running; one that failed for good is started again. One id a night or a week, so the work is done once.
 */
export async function startOrFollow<Params>(
  workflow: Workflow<Params>,
  { id, params }: { readonly id: string; readonly params: Params },
): Promise<"complete" | typeof STILL_RUNNING> {
  const instance = await instanceOf(workflow, id);
  if (instance === null) {
    await workflow.create({ id, params });
    return STILL_RUNNING;
  }
  const { status } = await instance.status();
  if (status === "complete") return "complete";
  if (status === "errored" || status === "terminated") await instance.restart();
  return STILL_RUNNING;
}
