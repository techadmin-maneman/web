// The cron's part in the unanswered-lead alert (docs/decisions/0323-the-unanswered-lead-alert.md), every minute: a push
// to Care on shift for each lead newly past its alert time (src/domain/leads/lead-alerts.ts).

import { pushLeadAlerts } from "../domain/leads/lead-alerts.ts";
import type { CronContext } from "./cron.ts";

export async function leadAlertsJob({ env, deps, inputs, budget, log }: CronContext): Promise<void> {
  const { careHours } = await inputs();
  const pushed = await pushLeadAlerts(env.DB, { push: deps.push, budget, now: deps.now(), hours: careHours });
  if (pushed > 0) log.info("lead_alerts_pushed", { pushed });
}
