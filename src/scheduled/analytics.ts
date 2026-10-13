// The cron's reporting copy, once a night, due from 3 am in India (its slot, src/scheduled/cron.ts)
// (docs/decisions/0146-the-nightly-analytics-copy.md). A copy whose totals differ from what it was sent, or a store
// near the free plan's limit, alerts.

import { copyTonight, WAREHOUSE_ALERT_BYTES } from "../domain/analytics/nightly.ts";
import { indiaDate } from "../lib/india-time.ts";
import { warehouseFor } from "../providers/warehouse/index.ts";
import type { CronContext } from "./cron.ts";

export async function analyticsJob({ env, deps, config, log, inputs, slot }: CronContext): Promise<void> {
  const date = slot?.date ?? indiaDate(deps.now());
  const secret = config.settings.analytics.clientKeySecret;
  const warehouse = warehouseFor(config.providers.ANALYTICS_PROVIDER, env.ANALYTICS_DB?.connectionString ?? null);
  if (secret === null || warehouse === null) return;
  try {
    if (await warehouse.ranOn(date)) return;
    const { nextVisitDays, lostAfterDays } = await inputs();
    const standing = {
      cadence: nextVisitDays.service_cadence,
      grace: nextVisitDays.at_risk_after_due,
      lostAfter: lostAfterDays,
    };
    const run = await copyTonight(env.DB, warehouse, { secret, date, now: deps.now, standing });
    log.info("analytics_copied", { written: run.rowsWritten, changed: run.rowsChanged, bytes: run.databaseBytes });
    if (run.totalsChecked) await deps.resolveAlert("analytics_totals");
    else {
      await deps.alertOnce({
        key: "analytics_totals",
        message:
          "Last night's reporting copy does not match the bookings and payments it was sent. Reports may be off.",
      });
    }
    if (run.databaseBytes < WAREHOUSE_ALERT_BYTES) await deps.resolveAlert("analytics_size");
    else {
      await deps.alertOnce({
        key: "analytics_size",
        message: "The reporting copy is near its 500 MB limit in Supabase. Trim the oldest rows or move up a plan.",
      });
    }
  } finally {
    await warehouse.close();
  }
}
