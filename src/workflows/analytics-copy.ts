// The nightly reporting copy as a Workflow (docs/decisions/0146-the-nightly-analytics-copy.md, 0196-long-work-in-
// workflows.md): a step for each part of the night (src/domain/analytics/nightly.ts), each tried again on its own, then
// the swap that puts the whole night in at once, and what ops are told. The cron starts one a night, named for the date
// (src/scheduled/analytics.ts).

import {
  finishNight,
  NIGHT_PARTS,
  stagePart,
  WAREHOUSE_ALERT_BYTES,
  type NightGiven,
} from "../domain/analytics/nightly.ts";
import { readOpsInputs } from "../domain/platform/ops-settings.ts";
import { failureReason } from "../log.ts";
import type { TableMeta, WarehouseProvider } from "../providers/warehouse/index.ts";
import { STEP_RETRIES, type Steps, type WorkflowRun } from "./steps.ts";
import { ALERT_WORDS } from "../config/alert-words.ts";

export interface CopyRun extends WorkflowRun {
  /** The copy's store, opened for each step and closed after it; null where the copy is switched off. */
  readonly warehouse: () => WarehouseProvider | null;
}

/** What the swap answers: what it wrote and changed, whether the totals matched, and the store's size. */
interface Swapped {
  readonly written: number;
  readonly changed: number;
  readonly totalsChecked: boolean;
  readonly bytes: number;
}

export async function copyNight(steps: Steps, run: CopyRun, date: string): Promise<void> {
  const secret = run.config.settings.analytics.clientKeySecret;
  if (secret === null) return;
  const withWarehouse = async <T>(work: (warehouse: WarehouseProvider) => Promise<T>): Promise<T> => {
    const warehouse = run.warehouse();
    if (warehouse === null) throw new Error("the reporting copy's store is switched off");
    try {
      return await work(warehouse);
    } finally {
      await warehouse.close();
    }
  };
  try {
    const begun = await steps.do("begin", STEP_RETRIES, async () => {
      if (await withWarehouse((warehouse) => warehouse.ranOn(date))) return null;
      const { nextVisitDays, lostAfterDays, bookingRules } = await readOpsInputs(run.env.DB, new Date());
      const standing = {
        cadence: nextVisitDays.service_cadence,
        grace: nextVisitDays.at_risk_after_due,
        lostAfter: lostAfterDays,
      };
      return { startedAt: new Date().toISOString(), standing, arrivalMinutes: bookingRules.arrival };
    });
    if (begun === null) return;
    const given: NightGiven = {
      secret,
      date,
      now: () => new Date(),
      standing: begun.standing,
      arrivalMinutes: begun.arrivalMinutes,
    };
    const staged: TableMeta[] = [];
    for (const part of NIGHT_PARTS) {
      const tables = await steps.do(`stage ${part.name}`, STEP_RETRIES, () =>
        withWarehouse((warehouse) => stagePart(run.env.DB, warehouse, { part, given })),
      );
      staged.push(...tables);
    }
    const swapped = await steps.do("swap", STEP_RETRIES, () =>
      withWarehouse(async (warehouse): Promise<Swapped> => {
        const log = await finishNight(warehouse, { staged, given, startedAt: new Date(begun.startedAt) });
        return {
          written: log.rowsWritten,
          changed: log.rowsChanged,
          totalsChecked: log.totalsChecked,
          bytes: log.databaseBytes,
        };
      }),
    );
    await steps.do("tell", STEP_RETRIES, () => tell(run, swapped));
  } catch (error) {
    await steps.do("tell of the failure", STEP_RETRIES, async () => {
      await run.deps.alertOnce({
        key: "analytics_copy_failed",
        message: ALERT_WORDS.analytics_copy_failed({ reason: failureReason(error) }),
      });
      return true;
    });
    throw error;
  }
}

/** What ops are told of a night copied: the totals, and the store's size; a copy that worked closes its failure. */
async function tell({ deps }: CopyRun, swapped: Swapped): Promise<boolean> {
  await deps.resolveAlert("analytics_copy_failed");
  if (swapped.totalsChecked) await deps.resolveAlert("analytics_totals");
  else {
    await deps.alertOnce({
      key: "analytics_totals",
      message: ALERT_WORDS.analytics_totals(),
    });
  }
  if (swapped.bytes < WAREHOUSE_ALERT_BYTES) await deps.resolveAlert("analytics_size");
  else {
    await deps.alertOnce({
      key: "analytics_size",
      message: ALERT_WORDS.analytics_size(),
    });
  }
  return true;
}
