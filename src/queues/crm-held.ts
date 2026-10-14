// What the CRM consumer's writes share: whether the CRM is held off as a whole
// (docs/decisions/0203-a-vendor-down-is-held-off.md), and a failure in words fit for a log line and an alert.

import type { Dependencies } from "../dependencies.ts";
import { heldUntil, noteOutage } from "../domain/platform/vendor-breakers.ts";
import { scrubString } from "../log.ts";
import { isRefusal } from "../providers/provider-error.ts";

/** Whether the CRM is held off now: its work waits, uncounted, for the sweeper. */
export const crmHeld = async (db: D1Database, deps: Dependencies): Promise<boolean> =>
  (await heldUntil(db, "crm", deps.now())) !== null;

/** A failed try: whether it held the CRM off, being the CRM's own failure, so it counts against no record. */
export const heldBy = async (db: D1Database, deps: Dependencies, error: unknown): Promise<boolean> =>
  !isRefusal(error) && (await noteOutage(db, { vendor: "crm", now: deps.now(), alertOnce: deps.alertOnce }));

/** A failure as a log line or an alert quotes it: its message, scrubbed, at most 300 characters. */
export function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return scrubString(message).slice(0, 300);
}
