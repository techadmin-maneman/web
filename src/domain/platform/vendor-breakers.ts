// A vendor that keeps failing, held off as a whole (docs/decisions/0203-a-vendor-down-is-held-off.md). Its failures in
// a row are counted in D1; at BREAKER_FAILURES it is held for BREAKER_HOLD_MINUTES, during which its work waits without
// counting against what it was for, and ops hear one alert. A failure once the hold is over holds it again at once;
// the first answer closes it, and the alert, and what waited goes on with the sweeper's next pass.

import { ALERT_WORDS } from "../../config/alert-words.ts";
import { MINUTE_MS } from "../../lib/durations.ts";
import {
  BREAKER_FAILURES,
  BREAKER_HOLD_MINUTES,
  BREAKER_VENDORS,
  type BreakerVendor,
} from "../../policy/vendor-breakers.ts";
import type { AlertOnce, ResolveAlert } from "./alerts.ts";

const alertKey = (vendor: BreakerVendor) => `vendor_down:${vendor}`;

/** Until when the vendor's work waits; null while it may be tried. */
export async function heldUntil(db: D1Database, vendor: BreakerVendor, now: Date): Promise<Date | null> {
  const until = await db
    .prepare("SELECT open_until FROM vendor_breakers WHERE vendor = ?1 AND open_until > ?2")
    .bind(vendor, now.toISOString())
    .first<string>("open_until");
  return until === null ? null : new Date(until);
}

/**
 * One more failure of the vendor's own, not its refusing a record. Answers whether the vendor is held now: a try
 * that failed into a hold is not counted against what it was for.
 */
export async function noteOutage(
  db: D1Database,
  outage: { readonly vendor: BreakerVendor; readonly now: Date; readonly alertOnce: AlertOnce },
): Promise<boolean> {
  const { vendor, now } = outage;
  const row = await db
    .prepare(
      `INSERT INTO vendor_breakers (vendor, failures, open_until, opened_at) VALUES (?1, 1, NULL, NULL)
       ON CONFLICT (vendor) DO UPDATE SET failures = failures + 1,
         open_until = CASE WHEN failures + 1 >= ?2 THEN ?3 ELSE open_until END,
         opened_at = CASE WHEN failures + 1 >= ?2 THEN COALESCE(opened_at, ?4) ELSE opened_at END
       RETURNING failures, opened_at`,
    )
    .bind(
      vendor,
      BREAKER_FAILURES,
      new Date(now.getTime() + BREAKER_HOLD_MINUTES * MINUTE_MS).toISOString(),
      now.toISOString(),
    )
    .first<{ failures: number; opened_at: string | null }>();
  const since = row?.opened_at ?? null;
  if (row === null || since === null) return false;
  await outage.alertOnce({
    key: alertKey(vendor),
    message: ALERT_WORDS.vendor_down({ vendor: BREAKER_VENDORS[vendor], since, failures: row.failures }),
  });
  return true;
}

/** The vendor answered: its failures start again from none, and a hold, with its alert, ends. */
export async function noteAnswered(db: D1Database, vendor: BreakerVendor, resolveAlert: ResolveAlert): Promise<void> {
  const reset = await db
    .prepare(
      `UPDATE vendor_breakers SET failures = 0, open_until = NULL, opened_at = NULL
       WHERE vendor = ?1 AND failures > 0 RETURNING opened_at`,
    )
    .bind(vendor)
    .first();
  if (reset !== null) await resolveAlert(alertKey(vendor));
}
