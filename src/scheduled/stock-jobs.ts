// The cron's stock and purchasing jobs (./cron.ts runs them, ./schedule.ts says when): the fits at risk for want of a
// hair system, the forecast and its accuracy, tomorrow's kits, the cycle counts, and stock that expires or is late.

import { tellOfExpiring, tellOfOverdue } from "../domain/inventory/stock-watch.ts";
import { refreshStockRisks } from "../domain/inventory/stock-risks.ts";
import { measureLastForecast } from "../domain/purchasing/forecast-accuracy.ts";
import { runForecastIfDue } from "../domain/purchasing/forecast.ts";
import { draftPlan } from "../domain/purchasing/supply-plan.ts";
import { checkTomorrowsKits } from "../domain/inventory/kit-check.ts";
import { raiseCountTasks } from "../domain/inventory/cycle-counts.ts";
import { indiaDate } from "../lib/india-time.ts";
import { classDaysOf } from "../policy/cycle-counts.ts";
import type { CronContext } from "./cron.ts";

/** The fits booked ahead with no hair system in reach, kept as tasks each hour (src/domain/inventory/stock-risks.ts). */
export async function stockRisksJob({ env, deps, inputs }: CronContext): Promise<void> {
  const now = deps.now();
  await refreshStockRisks(env.DB, indiaDate(now), now, (await inputs()).stockWatch.demand_days);
}

/** How right the last forecast was, once its first period has passed (src/domain/purchasing/forecast-accuracy.ts). */
export const forecastAccuracyJob = ({ env, deps }: CronContext) =>
  measureLastForecast(env.DB, deps.now(), indiaDate(deps.now()));

/** Once each planning period: the demand forecast, and the supply plan drafted from it. */
export async function forecastJob({ env, deps, inputs }: CronContext): Promise<void> {
  const now = deps.now();
  const given = await inputs();
  const run = await runForecastIfDue(env.DB, now, given);
  if (run !== null) await draftPlan(env.DB, run, now, given.planningPeriodDays);
}

/** Each evening hour: tomorrow's kits, and their top-ups (src/domain/inventory/kit-check.ts). */
export const kitCheckJob = async ({ env, deps, inputs }: CronContext) =>
  checkTomorrowsKits(env.DB, deps.now(), deps.alertOnce, (await inputs()).kitCheck);

/** The morning's cycle counts (src/domain/inventory/cycle-counts.ts). */
export const cycleCountsJob = async ({ env, deps, inputs, slot }: CronContext) =>
  raiseCountTasks(env.DB, slot?.date ?? indiaDate(deps.now()), deps.now(), classDaysOf((await inputs()).cycleCounts));

/** The morning's stock that expires soon, and transfers long on their way (src/domain/inventory/stock-watch.ts). */
export const expiringStockJob = async ({ env, deps, inputs, slot }: CronContext) =>
  tellOfExpiring(env.DB, deps, slot?.date ?? indiaDate(deps.now()), (await inputs()).stockWatch.expiry_warning_days);
export const overdueTransfersJob = async ({ env, deps, inputs }: CronContext) =>
  tellOfOverdue(env.DB, deps, deps.now(), (await inputs()).stockWatch.transfer_overdue_days);
