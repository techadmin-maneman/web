// The cron's part in the nightly reporting copy (docs/decisions/0146-the-nightly-analytics-copy.md,
// 0196-long-work-in-workflows.md): due from 3 am in India (its slot, ./cron.ts), it starts the night's Workflow
// (src/workflows/analytics-copy.ts), or follows the one started, and is done once that has finished.

import { indiaDate } from "../lib/india-time.ts";
import { startOrFollow } from "../workflows/steps.ts";
import type { CronContext } from "./cron.ts";

export async function analyticsJob({ env, deps, config, slot }: CronContext): Promise<unknown> {
  const date = slot?.date ?? indiaDate(deps.now());
  const provider = config.providers.ANALYTICS_PROVIDER;
  const switchedOff =
    config.settings.analytics.clientKeySecret === null ||
    provider === "none" ||
    (provider === "supabase" && env.ANALYTICS_DB === undefined);
  if (switchedOff) return undefined;
  return startOrFollow(env.ANALYTICS_COPY, { id: `copy-${date}`, params: { date } });
}
