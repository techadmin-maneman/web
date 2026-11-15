// The cron's part in the client's alerts (src/domain/clients/app-alerts.ts), every five minutes: a push for each alert
// new since; and, in the hour the technicians' day ahead goes, the alerts older than the inbox shows deleted.

import { dropOldClientAlerts, pushNewClientAlerts } from "../domain/clients/app-alerts.ts";
import { indiaTime } from "../lib/india-time.ts";
import type { CronContext } from "./cron.ts";

export async function clientAlertsJob({ env, deps, log, inputs, budget }: CronContext): Promise<void> {
  const now = deps.now();
  if (Number(indiaTime(now).slice(0, 2)) === (await inputs()).dayAheadHour && indiaTime(now).slice(3, 5) < "05") {
    await dropOldClientAlerts(env.DB, now);
  }
  const pushed = await pushNewClientAlerts(env.DB, { push: deps.push, budget, now });
  if (pushed > 0) log.info("client_alerts_pushed", { pushed });
}
