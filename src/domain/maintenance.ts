// The switch an operator sets while D1 is restored (docs/runbook.md, "Restoring D1"). While `maintenance` holds its
// row, the cron and every queue consumer stop before anything else, so none of them acts on a database that is being
// put back to an earlier minute. Still on an hour later, it is a step forgotten, and ops are told.

import type { AlertOnce } from "./alerts.ts";

export interface Maintenance {
  readonly reason: string;
  readonly startedAt: string;
}

/** How long a batch a consumer turns away waits before it is delivered again. */
export const MAINTENANCE_RETRY_SECONDS = 300;

/** Longer than any restore takes. */
const FORGOTTEN_AFTER_MS = 60 * 60 * 1000;

/** The maintenance under way, or null when there is none. */
export async function maintenanceUnderWay(db: D1Database): Promise<Maintenance | null> {
  const row = await db
    .prepare("SELECT reason, started_at FROM maintenance WHERE id = 1")
    .first<{ reason: string; started_at: string }>();
  if (row === null) return null;
  return { reason: row.reason, startedAt: row.started_at };
}

export async function alertIfForgotten(maintenance: Maintenance, alertOnce: AlertOnce, now: Date): Promise<void> {
  const onFor = now.getTime() - Date.parse(maintenance.startedAt);
  if (onFor < FORGOTTEN_AFTER_MS) return;
  await alertOnce({
    key: `maintenance:${maintenance.startedAt}`,
    message:
      `The cron and the queue consumers have stood still since ${maintenance.startedAt} for maintenance ` +
      `(${maintenance.reason}). Once it is done, delete the row in maintenance: docs/runbook.md, "Restoring D1".`,
  });
}
